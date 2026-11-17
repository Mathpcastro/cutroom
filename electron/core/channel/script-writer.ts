import { createHash } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import {
  GLOBAL_FORBIDDEN,
  COMPILED_SCENES,
  REAL_IMAGE_SCENES,
  TEXT_SCENES,
  beatSchema,
  sceneSchema,
  scriptSchema,
  type Beat,
  type Channel,
  type Episode,
  type Research,
  type Scene,
  type Script,
} from "../../../src/shared/channel";
import type { ChannelStore } from "./channel-store";
import { readJsonOr, writeJsonAtomic } from "./fs-json";
import { toSay, type Pronunciations } from "./pt-numbers";
import { factWarnings, usableFact } from "./research";

/**
 * Roteiro em falas (spec "Roteiro"). The script is a list of beats, never running text cut later.
 * Agent first: the agent writes the beats from `scriptBrief`; the app assigns stable ids,
 * fills `say` for the TTS, hashes each beat and reviews the script before asking for approval.
 * Every edit is by beat id (insert before/after an id), never by position.
 */

export const DEFAULT_WPM = 160;

// ---------- hashing & ids ----------

export function beatHash(beat: Pick<Beat, "text" | "say" | "scene">) {
  return createHash("sha1").update(JSON.stringify([beat.text, beat.say ?? "", beat.scene])).digest("hex").slice(0, 16);
}
const beatIdOf = (n: number) => `b_${String(n).padStart(3, "0")}`;

export const beatInputSchema = z.object({
  section: z.string().regex(/^[a-z0-9-]{1,40}$/),
  text: z.string().trim().min(1).max(600),
  say: z.string().max(1200).optional(),
  facts: z.array(z.string()).max(12).default([]),
  scene: sceneSchema.default({ type: "title", data: {}, media: [] }),
  cta: z.enum(["comment", "subscribe", "like", "endscreen", "next"]).optional(),
});
export type BeatInput = z.input<typeof beatInputSchema>;
/** Patch of a beat: no defaults (a `.partial()` of the input schema would fill `scene` and `facts` and wipe them). */
export const beatPatchSchema = z.object({
  section: z.string().regex(/^[a-z0-9-]{1,40}$/).optional(),
  text: z.string().trim().min(1).max(600).optional(),
  say: z.string().max(1200).optional(),
  facts: z.array(z.string()).max(12).optional(),
  scene: sceneSchema.partial().optional(),
  cta: z.enum(["comment", "subscribe", "like", "endscreen", "next"]).optional(),
});

function makeBeat(id: string, input: BeatInput, dictionary: Pronunciations, isNew?: boolean): Beat {
  const b = beatInputSchema.parse(input);
  const say = b.say?.trim() || toSay(b.text, dictionary);
  const draft = { id, section: b.section, text: b.text, say: say === b.text ? undefined : say, facts: b.facts, scene: b.scene, cta: b.cta, isNew: isNew || undefined };
  return beatSchema.parse({ ...draft, hash: beatHash(draft) });
}

// ---------- pronunciations ----------

export async function readPronunciations(store: ChannelStore, profileId: string, channelId: string): Promise<Pronunciations> {
  const raw = await readJsonOr(join(store.channelDir(profileId, channelId), "pronunciations.json"), () => ({}));
  return z.record(z.string().max(80), z.string().max(160)).catch({}).parse(raw);
}
export async function writePronunciations(store: ChannelStore, profileId: string, channelId: string, dict: Pronunciations) {
  const parsed = z.record(z.string().min(1).max(80), z.string().min(1).max(160)).parse(dict);
  await writeJsonAtomic(join(store.channelDir(profileId, channelId), "pronunciations.json"), parsed);
  return parsed;
}

// ---------- building ----------

/** Builds a full script from the agent's beats (replaces any previous script). */
export function buildScript(input: { sections?: { id: string; title: string }[]; beats: BeatInput[]; wpm?: number }, channel: Channel, dictionary: Pronunciations = {}): Script {
  const sections = input.sections?.length ? input.sections : channel.bible.structure.map((m) => ({ id: m.id, title: m.title }));
  const beats = input.beats.map((b, i) => makeBeat(beatIdOf(i + 1), b, dictionary));
  return scriptSchema.parse({ schemaVersion: 1, sections, beats, nextBeat: beats.length + 1, wpm: input.wpm, updatedAt: new Date().toISOString() });
}

// ---------- editing by id ----------

export const beatEditSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("insert"), after: z.string().optional(), before: z.string().optional(), beat: beatInputSchema }),
  z.object({ op: z.literal("update"), id: z.string(), patch: beatPatchSchema }),
  z.object({ op: z.literal("delete"), id: z.string() }),
  z.object({ op: z.literal("move"), id: z.string(), after: z.string().optional(), before: z.string().optional() }),
]);
export type BeatEdit = z.input<typeof beatEditSchema>;

/**
 * Applies edits by beat id. Inserting after `b_014` lands right after `b_014` whatever
 * else was inserted before (the real bug: beats inserted out of order in 2 episodes).
 * `narrated` marks new and changed beats `isNew` so only they are narrated again.
 */
export function applyBeatEdits(script: Script, edits: BeatEdit[], options: { dictionary?: Pronunciations; narrated?: boolean } = {}) {
  const dict = options.dictionary ?? {};
  const beats = [...script.beats];
  let next = script.nextBeat;
  const changed: string[] = [];
  const removed: string[] = [];
  const indexOf = (id: string) => {
    const i = beats.findIndex((b) => b.id === id);
    if (i < 0) throw Object.assign(new Error(`A fala ${id} não existe no roteiro.`), { code: "BEAT_NOT_FOUND" });
    return i;
  };
  const anchor = (after?: string, before?: string) => {
    if (after && before) throw new Error("Use after OU before, não os dois.");
    if (after) return indexOf(after) + 1;
    if (before) return indexOf(before);
    throw Object.assign(new Error("Diga onde inserir: after ou before com o id de uma fala (nunca por posição)."), { code: "BEAT_ANCHOR_REQUIRED" });
  };
  for (const raw of edits) {
    const edit = beatEditSchema.parse(raw);
    if (edit.op === "insert") {
      const at = anchor(edit.after, edit.before);
      const beat = makeBeat(beatIdOf(next++), edit.beat, dict, options.narrated);
      beats.splice(at, 0, beat);
      changed.push(beat.id);
    } else if (edit.op === "update") {
      const i = indexOf(edit.id);
      const cur = beats[i];
      const textChanged = edit.patch.text !== undefined && edit.patch.text !== cur.text;
      const merged: BeatInput = {
        section: edit.patch.section ?? cur.section,
        text: edit.patch.text ?? cur.text,
        // A new text gets a new `say` unless one was given.
        say: edit.patch.say ?? (textChanged ? undefined : cur.say),
        facts: edit.patch.facts ?? cur.facts,
        scene: edit.patch.scene ? { ...cur.scene, ...edit.patch.scene } : cur.scene,
        cta: edit.patch.cta ?? cur.cta,
      };
      const beat = makeBeat(cur.id, merged, dict, cur.isNew || (options.narrated && (textChanged || edit.patch.say !== undefined)));
      beats[i] = { ...beat, timing: textChanged || edit.patch.say !== undefined ? undefined : cur.timing };
      if (beat.hash !== cur.hash) changed.push(cur.id);
    } else if (edit.op === "delete") {
      beats.splice(indexOf(edit.id), 1);
      removed.push(edit.id);
    } else {
      const [beat] = beats.splice(indexOf(edit.id), 1);
      beats.splice(anchor(edit.after, edit.before), 0, beat);
      changed.push(beat.id);
    }
  }
  const out = scriptSchema.parse({ ...script, beats, nextBeat: next, updatedAt: new Date().toISOString() });
  return { script: out, changed: [...new Set(changed)], removed };
}

// ---------- duration ----------

export function countWords(s: string) {
  return s.split(/\s+/).filter((w) => /[\p{L}\d]/u.test(w)).length;
}
export function estimateSeconds(beats: Pick<Beat, "text" | "say">[], wpm = DEFAULT_WPM) {
  return (beats.reduce((s, b) => s + countWords(b.say ?? b.text), 0) / wpm) * 60;
}
/** Spec: target = channel minimum + 8% (long); the short is 30–60 s. */
export function durationTarget(channel: Channel, format: Episode["format"]) {
  if (format === "short") return { minSec: 30, targetSec: 50, maxSec: 59 };
  const minSec = channel.defaults.longMinMinutes * 60;
  return { minSec, targetSec: Math.round(minSec * 1.08), maxSec: 20 * 60 };
}

// ---------- review ----------

export type ScriptIssue = { level: "erro" | "aviso"; code: string; beatId?: string; message: string };

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const hasNumber = (s: string) => /\d/.test(s) || /\b(mil|milh(ão|ões|ao|oes)|bilh(ão|ões|ao|oes)|por cento)\b/i.test(s);
const sentences = (s: string) => s.split(/(?<=[.!?])\s+/).filter((x) => x.trim());
const isRealImage = (scene: Scene) => REAL_IMAGE_SCENES.includes(scene.type) || Boolean(scene.bgVideo);
const TEASER = /(at[eé] o final|no final|l[aá] no fim|no fim do v[ií]deo|fica at[eé])/i;

/** Automatic review before asking for approval (spec "Revisão automática do roteiro"). */
export function reviewScript(script: Script, ctx: { channel: Channel; research?: Research; format: Episode["format"] }): { ok: boolean; issues: ScriptIssue[]; stats: Record<string, number> } {
  const { channel, research, format } = ctx;
  const bible = channel.bible;
  const issues: ScriptIssue[] = [];
  const beats = script.beats;
  const factsById = new Map((research?.facts ?? []).map((f) => [f.id, f]));
  const wpm = script.wpm ?? DEFAULT_WPM;
  if (!beats.length) return { ok: false, issues: [{ level: "erro", code: "EMPTY", message: "O roteiro não tem falas." }], stats: {} };

  // Ids unique; sections contiguous and in the order of the structure.
  const ids = new Set<string>();
  for (const b of beats) {
    if (ids.has(b.id)) issues.push({ level: "erro", code: "DUPLICATE_ID", beatId: b.id, message: `Id de fala repetido: ${b.id}.` });
    ids.add(b.id);
  }
  const order = script.sections.map((s) => s.id);
  const seenSections: string[] = [];
  for (const b of beats) {
    if (!order.includes(b.section)) issues.push({ level: "erro", code: "UNKNOWN_SECTION", beatId: b.id, message: `Seção "${b.section}" não existe no roteiro.` });
    if (seenSections.at(-1) !== b.section) {
      if (seenSections.includes(b.section)) issues.push({ level: "erro", code: "ORDER", beatId: b.id, message: `A seção "${b.section}" volta depois de outra: falas fora de ordem.` });
      seenSections.push(b.section);
    }
  }
  for (let i = 1; i < seenSections.length; i++)
    if (order.indexOf(seenSections[i]) < order.indexOf(seenSections[i - 1]))
      issues.push({ level: "erro", code: "ORDER", message: `A seção "${seenSections[i]}" vem antes de "${seenSections[i - 1]}" na estrutura.` });

  // Every number has a usable fact.
  for (const b of beats) {
    if (!hasNumber(b.text) || b.cta) continue;
    const facts = b.facts.map((id) => factsById.get(id)).filter(Boolean);
    if (!facts.length) issues.push({ level: "erro", code: "NUMBER_WITHOUT_FACT", beatId: b.id, message: "Número sem fato com fonte (confiança média ou alta)." });
    else if (!facts.some((f) => f && usableFact(f))) issues.push({ level: "erro", code: "WEAK_FACT", beatId: b.id, message: "O fato desta fala tem confiança baixa, foi marcado como \"não usar\" ou é acusação." });
    for (const f of facts) for (const w of f ? factWarnings(f) : []) if (["MONEY_NO_CURRENCY", "MONEY_NO_DATE", "INDEX_NO_YEAR"].includes(w.code)) issues.push({ level: "aviso", code: w.code, beatId: b.id, message: w.message });
  }
  for (const id of beats.flatMap((b) => b.facts)) if (!factsById.has(id)) issues.push({ level: "erro", code: "FACT_NOT_FOUND", message: `Fato ${id} não existe na pesquisa.` });

  // Hook rules.
  const hookId = bible.structure[0]?.id;
  const hook = beats.filter((b) => b.section === hookId);
  const first = beats[0];
  if (countWords(sentences(first.text)[0] ?? first.text) > 15) issues.push({ level: "erro", code: "HOOK_FIRST_SENTENCE", beatId: first.id, message: "A 1ª frase do vídeo passa de 15 palavras." });
  if (format === "long" && hook.length) {
    const hookText = hook.map((b) => b.text).join(" ");
    const numbers = hookText.match(/\d[\d.,]*/g)?.length ?? 0;
    if (numbers < 2) issues.push({ level: "aviso", code: "HOOK_NUMBERS", message: "O gancho deveria ter 2 números." });
    if (!hookText.includes("?")) issues.push({ level: "aviso", code: "HOOK_QUESTION", message: "O gancho não faz a pergunta do vídeo." });
    if (!TEASER.test(hookText)) issues.push({ level: "aviso", code: "HOOK_TEASER", message: "Falta o gancho para o fim (\"fica até o final…\")." });
    else {
      const lastSections = bible.structure.slice(-2).map((m) => m.id);
      if (!beats.some((b) => lastSections.includes(b.section))) issues.push({ level: "erro", code: "TEASER_NOT_PAID", message: "O gancho para o fim promete algo que o fim não entrega (sem veredito ou assinatura)." });
    }
  }

  // Rhythm: no 3 pure text scenes in a row; ≥ 1/3 real imagery.
  let run = 0;
  for (const b of beats) {
    run = TEXT_SCENES.includes(b.scene.type) && !b.scene.bgVideo ? run + 1 : 0;
    if (run === 3) issues.push({ level: "erro", code: "TEXT_RUN", beatId: b.id, message: "3 cenas de texto puro seguidas: troque uma por foto, vídeo ou fundo em vídeo." });
  }
  const realShare = beats.filter((b) => isRealImage(b.scene)).length / beats.length;
  const minShare = Math.max(1 / 3, bible.visualRules.realImageShare) - 1e-9;
  if (realShare < minShare) issues.push({ level: "erro", code: "REAL_IMAGE_SHARE", message: `Só ${Math.round(realShare * 100)}% das falas têm imagem real; o mínimo é ${Math.round(minShare * 100)}%.` });
  for (const b of beats) {
    if (isRealImage(b.scene) && !b.scene.query && !b.scene.media.length && !b.scene.bgVideo) issues.push({ level: "aviso", code: "MEDIA_QUERY", beatId: b.id, message: "Cena de imagem real sem consulta de busca (lugar + objeto + clima)." });
    if (b.scene.data.tag && !b.scene.place) issues.push({ level: "erro", code: "PLACE_TAG", beatId: b.id, message: "Etiqueta de lugar sem `place`: imagem genérica entra sem etiqueta." });
  }

  for (const b of beats)
    if (!(COMPILED_SCENES as readonly string[]).includes(b.scene.type))
      issues.push({ level: "erro", code: "SCENE_NOT_SUPPORTED", beatId: b.id, message: `A cena "${b.scene.type}" ainda não é compilada; use ${COMPILED_SCENES.join(", ")}.` });

  // Forbidden words and themes.
  const forbidden = [...new Set([...GLOBAL_FORBIDDEN, ...bible.forbidden])].map((f) => [f, norm(f)] as const).filter(([, n]) => n.length >= 3 && !n.startsWith("piada com") && !n.startsWith("acusacao"));
  for (const b of beats) {
    const t = norm(b.text);
    for (const [orig, f] of forbidden) if (t.includes(f)) issues.push({ level: "erro", code: "FORBIDDEN", beatId: b.id, message: `Termo proibido: "${orig}".` });
  }

  // Sentences ≤ 25 words.
  for (const b of beats) if (sentences(b.say ?? b.text).some((s) => countWords(s) > 25)) issues.push({ level: "aviso", code: "LONG_SENTENCE", beatId: b.id, message: "Frase com mais de 25 palavras: o TTS perde o respiro." });

  // CTAs: at most 4, never before 1:00, end screen last.
  const ctas = beats.filter((b) => b.cta);
  if (ctas.length > 4) issues.push({ level: "erro", code: "TOO_MANY_CTAS", message: `${ctas.length} chamadas; o máximo é 4.` });
  let t = 0;
  for (const b of beats) {
    if (b.cta && t < 60 && format === "long") issues.push({ level: "erro", code: "CTA_TOO_EARLY", beatId: b.id, message: "Chamada antes de 1:00." });
    t += estimateSeconds([b], wpm);
  }
  const end = beats.findIndex((b) => b.cta === "endscreen");
  if (format === "long" && end >= 0 && end !== beats.length - 1) issues.push({ level: "erro", code: "ENDSCREEN_NOT_LAST", beatId: beats[end].id, message: "A tela final tem de ser a última fala." });
  if (format === "long" && end < 0) issues.push({ level: "aviso", code: "NO_ENDSCREEN", message: "Falta a fala de tela final." });

  // Duration.
  const seconds = estimateSeconds(beats, wpm);
  const target = durationTarget(channel, format);
  if (seconds < target.minSec) issues.push({ level: "erro", code: "TOO_SHORT", message: `Duração estimada ${fmt(seconds)} abaixo do mínimo ${fmt(target.minSec)}: acrescente fatos verificados (curiosidade, dica, comparação), nunca enrolação. Alvo ${fmt(target.targetSec)}.` });
  if (seconds > target.maxSec) issues.push({ level: "aviso", code: "TOO_LONG", message: `Duração estimada ${fmt(seconds)} acima de ${fmt(target.maxSec)}.` });
  for (const b of beats) {
    const s = estimateSeconds([b], wpm);
    if (s > 12) issues.push({ level: "aviso", code: "BEAT_TOO_LONG", beatId: b.id, message: `Fala com ~${Math.round(s)} s: divida (3 a 10 s por fala).` });
  }

  return {
    ok: !issues.some((i) => i.level === "erro"),
    issues,
    stats: { beats: beats.length, seconds: Math.round(seconds), words: beats.reduce((s, b) => s + countWords(b.text), 0), realImagePct: Math.round(realShare * 100), ctas: ctas.length },
  };
}
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

// ---------- brief for the agent ----------

/** Everything the agent needs to write the beats, in the channel's formula (agent-first `script_generate`). */
export function scriptBrief(channel: Channel, episode: Pick<Episode, "title" | "format">, research?: Research, wpm = DEFAULT_WPM) {
  const target = durationTarget(channel, episode.format);
  const totalTarget = channel.bible.structure.reduce((s, m) => s + m.targetSec, 0) || 1;
  const scale = target.targetSec / totalTarget;
  const facts = (research?.facts ?? []).filter(usableFact).map((f) => ({ id: f.id, claim: f.claim, value: f.value, unit: f.unit, date: f.dataDate ?? f.source.publishedAt, publisher: f.source.publisher, prudent: f.prudent, confidence: f.confidence }));
  return {
    title: episode.title,
    format: episode.format,
    targetSeconds: target.targetSec,
    minSeconds: target.minSec,
    targetWords: Math.round((target.targetSec / 60) * wpm),
    wordsPerMinute: wpm,
    promise: channel.bible.promise,
    persona: channel.bible.persona,
    structure:
      episode.format === "long"
        ? channel.bible.structure.map((m) => ({ section: m.id, title: m.title, seconds: Math.round(m.targetSec * scale), mustHave: m.mustHave }))
        : [{ section: "gancho", title: "Gancho (≤ 2 s)", seconds: 2, mustHave: "frase que prende" }, { section: "fatos", title: "3 a 5 fatos", seconds: 35, mustHave: "um dado por tela" }, { section: "virada", title: "Virada", seconds: 8, mustHave: "" }, { section: "pergunta", title: "Pergunta", seconds: 5, mustHave: "pergunta ou chamada para o longo" }],
    hookRules: channel.bible.hookRules,
    ctaPlan: channel.bible.ctaPlan,
    forbidden: [...new Set([...GLOBAL_FORBIDDEN, ...channel.bible.forbidden])],
    mustHave: channel.bible.mustHave,
    premise: research?.premise,
    facts,
    rules: [
      "Uma fala = 1 ou 2 frases, 3 a 10 s de narração, uma cena.",
      "Todo número da fala cita o id do fato em `facts`; sem fato, sem número. Divergência: use o texto de `prudent`.",
      "Frases com até 25 palavras, ordem direta.",
      "Opinião dita como opinião (\"na minha visão\"). O narrador nunca diz que foi ao lugar; cenas vividas são hipotéticas (\"imagina que você…\").",
      "Crítica a preço, governo, urbanismo e serviço, nunca ao povo. Um elogio verdadeiro por episódio.",
      "No máximo 4 chamadas (`cta`), nunca antes de 1:00; a tela final é a última fala.",
      `Pelo menos ${Math.round(Math.max(1 / 3, channel.bible.visualRules.realImageShare) * 100)}% das falas com imagem real (photo, video ou bgVideo) e uma consulta em scene.query (lugar + objeto + clima); nunca 3 cenas de texto puro seguidas.`,
      "Etiqueta de lugar (scene.data.tag) só com scene.place; imagem genérica vai sem etiqueta. Nunca escrever \"imagem ilustrativa\".",
      "Se os dados não confirmam a premissa do título, responda com honestidade e faça disso a virada.",
    ],
    sceneTypes: COMPILED_SCENES,
    sceneData: {
      photo: "{ move?: 'in'|'out'|'l'|'r', tag?: 'LUGAR' (só com scene.place), caption?: string } — mídia em scene.media",
      video: "{ clips?: [{ media: 'm_…', at?: 'palavra|alternativa', tag?: string }], caption?: string, big?: string }",
      stat: "{ value: number, prefix?: 'R$ ', suffix?: '%', decimals?: 0-2, label: string, source?: 'IBGE, 2022', at?: 'palavra' }",
      title: "{ lines: [{ text, color?: 'accent'|'ink'|'red'|'green', strike?: boolean, at?: 'palavra' }] (1 a 4), stamp?: string }",
      list: "{ title?: string, tone?: 'green'|'red', items: [{ text, mark: 'ok'|'no', at?: 'palavra' }] }",
      cta: "{ kind: 'comment'|'subscribe'|'like'|'endscreen', text?: string, examples?: ['Niterói', 'Recife'] }",
      any: "bgVideo: 'm_…' (vídeo de fundo com véu), stickers são da próxima leva",
    },
  };
}

// ---------- store-backed operations ----------

type Ids = { profileId: string; channelId: string; episodeId: string };

export async function saveScript(store: ChannelStore, ids: Ids, input: { sections?: { id: string; title: string }[]; beats: BeatInput[]; wpm?: number }) {
  const channel = await store.getChannel(ids.profileId, ids.channelId);
  const episode = await store.getEpisode(ids.profileId, ids.channelId, ids.episodeId);
  const dict = await readPronunciations(store, ids.profileId, ids.channelId);
  const script = buildScript(input, channel, dict);
  await store.writeEpisodeFile(ids.profileId, ids.channelId, ids.episodeId, "script", script);
  await linkFacts(store, ids, script);
  const research = await store.readEpisodeFile(ids.profileId, ids.channelId, ids.episodeId, "research");
  const review = reviewScript(script, { channel, research, format: episode.format });
  await store.setStage(ids.profileId, ids.channelId, ids.episodeId, "script", review.ok ? { status: "ok", inputHash: scriptHash(script) } : { status: "erro", error: `${review.issues.filter((i) => i.level === "erro").length} erro(s) na revisão do roteiro` });
  return { script, review };
}

export async function editScript(store: ChannelStore, ids: Ids, edits: BeatEdit[]) {
  const channel = await store.getChannel(ids.profileId, ids.channelId);
  const episode = await store.getEpisode(ids.profileId, ids.channelId, ids.episodeId);
  const dict = await readPronunciations(store, ids.profileId, ids.channelId);
  const narrated = episode.stages.narration.status === "ok" || episode.stages.narration.status === "desatualizado";
  let result!: ReturnType<typeof applyBeatEdits>;
  await store.mutateEpisodeFile(ids.profileId, ids.channelId, ids.episodeId, "script", () => {
    throw Object.assign(new Error("O episódio ainda não tem roteiro."), { code: "NO_SCRIPT" });
  }, (script) => {
    result = applyBeatEdits(script, edits, { dictionary: dict, narrated });
    return result.script;
  });
  await linkFacts(store, ids, result.script);
  const research = await store.readEpisodeFile(ids.profileId, ids.channelId, ids.episodeId, "research");
  const review = reviewScript(result.script, { channel, research, format: episode.format });
  // Editing a beat marks the following stages stale (and the approval must be given again).
  await store.mutateEpisode(ids.profileId, ids.channelId, ids.episodeId, (ep) => {
    if (result.changed.length || result.removed.length) {
      for (const s of ["narration", "align", "scenes", "qa", "render", "package", "shorts"] as const) if (ep.stages[s].status === "ok") ep.stages[s] = { ...ep.stages[s], status: "desatualizado" };
      if (ep.approvals.script) delete ep.approvals.script;
    }
    ep.stages.script = { ...ep.stages.script, status: review.ok ? "ok" : "erro", inputHash: scriptHash(result.script), updatedAt: new Date().toISOString() };
    ep.history.push({ at: new Date().toISOString(), actor: "agent", action: `roteiro editado: ${result.changed.length} alterada(s), ${result.removed.length} removida(s)` });
  });
  return { ...result, review };
}

export function scriptHash(script: Script) {
  return createHash("sha1").update(script.beats.map((b) => `${b.id}:${b.hash}`).join("|")).digest("hex").slice(0, 16);
}

/** Keeps `usedIn` of each fact in sync with the beats that cite it. */
async function linkFacts(store: ChannelStore, ids: Ids, script: Script) {
  const research = await store.readEpisodeFile(ids.profileId, ids.channelId, ids.episodeId, "research");
  if (!research) return;
  await store.mutateEpisodeFile(ids.profileId, ids.channelId, ids.episodeId, "research", () => research, (r) => {
    for (const f of r.facts) f.usedIn = script.beats.filter((b) => b.facts.includes(f.id)).map((b) => b.id);
  });
}

/** Paged view for MCP (never the giant script in one answer). */
export function pageScript(script: Script, page = 1, perPage = 40) {
  const pages = Math.max(1, Math.ceil(script.beats.length / perPage));
  const p = Math.min(Math.max(1, page), pages);
  return {
    page: p,
    pages,
    total: script.beats.length,
    sections: script.sections,
    beats: script.beats.slice((p - 1) * perPage, p * perPage).map((b) => ({ id: b.id, section: b.section, text: b.text, say: b.say, facts: b.facts, scene: b.scene, cta: b.cta, isNew: b.isNew, timing: b.timing ? { start: b.timing.start, end: b.timing.end } : undefined })),
  };
}

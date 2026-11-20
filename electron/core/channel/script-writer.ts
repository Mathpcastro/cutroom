import { createHash } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import {
  GLOBAL_FORBIDDEN,
  COMPILED_SCENES,
  TEXT_SCENES,
  beatSchema,
  sceneSchema,
  scriptSchema,
  type Beat,
  type Channel,
  type Check,
  type Episode,
  type Format,
  type ImageSource,
  type Research,
  type Scene,
  type Script,
} from "../../../src/shared/channel";
import { formatOf } from "../../../src/shared/channel-formats";
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
/** Long episode: the format's length (target = minimum + 8%); the short is 30–60 s. */
export function durationTarget(channel: Pick<Channel, "format" | "defaults">, format: Episode["format"]) {
  if (format === "short") return { minSec: 30, targetSec: 50, maxSec: 59 };
  const d = formatOf(channel).durationSec;
  return { minSec: d.min, targetSec: Math.min(d.max, Math.round(d.min * 1.08)), maxSec: d.max };
}

// ---------- review ----------

export type ScriptIssue = { level: "erro" | "aviso"; code: string; beatId?: string; message: string; /** Checklist item of the format that raised it. */ check?: string };

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const hasNumber = (s: string) => /\d/.test(s) || /\b(mil|milh(ão|ões|ao|oes)|bilh(ão|ões|ao|oes)|por cento)\b/i.test(s);
const sentences = (s: string) => s.split(/(?<=[.!?])\s+/).filter((x) => x.trim());
const TEASER = /(at[eé] o final|no final|l[aá] no fim|no fim do v[ií]deo|fica at[eé])/i;

/** Where a scene's imagery comes from (scene.source wins; otherwise the type says it). */
export function imageSourceOf(scene: Scene): ImageSource {
  if (scene.source) return scene.source;
  if (scene.type === "photo" || scene.type === "video") return "foto-real";
  // A ranking item over a photo (scene.media or a search query) shows real imagery too.
  if (scene.type === "rank" && (scene.media.length || scene.query)) return "foto-real";
  if (scene.type === "character" || scene.type === "avatar") return "avatar";
  if (scene.type === "custom") return "custom";
  if (scene.bgVideo) return "b-roll";
  return "grafico";
}
const hasImagery = (scene: Scene, sources: readonly string[]) => sources.includes(imageSourceOf(scene)) || (Boolean(scene.bgVideo) && sources.includes("b-roll"));
const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
/** Value of a counter shown by a scene: `counter` scenes, or `character` scenes with data.counter. */
export function counterValue(scene: Scene, counter: string, firstCounter: string | undefined): number | undefined {
  const d = scene.data ?? {};
  if (scene.type === "counter" && ((d.counter as string | undefined) ?? firstCounter) === counter && typeof d.value === "number") return d.value;
  const c = d.counter as { id?: string; value?: number } | undefined;
  if (scene.type === "character" && c && typeof c === "object" && (c.id ?? firstCounter) === counter && typeof c.value === "number") return c.value;
  return undefined;
}

/**
 * Automatic review before asking for approval. Structural checks always run (ids, order,
 * facts that exist, scene types, forbidden words, length); everything else comes from the
 * checklist of the channel's format, so any niche brings its own rules.
 */
export function reviewScript(script: Script, ctx: { channel: Channel; research?: Research; format: Episode["format"] }): { ok: boolean; issues: ScriptIssue[]; stats: Record<string, number> } {
  const { channel, research, format } = ctx;
  const bible = channel.bible;
  const rules: Format = formatOf(channel);
  const issues: ScriptIssue[] = [];
  const beats = script.beats;
  const factsById = new Map((research?.facts ?? []).map((f) => [f.id, f]));
  const wpm = script.wpm ?? DEFAULT_WPM;
  if (!beats.length) return { ok: false, issues: [{ level: "erro", code: "EMPTY", message: "O roteiro não tem falas." }], stats: {} };
  const long = format === "long";

  // ---- always: ids unique; sections known, contiguous and in order ----
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
  for (const id of beats.flatMap((b) => b.facts)) if (!factsById.has(id)) issues.push({ level: "erro", code: "FACT_NOT_FOUND", message: `Fato ${id} não existe na pesquisa.` });

  // ---- always: scene types the compiler renders and the format allows ----
  for (const b of beats) {
    if (!(COMPILED_SCENES as readonly string[]).includes(b.scene.type))
      issues.push({ level: "erro", code: "SCENE_NOT_SUPPORTED", beatId: b.id, message: `A cena "${b.scene.type}" ainda não é compilada; use ${COMPILED_SCENES.join(", ")}.` });
    else if (!rules.scenes.includes(b.scene.type) && !b.cta)
      issues.push({ level: "erro", code: "SCENE_NOT_IN_FORMAT", beatId: b.id, message: `O formato "${rules.name}" não usa a cena "${b.scene.type}"; use ${rules.scenes.join(", ")} (ou mude o formato do canal).` });
  }

  // ---- always: forbidden words and themes ----
  const forbidden = [...new Set([...GLOBAL_FORBIDDEN, ...bible.forbidden])].map((f) => [f, norm(f)] as const).filter(([, n]) => n.length >= 3 && !n.startsWith("piada com") && !n.startsWith("acusacao"));
  for (const b of beats) {
    const t = norm(b.text);
    for (const [orig, f] of forbidden) if (t.includes(f)) issues.push({ level: "erro", code: "FORBIDDEN", beatId: b.id, message: `Termo proibido: "${orig}".` });
  }

  // ---- always: length of the episode ----
  const seconds = estimateSeconds(beats, wpm);
  const target = durationTarget(channel, format);
  if (seconds < target.minSec) issues.push({ level: "erro", code: "TOO_SHORT", message: `Duração estimada ${fmt(seconds)} abaixo do mínimo ${fmt(target.minSec)}: acrescente conteúdo do formato, nunca enrolação. Alvo ${fmt(target.targetSec)}.` });
  if (seconds > target.maxSec) issues.push({ level: "aviso", code: "TOO_LONG", message: `Duração estimada ${fmt(seconds)} acima de ${fmt(target.maxSec)}.` });

  // ---- the format's checklist ----
  const hook = beats.filter((b) => b.section === (bible.structure[0]?.id ?? beats[0].section));
  const ctas = beats.filter((b) => b.cta);
  const firstCounter = rules.character?.counters[0]?.id;
  let imageShare: number | undefined;
  for (const c of rules.checklist) {
    const add = (code: string, message: string, beatId?: string, level: ScriptIssue["level"] = c.level) => issues.push({ level, code, beatId, message, check: c.id });
    runCheck(c, add);
  }

  function runCheck(c: Check, add: (code: string, message: string, beatId?: string, level?: ScriptIssue["level"]) => void) {
    const p = c.params;
    switch (c.kind) {
      case "fact-per-number":
        for (const b of beats) {
          if (!hasNumber(b.text) || b.cta || b.scene.type === "rank" || b.scene.type === "counter") continue;
          const facts = b.facts.map((id) => factsById.get(id)).filter(Boolean);
          if (!facts.length) add("NUMBER_WITHOUT_FACT", "Número sem fato com fonte (confiança média ou alta).", b.id);
          else if (!facts.some((f) => f && usableFact(f))) add("WEAK_FACT", 'O fato desta fala tem confiança baixa, foi marcado como "não usar" ou é acusação.', b.id);
          for (const f of facts) for (const w of f ? factWarnings(f) : []) if (["MONEY_NO_CURRENCY", "MONEY_NO_DATE", "INDEX_NO_YEAR"].includes(w.code)) add(w.code, w.message, b.id, "aviso");
        }
        break;
      case "facts-min": {
        const used = new Set(
          beats.flatMap((b) => b.facts).filter((id) => {
            const f = factsById.get(id);
            return f && usableFact(f);
          }),
        );
        if (used.size < num(p.min, 1)) add("FACTS_MIN", `O formato pede pelo menos ${num(p.min, 1)} fato(s) com fonte no episódio; há ${used.size}.`);
        break;
      }
      case "image-share": {
        const sources = Array.isArray(p.sources) ? (p.sources as string[]) : ["foto-real", "b-roll"];
        const share = beats.filter((b) => hasImagery(b.scene, sources)).length / beats.length;
        imageShare = share;
        const min = num(p.min, 1 / 3) - 1e-9;
        const real = sources.every((x) => x === "foto-real" || x === "b-roll");
        if (share < min) add(real ? "REAL_IMAGE_SHARE" : "IMAGE_SHARE", `Só ${Math.round(share * 100)}% das falas têm imagem de ${sources.join("/")}; o mínimo do formato é ${Math.round(min * 100)}%.`);
        break;
      }
      case "max-text-run": {
        let run = 0;
        for (const b of beats) {
          run = TEXT_SCENES.includes(b.scene.type) && !b.scene.bgVideo ? run + 1 : 0;
          if (run === num(p.max, 2) + 1) add("TEXT_RUN", `${run} cenas de texto puro seguidas: troque uma por imagem ou fundo em vídeo.`, b.id);
        }
        break;
      }
      case "first-sentence-words": {
        const first = beats[0];
        if (countWords(sentences(first.text)[0] ?? first.text) > num(p.max, 15)) add("HOOK_FIRST_SENTENCE", `A 1ª frase do vídeo passa de ${num(p.max, 15)} palavras.`, first.id);
        break;
      }
      case "hook-numbers":
        if (long && hook.length && (hook.map((b) => b.text).join(" ").match(/\d[\d.,]*/g)?.length ?? 0) < num(p.min, 2)) add("HOOK_NUMBERS", `O gancho deveria ter ${num(p.min, 2)} números.`);
        break;
      case "hook-question":
        if (long && hook.length && !hook.some((b) => b.text.includes("?"))) add("HOOK_QUESTION", "O gancho não faz a pergunta do vídeo.");
        break;
      case "hook-teaser": {
        if (!long || !hook.length) break;
        const hookText = hook.map((b) => b.text).join(" ");
        if (!TEASER.test(hookText)) add("HOOK_TEASER", 'Falta o gancho para o fim ("fica até o final…").');
        else {
          const lastSections = bible.structure.slice(-2).map((m) => m.id);
          if (!beats.some((b) => lastSections.includes(b.section))) add("TEASER_NOT_PAID", "O gancho para o fim promete algo que o fim não entrega.", undefined, "erro");
        }
        break;
      }
      case "cta-after": {
        if (!long) break;
        let t = 0;
        for (const b of beats) {
          if (b.cta && b.cta !== "endscreen" && t < num(p.sec, 60)) add("CTA_TOO_EARLY", `Chamada antes de ${fmt(num(p.sec, 60))}.`, b.id);
          t += estimateSeconds([b], wpm);
        }
        break;
      }
      case "max-ctas":
        if (ctas.length > num(p.max, 4)) add("TOO_MANY_CTAS", `${ctas.length} chamadas; o máximo do formato é ${num(p.max, 4)}.`);
        break;
      case "endscreen-last": {
        if (!long) break;
        const end = beats.findIndex((b) => b.cta === "endscreen");
        if (end >= 0 && end !== beats.length - 1) add("ENDSCREEN_NOT_LAST", "A tela final tem de ser a última fala.", beats[end].id);
        if (end < 0) add("NO_ENDSCREEN", "Falta a fala de tela final.", undefined, "aviso");
        break;
      }
      case "sentence-max-words":
        for (const b of beats) if (sentences(b.say ?? b.text).some((x) => countWords(x) > num(p.max, 25))) add("LONG_SENTENCE", `Frase com mais de ${num(p.max, 25)} palavras: o TTS perde o respiro.`, b.id);
        break;
      case "beat-max-seconds":
        for (const b of beats) {
          const sec = estimateSeconds([b], wpm);
          if (sec > num(p.max, 12)) add("BEAT_TOO_LONG", `Fala com ~${Math.round(sec)} s: divida (3 a 10 s por fala).`, b.id);
        }
        break;
      case "section-required": {
        const sec = String(p.section ?? "");
        if (sec && !beats.some((b) => b.section === sec)) add("SECTION_MISSING", `Falta a seção "${sec}" que o formato exige.`);
        break;
      }
      case "counter-continuity": {
        const counter = String(p.counter ?? firstCounter ?? "");
        const values = beats.map((b) => ({ b, v: counterValue(b.scene, counter, firstCounter) })).filter((x): x is { b: Beat; v: number } => x.v !== undefined);
        if (!values.length) add("COUNTER_MISSING", `Nenhuma cena mostra o contador "${counter}".`);
        for (let i = 1; i < values.length; i++) if (values[i].v <= values[i - 1].v) add("COUNTER_BACKWARDS", `O contador "${counter}" vai de ${values[i - 1].v} para ${values[i].v}: ele só avança.`, values[i].b.id);
        break;
      }
      case "ending-twist": {
        const sec = String(p.section ?? bible.structure.at(-1)?.id ?? "");
        const inSec = beats.filter((b) => b.section === sec);
        if (!inSec.length) add("TWIST_MISSING", `Falta a seção "${sec}" com a reviravolta.`);
        else if (!inSec.some((b) => b.scene.data?.twist === true)) add("TWIST_MISSING", `Marque a fala da reviravolta com scene.data.twist: true na seção "${sec}".`);
        break;
      }
      case "ranked-countdown": {
        const ranks = beats.filter((b) => b.scene.type === "rank").map((b) => ({ b, n: num((b.scene.data as { n?: unknown }).n, Number.NaN) }));
        if (ranks.length < num(p.min, 3)) add("RANK_COUNT", `A contagem tem ${ranks.length} item(ns); o formato pede pelo menos ${num(p.min, 3)}.`);
        for (let i = 1; i < ranks.length; i++) if (ranks[i].n !== ranks[i - 1].n - 1) add("RANK_ORDER", `Depois do nº ${ranks[i - 1].n} vem o nº ${ranks[i].n}: a contagem desce de 1 em 1.`, ranks[i].b.id);
        if (ranks.length && ranks.at(-1)!.n !== 1) add("RANK_ORDER", "A contagem tem de terminar no nº 1.", ranks.at(-1)!.b.id);
        break;
      }
      case "place-tag":
        for (const b of beats) if (b.scene.data?.tag && !b.scene.place) add("PLACE_TAG", "Etiqueta de lugar sem `place`: imagem genérica entra sem etiqueta.", b.id);
        break;
      case "vary-backdrop": {
        const key = (b: Beat) => {
          const bd = (b.scene.data as { backdrop?: string | { media?: string } }).backdrop;
          return typeof bd === "string" ? bd : (bd?.media ?? "");
        };
        const staged = beats.filter((b) => b.scene.type === "character" || b.scene.type === "counter");
        for (const b of staged) if (!key(b)) add("BACKDROP_MISSING", "Cena de personagem ou contador sem cenário: passe scene.data.backdrop.", b.id);
        for (let i = 1; i < staged.length; i++) if (key(staged[i]) && key(staged[i]) === key(staged[i - 1])) add("BACKDROP_REPEATED", `Mesmo cenário ("${key(staged[i])}") de novo: troque o lugar a cada cena.`, staged[i].id);
        break;
      }
      case "media-query":
        for (const b of beats)
          if ((b.scene.type === "photo" || b.scene.type === "video") && !b.scene.query && !b.scene.media.length && !b.scene.bgVideo) add("MEDIA_QUERY", "Cena de imagem sem consulta de busca (lugar + objeto + clima) nem mídia.", b.id);
        break;
    }
  }

  return {
    ok: !issues.some((i) => i.level === "erro"),
    issues,
    stats: {
      beats: beats.length,
      seconds: Math.round(seconds),
      words: beats.reduce((s, b) => s + countWords(b.text), 0),
      ...(imageShare !== undefined ? { imagePct: Math.round(imageShare * 100), realImagePct: Math.round(imageShare * 100) } : {}),
      ctas: ctas.length,
    },
  };
}
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

// ---------- brief for the agent ----------

/** Data each compiled scene takes (shown to the agent only for the scenes its format uses). */
export const SCENE_DATA_DOCS: Record<string, string> = {
  photo: "{ move?: 'in'|'out'|'l'|'r', tag?: 'LUGAR' (só com scene.place), caption?: string } — mídia em scene.media",
  video: "{ clips?: [{ media: 'm_…', at?: 'palavra|alternativa', tag?: string }], caption?: string, big?: string }",
  stat: "{ value: number, prefix?: 'R$ ', suffix?: '%', decimals?: 0-2, label: string, source?: 'IBGE, 2022', at?: 'palavra' }",
  title: "{ lines: [{ text, color?: 'accent'|'ink'|'red'|'green', strike?: boolean, at?: 'palavra' }] (1 a 4), stamp?: string }",
  list: "{ title?: string, tone?: 'green'|'red', items: [{ text, mark: 'ok'|'no', at?: 'palavra' }] }",
  cta: "{ kind: 'comment'|'subscribe'|'like'|'endscreen', text?: string, examples?: ['Niterói', 'Recife'] }",
  rank: "{ n: 1-100, title: string, subtitle?: string, at?: 'palavra' } — mídia opcional em scene.media (foto de fundo) ou bgVideo",
  counter: "{ backdrop?: 'quarto'|'sala'|'cozinha'|'rua'|'parque'|'escritorio'|'noite'|'campo'|{ media: 'm_…' }, counter?: 'dia', label?: 'DIA', value: number, from?: number, note?: string, items?: [{ text, qty?: number, delta?: '+'|'-' }] (inventário) }",
  character: "{ backdrop?: 'quarto'|'sala'|'cozinha'|'rua'|'parque'|'escritorio'|'noite'|'campo'|{ media: 'm_…' } (cenário; troque a cada cena), pose?: 'talk'|'think'|'shock'|'happy', line?: string (balão), counter?: { id?: 'dia', label?: 'DIA', value: number }, twist?: boolean } — imagem do personagem do canal ou scene.media[0]",
  custom:
    "{ html: string (corpo da cena), css?: string, js?: string (código GSAP usando `tl`, `D` = duração, `W`/`H`), texts?: string[] } — HTML/CSS/GSAP livre para qualquer visual; mídia por {{m_id}} no html/css; sem rede, sem <script>, sem URLs externas",
};

/** Plain description of a checklist item for the brief. */
function checkText(c: Check) {
  const p = c.params as Record<string, unknown>;
  const map: Record<string, string> = {
    "fact-per-number": "todo número da fala cita o id do fato em `facts` (contador e posição do ranking não contam)",
    "facts-min": `pelo menos ${p.min ?? 1} fato(s) com fonte no episódio`,
    "image-share": `pelo menos ${Math.round(Number(p.min ?? 0.34) * 100)}% das falas com imagem de ${(p.sources as string[] | undefined)?.join("/") ?? "foto real"}`,
    "max-text-run": `no máximo ${p.max ?? 2} cenas de texto puro seguidas`,
    "first-sentence-words": `1ª frase com até ${p.max ?? 15} palavras`,
    "hook-numbers": `${p.min ?? 2} números no gancho`,
    "hook-question": "o gancho faz a pergunta do vídeo",
    "hook-teaser": 'gancho para o fim ("fica até o final…") que o fim paga',
    "cta-after": `nenhuma chamada antes de ${p.sec ?? 60} s`,
    "max-ctas": `no máximo ${p.max ?? 4} chamadas`,
    "endscreen-last": "a tela final (cta: 'endscreen') é a última fala",
    "sentence-max-words": `frases com até ${p.max ?? 25} palavras`,
    "beat-max-seconds": `fala com até ${p.max ?? 12} s`,
    "section-required": `a seção "${p.section}" é obrigatória`,
    "counter-continuity": `o contador "${p.counter ?? "dia"}" só avança, nunca volta nem repete`,
    "ending-twist": `a seção "${p.section ?? "final"}" tem a reviravolta (scene.data.twist: true)`,
    "ranked-countdown": `cenas rank descendo de 1 em 1 até o nº 1 (pelo menos ${p.min ?? 3})`,
    "vary-backdrop": "cada cena de personagem ou contador tem cenário (data.backdrop) e troca de lugar em relação à anterior",
    "place-tag": "etiqueta de lugar (scene.data.tag) só com scene.place; imagem genérica vai sem etiqueta",
    "media-query": "cena de foto ou vídeo leva scene.query (lugar + objeto + clima) ou mídia",
  };
  return `${c.level === "erro" ? "[trava]" : "[aviso]"} ${map[c.kind] ?? c.kind}${c.note ? ` — ${c.note}` : ""}`;
}

/** Everything the agent needs to write the beats, in the channel's own format (agent-first `script_generate`). */
export function scriptBrief(channel: Channel, episode: Pick<Episode, "title" | "format">, research?: Research, wpm = DEFAULT_WPM) {
  const f = formatOf(channel);
  const target = durationTarget(channel, episode.format);
  const totalTarget = channel.bible.structure.reduce((s, m) => s + m.targetSec, 0) || 1;
  const scale = target.targetSec / totalTarget;
  const facts = (research?.facts ?? []).filter(usableFact).map((x) => ({ id: x.id, claim: x.claim, value: x.value, unit: x.unit, date: x.dataDate ?? x.source.publishedAt, publisher: x.source.publisher, prudent: x.prudent, confidence: x.confidence }));
  const scenes = f.scenes.filter((s) => (COMPILED_SCENES as readonly string[]).includes(s));
  return {
    title: episode.title,
    format: episode.format,
    channelFormat: { id: f.id, name: f.name, description: f.description, aspect: episode.format === "long" ? f.aspect : "9:16", research: f.research, imagery: f.imagery, character: f.character },
    targetSeconds: target.targetSec,
    minSeconds: target.minSec,
    targetWords: Math.round((target.targetSec / 60) * wpm),
    wordsPerMinute: wpm,
    promise: channel.bible.promise,
    persona: channel.bible.persona,
    structure:
      episode.format === "long"
        ? channel.bible.structure.map((m) => ({ section: m.id, title: m.title, seconds: Math.round(m.targetSec * scale), mustHave: m.mustHave }))
        : [{ section: "gancho", title: "Gancho (≤ 2 s)", seconds: 2, mustHave: "frase que prende" }, { section: "miolo", title: "3 a 5 batidas", seconds: 35, mustHave: "uma ideia por tela, no estilo do formato" }, { section: "virada", title: "Virada", seconds: 8, mustHave: "" }, { section: "pergunta", title: "Pergunta", seconds: 5, mustHave: "pergunta ou chamada para o longo" }],
    hookRules: channel.bible.hookRules,
    ctaPlan: channel.bible.ctaPlan,
    forbidden: [...new Set([...GLOBAL_FORBIDDEN, ...channel.bible.forbidden])],
    mustHave: channel.bible.mustHave,
    premise: research?.premise,
    facts,
    rules: [
      "Uma fala = 1 ou 2 frases, 3 a 10 s de narração, uma cena.",
      "Número que vem da pesquisa cita o id do fato em `facts`; divergência entre fontes: use o texto de `prudent`.",
      "Imagem gerada por IA ou cena custom: marque scene.source ('ia' | 'custom'); nunca apresente imagem gerada como foto real. Nunca escrever \"imagem ilustrativa\".",
      ...f.writingRules,
    ],
    checklist: f.checklist.map(checkText),
    rubric: f.rubric,
    sceneTypes: scenes,
    sceneData: { ...Object.fromEntries(scenes.map((s) => [s, SCENE_DATA_DOCS[s]])), any: "bgVideo: 'm_…' (vídeo de fundo com véu); scene.source diz de onde vem a imagem" },
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

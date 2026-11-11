import { z } from "zod";

/**
 * Spec 5: series, characters and episodes. The script is structured (scenes → lines) and converts to
 * the text format the engine reads (CRM.parseStory):
 *   # Episódio N: Título
 *   [cena: lugar, dia|noite]
 *   Nome (humor): fala            ← a line without a name is the narrator
 */

export const STORY_PLACES = ["quarto", "escritorio", "rua", "cafe"] as const;
export const STORY_TIMES = ["dia", "noite"] as const;
export const STORY_MOODS = ["animado", "sonolenta", "pensativa", "confiante", "brava", "nervoso", "surpresa"] as const;
export const NARRATOR = "Narrador";
export const MAX_ON_SCENE = 3; // + narrator = 4 voices per episode scene
export const MAX_WORDS = 12;
const id = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);
const text = (max: number) => z.string().trim().max(max);

export const characterSchema = z.object({
  id,
  name: text(40).min(1),
  role: text(200),
  description: text(600),
  speech: text(400),
  quirk: text(200).optional(),
  narrator: z.boolean().optional(),
  avatar: z.object({ avatarId: z.string().max(80), revision: z.number().int().positive().optional() }).optional(),
  voice: z.object({ provider: z.enum(["elevenlabs", "openai", "kokoro", "local"]), voiceId: z.string().max(200) }).optional(),
});
export type Character = z.infer<typeof characterSchema>;

export const ideaSchema = z.object({ title: text(120).min(1), line: text(300) });
export const seriesSchema = z.object({
  version: z.literal(1),
  id,
  title: text(120).min(1),
  premise: text(600),
  tone: text(300),
  setting: text(300),
  rules: text(1200),
  product: z.enum(["never", "sometimes", "end"]),
  cta: text(120),
  characters: z.array(characterSchema).max(8),
  ideas: z.array(ideaSchema).max(30),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Series = z.infer<typeof seriesSchema>;

export const lineSchema = z.object({ who: text(40).min(1), mood: z.string().max(20).optional(), text: text(300).min(1) });
export const sceneSchema = z.object({ place: z.string().max(20), time: z.enum(STORY_TIMES), lines: z.array(lineSchema).min(1).max(30) });
export const scriptSchema = z.object({ title: text(120).min(1), scenes: z.array(sceneSchema).min(1).max(8), hook: text(300).optional() });
export type StoryScript = z.infer<typeof scriptSchema>;
export type StoryLine = z.infer<typeof lineSchema>;

export const EPISODE_STATES = ["idea", "script", "ready", "scheduled", "published"] as const;
export const episodeSchema = z.object({
  version: z.literal(1),
  number: z.number().int().min(1).max(999),
  title: text(120).min(1),
  idea: text(300),
  state: z.enum(EPISODE_STATES),
  script: scriptSchema.optional(),
  /** Frozen at generation: name → avatar revision and voice, so later cast changes do not touch it. */
  cast: z.record(z.string(), z.object({ avatarId: z.string().optional(), revision: z.number().optional(), provider: z.string().optional(), voiceId: z.string().optional() })).optional(),
  filmId: z.string().max(120).optional(),
  output: z.string().max(2000).optional(),
  summary: text(400).optional(),
  updatedAt: z.string(),
});
export type Episode = z.infer<typeof episodeSchema>;

const clean = (s: string) => s.replace(/[\r\n]+/g, " ").trim();

/** Structured script → engine text. */
export function toEngineText(script: StoryScript, number: number) {
  const out = [`# Episódio ${number}: ${clean(script.title)}`];
  for (const scene of script.scenes) {
    out.push(`[cena: ${scene.place}, ${scene.time}]`);
    for (const line of scene.lines) {
      const isNarrator = line.who.toLowerCase() === NARRATOR.toLowerCase();
      out.push(isNarrator ? `${NARRATOR}: ${clean(line.text)}` : `${clean(line.who)}${line.mood ? ` (${line.mood})` : ""}: ${clean(line.text)}`);
    }
  }
  return out.join("\n");
}

/** Engine text → structured script (round trip without loss for scripts made by toEngineText). */
export function fromEngineText(src: string): { number: number; script: StoryScript } {
  let number = 1, title = "Episódio";
  const scenes: StoryScript["scenes"] = [];
  for (const raw of src.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const head = /^#\s*Epis[óo]dio\s*(\d+)\s*:\s*(.+)$/i.exec(line);
    if (head) { number = +head[1]; title = head[2].trim(); continue; }
    const scene = /^\[\s*cena\s*:\s*([^,\]]+?)\s*(?:,\s*(dia|noite))?\s*\]$/i.exec(line);
    if (scene) { scenes.push({ place: scene[1].toLowerCase(), time: (scene[2]?.toLowerCase() as "dia" | "noite") ?? "dia", lines: [] }); continue; }
    if (!scenes.length) scenes.push({ place: "quarto", time: "dia", lines: [] });
    const spoken = /^([^:()[\]]{1,40}?)\s*(?:\(([^)]*)\))?\s*:\s*(.+)$/.exec(line);
    scenes.at(-1)!.lines.push(spoken ? { who: spoken[1].trim(), ...(spoken[2] ? { mood: spoken[2].trim() } : {}), text: spoken[3].trim() } : { who: NARRATOR, text: line });
  }
  return { number, script: { title, scenes: scenes.filter((s) => s.lines.length) } };
}

export interface ScriptIssue { scene: number; line?: number; message: string; fix?: string }

/** Everything the engine cannot do, pointed out before generating, with the suggested fix. */
export function validateScript(script: StoryScript, cast: string[]): ScriptIssue[] {
  const issues: ScriptIssue[] = [];
  const names = new Set([...cast.map((n) => n.toLowerCase()), NARRATOR.toLowerCase()]);
  script.scenes.forEach((scene, s) => {
    if (!(STORY_PLACES as readonly string[]).includes(scene.place))
      issues.push({ scene: s, message: `Cenário "${scene.place}" não existe.`, fix: `Use ${STORY_PLACES.join(", ")}.` });
    const onScene = new Set(scene.lines.filter((l) => l.who.toLowerCase() !== NARRATOR.toLowerCase()).map((l) => l.who.toLowerCase()));
    if (onScene.size > MAX_ON_SCENE) issues.push({ scene: s, message: `${onScene.size} personagens nesta cena.`, fix: `No máximo ${MAX_ON_SCENE} + narrador por cena.` });
    scene.lines.forEach((line, l) => {
      if (!names.has(line.who.toLowerCase())) issues.push({ scene: s, line: l, message: `"${line.who}" não está no elenco.`, fix: `Escolha um personagem da série.` });
      if (line.mood && !(STORY_MOODS as readonly string[]).includes(line.mood)) issues.push({ scene: s, line: l, message: `Humor "${line.mood}" não existe.`, fix: `Use ${STORY_MOODS.join(", ")}.` });
      const words = line.text.split(/\s+/).filter(Boolean).length;
      if (words > MAX_WORDS) issues.push({ scene: s, line: l, message: `Fala com ${words} palavras.`, fix: `Encurte para até ${MAX_WORDS}.` });
    });
  });
  const seconds = estimateSeconds(script);
  if (seconds > 45) issues.push({ scene: 0, message: `O episódio dura cerca de ${seconds} s.`, fix: "Deixe entre 25 e 45 s (corte falas)." });
  return issues;
}

/** ~2.6 words per second plus a short pause per line. */
export function estimateSeconds(script: StoryScript) {
  const lines = script.scenes.flatMap((s) => s.lines);
  const words = lines.reduce((n, l) => n + l.text.split(/\s+/).filter(Boolean).length, 0);
  return Math.round(words / 2.6 + lines.length * 0.35);
}

/** Every spoken line in order, with who says it (for the dialogue service). */
export function spokenLines(script: StoryScript) {
  return script.scenes.flatMap((s) => s.lines);
}

/** "O primeiro cliente": the example series offered on the empty state. */
export const SAMPLE_SERIES = {
  title: "O primeiro cliente",
  premise: "Léo e Bia lançaram um SaaS no quarto. Cada episódio é um passo até o primeiro cliente de verdade.",
  tone: "Leve, rápido, com humor de quem empreende sem dinheiro.",
  setting: "Quarto de dia, café e escritório depois que o produto cresce.",
  rules: "Léo é otimista demais; Bia é pé no chão. O produto nunca vira propaganda: aparece resolvendo a cena.",
  characters: [
    { name: "Léo", role: "Fundador otimista", description: "Programa de madrugada e acredita em tudo.", speech: "Fala rápido, frases curtas, empolgado." },
    { name: "Bia", role: "Sócia pé no chão", description: "Cuida das vendas e do caixa.", speech: "Irônica, seca, engraçada sem querer." },
  ],
  script: {
    title: "O primeiro cliente",
    scenes: [
      { place: "quarto", time: "noite", lines: [
        { who: NARRATOR, text: "Episódio um. O primeiro cliente." },
        { who: "Léo", mood: "animado", text: "Bia, acorda! Alguém pagou!" },
        { who: "Bia", mood: "sonolenta", text: "Pagou o quê? A gente nem tem botão de pagar." },
        { who: "Léo", text: "Pois é. Ele mandou um Pix e escreveu: me ensina a usar." },
      ] },
      { place: "escritorio", time: "dia", lines: [
        { who: NARRATOR, text: "E foi aí que o cliente respondeu." },
        { who: "Léo", mood: "nervoso", text: "Ele quer cancelar?" },
        { who: "Bia", mood: "surpresa", text: "Não. Ele quer indicar dez amigos." },
        { who: NARRATOR, text: "Continua no próximo episódio." },
      ] },
    ],
  } satisfies StoryScript,
};

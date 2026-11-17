import { z } from "zod";

/**
 * Estúdio de Canais Dark: the data model from the spec ("Modelo de dados").
 * Every file is JSON validated here, written atomically and carries `schemaVersion`
 * so older files are migrated on read (see `migrateChannelFile`).
 * Ids are short and stable (`ep_7k2m`, `b_014`): never a list index.
 */

export const CHANNEL_SCHEMA_VERSION = 1 as const;

const text = (max: number) => z.string().max(max);
const iso = z.string().min(1).max(40);
export const shortId = (prefix: string) => z.string().regex(new RegExp(`^${prefix}_[a-z0-9]{2,16}$`));
export const channelId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);
export const episodeId = shortId("ep");
export const beatId = shortId("b");
export const factId = shortId("f");
export const mediaId = shortId("m");
export const ideaId = shortId("i");

// ---------- Bible ----------

export const movementSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,40}$/),
  title: text(80).min(1),
  /** Rough target in seconds; the writer uses it to balance the episode. */
  targetSec: z.number().min(5).max(900),
  mustHave: text(400).default(""),
});
export type Movement = z.infer<typeof movementSchema>;

export const CTA_KINDS = ["comment", "subscribe", "like", "endscreen", "next"] as const;
export const ctaSlotSchema = z.object({
  kind: z.enum(CTA_KINDS),
  at: z.enum(["after-section", "after-surprise", "end"]),
  section: z.string().max(40).optional(),
  line: text(300).min(1),
});
export type CtaSlot = z.infer<typeof ctaSlotSchema>;

export const bibleSchema = z.object({
  promise: text(300),
  persona: z.object({
    voiceTone: text(300),
    pov: z.enum(["1a pessoa opinião", "narrador neutro"]),
    catchphrases: z.array(text(120)).max(12),
  }),
  structure: z.array(movementSchema).min(1).max(16),
  hookRules: z.array(text(200)).max(12),
  ctaPlan: z.array(ctaSlotSchema).max(8),
  forbidden: z.array(text(120)).max(80),
  mustHave: z.array(text(200)).max(30),
  visualRules: z.object({
    realImageShare: z.number().min(0).max(1),
    minCutSeconds: z.number().min(0.5).max(20),
    maxCutSeconds: z.number().min(1).max(30),
    avatar: z.enum(["none", "corner", "host"]),
  }),
  thumbStyle: z.object({
    layout: z.enum(["foto+frase", "foto+frase+icone", "rosto+frase"]),
    maxWords: z.number().int().min(1).max(10),
    palette: z.array(z.string().max(20)).max(6),
  }),
  signature: z.object({ kind: z.enum(["placa", "frase", "nenhuma"]), template: text(200) }),
});
export type Bible = z.infer<typeof bibleSchema>;

/** The 8 movements of the long episode (editable per channel). */
export const DEFAULT_STRUCTURE: Movement[] = [
  { id: "gancho", title: "Gancho", targetSec: 50, mustHave: "1ª frase ≤ 15 palavras contraintuitiva com prova na tela; 2 números; a pergunta do vídeo; spoiler honesto; gancho para o fim" },
  { id: "contexto", title: "Contexto", targetSec: 60, mustHave: "o que é o tema, 3 dados de bolso" },
  { id: "tese", title: "Tese contrária", targetSec: 60, mustHave: "a leitura que o público não espera" },
  { id: "lado-bom", title: "O lado bom", targetSec: 150, mustHave: "dados, imagem real, uma cena hipotética em 2ª pessoa" },
  { id: "virada", title: "Virada", targetSec: 150, mustHave: "3 a 6 problemas com fonte" },
  { id: "comparacao", title: "Comparação", targetSec: 60, mustHave: "com a referência famosa do nicho" },
  { id: "veredito", title: "Veredito por perfil", targetSec: 60, mustHave: "vale para quem / não vale para quem / dica prática" },
  { id: "assinatura", title: "Pergunta e assinatura", targetSec: 30, mustHave: "pergunta que divide, assinatura do canal, tela final" },
];

export function defaultBible(niche: string): Bible {
  return bibleSchema.parse({
    promise: niche ? `${niche} sem filtro: o lado bom, o ruim e o veredito` : "",
    persona: { voiceTone: "direto, bem-humorado, sem exagero", pov: "1a pessoa opinião", catchphrases: [] },
    structure: DEFAULT_STRUCTURE,
    hookRules: ["1ª frase ≤ 15 palavras, contraintuitiva, com prova na tela", "2 números no gancho", "gancho para o fim já no primeiro minuto"],
    ctaPlan: [
      { kind: "comment", at: "after-section", section: "contexto", line: "Comenta aí de onde você tá assistindo." },
      { kind: "subscribe", at: "after-section", section: "lado-bom", line: "Se esse tipo de vídeo te ajuda, se inscreve no canal." },
      { kind: "like", at: "after-surprise", line: "Se você também não sabia disso, deixa o like." },
      { kind: "endscreen", at: "end", line: "Tem mais um vídeo aqui que você vai gostar." },
    ],
    forbidden: [...GLOBAL_FORBIDDEN],
    mustHave: ["todo dado com fonte", "um elogio verdadeiro", "opinião dita como opinião"],
    visualRules: { realImageShare: 0.34, minCutSeconds: 1, maxCutSeconds: 6, avatar: "none" },
    thumbStyle: { layout: "foto+frase", maxWords: 6, palette: [] },
    signature: { kind: "frase", template: "" },
  });
}

/** Words and themes no channel may use (spec "Conformidade"); each bible adds its own. */
export const GLOBAL_FORBIDDEN = [
  "piada com etnia",
  "piada com aparência",
  "piada com pobreza",
  "piada com sotaque",
  "acusação sem condenação",
  "eu fui lá",
  "quando eu estive",
  "imagem ilustrativa",
] as const;

// ---------- Channel ----------

export const channelSchema = z.object({
  schemaVersion: z.literal(CHANNEL_SCHEMA_VERSION),
  id: channelId,
  profileId: z.string().min(1).max(80),
  name: text(100).min(1),
  handle: z.string().regex(/^@[A-Za-z0-9._-]{3,30}$/).or(z.literal("")),
  niche: text(200),
  language: z.enum(["pt-BR", "en", "es"]),
  platforms: z.object({ youtubeChannelId: z.string().max(64).optional(), instagram: z.string().max(64).optional(), tiktok: z.string().max(64).optional() }),
  bible: bibleSchema,
  identity: z.object({
    logo: z.string().max(400),
    banner: z.string().max(400),
    palette: z.array(z.string().max(20)).max(8),
    fonts: z.object({ display: text(80), body: text(80) }),
    signature: text(200),
  }),
  defaults: z.object({
    voiceId: z.string().max(120),
    voiceSpeed: z.number().min(0.5).max(2),
    musicMood: z.array(text(40)).max(8),
    longMinMinutes: z.number().min(1).max(60),
    shortsPerEpisode: z.number().int().min(0).max(6),
  }),
  cadence: z.object({ longPerWeek: z.number().int().min(0).max(21), shortPerWeek: z.number().int().min(0).max(70), publishTimes: z.array(z.string().max(40)).max(21) }),
  /** Where the series this channel came from lives (migration from `series.ts`). */
  importedFrom: z.object({ kind: z.literal("series"), id: z.string().max(80), at: iso }).optional(),
  createdAt: iso,
  updatedAt: iso,
});
export type Channel = z.infer<typeof channelSchema>;

// ---------- Backlog ----------

export const ideaSchema = z.object({
  id: ideaId,
  title: text(140).min(1),
  angle: text(400),
  whyClick: text(300),
  format: z.enum(["long", "short", "series"]),
  evidence: z.array(z.object({ competitorUrl: z.string().url().max(400).optional(), views: z.number().int().min(0).optional() })).max(10),
  score: z.number().min(0).max(100),
  status: z.enum(["nova", "na fila", "usada", "descartada"]),
});
export type Idea = z.infer<typeof ideaSchema>;
export const backlogSchema = z.object({ schemaVersion: z.literal(CHANNEL_SCHEMA_VERSION), ideas: z.array(ideaSchema).max(500) });
export type Backlog = z.infer<typeof backlogSchema>;

/** Spec: 0–100 = demand (40) + gap (30) + bible fit (20) + real-image ease (10); each input 0–1. */
export function scoreIdea(p: { demand: number; gap: number; fit: number; imagery: number }) {
  const c = (n: number) => Math.min(1, Math.max(0, n));
  return Math.round(c(p.demand) * 40 + c(p.gap) * 30 + c(p.fit) * 20 + c(p.imagery) * 10);
}

// ---------- Episode ----------

export const STAGES = ["research", "script", "media", "narration", "align", "scenes", "qa", "render", "package", "shorts", "publish"] as const;
export type Stage = (typeof STAGES)[number];
export const stageStateSchema = z.object({
  status: z.enum(["pendente", "rodando", "ok", "erro", "desatualizado"]),
  jobId: z.string().max(80).optional(),
  error: text(2000).optional(),
  updatedAt: iso.optional(),
  inputHash: z.string().max(80).optional(),
});
export type StageState = z.infer<typeof stageStateSchema>;
const actor = z.enum(["user", "agent", "pilot"]);
export const approvalSchema = z.object({ at: iso, by: actor, note: text(400).optional() });
export const costItemSchema = z.object({ stage: z.enum(STAGES), provider: text(60), units: z.number().min(0), unit: text(30), usd: z.number().min(0), at: iso });
export type CostItem = z.infer<typeof costItemSchema>;

export const episodeSchema = z.object({
  schemaVersion: z.literal(CHANNEL_SCHEMA_VERSION),
  id: episodeId,
  channelId,
  ideaId: ideaId.optional(),
  format: z.enum(["long", "short"]),
  title: text(140).min(1),
  aspect: z.enum(["16:9", "9:16"]),
  stage: z.enum(STAGES),
  stages: z.record(z.enum(STAGES), stageStateSchema),
  approvals: z.object({ script: approvalSchema.optional(), frames: approvalSchema.optional(), final: approvalSchema.optional() }),
  durationSec: z.number().min(0).optional(),
  words: z.number().int().min(0).optional(),
  cost: z.object({ items: z.array(costItemSchema).max(2000), totalUsd: z.number().min(0) }),
  outputs: z.object({ video: z.string().max(400).optional(), preview: z.string().max(400).optional(), shorts: z.array(z.string().max(400)).max(20), thumbs: z.array(z.string().max(400)).max(10) }),
  history: z.array(z.object({ at: iso, actor, action: text(400) })).max(5000),
  createdAt: iso,
  updatedAt: iso,
});
export type Episode = z.infer<typeof episodeSchema>;

export function freshStages(): Record<Stage, StageState> {
  return Object.fromEntries(STAGES.map((s) => [s, { status: "pendente" }])) as Record<Stage, StageState>;
}

// ---------- Research ----------

export const sourceSchema = z.object({
  title: text(300),
  url: z.string().url().max(1000),
  publisher: text(160),
  publishedAt: z.string().max(40).optional(),
  accessedAt: iso,
  /** "oficial" = IBGE, órgão público, índice reconhecido; "imprensa"; "blog". Drives confidence. */
  kind: z.enum(["oficial", "imprensa", "blog", "outro"]).default("outro"),
  /** Exact sentence the value came from. */
  quote: text(1000).optional(),
});
export type Source = z.infer<typeof sourceSchema>;
export const CONFIDENCE = ["alta", "média", "baixa"] as const;
export const factSchema = z.object({
  id: factId,
  claim: text(500).min(1),
  value: z.union([z.number(), z.string().max(80)]).optional(),
  unit: text(40).optional(),
  /** Date the data refers to ("2022", "julho de 2026"); money and rankings always carry it. */
  dataDate: text(40).optional(),
  source: sourceSchema,
  /** Other sources that agree (independent confirmation). */
  confirmations: z.array(sourceSchema).max(10).default([]),
  confidence: z.enum(CONFIDENCE),
  conflicts: z.array(sourceSchema.extend({ value: z.union([z.number(), z.string().max(80)]).optional() })).max(10).optional(),
  /** Prudent wording to use when sources disagree ("cerca de 480 mil"). */
  prudent: text(300).optional(),
  /** Page metadata date ≠ text date: the text date wins and the fact is flagged. */
  suspiciousDate: z.boolean().optional(),
  excluded: z.boolean().optional(),
  usedIn: z.array(beatId).max(200),
});
export type Fact = z.infer<typeof factSchema>;
export const researchSchema = z.object({
  schemaVersion: z.literal(CHANNEL_SCHEMA_VERSION),
  questions: z.array(text(300)).max(30),
  facts: z.array(factSchema).max(400),
  /** Pages that could not be read (paywall, timeout): they never count as a source. */
  unread: z.array(z.object({ url: z.string().max(1000), reason: text(200) })).max(100),
  /** Pages read for this episode (limit of 30 per episode). */
  pages: z.array(z.object({ url: z.string().max(1000), title: text(300), readAt: iso })).max(60).default([]),
  premise: z.object({ question: text(300), verdict: z.enum(["confirma", "nega", "parcial", "indefinido"]), note: text(600) }).optional(),
  provider: z.enum(["agent", "tavily", "brave", "exa", "perplexity", "manual"]).optional(),
  updatedAt: iso,
});
export type Research = z.infer<typeof researchSchema>;

// ---------- Script (beats + scenes) ----------

export const SCENE_TYPES = [
  "photo", "video", "stat", "rank", "versus", "calc", "timeline", "map",
  "title", "quote", "doc", "list", "cards", "flip", "ticket",
  "stick", "flood", "heat", "blackout", "factory", "jam", "bridge", "gauge", "house", "walk", "route",
  "cta", "poll", "next", "placa", "avatar",
] as const;
export type SceneType = (typeof SCENE_TYPES)[number];
/** Scene types the compiler renders today (phase 1 starts with these six; the rest of the catalog follows). */
export const COMPILED_SCENES = ["photo", "video", "stat", "title", "list", "cta"] as const satisfies readonly SceneType[];
/** Scenes that show real imagery (photo, B-roll); `bgVideo` also counts on any scene. */
export const REAL_IMAGE_SCENES: readonly SceneType[] = ["photo", "video"];
/** Pure text scenes: the review forbids 3 in a row. */
export const TEXT_SCENES: readonly SceneType[] = ["title", "quote", "doc", "list", "cards"];

export const sceneSchema = z.object({
  type: z.enum(SCENE_TYPES),
  /** Type-specific data, validated by the scene compiler. */
  data: z.record(z.string(), z.unknown()).default({}),
  /** Media ids (licenses.json) this scene uses. */
  media: z.array(mediaId).max(12).default([]),
  /** Search query for real imagery, built by the writer: place + object + mood. */
  query: text(200).optional(),
  /** Place the imagery must be from ("Copacabana"); empty = generic, no place tag. */
  place: text(80).optional(),
  bgVideo: mediaId.optional(),
  stickers: z.array(mediaId).max(6).optional(),
});
export type Scene = z.infer<typeof sceneSchema>;

export const wordTimeSchema = z.object({ t: z.string().max(80), s: z.number().min(0), e: z.number().min(0) });
export const beatSchema = z.object({
  id: beatId,
  section: z.string().regex(/^[a-z0-9-]{1,40}$/),
  text: text(600).min(1),
  say: text(1200).optional(),
  facts: z.array(factId).max(12),
  scene: sceneSchema,
  /** CTA kind when this beat is an interaction call. */
  cta: z.enum(CTA_KINDS).optional(),
  isNew: z.boolean().optional(),
  timing: z.object({ start: z.number().min(0), end: z.number().min(0), cut: z.number().min(0), words: z.array(wordTimeSchema).max(400) }).optional(),
  hash: z.string().max(80),
});
export type Beat = z.infer<typeof beatSchema>;
export const scriptSchema = z.object({
  schemaVersion: z.literal(CHANNEL_SCHEMA_VERSION),
  sections: z.array(z.object({ id: z.string().regex(/^[a-z0-9-]{1,40}$/), title: text(80) })).max(20),
  beats: z.array(beatSchema).max(600),
  /** Next beat counter; ids are never reused, so inserting keeps every id stable. */
  nextBeat: z.number().int().min(1),
  /** Measured words per minute of the chosen voice, for the duration estimate. */
  wpm: z.number().min(60).max(260).optional(),
  updatedAt: iso,
});
export type Script = z.infer<typeof scriptSchema>;

// ---------- Media & licenses ----------

export const MEDIA_LICENSES = ["CC0", "PD", "CC BY", "CC BY-SA", "Pexels", "Pixabay", "user", "generated"] as const;
export const mediaItemSchema = z.object({
  id: mediaId,
  kind: z.enum(["photo", "video", "music", "sfx", "icon"]),
  file: z.string().max(400),
  source: z.enum(["commons", "openverse", "pexels", "pixabay", "incompetech", "freesound", "jamendo", "user", "generated"]),
  sourceUrl: z.string().max(1000),
  author: text(200),
  license: z.enum(MEDIA_LICENSES),
  licenseUrl: z.string().max(400),
  attribution: text(600),
  width: z.number().int().min(0).optional(),
  height: z.number().int().min(0).optional(),
  durationSec: z.number().min(0).optional(),
  place: text(80).optional(),
  title: text(300).optional(),
  generated: z.boolean().optional(),
  usedIn: z.array(beatId).max(200),
});
export type MediaItem = z.infer<typeof mediaItemSchema>;
export const licensesSchema = z.object({ schemaVersion: z.literal(CHANNEL_SCHEMA_VERSION), items: z.array(mediaItemSchema).max(2000) });
export type Licenses = z.infer<typeof licensesSchema>;

// ---------- Jobs ----------

export const jobSchema = z.object({
  id: z.string().regex(/^job_[a-z0-9]{4,24}$/),
  episodeId: episodeId.optional(),
  channelId: channelId.optional(),
  profileId: z.string().max(80).optional(),
  stage: z.string().max(40),
  status: z.enum(["queued", "running", "completed", "failed", "cancelled"]),
  progress: z.number().min(0).max(1),
  startedAt: iso,
  finishedAt: iso.optional(),
  log: z.array(text(600)).max(400),
  error: text(2000).optional(),
  result: z.unknown().optional(),
  costUsd: z.number().min(0),
  /** Free-form input so a job can be resumed after the app is closed. */
  input: z.unknown().optional(),
});
export type Job = z.infer<typeof jobSchema>;

// ---------- Migrations ----------

export type ChannelFileKind = "channel" | "backlog" | "episode" | "research" | "script" | "licenses";
type Migration = (value: Record<string, unknown>) => Record<string, unknown>;
/** `MIGRATIONS[kind][n]` upgrades a file from schemaVersion n to n + 1. Version 0 = files written before `schemaVersion` existed. */
export const MIGRATIONS: Record<ChannelFileKind, Record<number, Migration>> = {
  channel: { 0: (v) => ({ ...v, schemaVersion: 1 }) },
  backlog: { 0: (v) => ({ ideas: v.__list ?? v.ideas ?? [], schemaVersion: 1 }) },
  episode: { 0: (v) => ({ ...v, schemaVersion: 1 }) },
  research: { 0: (v) => ({ questions: [], unread: [], pages: [], ...v, schemaVersion: 1 }) },
  script: { 0: (v) => ({ sections: [], ...v, schemaVersion: 1 }) },
  licenses: { 0: (v) => ({ items: v.__list ?? v.items ?? [], schemaVersion: 1 }) },
};
export const SCHEMAS = {
  channel: channelSchema,
  backlog: backlogSchema,
  episode: episodeSchema,
  research: researchSchema,
  script: scriptSchema,
  licenses: licensesSchema,
} as const;
type Parsed = { [K in ChannelFileKind]: z.infer<(typeof SCHEMAS)[K]> };

/** Upgrades a raw JSON value to the current schemaVersion and validates it. */
export function migrateChannelFile<K extends ChannelFileKind>(kind: K, raw: unknown): Parsed[K] {
  if (raw === null || typeof raw !== "object") throw new Error(`Arquivo ${kind} inválido.`);
  /** Old files that were a bare list (backlog, licenses) are wrapped first. */
  let value: Record<string, unknown> = Array.isArray(raw) ? { __list: raw } : { ...(raw as Record<string, unknown>) };
  let version = typeof value.schemaVersion === "number" ? value.schemaVersion : 0;
  if (version > CHANNEL_SCHEMA_VERSION) throw new Error(`Arquivo ${kind} é de uma versão mais nova do Videosell (schemaVersion ${version}). Atualize o app.`);
  while (version < CHANNEL_SCHEMA_VERSION) {
    const step = MIGRATIONS[kind][version];
    if (!step) throw new Error(`Sem migração de ${kind} da versão ${version}.`);
    value = step(value);
    version = value.schemaVersion as number;
  }
  return SCHEMAS[kind].parse(value) as Parsed[K];
}

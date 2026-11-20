import { join } from "node:path";
import { z } from "zod";
import { copyFile, mkdir, stat } from "node:fs/promises";
import { extname } from "node:path";
import { STAGES, type Stage } from "../../../src/shared/channel";
import { FORMAT_TEMPLATES, formatOf } from "../../../src/shared/channel-formats";
import type { Transcriber } from "./aligner";
import { ChannelStore, createChannelArgs } from "./channel-store";
import { hyperframesRenderer, renderEpisode, renderProgress, type SceneRenderer } from "./episode-render";
import { durationOf } from "./ffmpeg";
import { readJsonOr } from "./fs-json";
import type { JobRunner } from "./jobs";
import { pickForBeat, readCandidates, registerUserMedia, searchForBeat, type Keys } from "./media-hub";
import { DEFAULT_VOICE_SETTINGS, alignNarration, generateNarration, narrationChars, redoBeats, type Speaker, type VoiceSettings } from "./narration";
import { generatePackage, packageInputSchema } from "./packager";
import { VISION_RUBRIC, hyperframesBench, runQa, type BenchRunner } from "./qa";
import { addFacts, emptyResearch, factInputSchema, setFactExcluded, setPremise, summarizeResearch } from "./research";
import { compileEpisodeScenes } from "./scene-compiler";
import { beatEditSchema, beatInputSchema, editScript, pageScript, readPronunciations, reviewScript, saveScript, scriptBrief, writePronunciations } from "./script-writer";
import { cutShorts } from "./shorts";

/**
 * MCP tools of the channel studio (spec "MCP e agentes"), on the same server as the rest.
 * Contracts: a long tool answers within 40 s with a `jobId` and keeps running (Codex cuts MCP
 * calls at ~60 s) — `channel_job_status` (or `job_status` with `jobId`) gives progress and
 * result; answers carry paths and ids, never giant content; errors carry a stable `code`;
 * calling a long tool again never duplicates work (the job of that episode + stage is reused);
 * keys never leave the app; page text is data, never instructions.
 * Names that already exist for story series (`episode_create`, `episode_*`) get the
 * `channel_` prefix so the old tools keep working.
 */

/** Approximate list price of paid voices, in US$ per 1,000 characters (estimate shown before spending). */
const PRICE_PER_1K: Record<string, number> = { elevenlabs: 0.22, fish: 0.015, openai: 0.015 };

const obj = (properties: Record<string, unknown> = {}, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });
const str = (description: string, extra: Record<string, unknown> = {}) => ({ type: "string", description, ...extra });
const num = (description: string, extra: Record<string, unknown> = {}) => ({ type: "number", description, ...extra });
const arr = (items: unknown, description: string, extra: Record<string, unknown> = {}) => ({ type: "array", items, description, ...extra });
const anyObj = (description: string) => ({ type: "object", description, additionalProperties: true });
const P = { profileId: str("Profile id (profile_list).") };
const C = { ...P, channelId: str("Channel id (channel_list).") };
const E = { ...C, episodeId: str("Episode id, e.g. ep_7k2m.") };
const req = { P: ["profileId"], C: ["profileId", "channelId"], E: ["profileId", "channelId", "episodeId"] };

export const CHANNEL_TOOLS = [
  { name: "format_templates", description: "Example formats (cidade, top10, e-se) with every field: structure, scenes, imagery, duration, character, checklist, rubric, writing rules. Videosell does not pick the niche: copy, mix or ignore these and write the format for ANY niche in channel_create. Immediate.", inputSchema: obj({}) },
  { name: "channel_create", description: "Create a dark channel for ANY niche. `format` is a template id (format_templates) or a whole format you write for the niche (id, name, aspect, durationSec {min,max}, scenes, imagery {sources}, character?, research, checklist [{id, kind, level, params}], rubric, writingRules, structure [{id, title, targetSec, mustHave}], hookRules, ctaPlan, thumbStyle); `extends` fills what you leave out from a template. The checklist drives script_review. `voice` = {provider: elevenlabs|fish|openai|kokoro|local, voiceId} (Fish Audio: reference_id). Immediate.", inputSchema: obj({ ...P, name: str("Channel name."), handle: str("@handle (checked later at creation on YouTube)."), niche: str("Niche in a few words."), language: str("pt-BR, en or es.", { enum: ["pt-BR", "en", "es"] }), format: { description: "Template id (\"cidade\", \"top10\", \"e-se\") or a format object for the niche (see format_templates).", anyOf: [{ type: "string" }, { type: "object", additionalProperties: true }] }, voice: obj({ provider: str("Voice provider.", { enum: ["elevenlabs", "fish", "openai", "kokoro", "local"] }), voiceId: str("Voice id (ElevenLabs voice_id, Fish Audio reference_id, OpenAI voice, Kokoro voice).") }, ["provider"]), voiceId: str("Legacy: 'provider:id'."), longMinMinutes: num("Legacy minimum length (the format's durationSec wins).") }, ["profileId", "name"]) },
  { name: "channel_character_set", description: "Set the image of the channel's fixed character (format.character): copies a local PNG/JPG/WEBP (avatar render, generated or user art) into the channel; character scenes use it when they have no media. Immediate.", inputSchema: obj({ ...C, path: str("Absolute path of the image on this computer."), name: str("Character name (optional).") }, [...req.C, "path"]) },
  { name: "channel_get", description: "Read a channel: bible, identity, defaults, cadence. Immediate.", inputSchema: obj(C, req.C) },
  { name: "channel_list", description: "List the profile's channels. Immediate.", inputSchema: obj(P, req.P) },
  { name: "channel_update", description: "Patch a channel (bible, identity, defaults, cadence are merged one level deep). `format` (template id or the format fields to change) is merged over the current format and validated; `voice` = {provider, voiceId}. Immediate.", inputSchema: obj({ ...C, patch: anyObj("Fields to change.") }, [...req.C, "patch"]) },
  { name: "channel_import_series", description: "Turn an existing story series (series_list) into a channel: premise → promise, tone → voice, rules → must-have, ideas → backlog. The series is untouched.", inputSchema: obj({ ...P, seriesId: str("Series id.") }, ["profileId", "seriesId"]) },
  { name: "channel_pronunciations", description: "Read or replace the channel's pronunciation dictionary (word → how the TTS must read it), applied to every episode.", inputSchema: obj({ ...C, set: anyObj("Optional new dictionary { palavra: 'pronúncia' }.") }, req.C) },
  { name: "backlog_get", description: "The channel's backlog (ideas with score 0–100 and status).", inputSchema: obj(C, req.C) },
  { name: "backlog_update", description: "Add ideas you researched (title, angle = the counter-thesis, whyClick, evidence [{competitorUrl, views}], score 0–100 = demand 40 + gap 30 + bible fit 20 + real-image ease 10) or change one idea's status ('nova','na fila','usada','descartada').", inputSchema: obj({ ...C, add: arr(anyObj("Idea."), "Ideas to add."), update: obj({ ideaId: str("Idea id."), patch: anyObj("Fields.") }, ["ideaId", "patch"]) }, req.C) },
  { name: "channel_episode_create", description: "Create an episode of a channel (from a backlog idea or a title). long = 16:9, short = 9:16. Immediate.", inputSchema: obj({ ...C, title: str("Episode title."), format: str("long or short.", { enum: ["long", "short"] }), ideaId: str("Backlog idea id.") }, [...req.C, "title"]) },
  { name: "channel_episode_get", description: "Read an episode: stages, approvals, cost, outputs (paths). Immediate.", inputSchema: obj(E, req.E) },
  { name: "channel_episode_list", description: "List a channel's episodes. Immediate.", inputSchema: obj(C, req.C) },
  { name: "episode_status", description: "Stages with status, warnings, cost and outputs of an episode, plus the render grid. Immediate.", inputSchema: obj(E, req.E) },
  { name: "episode_approve", description: "Record an approval (script, frames or final). ONLY after the user approved in chat (or the channel is in direct mode for script/frames). Immediate.", inputSchema: obj({ ...E, gate: str("script, frames or final.", { enum: ["script", "frames", "final"] }), note: str("Optional note.") }, [...req.E, "gate"]) },
  { name: "research_add_facts", description: "Store facts YOU researched with your own search (Videosell does not search the web), each with the exact claim, value, unit, date of the data and the source {url, publisher, title, publishedAt, quote}. The app classifies the source (official/press/blog), sets confidence (2 independent sources or 1 official = alta; 1 press = média; blog = baixa, never enters the script), merges confirmations and conflicts (with prudent wording). Immediate.", inputSchema: obj({ ...E, facts: arr(anyObj("Fact."), "Facts with sources.", { maxItems: 60 }) }, [...req.E, "facts"]) },
  { name: "research_get", description: "Facts table (claim, value, source, date, confidence, used in), conflicts, unread pages and warnings. Immediate.", inputSchema: obj({ ...E, page: num("Page (40 facts per page).") }, req.E) },
  { name: "research_exclude_fact", description: "Mark a fact 'não usar' (or back). The script must then be rewritten without it.", inputSchema: obj({ ...E, factId: str("Fact id."), excluded: { type: "boolean" } }, [...req.E, "factId", "excluded"]) },
  { name: "research_set_premise", description: "Record whether the data confirm the title's premise (confirma, nega, parcial, indefinido). If not, the script answers honestly and that becomes the turn.", inputSchema: obj({ ...E, question: str("The video's question."), verdict: str("Verdict.", { enum: ["confirma", "nega", "parcial", "indefinido"] }), note: str("Short explanation.") }, [...req.E, "question", "verdict", "note"]) },
  { name: "script_generate", description: "Brief to write the script in the channel's formula: structure with seconds per movement, target words, hook rules, CTA plan, forbidden words, usable facts (ids) and the scene types/data the compiler renders. Write the beats and save them with script_save. Immediate.", inputSchema: obj(E, req.E) },
  { name: "script_save", description: "Save the whole script as beats [{section, text, say?, facts:[factIds], scene:{type, data, media?, query?, place?, bgVideo?}, cta?}] (replaces the previous one). Returns ids and the automatic review (errors must be fixed before approval). Immediate.", inputSchema: obj({ ...E, beats: arr(anyObj("Beat."), "Beats in order.", { maxItems: 600 }), sections: arr(obj({ id: str("id"), title: str("title") }, ["id", "title"]), "Sections (default: the bible's structure)."), wpm: num("Measured words per minute of the voice.") }, [...req.E, "beats"]) },
  { name: "script_get", description: "The script, paged (40 beats per page). Immediate.", inputSchema: obj({ ...E, page: num("Page.") }, req.E) },
  { name: "script_edit_beats", description: "Edit beats BY ID, never by position: {op:'insert', after|before: beatId, beat}, {op:'update', id, patch}, {op:'delete', id}, {op:'move', id, after|before}. Later stages become stale; only new/changed beats are narrated again. Immediate.", inputSchema: obj({ ...E, edits: arr(anyObj("Edit."), "Edits in order.", { maxItems: 100 }) }, [...req.E, "edits"]) },
  { name: "script_review", description: "Run the automatic script review again: structure, scene types of the format, forbidden words, length, and every item of the channel format's checklist (each issue says which `check` raised it). Immediate.", inputSchema: obj(E, req.E) },
  { name: "media_search", description: "Search 4–8 licensed candidates for one beat (place photos from Commons/Openverse, generic from Pexels/Pixabay, B-roll ≥ 1080p, never NC/ND). Returns candidates with an index and a contact sheet image path. Look at the sheet before picking: the place tag is sacred. Job.", inputSchema: obj({ ...E, beatId: str("Beat id."), kind: str("photo, video, music or sfx.", { enum: ["photo", "video", "music", "sfx"] }), query: str("Override query: place + object + mood.") }, [...req.E, "beatId"]) },
  { name: "media_pick", description: "Download candidate `index` of a beat's last search, register its license and put it on the scene (role main, bgVideo or sticker). Pass `place` only if the image really is from that place. Job.", inputSchema: obj({ ...E, beatId: str("Beat id."), index: num("Candidate index."), place: str("Place shown (only if true)."), role: str("main, bgVideo or sticker.", { enum: ["main", "bgVideo", "sticker"] }) }, [...req.E, "beatId", "index"]) },
  { name: "media_music", description: "Search music (incompetech, Jamendo; ≥ 90 s) and register the chosen tracks for the episode (up to 3, one per group of sections). Job.", inputSchema: obj({ ...E, query: str("Mood/instruments, e.g. 'tense piano'."), pick: arr(num("index"), "Indexes to register from this search (empty = just list).") }, [...req.E, "query"]) },
  { name: "media_import", description: "Use a file the user gave you (their own photo, video or music, absolute path): copies it into the episode with license 'user' and puts it on the beat's scene. Pass `place` only if it really is from that place. Immediate.", inputSchema: obj({ ...E, file: str("Absolute path of the user's file."), kind: str("photo, video or music.", { enum: ["photo", "video", "music"] }), beatId: str("Beat id (not for music)."), place: str("Place shown."), author: str("Author to credit.") }, [...req.E, "file", "kind"]) },
  { name: "media_list", description: "Registered media of the episode with license, author, place and where it is used. Immediate.", inputSchema: obj(E, req.E) },
  { name: "narration_generate", description: "Narrate the whole script in blocks (≤ 1,700 characters per section block; each block cached by hash), join, normalize to −16 LUFS. Shows the estimated characters before spending. Job.", inputSchema: obj({ ...E, confirmCost: { type: "boolean", description: "true after the user saw the estimate (paid voices)." } }, req.E) },
  { name: "narration_redo_beats", description: "Re-record only the given beats (default: new or changed ones), rebuild the audio and re-align; only scenes whose time changed go stale. Job.", inputSchema: obj({ ...E, beatIds: arr(str("Beat id."), "Beats to re-record.") }, req.E) },
  { name: "align_run", description: "Word-level alignment of the narration with the script (match ≥ 97% target, fails under 95% with the worst span); writes each beat's start/end/cut. Job.", inputSchema: obj(E, req.E) },
  { name: "scenes_compile", description: "Compile every beat into its HyperFrames scene (unchanged scenes are kept). Job.", inputSchema: obj(E, req.E) },
  { name: "qa_run", description: "Frame bench (2 frames per scene, numbered sheets of 20) + automatic checks; returns the report path, the sheets and only what needs a human eye. Job.", inputSchema: obj({ ...E, beatIds: arr(str("Beat id."), "Only these scenes (to validate a fix).") }, req.E) },
  { name: "qa_report", description: "The last QA report (issues with scene, frame and suggested fix). Immediate.", inputSchema: obj(E, req.E) },
  { name: "frames_sheet", description: "Paths of the numbered frame sheets plus the vision rubric for an optional review (score 1–5 per scene, concrete fix for ≤ 3). Immediate.", inputSchema: obj(E, req.E) },
  { name: "episode_render", description: "Render scene by scene in parallel with cache, then concat, mix and encode out/video.mp4 + preview. Idempotent (cache + lock). Needs the frames approval unless the channel is in direct mode. Job.", inputSchema: obj({ ...E, encode: str("copy (fast, default) or x264 (CRF 18).", { enum: ["copy", "x264"] }) }, req.E) },
  { name: "package_generate", description: "Assemble the publishing package from your words: 3 titles (≤ 70), 3 thumb phrases (2–3 lines, ≤ 6 words), intro, hashtags (3), tags (10–15). The app adds chapters with the real times, FONTES, credits, notices, checks limits and renders the 3 thumbs. Job.", inputSchema: obj({ ...E, titles: arr(str("Title."), "3 titles."), thumbs: arr(anyObj("{lines:[...], media?, chip?}"), "3 thumbs."), intro: str("2–3 opening sentences."), question: str("Comment question (default: the comment CTA)."), hashtags: arr(str("Hashtag."), "3 hashtags."), tags: arr(str("Tag."), "10–15 tags."), recommended: num("Index 0–2 of the recommended title + thumb pair.") }, [...req.E, "titles", "thumbs", "intro", "hashtags", "tags"]) },
  { name: "package_get", description: "The episode's package (titles, thumbs paths, description, pinned comment, chapters, tags, fields). Immediate.", inputSchema: obj(E, req.E) },
  { name: "shorts_cut", description: "Cut the vertical Shorts from the rendered long episode (default 2: the opening hook + the best 40–58 s window), reusing the cached scenes. Optionally give windows [{beatIds:[...], hook:['line','line']}]. Job.", inputSchema: obj({ ...E, count: num("How many cuts."), windows: arr(anyObj("Window."), "Explicit windows.") }, req.E) },
  { name: "pipeline_run", description: "Run the mechanical stages from one stage to another (narration, align, scenes, qa, render, shorts), stopping at missing approvals (frames before render). Research, script, media and package come from you. Job.", inputSchema: obj({ ...E, from: str("First stage.", { enum: ["narration", "align", "scenes", "qa", "render", "shorts"] }), to: str("Last stage.", { enum: ["narration", "align", "scenes", "qa", "render", "shorts"] }), direct: { type: "boolean", description: "Direct mode: skip the script and frames approvals (only if the user turned it on)." } }, req.E) },
  { name: "channel_job_status", description: "Progress and result of a channel job (jobId), or the recent jobs of an episode. Immediate.", inputSchema: obj({ jobId: str("Job id."), episodeId: str("Episode id."), cancel: { type: "boolean", description: "Cancel this job." } }) },
] as const;

export type ChannelToolName = (typeof CHANNEL_TOOLS)[number]["name"];
export function isChannelTool(name: string): name is ChannelToolName {
  return CHANNEL_TOOLS.some((t) => t.name === name);
}

export type ChannelToolDeps = {
  store: ChannelStore;
  jobs: JobRunner;
  secret: (name: string) => Promise<string | undefined>;
  kit: { gsap: string; fontsDir: string };
  /** HyperFrames worker + browser (throws a clear error when the package is missing). */
  runner: () => Promise<{ worker: string; browser: string }>;
  transcriber: (language: string) => Promise<Transcriber>;
  speaker: (voice: VoiceSettings) => Promise<Speaker>;
  series?: (profileId: string, seriesId: string) => Promise<import("../../../src/shared/story").Series>;
  /** Test hooks. */
  renderer?: SceneRenderer;
  bench?: BenchRunner;
  waitMs?: number;
};

const ids = z.object({ profileId: z.string().min(1).max(80), channelId: z.string().min(1).max(64), episodeId: z.string().min(1).max(40) });
const cIds = ids.pick({ profileId: true, channelId: true });

/** Error with a stable code and a one-line fix (MCP answers carry it in the message). */
function coded(error: unknown) {
  const e = error as Error & { code?: string };
  if (e instanceof z.ZodError) return Object.assign(new Error(`[INVALID_INPUT] ${e.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`), { code: "INVALID_INPUT" });
  if (e?.code && !String(e.message).startsWith("[")) return Object.assign(new Error(`[${e.code}] ${e.message}`), { code: e.code });
  return e;
}

export function createChannelToolDispatcher(deps: ChannelToolDeps) {
  const { store, jobs } = deps;
  const wait = deps.waitMs ?? 40_000;
  const renderer = async () => deps.renderer ?? hyperframesRenderer(await deps.runner());
  const bench = async (dir: string) => deps.bench ?? hyperframesBench(await deps.runner(), dir);
  const voiceOf = async (p: string, c: string): Promise<VoiceSettings> => {
    const ch = await store.getChannel(p, c);
    const [provider, voiceId] = ch.defaults.voiceId.includes(":") ? (ch.defaults.voiceId.split(":", 2) as [VoiceSettings["provider"], string]) : (["elevenlabs", ch.defaults.voiceId] as const);
    return { provider, voiceId, ...DEFAULT_VOICE_SETTINGS, speed: ch.defaults.voiceSpeed };
  };
  const audioDuration = async (p: string, c: string, e: string) => durationOf(join(store.episodeDir(p, c, e), "audio", "narracao.wav"));
  const mediaKeys = async (): Promise<Keys> => ({ pexels: await deps.secret("pexels"), pixabay: await deps.secret("pixabay") });

  // ---------- job handlers ----------
  type J = z.infer<typeof ids>;
  const stage = async (i: J, s: Stage, work: () => Promise<unknown>) => {
    await store.setStage(i.profileId, i.channelId, i.episodeId, s, { status: "rodando" });
    try {
      const r = await work();
      return r;
    } catch (error) {
      await store.setStage(i.profileId, i.channelId, i.episodeId, s, { status: "erro", error: (error as Error).message.slice(0, 500) }).catch(() => undefined);
      throw error;
    }
  };
  const handlers: Record<string, (input: J & Record<string, unknown>, ctx: Parameters<Parameters<JobRunner["register"]>[1]>[1]) => Promise<unknown>> = {
    media: async (i, ctx) => {
      if (i.mode === "pick") return pickForBeat(store, i, String(i.beatId), Number(i.index), { place: i.place as string | undefined, role: i.role as never, signal: ctx.signal, http: { signal: ctx.signal, onWait: (s, host) => ctx.log(`${host} limitou os downloads. Tentando de novo em ${s} s.`) } });
      if (i.mode === "music") {
        const { searchMedia, registerCandidate } = await import("./media-hub");
        const ep = await store.getEpisode(i.profileId, i.channelId, i.episodeId);
        const found = await searchMedia(String(i.query), "music", { aspect: ep.aspect }, {}, { want: 8 });
        const picked = [];
        for (const n of (i.pick as number[]) ?? []) if (found.candidates[n]) picked.push(await registerCandidate(store, i, found.candidates[n], { aspect: ep.aspect, signal: ctx.signal }));
        return { candidates: found.candidates.map((c, k) => ({ index: k, title: c.title, author: c.author, license: c.license, durationSec: c.durationSec })), registered: picked.map((m) => ({ id: m.id, title: m.title, attribution: m.attribution })), errors: found.errors };
      }
      return searchForBeat(store, i, String(i.beatId), { kind: i.kind as never, query: i.query as string | undefined, keys: await mediaKeys(), sheet: true, http: { signal: ctx.signal } });
    },
    narration: async (i, ctx) =>
      stage(i, "narration", async () => {
        const voice = await voiceOf(i.profileId, i.channelId);
        const speak = await deps.speaker(voice);
        const res = await generateNarration(store, i, speak, voice, { signal: ctx.signal, onProgress: ctx.progress });
        await store.addCost(i.profileId, i.channelId, i.episodeId, { stage: "narration", provider: voice.provider, units: res.spentChars, unit: "caracteres", usd: (res.spentChars / 1000) * (PRICE_PER_1K[voice.provider] ?? 0) });
        await store.setStage(i.profileId, i.channelId, i.episodeId, "narration", { status: "ok", inputHash: res.blocks.map((b) => b.id).join("").slice(0, 60) });
        return { file: "audio/narracao.wav", durationSec: res.durationSec, blocks: res.blocks.length, spentChars: res.spentChars };
      }),
    redo: async (i, ctx) =>
      stage(i, "narration", async () => {
        const ch = await store.getChannel(i.profileId, i.channelId);
        const voice = await voiceOf(i.profileId, i.channelId);
        const res = await redoBeats(store, i, await deps.speaker(voice), voice, await deps.transcriber(ch.language), { beatIds: i.beatIds as string[] | undefined, language: ch.language, signal: ctx.signal });
        await store.setStage(i.profileId, i.channelId, i.episodeId, "narration", { status: "ok", inputHash: `redo-${Date.now()}` });
        await store.setStage(i.profileId, i.channelId, i.episodeId, "align", { status: "ok", inputHash: `redo-${Date.now()}` });
        return res;
      }),
    align: async (i, ctx) =>
      stage(i, "align", async () => {
        const ch = await store.getChannel(i.profileId, i.channelId);
        const res = await alignNarration(store, i, await deps.transcriber(ch.language), { language: ch.language, signal: ctx.signal });
        await store.setStage(i.profileId, i.channelId, i.episodeId, "align", { status: "ok", inputHash: String(res.duration) });
        return res;
      }),
    scenes: async (i) => compileEpisodeScenes(store, i, deps.kit, { audioDuration: await audioDuration(i.profileId, i.channelId, i.episodeId) }),
    qa: async (i, ctx) => {
      const ch = await store.getChannel(i.profileId, i.channelId);
      const epDir = store.episodeDir(i.profileId, i.channelId, i.episodeId);
      const r = await runQa(store, i, { bench: await bench(join(epDir, "qa")), font: join(deps.kit.fontsDir, "Anton-Regular.ttf"), beatIds: i.beatIds as string[] | undefined, signal: ctx.signal, onProgress: ctx.progress, transcribe: i.withWords ? await deps.transcriber(ch.language) : undefined });
      return { ok: r.ok, report: "qa/report.json", sheets: r.sheets, errors: r.issues.filter((x) => x.level === "erro"), warnings: r.issues.filter((x) => x.level === "aviso").length, elapsedSec: r.elapsedSec };
    },
    render: async (i, ctx) => renderEpisode(store, i, { render: await renderer(), encode: (i.encode as "copy" | "x264") ?? "copy", signal: ctx.signal, onProgress: ctx.progress }),
    package: async (i, ctx) => {
      const epDir = store.episodeDir(i.profileId, i.channelId, i.episodeId);
      const input = packageInputSchema.parse(i.pkg);
      const res = await generatePackage(store, i, input, { bench: await bench(join(epDir, "qa")), kit: deps.kit, signal: ctx.signal });
      return { file: "package.json", titles: res.titles, thumbs: res.thumbs.map((t) => t.file), chapters: res.chapters, issues: res.issues, descriptionChars: res.description.length };
    },
    shorts: async (i, ctx) => cutShorts(store, i, { count: i.count as number | undefined, windows: i.windows as never, fontsDir: deps.kit.fontsDir, signal: ctx.signal, onProgress: ctx.progress }),
    pipeline: async (i, ctx) => {
      const order = ["narration", "align", "scenes", "qa", "render", "shorts"] as const;
      const from = order.indexOf((i.from as (typeof order)[number]) ?? "narration");
      const to = order.indexOf((i.to as (typeof order)[number]) ?? "shorts");
      const done: string[] = [];
      for (const s of order.slice(from, to + 1)) {
        const ep = await store.getEpisode(i.profileId, i.channelId, i.episodeId);
        if (s === "narration" && !ep.approvals.script && !i.direct) return { done, stoppedAt: s, waiting: "Aprovação do roteiro (episode_approve gate script)." };
        if (s === "render" && !ep.approvals.frames && !i.direct) return { done, stoppedAt: s, waiting: "Aprovação dos quadros (confira as folhas e chame episode_approve gate frames)." };
        ctx.progress(done.length / (to - from + 1), `Etapa: ${s}`);
        const result = (await handlers[s === "shorts" ? "shorts" : s](i, ctx)) as Record<string, unknown> | undefined;
        if (s === "qa" && result && result.ok === false) return { done, stoppedAt: s, waiting: "Corrija os erros da revisão (qa_report) e rode de novo.", qa: result };
        if (s === "scenes" && result && Number(result.errors) > 0) return { done, stoppedAt: s, waiting: "Há cenas com erro (episode_status).", scenes: result };
        done.push(s);
      }
      return { done };
    },
  };
  for (const [name, h] of Object.entries(handlers)) jobs.register(`channel.${name}`, (input, ctx) => h(input as never, ctx));

  /** Starts (or reuses) the job and answers within `wait`. */
  const job = async (name: string, input: J & Record<string, unknown>) => {
    await store.getEpisode(input.profileId, input.channelId, input.episodeId); // validates ids
    const { job: started } = await jobs.start(`channel.${name}`, input, { episodeId: input.episodeId, channelId: input.channelId, profileId: input.profileId });
    const state = await jobs.wait(started.id, wait);
    return jobView(state ?? started);
  };

  async function sceneWith(i: J, beatId: string, mediaId: string, place?: string) {
    const script = await store.readEpisodeFile(i.profileId, i.channelId, i.episodeId, "script");
    const beat = script?.beats.find((b) => b.id === beatId);
    if (!beat) throw Object.assign(new Error(`A fala ${beatId} não existe.`), { code: "BEAT_NOT_FOUND" });
    return { ...beat.scene, media: [...beat.scene.media.filter((m) => m !== mediaId), mediaId], place: place ?? beat.scene.place };
  }

  return async (name: string, raw: Record<string, unknown>): Promise<unknown> => {
    try {
      return await dispatch(name, raw);
    } catch (error) {
      throw coded(error);
    }
  };

  async function dispatch(name: string, a: Record<string, unknown>): Promise<unknown> {
    switch (name as ChannelToolName) {
      case "format_templates":
        return Object.entries(FORMAT_TEMPLATES).map(([id, t]) => ({ id, when: t.when, format: { ...t.format, ...t.bible } }));
      case "channel_create": {
        const { profileId, ...rest } = z.object({ profileId: z.string() }).passthrough().parse(a);
        const ch = await store.createChannel(profileId, createChannelArgs.parse(rest));
        return { ...ch, next: ch.format?.character && !ch.format.character.image ? "O formato tem personagem fixo: defina a imagem com channel_character_set (avatar renderizado, arte gerada ou do usuário)." : "Crie o primeiro episódio com channel_episode_create." };
      }
      case "channel_character_set": {
        const r = cIds.extend({ path: z.string().min(1).max(1000), name: z.string().max(60).optional() }).parse(a);
        const ext = extname(r.path).toLowerCase();
        if (![".png", ".jpg", ".jpeg", ".webp"].includes(ext)) throw Object.assign(new Error("Use uma imagem PNG, JPG ou WEBP (de preferência PNG com fundo transparente)."), { code: "CHARACTER_IMAGE" });
        if ((await stat(r.path)).size > 15 * 1024 * 1024) throw Object.assign(new Error("Imagem do personagem acima de 15 MB."), { code: "CHARACTER_IMAGE" });
        const ch = await store.getChannel(r.profileId, r.channelId);
        const fmt = formatOf(ch);
        const rel = `assets/personagem${ext}`;
        await mkdir(join(store.channelDir(r.profileId, r.channelId), "assets"), { recursive: true });
        await copyFile(r.path, join(store.channelDir(r.profileId, r.channelId), rel));
        const character = { counters: [], inventory: false, description: "", ...(fmt.character ?? {}), name: r.name ?? fmt.character?.name ?? "Personagem", image: rel };
        const next = await store.updateChannel(r.profileId, r.channelId, { format: { ...fmt, character } });
        return { image: rel, character: next.format?.character };
      }
      case "channel_get": {
        const r = cIds.parse(a);
        return store.getChannel(r.profileId, r.channelId);
      }
      case "channel_list":
        return (await store.listChannels(z.object({ profileId: z.string() }).parse(a).profileId)).map((c) => ({ id: c.id, name: c.name, handle: c.handle, niche: c.niche, language: c.language, updatedAt: c.updatedAt }));
      case "channel_update": {
        const r = cIds.extend({ patch: z.record(z.string(), z.unknown()) }).parse(a);
        return store.updateChannel(r.profileId, r.channelId, r.patch);
      }
      case "channel_import_series": {
        const r = z.object({ profileId: z.string(), seriesId: z.string() }).parse(a);
        if (!deps.series) throw Object.assign(new Error("Séries indisponíveis aqui."), { code: "SERIES_UNAVAILABLE" });
        return store.importSeries(r.profileId, await deps.series(r.profileId, r.seriesId));
      }
      case "channel_pronunciations": {
        const r = cIds.extend({ set: z.record(z.string(), z.string()).optional() }).parse(a);
        return r.set ? writePronunciations(store, r.profileId, r.channelId, r.set) : readPronunciations(store, r.profileId, r.channelId);
      }
      case "backlog_get": {
        const r = cIds.parse(a);
        return store.getBacklog(r.profileId, r.channelId);
      }
      case "backlog_update": {
        const r = cIds.extend({ add: z.array(z.record(z.string(), z.unknown())).max(50).optional(), update: z.object({ ideaId: z.string(), patch: z.record(z.string(), z.unknown()) }).optional() }).parse(a);
        const added = r.add?.length ? await store.addIdeas(r.profileId, r.channelId, r.add as never) : [];
        const updated = r.update ? await store.updateIdea(r.profileId, r.channelId, r.update.ideaId, r.update.patch as never) : undefined;
        return { added: added.map((i) => i.id), updated: updated?.id };
      }
      case "channel_episode_create": {
        const r = cIds.extend({ title: z.string(), format: z.enum(["long", "short"]).optional(), ideaId: z.string().optional() }).parse(a);
        return store.createEpisode(r.profileId, r.channelId, { title: r.title, format: r.format, ideaId: r.ideaId }, "agent");
      }
      case "channel_episode_get": {
        const r = ids.parse(a);
        return store.getEpisode(r.profileId, r.channelId, r.episodeId);
      }
      case "channel_episode_list": {
        const r = cIds.parse(a);
        return (await store.listEpisodes(r.profileId, r.channelId)).map((e) => ({ id: e.id, title: e.title, format: e.format, stage: e.stage, outputs: e.outputs, updatedAt: e.updatedAt }));
      }
      case "episode_status": {
        const r = ids.parse(a);
        const ep = await store.getEpisode(r.profileId, r.channelId, r.episodeId);
        const epDir = store.episodeDir(r.profileId, r.channelId, r.episodeId);
        const qa = (await readJsonOr(join(epDir, "qa", "report.json"), () => undefined)) as { issues?: { level: string }[] } | undefined;
        return {
          title: ep.title,
          folder: epDir,
          stages: Object.fromEntries(STAGES.map((s) => [s, ep.stages[s].status + (ep.stages[s].error ? `: ${ep.stages[s].error}` : "")])),
          approvals: ep.approvals,
          cost: ep.cost.totalUsd,
          outputs: ep.outputs,
          qa: qa ? { errors: qa.issues?.filter((i) => i.level === "erro").length, warnings: qa.issues?.filter((i) => i.level === "aviso").length } : undefined,
          render: await renderProgress(store, r),
          jobs: (await jobs.list({ episodeId: r.episodeId })).slice(0, 5).map(jobView),
        };
      }
      case "episode_approve": {
        const r = ids.extend({ gate: z.enum(["script", "frames", "final"]), note: z.string().max(400).optional() }).parse(a);
        const ep = await store.getEpisode(r.profileId, r.channelId, r.episodeId);
        const need: Record<string, Stage> = { script: "script", frames: "qa", final: "render" };
        if (ep.stages[need[r.gate]].status !== "ok") throw Object.assign(new Error(`A etapa ${need[r.gate]} ainda não está ok (${ep.stages[need[r.gate]].status}).`), { code: "APPROVAL_TOO_EARLY" });
        const next = await store.approve(r.profileId, r.channelId, r.episodeId, r.gate, "agent", r.note);
        return { approvals: next.approvals };
      }
      case "research_add_facts": {
        const r = ids.extend({ facts: z.array(factInputSchema).min(1).max(60) }).parse(a);
        const res = await addFacts(store, r.profileId, r.channelId, r.episodeId, r.facts);
        await store.setStage(r.profileId, r.channelId, r.episodeId, "research", { status: "ok", inputHash: String(res.summary.facts) });
        return res;
      }
      case "research_get": {
        const r = ids.extend({ page: z.number().int().min(1).optional() }).parse(a);
        const research = (await store.readEpisodeFile(r.profileId, r.channelId, r.episodeId, "research")) ?? emptyResearch();
        const page = r.page ?? 1;
        return { summary: summarizeResearch(research), page, pages: Math.max(1, Math.ceil(research.facts.length / 40)), facts: research.facts.slice((page - 1) * 40, page * 40).map((f) => ({ id: f.id, claim: f.claim, value: f.value, unit: f.unit, date: f.dataDate, source: `${f.source.publisher} ${f.source.url}`, kind: f.source.kind, confidence: f.confidence, prudent: f.prudent, conflicts: f.conflicts?.length ?? 0, excluded: f.excluded, usedIn: f.usedIn })), unread: research.unread };
      }
      case "research_exclude_fact": {
        const r = ids.extend({ factId: z.string(), excluded: z.boolean() }).parse(a);
        const res = await setFactExcluded(store, r.profileId, r.channelId, r.episodeId, r.factId, r.excluded);
        return { ok: true, usedIn: res.facts.find((f) => f.id === r.factId)?.usedIn ?? [], next: "Reescreva as falas que usam este fato (script_edit_beats)." };
      }
      case "research_set_premise": {
        const r = ids.extend({ question: z.string().max(300), verdict: z.enum(["confirma", "nega", "parcial", "indefinido"]), note: z.string().max(600) }).parse(a);
        await setPremise(store, r.profileId, r.channelId, r.episodeId, { question: r.question, verdict: r.verdict, note: r.note });
        return { ok: true };
      }
      case "script_generate": {
        const r = ids.parse(a);
        const [ch, ep, research] = await Promise.all([store.getChannel(r.profileId, r.channelId), store.getEpisode(r.profileId, r.channelId, r.episodeId), store.readEpisodeFile(r.profileId, r.channelId, r.episodeId, "research")]);
        const brief = scriptBrief(ch, ep, research);
        if (!brief.facts.length && formatOf(ch).research !== "livre")
          return {
            needsResearch: true,
            next: "O episódio ainda não tem fatos com fonte. Pesquise na internet com a sua busca e grave com research_add_facts antes do roteiro. Se você não tem busca na web (IA dentro do Videosell), chame open_mcp_setup { reason: 'search' } e explique ao usuário que ele pode fazer tudo pelo agente local dele (Claude Code ou Codex) conectado por MCP.",
            brief,
          };
        return { brief, next: "Escreva as falas seguindo o briefing e salve com script_save." };
      }
      case "script_save": {
        const r = ids.extend({ beats: z.array(beatInputSchema).min(1).max(600), sections: z.array(z.object({ id: z.string(), title: z.string() })).optional(), wpm: z.number().min(60).max(260).optional() }).parse(a);
        const { script, review } = await saveScript(store, r, { beats: r.beats, sections: r.sections, wpm: r.wpm });
        return { beats: script.beats.length, ids: [script.beats[0]?.id, script.beats.at(-1)?.id], review };
      }
      case "script_get": {
        const r = ids.extend({ page: z.number().int().min(1).optional() }).parse(a);
        const script = await store.readEpisodeFile(r.profileId, r.channelId, r.episodeId, "script");
        if (!script) throw Object.assign(new Error("O episódio ainda não tem roteiro."), { code: "NO_SCRIPT" });
        return pageScript(script, r.page ?? 1);
      }
      case "script_edit_beats": {
        const r = ids.extend({ edits: z.array(beatEditSchema).min(1).max(100) }).parse(a);
        const res = await editScript(store, r, r.edits);
        return { changed: res.changed, removed: res.removed, review: res.review };
      }
      case "script_review": {
        const r = ids.parse(a);
        const [ch, ep, script, research] = await Promise.all([store.getChannel(r.profileId, r.channelId), store.getEpisode(r.profileId, r.channelId, r.episodeId), store.readEpisodeFile(r.profileId, r.channelId, r.episodeId, "script"), store.readEpisodeFile(r.profileId, r.channelId, r.episodeId, "research")]);
        if (!script) throw Object.assign(new Error("O episódio ainda não tem roteiro."), { code: "NO_SCRIPT" });
        return reviewScript(script, { channel: ch, research, format: ep.format });
      }
      case "media_search": {
        const r = ids.extend({ beatId: z.string(), kind: z.enum(["photo", "video", "music", "sfx"]).optional(), query: z.string().max(200).optional() }).parse(a);
        return job("media", { ...r, mode: "search" });
      }
      case "media_pick": {
        const r = ids.extend({ beatId: z.string(), index: z.number().int().min(0), place: z.string().max(80).optional(), role: z.enum(["main", "bgVideo", "sticker"]).optional() }).parse(a);
        return job("media", { ...r, mode: "pick" });
      }
      case "media_music": {
        const r = ids.extend({ query: z.string().max(200), pick: z.array(z.number().int().min(0)).max(3).optional() }).parse(a);
        return job("media", { ...r, mode: "music" });
      }
      case "media_import": {
        const r = ids.extend({ file: z.string().min(3).max(1000), kind: z.enum(["photo", "video", "music"]), beatId: z.string().optional(), place: z.string().max(80).optional(), author: z.string().max(200).optional() }).parse(a);
        if (!/\.(jpe?g|png|webp|mp4|mov|webm|mp3|wav|m4a)$/i.test(r.file)) throw Object.assign(new Error("Formato não aceito (jpg, png, webp, mp4, mov, webm, mp3, wav, m4a)."), { code: "MEDIA_FORMAT" });
        const item = await registerUserMedia(store, r, { file: r.file, kind: r.kind, author: r.author, place: r.place, usedIn: r.beatId ? [r.beatId] : [] });
        if (r.beatId && r.kind !== "music") {
          await editScript(store, r, [{ op: "update", id: r.beatId, patch: { scene: await sceneWith(r, r.beatId, item.id, r.place) } }]);
        }
        return item;
      }
      case "media_list": {
        const r = ids.parse(a);
        const [licenses, candidates] = await Promise.all([store.readEpisodeFile(r.profileId, r.channelId, r.episodeId, "licenses"), readCandidates(store, r)]);
        return { items: (licenses?.items ?? []).map((m) => ({ id: m.id, kind: m.kind, file: m.file, source: m.source, license: m.license, author: m.author, place: m.place, usedIn: m.usedIn })), searched: Object.keys(candidates) };
      }
      case "narration_generate": {
        const r = ids.extend({ confirmCost: z.boolean().optional() }).parse(a);
        const voice = await voiceOf(r.profileId, r.channelId);
        const script = await store.readEpisodeFile(r.profileId, r.channelId, r.episodeId, "script");
        if (!script) throw Object.assign(new Error("O episódio ainda não tem roteiro."), { code: "NO_SCRIPT" });
        const chars = narrationChars(script.beats);
        const paid = (PRICE_PER_1K[voice.provider] ?? 0) > 0;
        if (paid && !r.confirmCost) return { needsConfirmation: true, estimate: { provider: voice.provider, characters: chars, usd: Math.round((chars / 1000) * PRICE_PER_1K[voice.provider] * 100) / 100 }, next: "Mostre a estimativa ao usuário e chame de novo com confirmCost: true." };
        return job("narration", r);
      }
      case "narration_redo_beats": {
        const r = ids.extend({ beatIds: z.array(z.string()).max(100).optional() }).parse(a);
        return job("redo", r);
      }
      case "align_run":
        return job("align", ids.parse(a));
      case "scenes_compile":
        return job("scenes", ids.parse(a));
      case "qa_run": {
        const r = ids.extend({ beatIds: z.array(z.string()).max(600).optional() }).parse(a);
        return job("qa", r);
      }
      case "qa_report": {
        const r = ids.parse(a);
        return (await readJsonOr(join(store.episodeDir(r.profileId, r.channelId, r.episodeId), "qa", "report.json"), () => {
          throw Object.assign(new Error("Ainda não há revisão; rode qa_run."), { code: "NO_QA" });
        })) as unknown;
      }
      case "frames_sheet": {
        const r = ids.parse(a);
        const report = (await readJsonOr(join(store.episodeDir(r.profileId, r.channelId, r.episodeId), "qa", "report.json"), () => ({}))) as { sheets?: string[]; final?: { sheets?: unknown } };
        return { sheets: report.sheets ?? [], final: report.final?.sheets, rubric: VISION_RUBRIC };
      }
      case "episode_render": {
        const r = ids.extend({ encode: z.enum(["copy", "x264"]).optional() }).parse(a);
        const ep = await store.getEpisode(r.profileId, r.channelId, r.episodeId);
        if (!ep.approvals.frames) throw Object.assign(new Error("Falta a aprovação dos quadros: mostre as folhas (frames_sheet) ao usuário e registre com episode_approve gate frames."), { code: "APPROVAL_REQUIRED" });
        return job("render", r);
      }
      case "package_generate": {
        const r = ids.passthrough().parse(a);
        const { profileId, channelId, episodeId, ...pkg } = r as Record<string, unknown> & z.infer<typeof ids>;
        packageInputSchema.parse(pkg);
        return job("package", { profileId, channelId, episodeId, pkg });
      }
      case "package_get": {
        const r = ids.parse(a);
        return (await readJsonOr(join(store.episodeDir(r.profileId, r.channelId, r.episodeId), "package.json"), () => {
          throw Object.assign(new Error("Ainda não há pacote; rode package_generate."), { code: "NO_PACKAGE" });
        })) as unknown;
      }
      case "shorts_cut": {
        const r = ids.extend({ count: z.number().int().min(1).max(6).optional(), windows: z.array(z.object({ beatIds: z.array(z.string()).min(1), hook: z.array(z.string().max(40)).max(3).optional() })).max(6).optional() }).parse(a);
        return job("shorts", r);
      }
      case "pipeline_run": {
        const stagesEnum = z.enum(["narration", "align", "scenes", "qa", "render", "shorts"]);
        const r = ids.extend({ from: stagesEnum.optional(), to: stagesEnum.optional(), direct: z.boolean().optional() }).parse(a);
        return job("pipeline", r);
      }
      case "channel_job_status": {
        const r = z.object({ jobId: z.string().optional(), episodeId: z.string().optional(), cancel: z.boolean().optional() }).parse(a);
        if (r.jobId) {
          if (r.cancel) jobs.cancel(r.jobId);
          const j = await jobs.get(r.jobId);
          if (!j) throw Object.assign(new Error("Job não encontrado."), { code: "JOB_NOT_FOUND" });
          return jobView(j);
        }
        return { jobs: (await jobs.list({ episodeId: r.episodeId })).slice(0, 10).map(jobView) };
      }
    }
    throw Object.assign(new Error(`Ferramenta de canal desconhecida: ${name}.`), { code: "UNKNOWN_TOOL" });
  }
}

function jobView(j: { id: string; stage: string; status: string; progress: number; log: string[]; error?: string; result?: unknown; costUsd: number }) {
  const running = j.status === "running" || j.status === "queued";
  return {
    jobId: j.id,
    stage: j.stage.replace(/^channel\./, ""),
    status: j.status,
    progress: Math.round(j.progress * 100),
    last: j.log.at(-1),
    ...(j.error ? { error: j.error } : {}),
    ...(j.status === "completed" ? { result: j.result } : {}),
    ...(j.costUsd ? { costUsd: j.costUsd } : {}),
    ...(running ? { next: `Segue no computador do usuário. Chame channel_job_status com jobId ${j.id} em 30–60 s; não chame a ferramenta de novo.` } : {}),
  };
}


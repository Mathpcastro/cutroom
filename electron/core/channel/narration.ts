import { createHash } from "node:crypto";
import { mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Beat, Script } from "../../../src/shared/channel";
import type { SpeechResult } from "../voice";
import { CUT_GAP, alignBeats, type AlignResult, type TimedWord, type Transcriber } from "./aligner";
import type { ChannelStore } from "./channel-store";
import { durationOf, ffmpeg } from "./ffmpeg";
import { writeJsonAtomic } from "./fs-json";

/**
 * Narração em blocos (spec "Narração e alinhamento"):
 * beats of a section are joined into blocks of up to 1,700 characters (the `say` field),
 * each block is its own file named by the hash of its text and voice settings (a failed
 * block never loses the others), blocks are joined with 0.7 s between sections into a mono
 * 44.1 kHz WAV, normalized to −16 LUFS / −1.5 dBTP. Partial re-recording narrates only the
 * new or changed beats and rebuilds the audio from the original pieces.
 */

export const BLOCK_MAX_CHARS = 1700;
export const SECTION_GAP = 0.7;
export const PARTIAL_GAPS = { sameSection: 0.05, newSection: 0.45, beforeNew: 0.15 };
export const NARRATION_LUFS = -16;

export type VoiceSettings = { provider: "elevenlabs" | "fish" | "openai" | "kokoro" | "local"; voiceId: string; speed: number; stability: number; similarity: number; style: number; modelId?: string };
/** Spec default validated with the reference voice. */
export const DEFAULT_VOICE_SETTINGS: Omit<VoiceSettings, "provider" | "voiceId"> = { speed: 1.05, stability: 0.5, similarity: 0.8, style: 0.25 };
export type Speaker = (text: string, options: { signal?: AbortSignal }) => Promise<SpeechResult>;

export type Block = { id: string; section: string; beatIds: string[]; text: string; chars: number };

const said = (b: Pick<Beat, "say" | "text">) => (b.say ?? b.text).trim();
const settingsKey = (v: VoiceSettings) => `${v.provider}|${v.voiceId}|${v.modelId ?? ""}|${v.speed}|${v.stability}|${v.similarity}|${v.style}`;

/** Groups beats of the same section into blocks ≤ 1,700 characters; a beat is never split. */
export function planBlocks(beats: Pick<Beat, "id" | "section" | "say" | "text">[], voice: VoiceSettings, max = BLOCK_MAX_CHARS): Block[] {
  const blocks: Block[] = [];
  let cur: Omit<Block, "id"> | undefined;
  const flush = () => {
    if (!cur) return;
    blocks.push({ ...cur, id: createHash("sha1").update(`${settingsKey(voice)}\n${cur.text}`).digest("hex").slice(0, 16) });
    cur = undefined;
  };
  for (const b of beats) {
    const t = said(b);
    if (cur && (cur.section !== b.section || cur.chars + 1 + t.length > max)) flush();
    if (!cur) cur = { section: b.section, beatIds: [], text: "", chars: 0 };
    cur.beatIds.push(b.id);
    cur.text = cur.text ? `${cur.text} ${t}` : t;
    cur.chars = cur.text.length;
  }
  flush();
  return blocks;
}

export function narrationChars(beats: Pick<Beat, "say" | "text">[]) {
  return beats.reduce((s, b) => s + said(b).length, 0);
}

/** ElevenLabs with the channel's voice settings (speed, stability, similarity, style). */
export function elevenLabsSpeaker(apiKey: string, voice: VoiceSettings, options: { fetch?: (u: string, i?: RequestInit) => Promise<Response> } = {}): Speaker {
  return async (text, { signal }) => {
    const res = await (options.fetch ?? fetch)(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice.voiceId)}?output_format=mp3_44100_128`, {
      method: "POST",
      signal,
      headers: { "xi-api-key": apiKey, "content-type": "application/json" },
      body: JSON.stringify({
        text,
        model_id: voice.modelId ?? "eleven_multilingual_v2",
        voice_settings: { stability: voice.stability, similarity_boost: voice.similarity, style: voice.style, speed: voice.speed, use_speaker_boost: true },
      }),
    });
    if (res.status === 401) throw Object.assign(new Error("ElevenLabs: chave recusada. Confira em Vozes."), { code: "VOICE_AUTH" });
    if (res.status === 429) throw Object.assign(new Error("ElevenLabs: limite ou créditos esgotados. Tente de novo em 20 s."), { code: "VOICE_RATE_LIMIT" });
    if (!res.ok) throw Object.assign(new Error(`ElevenLabs respondeu ${res.status}.`), { code: "VOICE_FAILED" });
    return { audio: new Uint8Array(await res.arrayBuffer()), extension: "mp3" };
  };
}

async function exists(file: string) {
  try {
    return (await stat(file)).size > 0;
  } catch {
    return false;
  }
}

/** Saves a TTS answer as WAV through a temporary file, so a half-written block is never reused. */
async function saveAsWav(res: SpeechResult, wav: string, signal?: AbortSignal) {
  const raw = `${wav}.src.${res.extension}`;
  const tmp = `${wav}.tmp.wav`;
  await writeFile(raw, res.audio);
  try {
    await toWav(raw, tmp, signal, { trim: true });
    await rename(tmp, wav);
  } finally {
    await rm(raw, { force: true });
    await rm(tmp, { force: true });
  }
}

/** Any audio → WAV mono 44.1 kHz 16-bit. */
export async function toWav(input: string, output: string, signal?: AbortSignal, options: { trim?: boolean } = {}) {
  // TTS engines (the Windows voice above all) pad each answer with silence; trimmed, only the
  // planned pauses remain between beats and sections (QA flags silences over 1.5 s).
  const trim = "silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.05,areverse,silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.08,areverse";
  await ffmpeg(["-y", "-i", input, ...(options.trim ? ["-af", trim] : []), "-ac", "1", "-ar", "44100", "-c:a", "pcm_s16le", output], { signal });
  return output;
}

async function silence(dir: string, seconds: number) {
  const file = join(dir, `silence_${Math.round(seconds * 1000)}ms.wav`);
  if (!(await exists(file))) await ffmpeg(["-y", "-f", "lavfi", "-i", `anullsrc=r=44100:cl=mono`, "-t", String(seconds), "-c:a", "pcm_s16le", file]);
  return file;
}

const q = (p: string) => `'${p.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`;

/** Concatenates pieces (whole files or [inpoint, outpoint] ranges) into one WAV with the concat demuxer. */
export async function concatPieces(pieces: { file: string; from?: number; to?: number }[], output: string, signal?: AbortSignal) {
  const list = `${output}.list.txt`;
  const lines = pieces.flatMap((p) => [`file ${q(p.file)}`, ...(p.from !== undefined ? [`inpoint ${p.from.toFixed(3)}`] : []), ...(p.to !== undefined ? [`outpoint ${p.to.toFixed(3)}`] : [])]);
  await writeFile(list, `${lines.join("\n")}\n`, "utf8");
  try {
    await ffmpeg(["-y", "-f", "concat", "-safe", "0", "-i", list, "-ac", "1", "-ar", "44100", "-c:a", "pcm_s16le", output], { signal });
  } finally {
    await rm(list, { force: true });
  }
  return output;
}

/**
 * Sample-exact join for ranges of files: `atrim` + `concat` filters. The concat demuxer's
 * inpoint/outpoint on WAV cut at packet boundaries (tens of ms), which moved every old beat.
 */
export async function concatExact(pieces: { file: string; from?: number; to?: number }[], output: string, signal?: AbortSignal) {
  const files = [...new Set(pieces.map((p) => p.file))];
  const uses = new Map(files.map((f) => [f, pieces.filter((p) => p.file === f).length]));
  const lines: string[] = [];
  const labels = new Map<string, string[]>();
  files.forEach((f, i) => {
    const n = uses.get(f)!;
    const outs = Array.from({ length: n }, (_, k) => `s${i}_${k}`);
    labels.set(f, outs);
    lines.push(`[${i}:a]aresample=44100,aformat=sample_fmts=s16:channel_layouts=mono${n > 1 ? `,asplit=${n}${outs.map((o) => `[${o}]`).join("")}` : `[${outs[0]}]`}`);
  });
  const parts = pieces.map((p, i) => {
    const src = labels.get(p.file)!.shift()!;
    const trim = p.from !== undefined || p.to !== undefined ? `atrim=${p.from !== undefined ? `start=${p.from.toFixed(6)}` : ""}${p.from !== undefined && p.to !== undefined ? ":" : ""}${p.to !== undefined ? `end=${p.to.toFixed(6)}` : ""},` : "";
    lines.push(`[${src}]${trim}asetpts=PTS-STARTPTS[p${i}]`);
    return `[p${i}]`;
  });
  lines.push(`${parts.join("")}concat=n=${parts.length}:v=0:a=1[out]`);
  const script = `${output}.filter.txt`;
  await writeFile(script, lines.join(";\n"), "utf8");
  try {
    await ffmpeg(["-y", ...files.flatMap((f) => ["-i", f]), "-filter_complex_script", script, "-map", "[out]", "-ac", "1", "-ar", "44100", "-c:a", "pcm_s16le", output], { signal });
  } finally {
    await rm(script, { force: true });
  }
  return output;
}

/** loudnorm to −16 LUFS integrated, −1.5 dBTP (two passes for an exact target). */
export async function normalizeLoudness(input: string, output: string, target = NARRATION_LUFS, signal?: AbortSignal, format: { channels: number; rate: number } = { channels: 1, rate: 44100 }) {
  const { spawn } = await import("node:child_process");
  const { ffmpegPath } = await import("../media");
  const measure = await new Promise<Record<string, string>>((resolve, reject) => {
    const child = spawn(ffmpegPath, ["-hide_banner", "-nostats", "-i", input, "-af", `loudnorm=I=${target}:TP=-1.5:LRA=11:print_format=json`, "-f", "null", "-"], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    child.stderr.on("data", (d: Buffer) => (err += d.toString()));
    signal?.addEventListener("abort", () => child.kill(), { once: true });
    child.once("error", reject);
    child.once("close", () => {
      const m = err.match(/\{[\s\S]*\}/);
      try {
        resolve(JSON.parse(m?.[0] ?? "{}"));
      } catch {
        reject(new Error("Não consegui medir a narração."));
      }
    });
  });
  const second = measure.input_i
    ? `loudnorm=I=${target}:TP=-1.5:LRA=11:measured_I=${measure.input_i}:measured_TP=${measure.input_tp}:measured_LRA=${measure.input_lra}:measured_thresh=${measure.input_thresh}:offset=${measure.target_offset}:linear=true`
    : `loudnorm=I=${target}:TP=-1.5:LRA=11`;
  await ffmpeg(["-y", "-i", input, "-af", second, "-ar", String(format.rate), "-ac", String(format.channels), "-c:a", "pcm_s16le", output], { signal });
  return output;
}

type Ids = { profileId: string; channelId: string; episodeId: string };
const audioDir = (store: ChannelStore, ids: Ids) => join(store.episodeDir(ids.profileId, ids.channelId, ids.episodeId), "audio");

export type NarrationProgress = (p: number, message: string) => void;

/**
 * Full narration: blocks → files (cached by hash) → joined (0.7 s between sections) →
 * normalized `audio/narracao.wav`. Returns the blocks and characters spent this run.
 */
export async function generateNarration(store: ChannelStore, ids: Ids, speak: Speaker, voice: VoiceSettings, options: { onProgress?: NarrationProgress; signal?: AbortSignal } = {}) {
  const script = await store.readEpisodeFile(ids.profileId, ids.channelId, ids.episodeId, "script");
  if (!script?.beats.length) throw Object.assign(new Error("O episódio ainda não tem roteiro."), { code: "NO_SCRIPT" });
  const dir = audioDir(store, ids);
  const blocksDir = join(dir, "blocks");
  await mkdir(blocksDir, { recursive: true });
  const blocks = planBlocks(script.beats, voice);
  let spent = 0;
  const failures: { block: string; error: string }[] = [];
  for (const [i, block] of blocks.entries()) {
    options.signal?.throwIfAborted();
    const wav = join(blocksDir, `${block.id}.wav`);
    options.onProgress?.(i / blocks.length * 0.8, `Narrando bloco ${i + 1} de ${blocks.length}`);
    if (await exists(wav)) continue;
    try {
      const res = await speak(block.text, { signal: options.signal });
      await saveAsWav(res, wav, options.signal);
      spent += block.chars;
    } catch (error) {
      failures.push({ block: block.id, error: (error as Error).message });
      if ((error as { code?: string }).code === "VOICE_AUTH") break;
    }
  }
  if (failures.length) {
    const err = Object.assign(new Error(`${failures.length} bloco(s) falharam; os outros ficaram salvos. ${failures[0].error}`), { code: "NARRATION_PARTIAL", failures, spent });
    throw err;
  }
  options.onProgress?.(0.85, "Juntando os blocos");
  const gap = await silence(dir, SECTION_GAP);
  const pieces: { file: string }[] = [];
  blocks.forEach((b, i) => {
    if (i > 0 && blocks[i - 1].section !== b.section) pieces.push({ file: gap });
    pieces.push({ file: join(blocksDir, `${b.id}.wav`) });
  });
  const joined = await concatPieces(pieces, join(dir, "narracao.raw.wav"), options.signal);
  options.onProgress?.(0.92, "Normalizando o volume");
  const out = await normalizeLoudness(joined, join(dir, "narracao.wav"), NARRATION_LUFS, options.signal);
  await rm(joined, { force: true });
  // Remove block files no longer used (old texts).
  const keep = new Set(blocks.map((b) => `${b.id}.wav`));
  for (const name of await readdir(blocksDir)) if (!keep.has(name) && !name.startsWith("silence_")) await rm(join(blocksDir, name), { force: true });
  return { file: out, blocks, spentChars: spent, durationSec: await durationOf(out) };
}

/**
 * Aligns `audio/narracao.wav` with the script: transcribes, matches, writes `words.json`
 * and each beat's timing into script.json. Fails below 95% with the worst span.
 */
export async function alignNarration(store: ChannelStore, ids: Ids, transcribe: Transcriber, options: { language?: string; signal?: AbortSignal } = {}) {
  const dir = audioDir(store, ids);
  const file = join(dir, "narracao.wav");
  const script = await store.readEpisodeFile(ids.profileId, ids.channelId, ids.episodeId, "script");
  if (!script) throw Object.assign(new Error("O episódio ainda não tem roteiro."), { code: "NO_SCRIPT" });
  const words = await transcribe(file, { language: options.language, signal: options.signal });
  const duration = await durationOf(file);
  const result = alignBeats(script.beats, words, duration);
  await writeJsonAtomic(join(dir, "words.json"), { duration, words, ratio: result.ratio });
  if (!result.ok) throw Object.assign(new Error(result.error ?? "Alinhamento falhou."), { code: "ALIGN_LOW_MATCH", result });
  const changed = await applyTimings(store, ids, result);
  return { ratio: result.ratio, duration, changedBeats: changed, warning: result.ratio < 0.97 ? `Casamento de ${Math.round(result.ratio * 1000) / 10}%, abaixo da meta de 97%. Pior trecho: ${result.worst?.beatId}.` : undefined };
}

/** Writes the timings; returns the beats whose scene time changed (only those scenes go stale). */
async function applyTimings(store: ChannelStore, ids: Ids, result: AlignResult) {
  const changed: string[] = [];
  await store.mutateEpisodeFile(ids.profileId, ids.channelId, ids.episodeId, "script", () => {
    throw new Error("sem roteiro");
  }, (s: Script) => {
    for (const b of s.beats) {
      const t = result.timings[b.id];
      if (!t) continue;
      const old = b.timing;
      const len = (x?: { start: number; cut: number }) => (x ? x.cut - x.start : -1);
      if (!old || b.isNew || Math.abs(len(old) - len(t)) > 1 / 30 + 1e-6 || Math.abs(old.start - t.start) > 1 / 30 + 1e-6) changed.push(b.id);
      b.timing = t;
      b.isNew = undefined;
    }
  });
  return changed;
}

/**
 * Partial re-record: narrates only `beatIds` (default: beats marked `isNew` or without timing),
 * rebuilds the audio (old beats cut from the original up to the next beat's start, new ones
 * in between with 0.05 s / 0.45 s / 0.15 s pauses), then re-aligns. Only scenes whose time
 * changed come back as `changedBeats`.
 */
export async function redoBeats(store: ChannelStore, ids: Ids, speak: Speaker, voice: VoiceSettings, transcribe: Transcriber, options: { beatIds?: string[]; language?: string; signal?: AbortSignal } = {}) {
  const script = await store.readEpisodeFile(ids.profileId, ids.channelId, ids.episodeId, "script");
  if (!script) throw Object.assign(new Error("O episódio ainda não tem roteiro."), { code: "NO_SCRIPT" });
  const dir = audioDir(store, ids);
  const original = join(dir, "narracao.wav");
  if (!(await exists(original))) throw Object.assign(new Error("Ainda não há narração completa; gere a narração primeiro."), { code: "NO_NARRATION" });
  const targets = new Set(options.beatIds?.length ? options.beatIds : script.beats.filter((b) => b.isNew || !b.timing).map((b) => b.id));
  if (!targets.size) return { redone: [], spentChars: 0, ratio: 1, changedBeats: [] as string[] };
  const beatsDir = join(dir, "beats");
  await mkdir(beatsDir, { recursive: true });
  let spent = 0;
  const files = new Map<string, string>();
  for (const b of script.beats.filter((x) => targets.has(x.id))) {
    const wav = join(beatsDir, `${b.id}-${b.hash}.wav`);
    if (!(await exists(wav))) {
      const res = await speak(said(b), { signal: options.signal });
      await saveAsWav(res, wav, options.signal);
      spent += said(b).length;
    }
    files.set(b.id, wav);
  }
  // Each piece knows where it lands in the rebuilt audio, so old beats keep their exact timing
  // (shifted by whole frames) and only the new beats are transcribed — a re-alignment of the
  // whole file moves every beat a few ms and would make every scene render again.
  type Piece = { file: string; from?: number; to?: number; seconds: number; beatId?: string; fresh?: boolean };
  const pieces: Piece[] = [];
  const gap = async (seconds: number) => ({ file: await silence(dir, Math.round(seconds * 1000) / 1000), seconds: Math.round(seconds * 1000) / 1000 });
  const originalSeconds = await durationOf(original);
  const FRAME = 1 / 30;
  const placed = () => pieces.reduce((sum, p) => sum + p.seconds, 0);
  for (const [i, b] of script.beats.entries()) {
    const prev = script.beats[i - 1];
    const fresh = files.get(b.id);
    if (fresh) {
      if (prev) pieces.push(await gap(prev.section !== b.section ? PARTIAL_GAPS.newSection : PARTIAL_GAPS.beforeNew));
      pieces.push({ file: fresh, seconds: await durationOf(fresh), beatId: b.id, fresh: true });
      const next = script.beats[i + 1];
      if (next && !files.has(next.id)) pieces.push(await gap(next.section !== b.section ? PARTIAL_GAPS.newSection : PARTIAL_GAPS.sameSection));
    } else if (b.timing) {
      // From its start in the original (the first beat from 0) to the next beat's start there.
      const from = i === 0 ? 0 : b.timing.start;
      // Old beats move by whole frames only: pad the pause before them up to the next frame.
      const shift = placed() - from;
      // Pauses are rounded to the millisecond, so "already on a frame" needs a tolerance.
      const frames = shift / FRAME;
      if (pieces.length && Math.abs(frames - Math.round(frames)) > 0.05) pieces.push(await gap((Math.ceil(frames) - frames) * FRAME));
      const to = Math.min(b.timing.cut + CUT_GAP, originalSeconds);
      pieces.push({ file: original, from, to, seconds: to - from, beatId: b.id });
    }
  }
  const rebuilt = await concatExact(pieces, join(dir, "narracao.rebuilt.wav"), options.signal);
  await rename(original, join(dir, `narracao.prev.wav`)).catch(() => undefined);
  await rename(rebuilt, original);
  const total = await durationOf(original);
  const planned = pieces.reduce((sum, p) => sum + p.seconds, 0);
  if (Math.abs(total - planned) > 0.05) {
    // The pieces did not land where planned: fall back to aligning the whole file.
    const aligned = await alignNarration(store, ids, transcribe, options);
    return { redone: [...targets], spentChars: spent, ratio: aligned.ratio, changedBeats: aligned.changedBeats };
  }
  // Timings: old beats shifted; new beats aligned on their own file.
  let at = 0;
  const timings = new Map<string, NonNullable<Beat["timing"]>>();
  let ratioSum = 0;
  let ratioN = 0;
  for (const p of pieces) {
    if (p.beatId) {
      const b = script.beats.find((x) => x.id === p.beatId)!;
      if (p.fresh) {
        const words = await transcribe(p.file, { language: options.language, signal: options.signal });
        const r = alignBeats([b], words, p.seconds);
        ratioSum += r.ratio;
        ratioN++;
        const t = r.timings[b.id];
        timings.set(b.id, { start: at + (t?.words[0]?.s ?? 0), end: at + (t?.end ?? p.seconds), cut: 0, words: (t?.words ?? []).map((w) => ({ t: w.t, s: w.s + at, e: w.e + at })) });
      } else {
        const old = b.timing!;
        const delta = at - (p.from ?? 0);
        timings.set(b.id, { start: old.start + delta, end: old.end + delta, cut: 0, words: old.words.map((w) => ({ t: w.t, s: w.s + delta, e: w.e + delta })) });
      }
    }
    at += p.seconds;
  }
  const order = script.beats.filter((b) => timings.has(b.id));
  order.forEach((b, i) => {
    const t = timings.get(b.id)!;
    const next = order[i + 1] ? timings.get(order[i + 1].id)! : undefined;
    t.cut = next ? Math.max(t.end, next.start - CUT_GAP) : total;
  });
  const round3 = (n: number) => Math.round(n * 1000) / 1000;
  const changed: string[] = [];
  await store.mutateEpisodeFile(ids.profileId, ids.channelId, ids.episodeId, "script", () => {
    throw new Error("sem roteiro");
  }, (s: Script) => {
    for (const b of s.beats) {
      const t = timings.get(b.id);
      if (!t) continue;
      const next = { start: round3(t.start), end: round3(t.end), cut: round3(t.cut), words: t.words.map((w) => ({ t: w.t, s: round3(w.s), e: round3(w.e) })) };
      const len = (x?: { start: number; cut: number }) => (x ? x.cut - x.start : -1);
      if (!b.timing || b.isNew || targets.has(b.id) || Math.abs(len(b.timing) - len(next)) > FRAME + 1e-6) changed.push(b.id);
      b.timing = next;
      b.isNew = undefined;
    }
  });
  const words = [...timings.values()].flatMap((t) => t.words.map((w) => ({ text: w.t, start: w.s, end: w.e })));
  await writeJsonAtomic(join(dir, "words.json"), { duration: total, words, ratio: ratioN ? ratioSum / ratioN : 1, partial: true });
  return { redone: [...targets], spentChars: spent, ratio: ratioN ? Math.round((ratioSum / ratioN) * 1000) / 1000 : 1, changedBeats: changed };
}

export type { TimedWord };

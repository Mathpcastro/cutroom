import { copyFile, mkdir, readdir, rename, rm, stat, statfs, writeFile } from "node:fs/promises";
import { availableParallelism, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { SfxKind } from "../../../src/shared/shots";
import { synthEffect } from "../compose-sfx";
import { wavBytes } from "../compose-music";
import { runFilmWorker, type FilmRunner } from "../film";
import type { ChannelStore } from "./channel-store";
import { durationOf, ffmpeg, measureLoudness } from "./ffmpeg";
import { readJsonOr, writeJsonAtomic } from "./fs-json";
import { normalizeLoudness } from "./narration";
import { FPS, sceneMetaSchema, type SceneMeta } from "./scene-compiler";

/**
 * Montagem e render (spec "Montagem e render"): each scene renders on its own, in parallel,
 * into `cache/<hash>.mp4` (an existing hash is skipped), then the clips are concatenated in
 * order and mixed with the narration, music per section (fade + ducking) and effects.
 * Two renders of the same episode never run at once (lock); closing the app mid-render loses
 * nothing (the cache keeps finished scenes and the job resumes).
 */

export const SCENE_TIMEOUT_MS = 120_000;
export const SCENE_RETRIES = 2;
export const MUSIC_GAIN = 0.07;
export const MUSIC_END_GAIN = 0.22;
export const LUFS = { long: -16, short: -14 } as const;

export type SceneRenderer = (sceneDir: string, output: string, options: { signal: AbortSignal; workers: number }) => Promise<void>;

/** Physical cores − 1, at least 2 and at most 6 (logical / 2 approximates physical cores). */
export function renderWorkers(logical = availableParallelism()) {
  return Math.min(6, Math.max(2, Math.floor(logical / 2) - 1));
}

/** HyperFrames renderer: the scene folder already carries the CSP (no network from scene HTML). */
export function hyperframesRenderer(runner: Omit<FilmRunner, "signal">): SceneRenderer {
  return async (dir, output, { signal, workers }) => {
    await runFilmWorker(dir, { mode: "film", output, workers, quality: "high" }, { ...runner, signal });
  };
}

// ---------- lock ----------

const locks = new Set<string>();
function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}
/** One render per episode (bug: an old and a new render writing the same file). */
export async function acquireRenderLock(episodeDir: string) {
  const file = join(episodeDir, "render.lock");
  if (locks.has(file)) throw Object.assign(new Error("Este episódio já está renderizando."), { code: "RENDER_LOCKED" });
  const current = (await readJsonOr(file, () => undefined)) as { pid?: number } | undefined;
  if (current?.pid && current.pid !== process.pid && alive(current.pid)) throw Object.assign(new Error("Este episódio já está renderizando em outra janela do app."), { code: "RENDER_LOCKED" });
  locks.add(file);
  await writeJsonAtomic(file, { pid: process.pid, at: new Date().toISOString() });
  return async () => {
    locks.delete(file);
    await rm(file, { force: true });
  };
}

// ---------- disk ----------

export async function checkDisk(dir: string, needBytes: number) {
  try {
    const s = await statfs(dir);
    const free = Number(s.bavail) * Number(s.bsize);
    if (free < needBytes) throw Object.assign(new Error(`Pouco espaço em disco: ${(free / 1e9).toFixed(1)} GB livres, o render precisa de cerca de ${(needBytes / 1e9).toFixed(1)} GB.`), { code: "DISK_FULL" });
    return free;
  } catch (error) {
    if ((error as { code?: string }).code === "DISK_FULL") throw error;
    return undefined;
  }
}

// ---------- scenes ----------

type Ids = { profileId: string; channelId: string; episodeId: string };
export type SceneStatus = "pendente" | "rodando" | "pronta" | "erro";

export async function readSceneMetas(episodeDir: string, beatIds: string[]) {
  const metas: SceneMeta[] = [];
  for (const id of beatIds) {
    const m = sceneMetaSchema.safeParse(await readJsonOr(join(episodeDir, "scenes", id, "scene.json"), () => undefined));
    if (!m.success) throw Object.assign(new Error(`A cena ${id} não foi compilada. Rode scenes_compile antes.`), { code: "SCENE_NOT_COMPILED" });
    metas.push(m.data);
  }
  return metas;
}

/** The worker's stderr starts with HyperFrames notices; the useful line is the last error-looking one. */
export function sceneError(error: unknown) {
  const lines = String((error as Error)?.message ?? error).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const useful = lines.filter((l) => !/^\[(INFO|hyperframes|initSession|BrowserManager|HyperFrames)/.test(l) && !l.startsWith("{"));
  return (useful.find((l) => /error|erro|failed|falh/i.test(l)) ?? useful.at(-1) ?? lines.at(-1) ?? "falha desconhecida").slice(0, 300);
}

async function exists(f: string) {
  return stat(f).then((s) => s.size > 0, () => false);
}

/**
 * Renders every scene missing from the cache with `workers` in parallel; each scene has a 120 s
 * timeout; a failed scene does not stop the others and is retried twice with 1 worker.
 */
export async function renderScenes(episodeDir: string, metas: SceneMeta[], render: SceneRenderer, options: { workers?: number; signal?: AbortSignal; onScene?: (beatId: string, status: SceneStatus, done: number, total: number) => void; timeoutMs?: number; tempDir?: string } = {}) {
  const cache = join(episodeDir, "cache");
  await mkdir(cache, { recursive: true });
  const todo: SceneMeta[] = [];
  let done = 0;
  for (const m of metas) {
    if (await exists(join(cache, `${m.hash}.mp4`))) {
      done++;
      options.onScene?.(m.beatId, "pronta", done, metas.length);
    } else todo.push(m);
  }
  const cached = done;
  const failed = new Map<string, string>();
  const one = async (m: SceneMeta, workers: number) => {
    const out = join(cache, `${m.hash}.mp4`);
    // Rendered in a short temp path: HyperFrames writes a transaction folder next to the output and
    // ffprobe fails past Windows' 260-character limit inside deep profile folders.
    const partial = join(options.tempDir ?? join(tmpdir(), "videosell-render"), `${m.hash}.mp4`);
    await mkdir(dirname(partial), { recursive: true });
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    options.signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? SCENE_TIMEOUT_MS);
    options.onScene?.(m.beatId, "rodando", done, metas.length);
    try {
      await render(join(episodeDir, "scenes", m.beatId), partial, { signal: controller.signal, workers });
      if (!(await exists(partial))) throw new Error("O renderizador não gerou o clipe.");
      await rename(partial, out).catch(async () => {
        await copyFile(partial, out);
        await rm(partial, { force: true });
      });
      failed.delete(m.beatId);
      done++;
      options.onScene?.(m.beatId, "pronta", done, metas.length);
    } catch (error) {
      await rm(partial, { force: true });
      if (options.signal?.aborted) throw error;
      failed.set(m.beatId, controller.signal.aborted ? "tempo esgotado (120 s)" : sceneError(error));
      options.onScene?.(m.beatId, "erro", done, metas.length);
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
    }
  };
  const workers = Math.max(1, options.workers ?? renderWorkers());
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(workers, todo.length) }, async () => {
      while (next < todo.length) {
        options.signal?.throwIfAborted();
        await one(todo[next++], 1);
      }
    }),
  );
  for (let attempt = 0; attempt < SCENE_RETRIES && failed.size; attempt++)
    for (const m of todo.filter((x) => failed.has(x.beatId))) {
      options.signal?.throwIfAborted();
      await one(m, 1);
    }
  return { rendered: todo.length - failed.size, cached, failed: [...failed].map(([beatId, error]) => ({ beatId, error })) };
}

// ---------- concat & mix ----------

const q = (p: string) => `'${p.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`;

/** Joins the scene clips in order (concat demuxer, no re-encode). */
export async function concatClips(files: string[], output: string, signal?: AbortSignal) {
  const list = `${output}.list.txt`;
  await writeFile(list, files.map((f) => `file ${q(f)}`).join("\n") + "\n", "utf8");
  try {
    await ffmpeg(["-y", "-f", "concat", "-safe", "0", "-i", list, "-an", "-c", "copy", output], { signal });
  } finally {
    await rm(list, { force: true });
  }
  return output;
}

export type MusicSpan = { file: string; from: number; to: number };
/** Effects track: synthesized effects at frame positions, mono float, clipped softly. */
export async function writeSfxTrack(cues: { t: number; kind: SfxKind; gain: number }[], duration: number, file: string) {
  const RATE = 44100;
  const n = Math.ceil((duration + 0.5) * RATE);
  const mix = new Float32Array(n);
  cues.forEach((cue, i) => {
    const fx = synthEffect(cue.kind, i + 1);
    const at = Math.round(cue.t * RATE) + (cue.kind === "riser" ? -fx.length : 0);
    for (let k = 0; k < fx.length; k++) {
      const j = at + k;
      if (j >= 0 && j < n) mix[j] += fx[k] * cue.gain;
    }
  });
  for (let i = 0; i < n; i++) mix[i] = Math.tanh(mix[i]);
  await writeFile(file, wavBytes(mix, RATE, 1));
  return file;
}

/**
 * Mix: narration + music per section (1 s fades, ducked under the voice, up to 0.22 on the end
 * screen) + effects; `asetpts=N/SR/TB` after `amix` (FFmpeg 8 corrupts AAC timestamps otherwise);
 * final loudness −16 LUFS (long) or −14 (short).
 */
export async function mixAudio(o: { narration: string; music: MusicSpan[]; sfx?: string; duration: number; endscreenAt?: number; output: string; lufs: number; signal?: AbortSignal }) {
  const inputs = ["-i", o.narration];
  const graph: string[] = ["[0:a]aresample=48000,aformat=channel_layouts=stereo,apad,atrim=0:" + o.duration.toFixed(3) + ",asplit=2[voice][key]"];
  const beds: string[] = [];
  // Loops happen inside the graph (aloop over the decoded file): an endless -stream_loop input
  // hangs FFmpeg on macOS, and the file is read only once this way.
  for (const [i, m] of o.music.entries()) {
    inputs.push("-i", m.file);
    const len = Math.max(0.1, m.to - m.from);
    const fade = Math.min(1, len / 3);
    const samples = Math.max(1, Math.round((await durationOf(m.file, { signal: o.signal })) * 48000));
    graph.push(`[${i + 1}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,aloop=loop=-1:size=${samples},atrim=0:${len.toFixed(3)},asetpts=PTS-STARTPTS,afade=t=in:d=${fade.toFixed(2)},afade=t=out:st=${(len - fade).toFixed(3)}:d=${fade.toFixed(2)},adelay=${Math.round(m.from * 1000)}:all=1[m${i}]`);
    beds.push(`[m${i}]`);
  }
  const mixInputs = ["[voice]"];
  if (beds.length) {
    const end = o.endscreenAt ?? o.duration + 1;
    graph.push(`${beds.join("")}amix=inputs=${beds.length}:normalize=0:duration=longest,asetpts=N/SR/TB,volume='if(gte(t,${end.toFixed(3)}),${MUSIC_END_GAIN},${MUSIC_GAIN})':eval=frame[bed]`);
    graph.push(`[bed][key]sidechaincompress=threshold=0.02:ratio=6:attack=20:release=400:makeup=1[ducked]`);
    mixInputs.push("[ducked]");
  }
  if (o.sfx) {
    inputs.push("-i", o.sfx);
    graph.push(`[${o.music.length + 1}:a]aresample=48000,aformat=channel_layouts=stereo[fx]`);
    mixInputs.push("[fx]");
  }
  if (!beds.length) graph.push("[key]anullsink");
  graph.push(`${mixInputs.join("")}amix=inputs=${mixInputs.length}:normalize=0:duration=first,asetpts=N/SR/TB,atrim=0:${o.duration.toFixed(3)}[out]`);
  const raw = `${o.output}.raw.wav`;
  try {
    await ffmpeg(["-y", ...inputs, "-filter_complex", graph.join(";"), "-map", "[out]", "-c:a", "pcm_s16le", "-ar", "48000", raw], { signal: o.signal });
    // Two-pass loudnorm: the target is measured before liberating (spec: ±1 LUFS).
    await normalizeLoudness(raw, o.output, o.lufs, o.signal, { channels: 2, rate: 48000 });
  } finally {
    await rm(raw, { force: true });
  }
  return o.output;
}

/** Final file: the concatenated video (stream copy or x264 CRF 18) + AAC 192k, +faststart. */
export async function muxFinal(video: string, audio: string, output: string, options: { encode?: "copy" | "x264"; signal?: AbortSignal } = {}) {
  const v = options.encode === "x264" ? ["-c:v", "libx264", "-profile:v", "high", "-crf", "18", "-preset", "medium", "-pix_fmt", "yuv420p"] : ["-c:v", "copy"];
  const partial = `${output}.partial.mp4`;
  await ffmpeg(["-y", "-i", video, "-i", audio, "-map", "0:v:0", "-map", "1:a:0", ...v, "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-shortest", "-movflags", "+faststart", partial], { signal: options.signal });
  await rename(partial, output);
  return output;
}

/** Light preview for the phone: 854×480 (or 480×854), ~300 kbps video. */
export async function makePreview(input: string, output: string, vertical: boolean, signal?: AbortSignal) {
  await ffmpeg(["-y", "-i", input, "-vf", vertical ? "scale=480:854" : "scale=854:480", "-c:v", "libx264", "-preset", "veryfast", "-b:v", "300k", "-maxrate", "350k", "-bufsize", "700k", "-c:a", "aac", "-b:a", "64k", "-ac", "1", "-movflags", "+faststart", output], { signal });
  return output;
}

// ---------- episode ----------

export type RenderOptions = {
  render: SceneRenderer;
  workers?: number;
  encode?: "copy" | "x264";
  preview?: boolean;
  signal?: AbortSignal;
  onProgress?: (p: number, message: string) => void;
  timeoutMs?: number;
};

/**
 * `episode_render`: scenes (cache) → concat → mix → final + preview. Idempotent: calling it
 * again reuses the cache and the lock prevents a second render of the same episode.
 */
export async function renderEpisode(store: ChannelStore, ids: Ids, options: RenderOptions) {
  const epDir = store.episodeDir(ids.profileId, ids.channelId, ids.episodeId);
  const release = await acquireRenderLock(epDir);
  const t0 = Date.now();
  try {
    await store.setStage(ids.profileId, ids.channelId, ids.episodeId, "render", { status: "rodando" });
    const [episode, script, licenses] = await Promise.all([
      store.getEpisode(ids.profileId, ids.channelId, ids.episodeId),
      store.readEpisodeFile(ids.profileId, ids.channelId, ids.episodeId, "script"),
      store.readEpisodeFile(ids.profileId, ids.channelId, ids.episodeId, "licenses"),
    ]);
    if (!script?.beats.length) throw Object.assign(new Error("O episódio ainda não tem roteiro."), { code: "NO_SCRIPT" });
    const narration = join(epDir, "audio", "narracao.wav");
    if (!(await exists(narration))) throw Object.assign(new Error("Falta a narração (audio/narracao.wav)."), { code: "NO_NARRATION" });
    const metas = await readSceneMetas(epDir, script.beats.map((b) => b.id));
    const totalFrames = metas.reduce((s, m) => s + m.frames, 0);
    const duration = totalFrames / FPS;
    await checkDisk(epDir, Math.round((duration / 60) * 55e6 * 3));

    const progressFile = join(epDir, "out", "render-progress.json");
    await mkdir(join(epDir, "out"), { recursive: true });
    const grid: Record<string, SceneStatus> = Object.fromEntries(metas.map((m) => [m.beatId, "pendente" as SceneStatus]));
    let lastWrite = 0;
    const scenes = await renderScenes(epDir, metas, options.render, {
      workers: options.workers,
      signal: options.signal,
      timeoutMs: options.timeoutMs,
      onScene: (beatId, status, done, total) => {
        grid[beatId] = status;
        options.onProgress?.((done / total) * 0.8, `Cenas: ${done} de ${total}`);
        if (Date.now() - lastWrite > 1000 || done === total) {
          lastWrite = Date.now();
          void writeJsonAtomic(progressFile, { updatedAt: new Date().toISOString(), scenes: grid, done, total, elapsedSec: Math.round((Date.now() - t0) / 1000) });
        }
      },
    });
    await writeJsonAtomic(progressFile, { updatedAt: new Date().toISOString(), scenes: grid, done: metas.length - scenes.failed.length, total: metas.length, elapsedSec: Math.round((Date.now() - t0) / 1000) });
    if (scenes.failed.length) throw Object.assign(new Error(`${scenes.failed.length} cena(s) falharam depois de 2 novas tentativas: ${scenes.failed.map((f) => `${f.beatId} (${f.error})`).join("; ")}`), { code: "RENDER_SCENES_FAILED", failed: scenes.failed });

    options.onProgress?.(0.82, "Juntando as cenas");
    const raw = await concatClips(metas.map((m) => join(epDir, "cache", `${m.hash}.mp4`)), join(epDir, "out", "video.silent.mp4"), options.signal);
    const got = await durationOf(raw);
    if (Math.abs(got - duration) > 1 / FPS + 0.02) throw Object.assign(new Error(`A soma das cenas (${got.toFixed(2)} s) não bate com a narração (${duration.toFixed(2)} s).`), { code: "RENDER_DURATION_MISMATCH" });

    options.onProgress?.(0.86, "Mixando narração, trilha e efeitos");
    const sections = sectionSpans(script.beats, metas);
    const musicFiles = await musicTracks(epDir, licenses?.items ?? []);
    const music = assignMusic(sections, musicFiles, duration);
    const last = script.beats.at(-1);
    const endscreenAt = last?.cta === "endscreen" ? metas.at(-1)!.startFrame / FPS : undefined;
    const sfxCues = metas.flatMap((m) => m.sfx.map((c) => ({ t: m.startFrame / FPS + c.t, kind: c.kind as SfxKind, gain: c.gain })));
    const sfx = sfxCues.length ? await writeSfxTrack(sfxCues, duration, join(epDir, "audio", "sfx.wav")) : undefined;
    const lufs = episode.format === "short" ? LUFS.short : LUFS.long;
    const mix = await mixAudio({ narration, music, sfx, duration, endscreenAt, output: join(epDir, "audio", "mix.wav"), lufs, signal: options.signal });
    const loud = await measureLoudness(mix, { signal: options.signal });

    options.onProgress?.(0.92, "Codificando o vídeo final");
    const video = await muxFinal(raw, mix, join(epDir, "out", "video.mp4"), { encode: options.encode, signal: options.signal });
    await rm(raw, { force: true });
    let preview: string | undefined;
    if (options.preview !== false) {
      options.onProgress?.(0.96, "Gerando a prévia leve");
      preview = await makePreview(video, join(epDir, "out", "preview.mp4"), episode.aspect === "9:16", options.signal);
    }
    const elapsedSec = Math.round((Date.now() - t0) / 1000);
    await store.mutateEpisode(ids.profileId, ids.channelId, ids.episodeId, (ep) => {
      ep.outputs.video = "out/video.mp4";
      if (preview) ep.outputs.preview = "out/preview.mp4";
      ep.durationSec = Math.round(duration * 100) / 100;
    });
    await store.setStage(ids.profileId, ids.channelId, ids.episodeId, "render", { status: "ok", inputHash: metas.map((m) => m.hash).join("").slice(0, 60) });
    return { video, preview, durationSec: duration, lufs: loud.lufs, truePeak: loud.truePeak, scenes: { total: metas.length, rendered: scenes.rendered, cached: scenes.cached }, elapsedSec, music: music.map((m) => ({ from: m.from, to: m.to })) };
  } catch (error) {
    await store.setStage(ids.profileId, ids.channelId, ids.episodeId, "render", { status: "erro", error: (error as Error).message }).catch(() => undefined);
    throw error;
  } finally {
    await release();
  }
}

/** Time span of each section in the final video (from the scene plan). */
export function sectionSpans(beats: { id: string; section: string }[], metas: SceneMeta[]) {
  const spans: { section: string; from: number; to: number }[] = [];
  beats.forEach((b, i) => {
    const m = metas[i];
    const from = m.startFrame / FPS;
    const to = (m.startFrame + m.frames) / FPS;
    const lastSpan = spans.at(-1);
    if (lastSpan && lastSpan.section === b.section) lastSpan.to = to;
    else spans.push({ section: b.section, from, to });
  });
  return spans;
}

async function musicTracks(epDir: string, items: { kind: string; file: string }[]) {
  const out: string[] = [];
  for (const m of items.filter((i) => i.kind === "music")) {
    const abs = join(epDir, m.file);
    const loop = abs.replace(/\.mp3$/i, ".loop.mp3");
    out.push((await exists(loop)) ? loop : abs);
  }
  return out;
}

/** Music per section: the tracks split the sections into contiguous groups (up to 3 tracks). */
export function assignMusic(sections: { from: number; to: number }[], files: string[], duration: number): MusicSpan[] {
  if (!files.length || !sections.length) return [];
  const n = Math.min(files.length, 3, sections.length);
  const per = Math.ceil(sections.length / n);
  const spans: MusicSpan[] = [];
  for (let g = 0; g < n; g++) {
    const group = sections.slice(g * per, (g + 1) * per);
    if (!group.length) continue;
    spans.push({ file: files[g], from: group[0].from, to: g === n - 1 ? duration : group.at(-1)!.to });
  }
  return spans;
}

/** Status grid for the UI (squares per scene). */
export async function renderProgress(store: ChannelStore, ids: Ids) {
  return readJsonOr(join(store.episodeDir(ids.profileId, ids.channelId, ids.episodeId), "out", "render-progress.json"), () => undefined);
}

/** Removes cache clips that no current scene uses. */
export async function pruneCache(episodeDir: string, keep: Set<string>) {
  const dir = join(episodeDir, "cache");
  let removed = 0;
  for (const f of await readdir(dir).catch(() => [] as string[]))
    if (!keep.has(f.replace(/\.mp4$/, ""))) {
      await rm(join(dir, f), { force: true });
      removed++;
    }
  return removed;
}


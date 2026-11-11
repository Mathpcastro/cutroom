import { createHash } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Word } from "../../src/shared/types";
import { ffmpegPath, ffprobePath } from "./media";
import { runProcess } from "./process";

/**
 * A reference video turned into a "mold": where it cuts, how fast it moves, its colours, what is said
 * and when. Videosell recreates the structure (rhythm, beats, palette, hook) with the user's own avatar,
 * voice and product — never the reference's footage, which stays on the user's computer.
 */
export interface ReferenceShot {
  start: number;
  end: number;
  /** Picture change inside the shot, 0 (still) to 1 (constant motion). */
  motion: number;
  /** Dominant colours, darkest first. */
  palette: string[];
  /** Words spoken during the shot. */
  text: string;
  /** Keyframe (JPEG) in the analysis folder. */
  frame: string;
}
export interface ReferenceBlueprint {
  id: string;
  source: string;
  duration: number;
  width: number;
  height: number;
  hasAudio: boolean;
  shots: ReferenceShot[];
  sentences: { text: string; start: number; end: number }[];
  words: { text: string; start: number; end: number }[];
  palette: string[];
  pace: {
    cuts: number;
    secondsPerShot: number;
    wordsPerSecond: number;
    /** Average picture change, 0–1. */
    energy: number;
    hook: string;
  };
  dir: string;
  /** What could not be read (e.g. speech without the local transcription package). */
  notes: string[];
}

const SAMPLE_FPS = 6;
const W = 36;
const H = 64;

export interface ReferenceDeps {
  /** Where analyses are cached (one folder per video). */
  root: string;
  transcribe(file: string, duration: number, signal: AbortSignal, progress: (v: number) => void): Promise<Word[]>;
}

async function probe(file: string, signal?: AbortSignal) {
  const out = await runProcess(ffprobePath, ["-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height", "-of", "json", file], { signal });
  const info = JSON.parse(out) as { format?: { duration?: string }; streams?: { codec_type: string; width?: number; height?: number }[] };
  const video = info.streams?.find((s) => s.codec_type === "video");
  const duration = Number(info.format?.duration);
  if (!video || !Number.isFinite(duration) || duration <= 0) throw new Error("O arquivo não parece ser um vídeo válido.");
  if (duration > 180) throw new Error("Use uma referência de até 3 minutos (Reels, TikTok ou Shorts).");
  return { duration, width: video.width ?? 0, height: video.height ?? 0, hasAudio: Boolean(info.streams?.some((s) => s.codec_type === "audio")) };
}

/** Frame-to-frame difference (0–1) of tiny grey frames. */
export function frameDiffs(gray: Uint8Array, size = W * H) {
  const frames = Math.floor(gray.length / size);
  const diffs: number[] = [0];
  for (let f = 1; f < frames; f++) {
    let sum = 0;
    for (let i = 0; i < size; i++) sum += Math.abs(gray[f * size + i] - gray[(f - 1) * size + i]);
    diffs.push(sum / size / 255);
  }
  return diffs;
}

/** Hard cuts: a difference spike well above the local level, at least `minGap` seconds apart. */
export function detectCuts(diffs: number[], fps: number, minGap = 0.4) {
  const cuts: number[] = [];
  let last = -Infinity;
  for (let i = 1; i < diffs.length; i++) {
    const window = diffs.slice(Math.max(1, i - 6), i);
    const local = window.length ? window.reduce((a, b) => a + b, 0) / window.length : 0;
    const t = i / fps;
    if (diffs[i] > 0.12 && diffs[i] > local * 2.6 + 0.03 && t - last >= minGap) {
      cuts.push(+t.toFixed(2));
      last = t;
    }
  }
  return cuts;
}

/** Dominant colours of an RGB buffer (coarse buckets, most frequent first, then sorted dark → light). */
export function dominantColors(rgb: Uint8Array, count = 3) {
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (let i = 0; i + 2 < rgb.length; i += 3) {
    const key = ((rgb[i] >> 5) << 6) | ((rgb[i + 1] >> 5) << 3) | (rgb[i + 2] >> 5);
    const b = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    b.n++; b.r += rgb[i]; b.g += rgb[i + 1]; b.b += rgb[i + 2];
    buckets.set(key, b);
  }
  const hex = (v: number) => Math.round(v).toString(16).padStart(2, "0");
  return [...buckets.values()]
    .sort((a, b) => b.n - a.n)
    .slice(0, count)
    .map((b) => ({ r: b.r / b.n, g: b.g / b.n, b: b.b / b.n }))
    .sort((a, b) => a.r + a.g + a.b - (b.r + b.g + b.b))
    .map((c) => `#${hex(c.r)}${hex(c.g)}${hex(c.b)}`);
}

/** Sentences from timed words (split on . ! ? or a pause longer than 0.7 s). */
export function sentencesFrom(words: { text: string; start: number; end: number }[]) {
  const out: { text: string; start: number; end: number }[] = [];
  let cur: typeof words = [];
  words.forEach((w, i) => {
    cur.push(w);
    const next = words[i + 1];
    if (/[.!?]$/.test(w.text) || !next || next.start - w.end > 0.7) {
      out.push({ text: cur.map((x) => x.text).join(" "), start: cur[0].start, end: cur[cur.length - 1].end });
      cur = [];
    }
  });
  return out;
}

export async function analyzeReference(file: string, deps: ReferenceDeps, signal: AbortSignal, progress: (v: number, label?: string) => void): Promise<ReferenceBlueprint> {
  const info = await stat(file);
  const id = createHash("sha256").update(JSON.stringify([file, info.size, info.mtimeMs])).digest("hex").slice(0, 20);
  const dir = join(deps.root, id);
  const cached = await readFile(join(dir, "blueprint.json"), "utf8").then((s) => JSON.parse(s) as ReferenceBlueprint, () => undefined);
  if (cached) return cached;
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const meta = await probe(file, signal);

  progress(0.05, "Medindo cortes e movimento…");
  const grayFile = join(dir, "motion.gray");
  await runProcess(ffmpegPath, ["-v", "error", "-y", "-i", file, "-an", "-vf", `fps=${SAMPLE_FPS},scale=${W}:${H}:flags=area,format=gray`, "-f", "rawvideo", grayFile], { signal });
  const diffs = frameDiffs(new Uint8Array(await readFile(grayFile)));
  await rm(grayFile, { force: true });
  const cuts = detectCuts(diffs, SAMPLE_FPS);
  const bounds = [0, ...cuts, meta.duration];
  // Very short shots (fades, flashes) join the next one.
  const rawShots: { start: number; end: number }[] = [];
  bounds.slice(0, -1).forEach((start, i) => {
    const shot = { start: +start.toFixed(2), end: +bounds[i + 1].toFixed(2) };
    const prev = rawShots[rawShots.length - 1];
    if (prev && prev.end - prev.start < 0.35) prev.end = shot.end;
    else rawShots.push(shot);
  });
  const lastShot = rawShots[rawShots.length - 1];
  if (rawShots.length > 1 && lastShot.end - lastShot.start < 0.35) { rawShots.pop(); rawShots[rawShots.length - 1].end = lastShot.end; }

  progress(0.25, "Lendo as cores de cada cena…");
  const shots: ReferenceShot[] = [];
  const allColors: Uint8Array[] = [];
  for (const [i, s] of rawShots.entries()) {
    const mid = s.start + (s.end - s.start) / 2;
    const frame = join(dir, `cena-${String(i + 1).padStart(2, "0")}.jpg`);
    await runProcess(ffmpegPath, ["-v", "error", "-y", "-ss", mid.toFixed(2), "-i", file, "-frames:v", "1", "-vf", "scale=360:-2", "-q:v", "4", frame], { signal });
    const rgbFile = join(dir, "c.rgb");
    await runProcess(ffmpegPath, ["-v", "error", "-y", "-ss", mid.toFixed(2), "-i", file, "-frames:v", "1", "-vf", "scale=24:42:flags=area", "-pix_fmt", "rgb24", "-f", "rawvideo", rgbFile], { signal });
    const rgb = new Uint8Array(await readFile(rgbFile));
    allColors.push(rgb);
    const inside = diffs.slice(Math.floor(s.start * SAMPLE_FPS) + 1, Math.max(Math.floor(s.start * SAMPLE_FPS) + 2, Math.floor(s.end * SAMPLE_FPS)));
    const motion = inside.length ? Math.min(1, (inside.reduce((a, b) => a + b, 0) / inside.length) * 8) : 0;
    shots.push({ ...s, motion: +motion.toFixed(2), palette: dominantColors(rgb, 3), text: "", frame });
    progress(0.25 + 0.3 * ((i + 1) / rawShots.length));
  }
  await rm(join(dir, "c.rgb"), { force: true });

  let words: { text: string; start: number; end: number }[] = [];
  const notes: string[] = [];
  if (meta.hasAudio) {
    progress(0.55, "Ouvindo a fala…");
    try {
      const recognized = await deps.transcribe(file, meta.duration, signal, (v) => progress(0.55 + 0.4 * v));
      words = recognized.map((w) => ({ text: w.text.trim(), start: +w.start.toFixed(2), end: +w.end.toFixed(2) })).filter((w) => w.text);
    } catch (error) {
      if (signal.aborted) throw error;
      // Without the local transcription the mold keeps rhythm, cuts and colours; the speech stays empty.
      notes.push(`A fala não foi lida: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  for (const s of shots) s.text = words.filter((w) => w.start >= s.start - 0.05 && w.start < s.end).map((w) => w.text).join(" ");
  const sentences = sentencesFrom(words);
  const all = new Uint8Array(allColors.reduce((n, c) => n + c.length, 0));
  allColors.reduce((o, c) => (all.set(c, o), o + c.length), 0);
  const energy = diffs.length ? Math.min(1, (diffs.reduce((a, b) => a + b, 0) / diffs.length) * 8) : 0;
  const blueprint: ReferenceBlueprint = {
    id,
    source: file,
    ...meta,
    shots,
    sentences,
    words,
    palette: dominantColors(all, 4),
    pace: {
      cuts: cuts.length,
      secondsPerShot: +(meta.duration / Math.max(1, shots.length)).toFixed(2),
      wordsPerSecond: words.length ? +(words.length / Math.max(1, words[words.length - 1].end - words[0].start)).toFixed(2) : 0,
      energy: +energy.toFixed(2),
      hook: words.filter((w) => w.start < 3).map((w) => w.text).join(" "),
    },
    dir,
    notes,
  };
  // A mold without speech because transcription was missing is not cached: install it and analyse again.
  if (!notes.length) await writeFile(join(dir, "blueprint.json"), JSON.stringify(blueprint, null, 2), "utf8");
  progress(1);
  return blueprint;
}

/**
 * Downloads a reference from a link: a post on X (its video, through the public embed data) or a
 * direct .mp4 link. Instagram and TikTok links need the file: they do not offer the video publicly.
 */
export async function fetchReference(url: string, root: string, signal: AbortSignal) {
  const u = new URL(url);
  let video = url;
  const x = /(?:^|\.)(?:x|twitter)\.com$/.test(u.hostname) ? /\/status\/(\d+)/.exec(u.pathname) : null;
  if (x) {
    const res = await fetch(`https://cdn.syndication.twimg.com/tweet-result?id=${x[1]}&lang=pt&token=4`, { signal });
    if (!res.ok) throw new Error("Não consegui ler esse post do X. Baixe o vídeo e escolha o arquivo.");
    const data = (await res.json()) as { mediaDetails?: { video_info?: { variants?: { content_type: string; bitrate?: number; url: string }[] } }[] };
    const variants = (data.mediaDetails ?? []).flatMap((m) => m.video_info?.variants ?? []).filter((v) => v.content_type === "video/mp4");
    const pick = variants.filter((v) => (v.bitrate ?? 0) <= 2_500_000).sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0))[0] ?? variants[0];
    if (!pick) throw new Error("Esse post do X não tem vídeo.");
    video = pick.url;
  } else if (/instagram\.com|tiktok\.com|youtube\.com|youtu\.be/.test(u.hostname)) {
    throw new Error("Instagram, TikTok e YouTube não liberam o vídeo por link. Baixe o vídeo e escolha o arquivo no computador.");
  } else if (!/\.mp4$/i.test(u.pathname)) {
    throw new Error("Use um post do X, um link direto de .mp4 ou escolha o arquivo no computador.");
  }
  const res = await fetch(video, { signal });
  if (!res.ok) throw new Error(`O download da referência falhou (${res.status}).`);
  const size = Number(res.headers.get("content-length") ?? 0);
  if (size > 300 * 1024 * 1024) throw new Error("A referência passa de 300 MB. Use um vídeo menor.");
  const buf = Buffer.from(await res.arrayBuffer());
  const dir = join(root, "downloads");
  await mkdir(dir, { recursive: true });
  const file = join(dir, `${createHash("sha256").update(url).digest("hex").slice(0, 16)}.mp4`);
  await writeFile(file, buf);
  return file;
}

function luminance(hex: string) {
  const n = parseInt(hex.replace("#", ""), 16);
  return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
}

/**
 * The Videosell format closest to the reference, from what can be measured without a vision model:
 * light frames → interface demo; long calm shots on dark colours → illustrated explainer; speech with
 * frequent cuts → avatar presenter. Agents with vision should confirm it on the keyframes.
 */
export function suggestFormat(b: Pick<ReferenceBlueprint, "palette" | "pace" | "words">) {
  const light = b.palette.length ? b.palette.reduce((sum, c) => sum + luminance(c), 0) / b.palette.length : 0;
  if (light > 0.62) return { id: "ui-motion", reason: "quadros claros, como uma interface" };
  if (b.pace.secondsPerShot >= 5 && b.pace.energy < 0.25) return { id: "kurzgesagt", reason: "planos longos e calmos, como uma explicação ilustrada" };
  if (b.pace.energy > 0.45 && !b.words.length) return { id: "pixel", reason: "muito movimento e sem fala" };
  return { id: "avatar", reason: "fala com cortes frequentes, como um apresentador" };
}

/** What the agent / planner needs, without file paths. */
export function blueprintSummary(b: ReferenceBlueprint) {
  return {
    duracao: +b.duration.toFixed(1),
    cortes: b.pace.cuts,
    segundosPorCena: b.pace.secondsPerShot,
    palavrasPorSegundo: b.pace.wordsPerSecond,
    energia: b.pace.energy,
    gancho: b.pace.hook,
    paleta: b.palette,
    cenas: b.shots.map((s, i) => ({ cena: i + 1, inicio: s.start, fim: s.end, movimento: s.motion, cores: s.palette, fala: s.text })),
    frases: b.sentences.map((s) => ({ texto: s.text, inicio: s.start, fim: s.end })),
    avisos: b.notes ?? [],
    formatoSugerido: suggestFormat(b),
  };
}

/** Style handed to CRM.autoReel so the new film keeps the reference's rhythm and colours. */
export function referenceStyle(b: ReferenceBlueprint) {
  return {
    palette: b.palette,
    secondsPerShot: b.pace.secondsPerShot,
    energy: b.pace.energy,
    shots: b.shots.map((s) => ({ start: +(s.start / b.duration).toFixed(4), motion: s.motion, palette: s.palette })),
  };
}

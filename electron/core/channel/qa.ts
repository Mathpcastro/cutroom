import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { TEXT_SCENES, type Beat, type Channel, type Licenses, type Research, type Script } from "../../../src/shared/channel";
import { runFilmWorker, type FilmRunner } from "../film";
import { wordCheck, type Transcriber } from "./aligner";
import type { ChannelStore } from "./channel-store";
import { durationOf, ffmpeg, measureLoudness } from "./ffmpeg";
import { writeJsonAtomic } from "./fs-json";
import { usableFact } from "./research";
import { readSceneMetas } from "./episode-render";
import { FPS, sizeOf, type SceneMeta } from "./scene-compiler";

/**
 * Revisão e QA automática (spec "Revisão e QA automática"): before the final render the app
 * takes 2 frames per scene (20% and 85%), runs automatic checks and shows only what needs a
 * human eye. Corrections are validated on this frame bench, never by re-rendering the video.
 */

export type QaLevel = "erro" | "aviso";
export type QaIssue = { level: QaLevel; code: string; beatId?: string; t?: number; message: string; fix: string };
export type TextBox = { text: string; x: number; y: number; w: number; h: number; id: string; cls: string; clipped: boolean };
export type BenchFrame = { t: number; file?: string; boxes: TextBox[]; layers: number };
export type BenchScene = { directory: string; duration: number; frames: BenchFrame[]; errors: string[] };
export type BenchRunner = (scenes: { directory: string; times: number[]; output?: string }[], options: { width: number; height: number; scale: number; signal?: AbortSignal }) => Promise<BenchScene[]>;

export const BENCH_POINTS = [0.2, 0.85];
export const SHEET_SCENES = 20;
export const THUMB_SCALE = 0.4;
/** UI text the components may show (not episode data): button states and the source prefix. */
const UI_TEXT = new Set(["INSCREVER-SE", "INSCRITO", "Fonte:"]);

export function hyperframesBench(runner: Omit<FilmRunner, "signal">, workDir: string): BenchRunner {
  return async (scenes, o) => {
    const res = (await runFilmWorker(workDir, { mode: "bench", scenes, width: o.width, height: o.height, scale: o.scale }, { ...runner, signal: o.signal })) as { scenes?: BenchScene[] };
    return res.scenes ?? [];
  };
}

// ---------- pure checks ----------

const inter = (a: TextBox, b: TextBox) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
const norm = (s: string) => s.normalize("NFC").replace(/\s+/g, " ").trim();

/** DOM checks on one scene's measured frames (spec table "Checagens automáticas"). */
export function checkSceneFrames(meta: Pick<SceneMeta, "beatId" | "texts">, frames: BenchFrame[], size: { w: number; h: number }, extraAllowed: string[] = []): QaIssue[] {
  const issues: QaIssue[] = [];
  const allowed = [...meta.texts, ...extraAllowed, ...UI_TEXT].map(norm);
  const seen = new Set<string>();
  for (const f of frames) {
    for (const b of f.boxes) {
      const key = `${b.text}|${f.t}`;
      if (seen.has(key)) continue;
      seen.add(key);
      // Overflow: outside the screen or clipped by its container.
      if (b.x < -2 || b.y < -2 || b.x + b.w > size.w + 2 || b.y + b.h > size.h + 2 || b.clipped)
        issues.push({ level: "erro", code: "TEXT_OVERFLOW", beatId: meta.beatId, t: f.t, message: `Texto estourando ou cortado: "${b.text.slice(0, 60)}".`, fix: "Reduzir o corpo da fonte ou quebrar a linha (texto mais curto na fala)." });
      // Foreign text: every label must be data of this beat (bug: "SERRA / VITÓRIA" in the Niterói episode).
      const t = norm(b.text);
      const isNumber = /^[\d.,\s%R$€+-]+$/.test(t);
      if (!isNumber && !allowed.some((a) => a.includes(t) || t.includes(a)))
        issues.push({ level: "erro", code: "FOREIGN_TEXT", beatId: meta.beatId, t: f.t, message: `Texto que não está nos dados da fala: "${t.slice(0, 60)}".`, fix: "Erro de compilação: o rótulo tem de vir da fala." });
    }
    // Overlapping text boxes (excluding pieces of the same element).
    const boxes = f.boxes.filter((b) => b.w * b.h > 0);
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        // Pieces of the same element or lines of the same block (`tb1_0`, `tb1_1`) are laid out together.
        const group = (id: string) => id.replace(/_\d+$/, "");
        if (a.id && group(a.id) === group(b.id)) continue;
        const area = inter(a, b);
        if (area > 0.12 * Math.min(a.w * a.h, b.w * b.h))
          issues.push({ level: "aviso", code: "TEXT_OVERLAP", beatId: meta.beatId, t: f.t, message: `Textos sobrepostos: "${a.text.slice(0, 30)}" e "${b.text.slice(0, 30)}".`, fix: "Mover um dos elementos para a posição alternativa." });
      }
  }
  // Empty start: the frame at 20% shows only the background.
  const first = frames[0];
  if (first && first.layers === 0 && first.boxes.filter((b) => !/seal/.test(b.cls)).length === 0)
    issues.push({ level: "aviso", code: "EMPTY_START", beatId: meta.beatId, t: first.t, message: "Cena vazia no início (só o fundo).", fix: "Puxar o 1º elemento para até 10 quadros." });
  return dedupe(issues);
}

function dedupe(issues: QaIssue[]) {
  const seen = new Set<string>();
  return issues.filter((i) => {
    const k = `${i.code}|${i.beatId}|${i.message}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Checks that need no browser: script, facts, media, rhythm, order. */
export function staticChecks(script: Script, ctx: { research?: Research; licenses?: Licenses; metas: SceneMeta[] }): QaIssue[] {
  const issues: QaIssue[] = [];
  const facts = new Map((ctx.research?.facts ?? []).map((f) => [f.id, f]));
  const media = new Map((ctx.licenses?.items ?? []).map((m) => [m.id, m]));
  const metaOf = new Map(ctx.metas.map((m) => [m.beatId, m]));
  let textRun = 0;
  let prevStart = -1;
  for (const b of script.beats) {
    const meta = metaOf.get(b.id);
    // A number shown on screen without a usable fact blocks the episode.
    const shown = [JSON.stringify(b.scene.data ?? {}), ...(meta?.texts ?? [])].join(" ");
    const showsNumber = b.scene.type === "stat" || /\d/.test(meta?.texts.join(" ") ?? "");
    if (showsNumber && !b.cta && !b.facts.some((id) => facts.get(id) && usableFact(facts.get(id)!)) && !(b.scene.type === "stat" && /"source"/.test(shown)))
      issues.push({ level: "erro", code: "NUMBER_WITHOUT_SOURCE", beatId: b.id, message: "Número na tela sem fato com fonte.", fix: "Ligar um fato (research_add_facts) ou tirar o número da tela." });
    // Place tag over media without `place`.
    const tags = [b.scene.data?.tag, ...(((b.scene.data?.clips as { tag?: string }[] | undefined) ?? []).map((c) => c.tag))].filter(Boolean);
    if (tags.length && !b.scene.media.some((id) => media.get(id)?.place)) issues.push({ level: "aviso", code: "PLACE_TAG", beatId: b.id, message: "Etiqueta de lugar sobre mídia sem lugar.", fix: "Remover a etiqueta." });
    // Rhythm.
    textRun = (TEXT_SCENES as readonly string[]).includes(b.scene.type) && !b.scene.bgVideo ? textRun + 1 : 0;
    if (textRun === 3) issues.push({ level: "aviso", code: "TEXT_RUN", beatId: b.id, message: "3 cenas seguidas de texto puro.", fix: "Trocar uma por B-roll ou pôr fundo em vídeo." });
    if (meta && meta.frames / FPS > 12 && !["video", "photo"].includes(b.scene.type) && !b.scene.bgVideo && b.cta !== "endscreen")
      issues.push({ level: "aviso", code: "STATIC_SCENE", beatId: b.id, message: `Cena parada por ${Math.round(meta.frames / FPS)} s.`, fix: "Sugerir B-roll ou fundo em vídeo; ou dividir a fala." });
    // Order of beats vs order of audio.
    if (b.timing) {
      if (b.timing.start < prevStart) issues.push({ level: "erro", code: "ORDER", beatId: b.id, message: "Ordem das falas no áudio diferente do roteiro.", fix: "Voltar ao alinhamento." });
      prevStart = b.timing.start;
    }
    for (const w of meta?.warnings ?? []) if (/Caracteres trocados/.test(w)) issues.push({ level: "aviso", code: "GLYPH", beatId: b.id, message: w, fix: "Trocar o caractere no texto da fala." });
  }
  // Every used media must be in the license record.
  for (const b of script.beats) for (const id of [...b.scene.media, ...(b.scene.bgVideo ? [b.scene.bgVideo] : [])]) if (!media.has(id)) issues.push({ level: "erro", code: "MEDIA_WITHOUT_LICENSE", beatId: b.id, message: `Mídia ${id} sem registro de licença.`, fix: "Escolher a mídia pelo media_pick." });
  return issues;
}

/** Silences longer than 1.5 s inside the narration (outside section pauses). */
export async function silenceCheck(file: string, signal?: AbortSignal): Promise<QaIssue[]> {
  const { spawn } = await import("node:child_process");
  const { ffmpegPath } = await import("../media");
  const err = await new Promise<string>((resolve, reject) => {
    const child = spawn(ffmpegPath, ["-hide_banner", "-nostats", "-i", file, "-af", "silencedetect=n=-45dB:d=1.5", "-f", "null", "-"], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    let out = "";
    child.stderr.on("data", (d: Buffer) => (out += d.toString()));
    signal?.addEventListener("abort", () => child.kill(), { once: true });
    child.once("error", reject);
    child.once("close", () => resolve(out));
  });
  const total = await durationOf(file);
  const issues: QaIssue[] = [];
  for (const m of err.matchAll(/silence_end: ([\d.]+) \| silence_duration: ([\d.]+)/g)) {
    const end = Number(m[1]);
    const d = Number(m[2]);
    if (end >= total - 0.05) continue; // trailing silence
    issues.push({ level: "aviso", code: "SILENCE", t: end - d, message: `Silêncio de ${d.toFixed(1)} s na narração.`, fix: "Verificar a narração desse trecho (regravar a fala)." });
  }
  return issues;
}

// ---------- sheets ----------

const assTime = (sec: number) => `${Math.floor(sec / 3600)}:${String(Math.floor(sec / 60) % 60).padStart(2, "0")}:${(sec % 60).toFixed(2).padStart(5, "0")}`;
const assText = (text: string) => text.replace(/[{}\\]/g, " ").replace(/\s+/g, " ").trim();

/**
 * Numbered sheet: rows of `cols` frames (scene number + point), each at `w`×`h`.
 * The labels are burned with libass (`ass` filter), not `drawtext`: the FFmpeg shipped for
 * macOS has no freetype/drawtext, while libass is present on every platform (Shorts use it).
 */
export async function numberedSheet(frames: { file: string; label: string }[], output: string, o: { w: number; h: number; cols: number; font: string; signal?: AbortSignal }) {
  const rows = Math.ceil(frames.length / o.cols);
  const out = resolve(output);
  const work = await mkdtemp(join(dirname(out), ".sheet-"));
  try {
    // libass reads the font from a folder next to the .ass (relative paths: no drive letters).
    await mkdir(join(work, "fonts"));
    await copyFile(o.font, join(work, "fonts", basename(o.font)));
    const family = basename(o.font).split(/[-_.]/)[0] || "Sans";
    const size = Math.round(o.h / 11);
    const events = frames.map((f, i) => {
      const x = (i % o.cols) * o.w + 14;
      const y = Math.floor(i / o.cols) * o.h + 12;
      return `Dialogue: 0,${assTime(0)},${assTime(3600)},Label,,0,0,0,,{\\pos(${x},${y})}${assText(f.label)}`;
    });
    const ass = [
      "[Script Info]", "ScriptType: v4.00+", `PlayResX: ${o.cols * o.w}`, `PlayResY: ${rows * o.h}`, "WrapStyle: 2", "ScaledBorderAndShadow: yes", "",
      "[V4+ Styles]",
      "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
      `Style: Label,${family},${size},&H00FFFFFF,&H00FFFFFF,&H59000000,&H59000000,0,0,0,0,100,100,0,0,3,${Math.max(4, Math.round(size / 3))},0,7,0,0,0,1`, "",
      "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text", ...events, "",
    ].join("\n");
    await writeFile(join(work, "sheet.ass"), ass, "utf8");
    const inputs = frames.flatMap((f) => ["-i", resolve(f.file)]);
    const parts = frames.map((_, i) => `[${i}:v]scale=${o.w}:${o.h}:force_original_aspect_ratio=decrease,pad=${o.w}:${o.h}:(ow-iw)/2:(oh-ih)/2:color=0x111111,setsar=1[v${i}]`);
    const pads = Array.from({ length: rows * o.cols - frames.length }, (_, i) => `color=c=0x111111:s=${o.w}x${o.h}:d=1[p${i}]`);
    const labels = [...frames.map((_, i) => `[v${i}]`), ...pads.map((_, i) => `[p${i}]`)];
    const layout = labels.map((_, i) => `${(i % o.cols) * o.w}_${Math.floor(i / o.cols) * o.h}`).join("|");
    const grid = labels.length === 1 ? parts[0].replace(/\[v0\]$/, "[g]") : [...parts, ...pads, `${labels.join("")}xstack=inputs=${labels.length}:layout=${layout}[g]`].join(";");
    const graph = `${grid};[g]ass=filename=sheet.ass:fontsdir=fonts[out]`;
    await ffmpeg(["-y", ...inputs, "-filter_complex", graph, "-map", "[out]", "-frames:v", "1", "-q:v", "4", out], { signal: o.signal, cwd: work });
  } finally {
    await rm(work, { recursive: true, force: true });
  }
  return output;
}

/** Final video sheets: 1 frame every 8 s, and the first minute at 1 fps (the hook). */
export async function finalSheets(video: string, outDir: string, o: { aspect: "16:9" | "9:16"; signal?: AbortSignal }) {
  await mkdir(outDir, { recursive: true });
  const d = await durationOf(video);
  const [tw, th] = o.aspect === "16:9" ? [320, 180] : [180, 320];
  const n8 = Math.max(1, Math.ceil(d / 8));
  const cols8 = 10;
  const every8 = join(outDir, "final-a-cada-8s.jpg");
  await ffmpeg(["-y", "-i", video, "-vf", `fps=1/8,scale=${tw}:${th},tile=${cols8}x${Math.ceil(n8 / cols8)}`, "-frames:v", "1", "-q:v", "4", every8], { signal: o.signal });
  const hook = join(outDir, "final-primeiro-minuto.jpg");
  await ffmpeg(["-y", "-t", "60", "-i", video, "-vf", `fps=1,scale=${tw}:${th},tile=10x${Math.ceil(Math.min(60, d) / 10)}`, "-frames:v", "1", "-q:v", "4", hook], { signal: o.signal });
  return { every8, hook };
}

// ---------- store-backed ----------

type Ids = { profileId: string; channelId: string; episodeId: string };
export type QaReport = { at: string; ok: boolean; issues: QaIssue[]; sheets: string[]; scenes: number; elapsedSec: number; final?: Record<string, unknown> };

/**
 * `qa_run`: frame bench (2 frames per scene, 40% scale, numbered sheets of 20 scenes) + every
 * automatic check. Writes `qa/report.json`; the QA stage is "erro" while an error remains.
 */
export async function runQa(store: ChannelStore, ids: Ids, options: { bench: BenchRunner; font: string; transcribe?: Transcriber; signal?: AbortSignal; onProgress?: (p: number, m: string) => void; beatIds?: string[] }) {
  const t0 = Date.now();
  const epDir = store.episodeDir(ids.profileId, ids.channelId, ids.episodeId);
  const [channel, episode, script, research, licenses] = await Promise.all([
    store.getChannel(ids.profileId, ids.channelId),
    store.getEpisode(ids.profileId, ids.channelId, ids.episodeId),
    store.readEpisodeFile(ids.profileId, ids.channelId, ids.episodeId, "script"),
    store.readEpisodeFile(ids.profileId, ids.channelId, ids.episodeId, "research"),
    store.readEpisodeFile(ids.profileId, ids.channelId, ids.episodeId, "licenses"),
  ]);
  if (!script?.beats.length) throw Object.assign(new Error("O episódio ainda não tem roteiro."), { code: "NO_SCRIPT" });
  const metas = await readSceneMetas(epDir, script.beats.map((b) => b.id));
  const size = sizeOf(episode.aspect);
  const only = options.beatIds?.length ? new Set(options.beatIds) : undefined;
  const benchMetas = metas.filter((m) => !only || only.has(m.beatId));
  const qaDir = join(epDir, "qa");
  await rm(join(qaDir, "frames"), { recursive: true, force: true }).catch(() => undefined);
  options.onProgress?.(0.05, `Tirando quadros de ${benchMetas.length} cenas`);
  const scenes = benchMetas.map((m) => ({ directory: join(epDir, "scenes", m.beatId), times: BENCH_POINTS.map((p) => (m.frames / FPS) * p), output: join(qaDir, "frames", m.beatId) }));
  const results = await options.bench(scenes, { width: size.w, height: size.h, scale: THUMB_SCALE, signal: options.signal });
  const issues: QaIssue[] = [];
  const allowedGlobal = [channel.name, channel.handle].filter(Boolean);
  benchMetas.forEach((m, i) => {
    const r = results[i];
    if (!r) return;
    for (const e of r.errors) issues.push({ level: "erro", code: "SCENE_ERROR", beatId: m.beatId, message: e, fix: "Refazer a cena (scenes_compile) e conferir a mídia." });
    issues.push(...checkSceneFrames(m, r.frames, size, allowedGlobal));
  });
  issues.push(...staticChecks(script, { research, licenses, metas }));
  options.onProgress?.(0.7, "Montando as folhas numeradas");
  const sheets: string[] = [];
  const pageW = Math.round(size.w * THUMB_SCALE);
  const pageH = Math.round(size.h * THUMB_SCALE);
  for (let p = 0; p * SHEET_SCENES < benchMetas.length; p++) {
    const chunk = benchMetas.slice(p * SHEET_SCENES, (p + 1) * SHEET_SCENES);
    const frames = chunk.flatMap((m) => {
      const r = results[benchMetas.indexOf(m)];
      const index = script.beats.findIndex((b) => b.id === m.beatId) + 1;
      return (r?.frames ?? []).filter((f) => f.file).map((f, k) => ({ file: f.file!, label: `${index} ${m.beatId} ${k === 0 ? "20" : "85"}` }));
    });
    if (!frames.length) continue;
    sheets.push(await numberedSheet(frames, join(qaDir, `folha-${String(p + 1).padStart(2, "0")}.jpg`), { w: Math.round(pageW / 2), h: Math.round(pageH / 2), cols: size.vertical ? 8 : 4, font: options.font, signal: options.signal }));
  }
  // Audio: narration silences, and the cut-word check when a transcriber is available.
  const narration = join(epDir, "audio", "narracao.wav");
  if (await durationOf(narration).then(() => true, () => false)) issues.push(...(await silenceCheck(narration, options.signal)));
  let final: QaReport["final"];
  if (episode.outputs.video) {
    const video = join(epDir, episode.outputs.video);
    options.onProgress?.(0.85, "Conferindo o vídeo final");
    final = await finalCheck(video, channel, episode.format, episode.aspect, qaDir, options.signal);
    issues.push(...(final.issues as QaIssue[]));
    if (options.transcribe) {
      const words = await options.transcribe(video, { language: channel.language, signal: options.signal });
      const check = wordCheck(script.beats, words);
      if (check.ratio < 0.97 || check.missing.length > Math.max(2, script.beats.length * 0.02))
        issues.push({ level: "erro", code: "CUT_WORD", message: `Transcrição do áudio final casa ${Math.round(check.ratio * 1000) / 10}% com o roteiro; faltam: ${check.missing.slice(0, 8).join(", ")}.`, fix: "Refazer o corte das falas (alinhamento) e renderizar de novo." });
      final.wordRatio = check.ratio;
    }
  }
  const report: QaReport = { at: new Date().toISOString(), ok: !issues.some((i) => i.level === "erro"), issues, sheets, scenes: benchMetas.length, elapsedSec: Math.round((Date.now() - t0) / 1000), final };
  await writeJsonAtomic(join(qaDir, "report.json"), report);
  await store.setStage(ids.profileId, ids.channelId, ids.episodeId, "qa", report.ok ? { status: "ok", inputHash: metas.map((m) => m.hash).join("").slice(0, 60) } : { status: "erro", error: `${issues.filter((i) => i.level === "erro").length} erro(s) na revisão` });
  return report;
}

/** Spec "Conferência do vídeo final": duration ≥ channel minimum, loudness measured, sheets. */
export async function finalCheck(video: string, channel: Channel, format: "long" | "short", aspect: "16:9" | "9:16", qaDir: string, signal?: AbortSignal) {
  const issues: QaIssue[] = [];
  const duration = await durationOf(video);
  const min = format === "long" ? channel.defaults.longMinMinutes * 60 : 15;
  if (duration < min) issues.push({ level: "erro", code: "TOO_SHORT", message: `Vídeo com ${Math.round(duration)} s, abaixo do mínimo do canal (${min} s).`, fix: "Acrescentar fatos verificados ao roteiro." });
  if (format === "short" && duration > 59.5) issues.push({ level: "aviso", code: "SHORT_TOO_LONG", message: `Curto com ${duration.toFixed(1)} s (máximo 59 s).`, fix: "Cortar uma fala." });
  const loud = await measureLoudness(video, { signal });
  const target = format === "long" ? -16 : -14;
  if (Math.abs(loud.lufs - target) > 1) issues.push({ level: "erro", code: "LOUDNESS", message: `Volume em ${loud.lufs.toFixed(1)} LUFS (alvo ${target}).`, fix: "Normalizar o áudio (renderizar de novo só a mixagem)." });
  const sheets = await finalSheets(video, qaDir, { aspect, signal });
  return { duration, lufs: loud.lufs, truePeak: loud.truePeak, sheets, issues } as Record<string, unknown> & { issues: QaIssue[] };
}

/** Rubric for the optional vision review (the agent looks at the sheets and answers per scene). */
export const VISION_RUBRIC = [
  "Para cada cena numerada na folha, dê nota de 1 a 5 para: legibilidade, poluição visual, coerência imagem-fala, hierarquia visual e \"parece template?\".",
  "Para toda nota ≤ 3, dê uma correção concreta (trocar mídia, encurtar texto, mudar o tipo de cena).",
  "Confira se a imagem é do lugar dito na fala (etiqueta de lugar só em imagem daquele lugar) e se nenhuma pessoa vulnerável ilustra problema.",
];

export type { Beat };

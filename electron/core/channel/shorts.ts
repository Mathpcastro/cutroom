import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Beat } from "../../../src/shared/channel";
import type { ChannelStore } from "./channel-store";
import { concatClips, readSceneMetas } from "./episode-render";
import { durationOf, ffmpeg } from "./ffmpeg";
import { normalizeLoudness } from "./narration";
import { countWords } from "./script-writer";
import { FPS, lookOf, safeText } from "./scene-compiler";

/**
 * Shorts e Reels (spec "Shorts e Reels"): every long episode leaves with 2 vertical cuts.
 * Windows of 40–58 s start and end on beat boundaries (= scene boundaries, so the cut reuses
 * the cached scene clips and never re-renders a scene). Score = hook in the first sentence (40)
 * + number or strong opinion (30) + closes on its own (30). Cut 1 = the opening hook; cut 2 =
 * the best other window. Vertical layout 1080×1920: hook on top, the 16:9 scene at 56% in the
 * middle with a border in the channel color, big captions (≤ 3 words, current word
 * highlighted) and the @ at the bottom, which becomes "VÍDEO COMPLETO NO CANAL" in the last 2.5 s.
 */

export const SHORT_MIN = 40;
export const SHORT_MAX = 58;
export const SHORT_LUFS = -14;
const W = 1080;
const H = 1920;

type TimedBeat = Pick<Beat, "id" | "text" | "facts" | "cta" | "section"> & { start: number; end: number };
export type Window = { from: number; to: number; beatIds: string[]; start: number; end: number; score: number; parts: { hook: number; strong: number; alone: number } };

const HOOKY = /\?|\b(não é|nunca|ninguém|ningu[eé]m|pior|melhor|mais caro|mais cara|mais barat|por que|o que ninguém|verdade|segredo|ningu)/i;
const OPINION = /\b(na minha visão|eu acho|vale a pena|não vale|o problema|o pior|o melhor|absurdo|surpreend)/i;
const CONNECTOR = /^(e|mas|então|entao|isso|isto|ele|ela|eles|elas|esse|essa|esses|essas|também|tambem|por isso|aí|ai|depois|além disso|só que)\b/i;

/** Scores one window of beats with the spec formula (0–100). */
export function scoreWindow(beats: TimedBeat[]) {
  const first = beats[0];
  const firstSentence = first.text.split(/(?<=[.!?])\s+/)[0];
  const hook = (countWords(firstSentence) <= 15 ? 0.4 : 0) + (HOOKY.test(firstSentence) ? 0.4 : 0) + (/\d/.test(firstSentence) ? 0.2 : 0);
  const strong = beats.some((b) => b.facts.length && /\d/.test(b.text)) ? 1 : beats.some((b) => OPINION.test(b.text)) ? 0.7 : 0;
  const lastText = beats.at(-1)!.text.trim();
  const alone = (CONNECTOR.test(first.text.trim()) ? 0 : 0.6) + (/[.!?]$/.test(lastText) ? 0.2 : 0) + (beats.some((b) => b.cta) ? 0 : 0.2);
  const parts = { hook: Math.round(hook * 40), strong: Math.round(strong * 30), alone: Math.round(alone * 30) };
  return { score: parts.hook + parts.strong + parts.alone, parts };
}

/** Every window of 40–58 s on beat boundaries. */
export function candidateWindows(beats: TimedBeat[], min = SHORT_MIN, max = SHORT_MAX): Window[] {
  const out: Window[] = [];
  for (let i = 0; i < beats.length; i++)
    for (let j = i; j < beats.length; j++) {
      const len = beats[j].end - beats[i].start;
      if (len > max) break;
      if (len < min) continue;
      const slice = beats.slice(i, j + 1);
      if (slice.some((b) => b.cta === "endscreen")) continue;
      const { score, parts } = scoreWindow(slice);
      out.push({ from: i, to: j, beatIds: slice.map((b) => b.id), start: beats[i].start, end: beats[j].end, score, parts });
    }
  return out;
}

/** Cut 1 = the opening (from the first beat); the others = best windows that do not overlap. */
export function pickWindows(beats: TimedBeat[], count = 2): Window[] {
  const all = candidateWindows(beats);
  if (!all.length) return [];
  const opening = all.filter((w) => w.from === 0).sort((a, b) => b.score - a.score || b.end - b.start - (a.end - a.start))[0];
  const picked: Window[] = opening ? [opening] : [];
  for (const w of [...all].sort((a, b) => b.score - a.score || a.start - b.start)) {
    if (picked.length >= count) break;
    if (picked.some((p) => w.from <= p.to && p.from <= w.to)) continue;
    picked.push(w);
  }
  return picked;
}

// ---------- captions & overlay (ASS) ----------

const assTime = (s: number) => {
  const cs = Math.max(0, Math.round(s * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const sec = Math.floor((cs % 6000) / 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
};
const assColor = (hex: string) => {
  const m = hex.replace("#", "").padEnd(6, "0");
  return `&H00${m.slice(4, 6)}${m.slice(2, 4)}${m.slice(0, 2)}`.toUpperCase();
};
const assText = (s: string) => safeText(s).text.replace(/[{}\\]/g, "").replace(/\n/g, " ");

/** Groups of up to 3 words, breaking at punctuation. */
export function captionGroups(words: { t: string; s: number; e: number }[]) {
  const groups: { words: typeof words }[] = [];
  let cur: typeof words = [];
  for (const w of words) {
    cur.push(w);
    if (cur.length === 3 || /[.,!?;:]$/.test(w.t)) {
      groups.push({ words: cur });
      cur = [];
    }
  }
  if (cur.length) groups.push({ words: cur });
  return groups;
}

/** The whole vertical overlay as one ASS file: hook on top, captions, footer. */
export function shortAss(o: { hook: string[]; chip?: string; words: { t: string; s: number; e: number }[]; duration: number; handle: string; look: ReturnType<typeof lookOf> }) {
  const accent = assColor(o.look.accent);
  const ink = assColor("#FFFFFF");
  const display = o.look.display.family;
  const body = o.look.body.family;
  const head = `[Script Info]
ScriptType: v4.00+
PlayResX: ${W}
PlayResY: ${H}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Hook,${display},112,${ink},${ink},&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,6,4,8,60,60,0,1
Style: Chip,${display},44,&H00111111,&H00111111,${accent},${accent},0,0,0,0,100,100,1,0,3,10,0,8,60,60,0,1
Style: Cap,${display},104,${ink},${ink},&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,7,4,5,40,40,0,1
Style: Foot,${body},40,${ink},${ink},&H00000000,&H00000000,1,0,0,0,100,100,1,0,1,3,0,2,40,40,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  const end = assTime(o.duration);
  const ev: string[] = [];
  if (o.chip) ev.push(`Dialogue: 1,${assTime(0)},${end},Chip,,0,0,0,,{\\pos(${W / 2},170)}${assText(o.chip.toUpperCase())}`);
  // Hook phrase, 3 lines max, last line in the accent color (top area y 150–560).
  const lines = o.hook.slice(0, 3).map(assText);
  const hookY = o.chip ? 270 : 200;
  ev.push(`Dialogue: 1,${assTime(0)},${end},Hook,,0,0,0,,{\\pos(${W / 2},${hookY})}${lines.map((l, i) => (i === lines.length - 1 ? `{\\c${accent}}${l.toUpperCase()}` : l.toUpperCase())).join("\\N")}`);
  // Captions: the group stays while its words are spoken; the current word is highlighted.
  for (const g of captionGroups(o.words)) {
    g.words.forEach((w, k) => {
      const from = w.s;
      const to = k + 1 < g.words.length ? g.words[k + 1].s : w.e;
      const text = g.words.map((x, i) => (i === k ? `{\\c${accent}}${assText(x.t).toUpperCase()}{\\c${ink}}` : assText(x.t).toUpperCase())).join(" ");
      if (to > from) ev.push(`Dialogue: 2,${assTime(from)},${assTime(to)},Cap,,0,0,0,,{\\pos(${W / 2},1440)}${text}`);
    });
  }
  // Footer above the 250 px safe area; the last 2.5 s call the long video.
  const swap = Math.max(0, o.duration - 2.5);
  if (o.handle) ev.push(`Dialogue: 1,${assTime(0)},${assTime(swap)},Foot,,0,0,0,,{\\pos(${W / 2},1650)}${assText(o.handle)}`);
  ev.push(`Dialogue: 1,${assTime(swap)},${end},Foot,,0,0,0,,{\\pos(${W / 2},1650)\\c${accent}\\fs52}VÍDEO COMPLETO NO CANAL`);
  return head + ev.join("\n") + "\n";
}

/** Words of the window, in seconds relative to the window start, with the script's spelling. */
export function windowWords(beats: Pick<Beat, "text" | "timing">[], windowStart: number) {
  const out: { t: string; s: number; e: number }[] = [];
  for (const b of beats) {
    const timed = b.timing?.words ?? [];
    const written = b.text.split(/\s+/).filter(Boolean);
    if (!b.timing) continue;
    // Spread the written words over the beat's spoken span (written ≠ spoken tokens for numbers).
    const s0 = timed[0]?.s ?? b.timing.start;
    const e0 = timed.at(-1)?.e ?? b.timing.end;
    const step = Math.max(0.05, (e0 - s0) / Math.max(1, written.length));
    written.forEach((t, i) => out.push({ t, s: s0 + i * step - windowStart, e: s0 + (i + 1) * step - windowStart }));
  }
  return out.filter((w) => w.e > 0);
}

// ---------- store-backed ----------

type Ids = { profileId: string; channelId: string; episodeId: string };

/**
 * `shorts_cut`: picks the windows (or uses the agent's), joins the cached scene clips, composes
 * the vertical layout and cuts the mixed audio at −14 LUFS. Outputs `out/shorts/short_<n>.mp4`.
 */
export async function cutShorts(store: ChannelStore, ids: Ids, options: { count?: number; windows?: { beatIds: string[]; hook?: string[] }[]; hooks?: string[][]; fontsDir: string; signal?: AbortSignal; onProgress?: (p: number, m: string) => void }) {
  const epDir = store.episodeDir(ids.profileId, ids.channelId, ids.episodeId);
  const [channel, episode, script] = await Promise.all([
    store.getChannel(ids.profileId, ids.channelId),
    store.getEpisode(ids.profileId, ids.channelId, ids.episodeId),
    store.readEpisodeFile(ids.profileId, ids.channelId, ids.episodeId, "script"),
  ]);
  if (!script?.beats.length) throw Object.assign(new Error("O episódio ainda não tem roteiro."), { code: "NO_SCRIPT" });
  if (episode.aspect !== "16:9") throw Object.assign(new Error("Cortes verticais saem de episódios longos (16:9)."), { code: "SHORTS_NOT_LONG" });
  const metas = await readSceneMetas(epDir, script.beats.map((b) => b.id));
  const mix = join(epDir, "audio", "mix.wav");
  await durationOf(mix).catch(() => {
    throw Object.assign(new Error("Renderize o episódio antes de cortar os Shorts (falta a mixagem)."), { code: "NO_MIX" });
  });
  const timed: TimedBeat[] = script.beats.map((b, i) => ({ ...b, start: metas[i].startFrame / FPS, end: (metas[i].startFrame + metas[i].frames) / FPS }));
  const count = options.count ?? channel.defaults.shortsPerEpisode ?? 2;
  let windows: Window[];
  if (options.windows?.length) {
    windows = options.windows.map((w) => {
      const idx = w.beatIds.map((id) => timed.findIndex((b) => b.id === id)).sort((a, b) => a - b);
      if (idx.some((i) => i < 0)) throw Object.assign(new Error("Corte com fala que não existe."), { code: "BEAT_NOT_FOUND" });
      for (let k = 1; k < idx.length; k++) if (idx[k] !== idx[k - 1] + 1) throw Object.assign(new Error("O corte precisa de falas seguidas."), { code: "SHORT_NOT_CONTIGUOUS" });
      const slice = timed.slice(idx[0], idx.at(-1)! + 1);
      const len = slice.at(-1)!.end - slice[0].start;
      if (len < SHORT_MIN - 0.5 || len > SHORT_MAX + 0.5) throw Object.assign(new Error(`O corte tem ${len.toFixed(1)} s; use de ${SHORT_MIN} a ${SHORT_MAX} s.`), { code: "SHORT_LENGTH" });
      return { from: idx[0], to: idx.at(-1)!, beatIds: slice.map((b) => b.id), start: slice[0].start, end: slice.at(-1)!.end, ...scoreWindow(slice) };
    });
  } else windows = pickWindows(timed, count);
  if (!windows.length) throw Object.assign(new Error(`Não há trecho de ${SHORT_MIN} a ${SHORT_MAX} s que comece e termine numa fala.`), { code: "NO_SHORT_WINDOW" });

  const look = lookOf(channel);
  const outDir = join(epDir, "out", "shorts");
  const work = join(epDir, "out", "shorts", ".work");
  await mkdir(work, { recursive: true });
  const outputs: { file: string; start: number; end: number; duration: number; score: number; beatIds: string[] }[] = [];
  for (const [n, w] of windows.entries()) {
    options.onProgress?.(n / windows.length, `Corte ${n + 1} de ${windows.length}`);
    const sceneClips = metas.slice(w.from, w.to + 1).map((m) => join(epDir, "cache", `${m.hash}.mp4`));
    const middle = await concatClips(sceneClips, join(work, `mid_${n + 1}.mp4`), options.signal);
    const duration = w.end - w.start;
    const audio = join(work, `a_${n + 1}.wav`);
    await ffmpeg(["-y", "-ss", w.start.toFixed(3), "-t", duration.toFixed(3), "-i", mix, "-c:a", "pcm_s16le", `${audio}.raw.wav`], { signal: options.signal });
    await normalizeLoudness(`${audio}.raw.wav`, audio, SHORT_LUFS, options.signal, { channels: 2, rate: 48000 });
    await rm(`${audio}.raw.wav`, { force: true });
    const first = script.beats[w.from];
    const hook = options.windows?.[n]?.hook ?? options.hooks?.[n] ?? hookLines(first.text);
    const chip = first.scene.place ?? undefined;
    const ass = shortAss({ hook, chip, words: windowWords(script.beats.slice(w.from, w.to + 1), w.start), duration, handle: channel.handle, look });
    await writeFile(join(work, `o_${n + 1}.ass`), ass, "utf8");
    // Fonts for libass: copy the two channel fonts next to the .ass (paths without drive letters).
    await mkdir(join(work, "fonts"), { recursive: true });
    for (const f of [look.display.file, look.body.file]) await copyFile(join(options.fontsDir, f), join(work, "fonts", f)).catch(() => undefined);
    const file = join(outDir, `short_${n + 1}.mp4`);
    const midH = Math.round((W * 9) / 16);
    const border = look.accent.replace("#", "0x");
    const vf = `[0:v]scale=${W}:${midH},pad=${W}:${H}:0:640:color=${look.bg.replace("#", "0x")},drawbox=x=0:y=632:w=${W}:h=${midH + 16}:color=${border}:t=8,ass=filename=o_${n + 1}.ass:fontsdir=fonts,fps=30,format=yuv420p[v]`;
    await ffmpeg(["-y", "-i", middle, "-i", audio, "-filter_complex", vf, "-map", "[v]", "-map", "1:a", "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-t", duration.toFixed(3), "-movflags", "+faststart", file], { signal: options.signal, cwd: work });
    outputs.push({ file: `out/shorts/short_${n + 1}.mp4`, start: w.start, end: w.end, duration, score: w.score, beatIds: w.beatIds });
  }
  await rm(work, { recursive: true, force: true });
  await store.mutateEpisode(ids.profileId, ids.channelId, ids.episodeId, (ep) => {
    ep.outputs.shorts = outputs.map((o) => o.file);
  });
  await store.setStage(ids.profileId, ids.channelId, ids.episodeId, "shorts", { status: "ok", inputHash: outputs.map((o) => `${o.start}-${o.end}`).join("|") });
  return { shorts: outputs };
}

/** Default hook phrase: the first sentence in up to 3 short lines. */
export function hookLines(text: string) {
  const words = text.split(/(?<=[.!?])\s+/)[0].split(/\s+/).slice(0, 12);
  const per = Math.ceil(words.length / Math.min(3, Math.max(1, Math.ceil(words.length / 4))));
  const lines: string[] = [];
  for (let i = 0; i < words.length; i += per) lines.push(words.slice(i, i + per).join(" "));
  return lines.slice(0, 3);
}



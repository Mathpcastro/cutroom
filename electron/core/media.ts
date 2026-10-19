import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import ffmpegStatic from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";
import type { Media, Project, Word } from "../../src/shared/types";
import { clipDuration, projectDuration, validateProject } from "./project";
import { captionAssParts } from "../../src/shared/captions";
import type { CaptionWord } from "../../src/shared/captions";
import { motionExportSegments } from "../../src/shared/motions";

const unpack = (p: string) =>
  p.replace(/([\\/])app\.asar([\\/])/, "$1app.asar.unpacked$2");
export const ffmpegPath = unpack(ffmpegStatic ?? "ffmpeg");
export const ffprobePath = unpack(ffprobeStatic.path);
const abortError = () =>
  Object.assign(new Error("Operação cancelada."), { name: "AbortError" });
function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

async function run(
  binary: string,
  args: string[],
  options: {
    signal?: AbortSignal;
    duration?: number;
    onProgress?: (p: number) => void;
    cwd?: string;
    timeoutMs?: number;
  } = {},
): Promise<{ stdout: string; stderr: string }> {
  checkAbort(options.signal);
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      cwd: options.cwd,
    });
    let stdout = "",
      stderr = "",
      progressBuffer = "";
    let timedOut = false;
    const abort = () => child.kill("SIGTERM");
    const timer = options.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          abort();
        }, options.timeoutMs)
      : undefined;
    options.signal?.addEventListener("abort", abort, { once: true });
    const cleanup = () => {
      options.signal?.removeEventListener("abort", abort);
      if (timer) clearTimeout(timer);
    };
    child.stdout.on("data", (data: Buffer) => {
      const chunk = data.toString();
      stdout = (stdout + chunk).slice(-2_000_000);
      progressBuffer += chunk;
      const lines = progressBuffer.split(/\r?\n/);
      progressBuffer = lines.pop() ?? "";
      for (const line of lines)
        if (line.startsWith("out_time_us=") && options.duration) {
          const value = Number(line.slice(12));
          if (Number.isFinite(value))
            options.onProgress?.(
              Math.min(
                99.9,
                Math.max(0, (value / 1e6 / options.duration) * 100),
              ),
            );
        }
    });
    child.stderr.on("data", (data: Buffer) => {
      stderr = (stderr + data.toString()).slice(-2_000_000);
    });
    child.on("error", (error) => {
      cleanup();
      reject(
        new Error(
          `Não foi possível iniciar o mecanismo de vídeo: ${error.message}`,
        ),
      );
    });
    child.on("close", (code) => {
      cleanup();
      if (options.signal?.aborted) reject(abortError());
      else if (timedOut)
        reject(
          new Error(
            "O processamento excedeu o tempo limite. Tente um vídeo menor.",
          ),
        );
      else if (code !== 0)
        reject(
          new Error(
            `Falha no processamento do vídeo (${code}): ${stderr.slice(-3500)}`,
          ),
        );
      else resolve({ stdout, stderr });
    });
    if (options.signal?.aborted) abort();
  });
}

export async function probeMedia(
  sourcePath: string,
  cacheDir: string,
  options: { signal?: AbortSignal; forceProxy?: boolean } = {},
): Promise<Media> {
  checkAbort(options.signal);
  const absolute = path.resolve(sourcePath),
    stat = await fs.stat(absolute);
  checkAbort(options.signal);
  if (!stat.isFile()) throw new Error("Selecione um arquivo de vídeo.");
  const { stdout } = await run(
    ffprobePath,
    ["-v", "error", "-show_format", "-show_streams", "-of", "json", absolute],
    options,
  );
  checkAbort(options.signal);
  const info = JSON.parse(stdout) as {
    format?: { duration?: string; format_name?: string };
    streams: {
      codec_type: string;
      codec_name?: string;
      pix_fmt?: string;
      width?: number;
      height?: number;
      avg_frame_rate?: string;
      r_frame_rate?: string;
      duration?: string;
      tags?: { rotate?: string };
      side_data_list?: { rotation?: number }[];
    }[];
  };
  const video = info.streams.find((s) => s.codec_type === "video");
  if (!video?.width || !video.height)
    throw new Error("O arquivo não possui uma faixa de vídeo compatível.");
  const duration = Number(info.format?.duration ?? video.duration);
  if (!Number.isFinite(duration) || duration <= 0 || duration > 7 * 86400)
    throw new Error("Não foi possível determinar a duração do vídeo.");
  const rate = (video.avg_frame_rate || video.r_frame_rate || "30/1")
    .split("/")
    .map(Number);
  const rawFps = rate.length > 1 ? rate[0] / rate[1] : rate[0],
    fps = Number.isFinite(rawFps) && rawFps > 0 ? rawFps : 30;
  const rotation =
    video.side_data_list?.find((s) => s.rotation !== undefined)?.rotation ??
    Number(video.tags?.rotate ?? 0);
  const rotated = Math.abs(rotation) % 180 === 90;
  const mediaId = createHash("sha256")
    .update(`${absolute}\0${stat.size}\0${stat.mtimeMs}`)
    .digest("hex")
    .slice(0, 24);
  await fs.mkdir(cacheDir, { recursive: true });
  checkAbort(options.signal);
  const thumbnail = path.join(path.resolve(cacheDir), `${mediaId}.jpg`);
  let thumb: string | undefined = thumbnail;
  try {
    await fs.access(thumbnail).catch(async () => {
      checkAbort(options.signal);
      const thumbTemp = await fs.mkdtemp(
        path.join(path.resolve(cacheDir), ".thumbnail-"),
      );
      try {
        checkAbort(options.signal);
        const staged = path.join(thumbTemp, "thumbnail.jpg");
        await run(
          ffmpegPath,
          [
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-ss",
            String(Math.min(duration / 3, 2)),
            "-i",
            absolute,
            "-frames:v",
            "1",
            "-vf",
            "scale=480:-2",
            staged,
          ],
          options,
        );
        checkAbort(options.signal);
        await fs.rename(staged, thumbnail);
      } finally {
        await fs
          .rm(thumbTemp, { recursive: true, force: true })
          .catch(() => undefined);
      }
    });
  } catch (error) {
    if (options.signal?.aborted) throw abortError();
    thumb = undefined;
  }
  checkAbort(options.signal);
  const audio = info.streams.find((s) => s.codec_type === "audio"),
    extension = path.extname(absolute).toLowerCase();
  const mp4Compatible =
    [".mp4", ".m4v"].includes(extension) &&
    video.codec_name === "h264" &&
    ["yuv420p", "yuvj420p"].includes(video.pix_fmt ?? "") &&
    (!audio || ["aac", "mp3"].includes(audio.codec_name ?? ""));
  const webmCompatible =
    extension === ".webm" &&
    ["vp8", "vp9", "av1"].includes(video.codec_name ?? "") &&
    (!audio || ["opus", "vorbis"].includes(audio.codec_name ?? ""));
  let proxy: string | undefined;
  if (options.forceProxy || (!mp4Compatible && !webmCompatible)) {
    proxy = path.join(
      path.resolve(cacheDir),
      `${mediaId}-preview${options.forceProxy ? `-recovery-${Date.now()}` : ""}.mp4`,
    );
    try {
      await fs.access(proxy);
    } catch {
      checkAbort(options.signal);
      const proxyTemp = await fs.mkdtemp(
        path.join(path.resolve(cacheDir), ".proxy-"),
      );
      try {
        checkAbort(options.signal);
        const staged = path.join(proxyTemp, "preview.mp4");
        await run(
          ffmpegPath,
          [
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
            absolute,
            "-map",
            "0:v:0",
            "-map",
            "0:a:0?",
            "-vf",
            "scale=w='min(1280,iw)':h='min(720,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "24",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            "-ar",
            "48000",
            "-movflags",
            "+faststart",
            staged,
          ],
          { signal: options.signal, timeoutMs: 20 * 60 * 1000 },
        );
        checkAbort(options.signal);
        await fs.rename(staged, proxy);
      } finally {
        await fs
          .rm(proxyTemp, { recursive: true, force: true })
          .catch(() => undefined);
      }
    }
  }
  checkAbort(options.signal);
  return {
    id: mediaId,
    name: path.basename(absolute),
    path: absolute,
    duration,
    width: rotated ? video.height : video.width,
    height: rotated ? video.width : video.height,
    fps,
    hasAudio: !!audio,
    thumbnail: thumb,
    proxy,
  };
}

export async function detectSilences(
  media: Media,
  options: {
    signal?: AbortSignal;
    onProgress?: (percent: number) => void;
  } = {},
): Promise<{ start: number; end: number }[]> {
  checkAbort(options.signal);
  if (!media.hasAudio) return [];
  const { stderr } = await run(
    ffmpegPath,
    [
      "-hide_banner",
      "-nostats",
      "-progress",
      "pipe:1",
      "-i",
      media.path,
      "-vn",
      "-af",
      "silencedetect=noise=-35dB:d=0.32",
      "-f",
      "null",
      "-",
    ],
    { ...options, duration: media.duration },
  );
  const ranges: { start: number; end: number }[] = [];
  let start: number | undefined;
  for (const match of stderr.matchAll(/silence_(start|end):\s*(-?[\d.]+)/g)) {
    const time = Math.max(0, Math.min(media.duration, Number(match[2])));
    if (match[1] === "start") start = time;
    else {
      const from = start ?? 0;
      if (time > from) ranges.push({ start: from, end: time });
      start = undefined;
    }
  }
  if (start !== undefined && start < media.duration)
    ranges.push({ start, end: media.duration });
  return ranges;
}

export function tempoFilters(speed: number): string {
  const filters: string[] = [];
  while (speed > 2) {
    filters.push("atempo=2");
    speed /= 2;
  }
  while (speed < 0.5) {
    filters.push("atempo=0.5");
    speed /= 0.5;
  }
  filters.push(`atempo=${speed.toFixed(8)}`);
  return filters.join(",");
}

const n = (v: number) => v.toFixed(8);
const assTime = (seconds: number) => {
  const ticks = Math.max(0, Math.round(seconds * 100));
  return `${Math.floor(ticks / 360000)}:${String(Math.floor(ticks / 6000) % 60).padStart(2, "0")}:${String(Math.floor(ticks / 100) % 60).padStart(2, "0")}.${String(ticks % 100).padStart(2, "0")}`;
};
const assText = (text: string) =>
  text
    .replace(/\\/g, "＼")
    .replace(/{/g, "｛")
    .replace(/}/g, "｝")
    .replace(/\r?\n/g, "\\N");
function wrap(text: string, max: number): string {
  return text
    .split("\n")
    .map((line) => {
      let current = "",
        out = "";
      for (const word of line.split(/\s+/)) {
        if ((current + word).length > max && current) {
          out += current.trim() + "\n";
          current = "";
        }
        current += `${word} `;
      }
      return out + current.trim();
    })
    .join("\n");
}

/** ASS carries Unicode text in a file, so user text never becomes FFmpeg filter syntax. */
export function createAss(project: Project, words: Word[] = []): string {
  const captions = captionAssParts(project, words);
  const { width: w, height: h, accent } = project.settings,
    unit = Math.min(w / 1920, h / 1080);
  const orange = `&H00${accent.slice(5, 7)}${accent.slice(3, 5)}${accent.slice(1, 3)}&`;
  const lines = [
    `[Script Info]`,
    `ScriptType: v4.00+`,
    `PlayResX: ${w}`,
    `PlayResY: ${h}`,
    `WrapStyle: 0`,
    `ScaledBorderAndShadow: yes`,
    "",
    "[V4+ Styles]",
    "Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding",
    `Style: Default,Barlow,${Math.round(64 * unit)},&H00FFFFFF,${orange},&H00000000,&H99000000,-1,0,0,0,100,100,0,0,1,${Math.max(2, Math.round(3 * unit))},0,2,${Math.round(w * 0.08)},${Math.round(w * 0.08)},${Math.round(h * 0.12)},1`,
    captions.style,
    "",
    "[Events]",
    "Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text",
  ];
  const event = (layer: number, start: number, end: number, text: string) => {
    if (end > start)
      lines.push(
        `Dialogue: ${layer},${assTime(start)},${assTime(end)},Default,,0,0,0,,${text}`,
      );
  };
  const box = (
    start: number,
    end: number,
    x: number,
    y: number,
    width: number,
    height: number,
    alpha: string,
    color = "&H000000&",
  ) =>
    event(
      0,
      start,
      end,
      `{\\an7\\pos(${Math.round(x)},${Math.round(y)})\\bord0\\shad0\\1c${color}\\1a&H${alpha}&\\p1}m 0 0 l ${Math.round(width)} 0 l ${Math.round(width)} ${Math.round(height)} l 0 ${Math.round(height)}{\\p0}`,
    );
  for (const overlay of project.overlays) {
    const start = overlay.start,
      end = Math.min(overlay.end, projectDuration(project)),
      full = ["title", "statement", "cover"].includes(overlay.kind);
    let y = h * 0.5,
      x = w * 0.5,
      align = 5,
      size = 78 * unit;
    if (overlay.kind === "cover" || overlay.kind === "promo") {
      // 24 horizontal bands form the requested strong, readable top/bottom gradient.
      for (let i = 0; i < 24; i++) {
        const opacity =
          i < 8 ? 0.75 - (i / 8) * 0.35 : 0.4 + ((i - 8) / 15) * 0.58;
        box(
          start,
          end,
          0,
          (h * i) / 24,
          w,
          h / 24 + 1,
          Math.round((1 - opacity) * 255)
            .toString(16)
            .padStart(2, "0"),
        );
      }
      if (overlay.kind === "promo") {
        y = h * 0.72;
        size = 60 * unit;
      }
    } else if (full) box(start, end, 0, 0, w, h, "12");
    else {
      box(start, end, w * 0.05, h * 0.68, w * 0.7, h * 0.22, "18");
      box(
        start,
        end,
        w * 0.05,
        h * 0.68,
        Math.max(4, w * 0.005),
        h * 0.22,
        "00",
        orange,
      );
      x = w * 0.09;
      y = h * 0.78;
      align = 4;
      size = 44 * unit;
    }
    const chars = full
      ? Math.floor((w / Math.max(1, size * 0.55)) * 0.8)
      : Math.floor((w * 0.6) / Math.max(1, size * 0.55));
    const tag = `{\\an${align}\\pos(${Math.round(x)},${Math.round(y)})\\fs${Math.round(size)}\\fad(180,160)\\1c${overlay.kind === "title" ? orange : "&H00FFFFFF&"}}`;
    const steps =
      overlay.kind === "flow"
        ? overlay.text.split(/\s*(?:→|->|\n)\s*/).filter(Boolean)
        : [];
    if (steps.length > 1)
      for (let i = 0; i < steps.length; i++)
        event(
          2,
          start + ((end - start) * i) / steps.length,
          start + ((end - start) * (i + 1)) / steps.length,
          tag + assText(wrap(steps.slice(0, i + 1).join(" → "), chars)),
        );
    else event(2, start, end, tag + assText(wrap(overlay.text, chars)));
  }
  let offset = 0;
  for (const clip of project.clips) {
    const end = offset + clipDuration(clip);
    if (clip.speed >= 4 && clip.muted)
      event(
        2,
        offset,
        end,
        `{\\an7\\pos(${Math.round(w * 0.08)},${Math.round(h * 0.08)})\\fs${Math.round(44 * unit)}\\1c${orange}}>> ${clip.speed}x`,
      );
    offset = end;
  }
  lines.push(...captions.events);
  return lines.join("\n") + "\n";
}

export async function exportProject(
  value: Project,
  outputPath: string,
  options: {
    onProgress?: (percent: number) => void;
    signal?: AbortSignal;
    fontPath?: string;
    motions?: { id: string; path: string }[];
  } = {},
): Promise<void> {
  const project = validateProject(value);
  if (
    (project.motions ?? []).some(
      (s) => !options.motions?.some((m) => m.id === s.id),
    )
  )
    throw new Error(
      "As animações precisam ser renderizadas antes da exportação.",
    );
  if (!project.clips.length)
    throw new Error("Adicione ao menos um trecho antes de exportar.");
  if (path.extname(outputPath).toLowerCase() !== ".mp4")
    throw new Error("A exportação deve usar a extensão .mp4.");
  const absolute = path.resolve(outputPath);
  if (
    project.media.some(
      (m) => path.resolve(m.path).toLowerCase() === absolute.toLowerCase(),
    )
  )
    throw new Error("A exportação não pode sobrescrever um vídeo de origem.");
  checkAbort(options.signal);
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  // Same-volume staging permits an atomic rename and preserves an existing destination on failure.
  const temp = await fs.mkdtemp(
    path.join(path.dirname(absolute), ".cutroom-export-"),
  );
  const { width, height, fps, normalize, targetLufs } = project.settings;
  const clips: string[] = [],
    words: CaptionWord[] = [];
  let elapsed = 0;
  options.onProgress?.(0);
  try {
    for (let index = 0; index < project.clips.length; index++) {
      checkAbort(options.signal);
      const clip = project.clips[index],
        media = project.media.find((m) => m.id === clip.mediaId)!;
      const frames = Math.max(1, Math.round(clipDuration(clip) * fps)),
        duration = frames / fps;
      const scaledW = Math.ceil((width * clip.zoom) / 2) * 2,
        scaledH = Math.ceil((height * clip.zoom) / 2) * 2;
      const focusX = clip.focusX ?? 0.5,
        focusY = clip.focusY ?? 0.5;
      const covers = project.overlays.filter(
        (o) =>
          o.kind === "cover" && o.end > elapsed && o.start < elapsed + duration,
      );
      let framing: string;
      if (covers.length) {
        const enable = covers
          .map(
            (o) =>
              `between(t,${n(Math.max(0, o.start - elapsed))},${n(Math.min(duration, o.end - elapsed))})`,
          )
          .join("+");
        framing = `[0:v:0]setpts=(PTS-STARTPTS)/${n(clip.speed)},split=2[contain][fill];[contain]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black,setsar=1[base];[fill]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1[full];[base][full]overlay=enable='${enable}'[framed];[framed]`;
      } else
        framing = `[0:v:0]setpts=(PTS-STARTPTS)/${n(clip.speed)},scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,`;
      const video = `${framing}scale=${scaledW}:${scaledH},crop=${width}:${height}:${Math.round(Math.max(0, Math.min(scaledW - width, scaledW * focusX - width / 2)))}:${Math.round(Math.max(0, Math.min(scaledH - height, scaledH * focusY - height / 2)))},fps=${fps},tpad=stop_mode=clone:stop_duration=1,trim=end_frame=${frames},setpts=N/(${fps}*TB),format=yuv420p[v]`;
      const fade = Math.min(0.03, duration / 2),
        audio =
          media.hasAudio && !clip.muted
            ? `[0:a:0]asetpts=PTS-STARTPTS,${tempoFilters(clip.speed)},aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,apad,atrim=duration=${n(duration)},afade=t=in:st=0:d=${n(fade)},afade=t=out:st=${n(duration - fade)}:d=${n(fade)}[a]`
            : `anullsrc=r=48000:cl=stereo,atrim=duration=${n(duration)},asetpts=PTS-STARTPTS[a]`;
      const script = path.join(temp, `clip-${index}.ffgraph`),
        output = path.join(temp, `clip-${index}.mkv`);
      await fs.writeFile(script, `${video};\n${audio}`, "utf8");
      await run(
        ffmpegPath,
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-y",
          "-ss",
          n(clip.start),
          "-t",
          n(clip.end - clip.start),
          "-i",
          media.path,
          "-filter_complex_script",
          script,
          "-map",
          "[v]",
          "-map",
          "[a]",
          "-c:v",
          "libx264",
          "-preset",
          "ultrafast",
          "-crf",
          "16",
          "-c:a",
          "pcm_s16le",
          "-ar",
          "48000",
          "-t",
          n(duration),
          "-progress",
          "pipe:1",
          "-nostats",
          output,
        ],
        {
          signal: options.signal,
          duration,
          onProgress: (p) =>
            options.onProgress?.(
              ((index + p / 100) / project.clips.length) * 65,
            ),
        },
      );
      for (const word of project.words)
        if (word.mediaId === clip.mediaId && !clip.muted) {
          const start = Math.max(word.start, clip.start),
            end = Math.min(word.end, clip.end);
          if (end > start)
            words.push({
              ...word,
              clipId: clip.id,
              start: elapsed + (start - clip.start) / clip.speed,
              end:
                elapsed + Math.min(duration, (end - clip.start) / clip.speed),
            });
        }
      clips.push(output);
      elapsed += duration;
    }
    const list = path.join(temp, "concat.txt");
    await fs.writeFile(
      list,
      clips
        .map((p) => `file '${p.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`)
        .join("\n"),
      "utf8",
    );
    const concatInput = ["-f", "concat", "-safe", "0", "-i", list];
    let audioFilter = "anull";
    if (normalize) {
      const base = `loudnorm=I=${targetLufs}:TP=-1.5:LRA=11`;
      options.onProgress?.(66);
      const measured = await run(
        ffmpegPath,
        [
          "-hide_banner",
          "-nostats",
          ...concatInput,
          "-vn",
          "-af",
          `${base}:print_format=json`,
          "-f",
          "null",
          "-",
        ],
        {
          signal: options.signal,
          duration: elapsed,
          onProgress: (p) => options.onProgress?.(66 + p * 0.1),
        },
      );
      const match = measured.stderr.match(/\{[^{}]*"input_i"[^{}]*\}/g)?.at(-1);
      if (!match) throw new Error("Não foi possível medir o volume do áudio.");
      const data = JSON.parse(match) as Record<string, string>;
      if (
        [
          "input_i",
          "input_tp",
          "input_lra",
          "input_thresh",
          "target_offset",
        ].every((k) => Number.isFinite(Number(data[k])))
      )
        audioFilter = `${base}:measured_I=${data.input_i}:measured_TP=${data.input_tp}:measured_LRA=${data.input_lra}:measured_thresh=${data.input_thresh}:offset=${data.target_offset}:linear=true`;
      // Digital silence is already silent; loudnorm measurements are -inf and must not be fed back.
      else if (data.input_i !== "-inf") audioFilter = base;
    }
    const ass = path.join(temp, "motions.ass");
    await fs.writeFile(ass, createAss(project, words), "utf8");
    const hasText =
      project.overlays.length > 0 ||
      (project.settings.captions && words.length > 0) ||
      project.clips.some((c) => c.muted && c.speed >= 4);
    let videoFilter = "null";
    if (hasText) {
      // Relative, generated names avoid the two escaping layers of FFmpeg paths (drive colons/apostrophes).
      videoFilter = "ass=filename=motions.ass";
      if (options.fontPath) {
        await fs.mkdir(path.join(temp, "fonts"));
        // The application supplies its trusted bundled font directory; filenames are never filter syntax.
        const fontDir = path.dirname(options.fontPath);
        for (const entry of await fs.readdir(fontDir, { withFileTypes: true }))
          if (entry.isFile() && /\.(ttf|otf|woff2?)$/i.test(entry.name))
            await fs.copyFile(
              path.join(fontDir, entry.name),
              path.join(temp, "fonts", entry.name),
            );
        videoFilter += ":fontsdir=fonts";
      }
    }
    const finalScript = path.join(temp, "final.ffgraph"),
      staged = path.join(temp, "final.mp4");
    const motionInputs: string[] = [],
      motionGraph: string[] = [];
    let base = "0:v:0";
    for (const [i, motion] of (project.motions ?? []).entries()) {
      const rendered = options.motions!.find((m) => m.id === motion.id)!;
      motionInputs.push("-i", rendered.path);
      const parts = motionExportSegments(motion, project);
      motionGraph.push(
        `[${i + 1}:v:0]split=${parts.length}${parts.map((_, j) => `[part${i}_${j}]`).join("")}`,
      );
      for (const [j, part] of parts.entries()) {
        motionGraph.push(
          `[part${i}_${j}]trim=start=${n(part.sourceOffset)}:duration=${n((part.end - part.start) * part.playbackRate)},setpts=(PTS-STARTPTS)/${n(part.playbackRate)}+${n(part.start)}/TB[scene${i}_${j}]`,
        );
        motionGraph.push(
          `[${base}][scene${i}_${j}]overlay=0:0:eof_action=pass:enable='gte(t,${n(part.start)})*lt(t,${n(part.end)})'[motion${i}_${j}]`,
        );
        base = `motion${i}_${j}`;
      }
    }
    await fs.writeFile(
      finalScript,
      [
        ...motionGraph,
        `[${base}]${videoFilter}[v]`,
        `[0:a:0]${audioFilter},aresample=48000[a]`,
      ].join(";\n"),
      "utf8",
    );
    await run(
      ffmpegPath,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        ...concatInput,
        ...motionInputs,
        "-filter_complex_script",
        finalScript,
        "-map",
        "[v]",
        "-map",
        "[a]",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "20",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-ar",
        "48000",
        "-movflags",
        "+faststart",
        "-t",
        n(elapsed),
        "-progress",
        "pipe:1",
        "-nostats",
        staged,
      ],
      {
        signal: options.signal,
        cwd: temp,
        duration: elapsed,
        onProgress: (p) => options.onProgress?.(76 + p * 0.23),
      },
    );
    checkAbort(options.signal);
    await fs.rename(staged, absolute);
    options.onProgress?.(100);
  } finally {
    await fs.rm(temp, { recursive: true, force: true }).catch(() => undefined);
  }
}

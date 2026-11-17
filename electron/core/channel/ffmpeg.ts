import { ffmpegPath, ffprobePath } from "../media";
import { runProcess } from "../process";

/** FFmpeg and ffprobe for the channel studio (the bundled static builds, unpacked from asar). */
export async function ffmpeg(args: string[], options: { signal?: AbortSignal; cwd?: string } = {}) {
  return runProcess(ffmpegPath, ["-hide_banner", "-loglevel", "error", "-nostdin", ...args], { signal: options.signal, cwd: options.cwd });
}

export type ProbeInfo = {
  format?: { duration?: string };
  streams: { codec_type: string; codec_name?: string; width?: number; height?: number; duration?: string; sample_rate?: string; channels?: number; r_frame_rate?: string; nb_frames?: string }[];
};

export async function ffprobeJson(file: string, options: { signal?: AbortSignal } = {}): Promise<ProbeInfo> {
  const out = await runProcess(ffprobePath, ["-v", "error", "-show_format", "-show_streams", "-of", "json", file], { signal: options.signal });
  return JSON.parse(out) as ProbeInfo;
}

export async function durationOf(file: string, options: { signal?: AbortSignal } = {}) {
  const info = await ffprobeJson(file, options);
  return Number(info.format?.duration ?? info.streams[0]?.duration ?? 0);
}

/** Integrated loudness (LUFS) and true peak measured with ebur128. */
export async function measureLoudness(file: string, options: { signal?: AbortSignal } = {}) {
  const { spawn } = await import("node:child_process");
  return new Promise<{ lufs: number; truePeak: number }>((resolve, reject) => {
    const child = spawn(ffmpegPath, ["-hide_banner", "-nostats", "-i", file, "-filter_complex", "ebur128=peak=true", "-f", "null", "-"], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    child.stderr.on("data", (d: Buffer) => (err = (err + d.toString()).slice(-20_000)));
    options.signal?.addEventListener("abort", () => child.kill(), { once: true });
    child.once("error", reject);
    child.once("close", (code) => {
      const summary = err.slice(err.lastIndexOf("Summary:"));
      const lufs = Number(summary.match(/I:\s+(-?[\d.]+) LUFS/)?.[1]);
      const truePeak = Number(summary.match(/Peak:\s+(-?[\d.]+) dBFS/)?.[1]);
      if (code !== 0 || !Number.isFinite(lufs)) reject(new Error(`Não consegui medir o volume: ${err.slice(-300)}`));
      else resolve({ lufs, truePeak });
    });
  });
}

import { execFile as execFileCallback } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import ffmpegStatic from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";
import { describe, expect, it } from "vitest";

const execFile = promisify(execFileCallback);
const ffmpegPath = ffmpegStatic!;
const ffprobePath = ffprobeStatic.path;
const names = ["professor", "ui-motion"] as const;

async function audioHash(file: string) {
  const { stdout } = await execFile(ffmpegPath, [
    "-v", "error", "-i", file, "-map", "0:a:0", "-c:a", "copy", "-f", "md5", "-",
  ]);
  return stdout.trim();
}

async function probe(file: string) {
  const { stdout } = await execFile(ffprobePath, [
    "-v", "error", "-show_streams", "-show_format", "-of", "json", file,
  ]);
  return JSON.parse(stdout) as {
    format: { duration: string };
    streams: Array<{
      codec_type: string;
      width?: number;
      height?: number;
      avg_frame_rate?: string;
      sample_rate?: string;
    }>;
  };
}

describe("mídias reais dos dois comparativos do upsell", { timeout: 60_000 }, () => {
  for (const name of names) {
    it(`${name}: mantém byte a byte o stream de narração original`, async () => {
      const generated = resolve(`site/upsell/videos/${name}.mp4`);
      const original = resolve(`artifacts/upsell-demos/original/${name}.mp4`);
      expect(await audioHash(generated)).toEqual(await audioHash(original));
    });

    it(`${name}: entrega vertical 1080 × 1920, 30 fps e áudio 48 kHz`, async () => {
      const info = await probe(resolve(`site/upsell/videos/${name}.mp4`));
      const video = info.streams.find((stream) => stream.codec_type === "video");
      const audio = info.streams.find((stream) => stream.codec_type === "audio");
      expect(video).toMatchObject({ width: 1080, height: 1920, avg_frame_rate: "30/1" });
      expect(audio?.sample_rate).toBe("48000");
      expect(Number(info.format.duration)).toBeGreaterThan(0);
    });

    it(`${name}: tem pôster vertical com as dimensões do vídeo`, async () => {
      const info = await probe(resolve(`site/upsell/videos/${name}.jpg`));
      const poster = info.streams.find((stream) => stream.codec_type === "video");
      expect(poster).toMatchObject({ width: 1080, height: 1920 });
    });
  }
});

import { execFile as execFileCallback } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";
import ffprobeStatic from "ffprobe-static";
import { describe, expect, it } from "vitest";

const execFile = promisify(execFileCallback);
const ffprobePath = ffprobeStatic.path;

// Every video the page plays, with its poster (the page is the source of truth).
const page = readFileSync(resolve("site/upsell/index.html"), "utf8");
const names = [...new Set([...page.matchAll(/src="videos\/([\w-]+)\.mp4"/g)].map((m) => m[1]))];

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

describe("vídeos reais da página de upsell", { timeout: 60_000 }, () => {
  it("a página toca os vídeos gerados pelo motor novo", () => {
    expect(names).toEqual(expect.arrayContaining(["avatar", "professor", "ui-motion", "mentoria", "stickman", "kurzgesagt"]));
  });

  for (const name of names) {
    it(`${name}: vertical 9:16, 30 fps, com áudio a 48 kHz`, async () => {
      const info = await probe(resolve(`site/upsell/videos/${name}.mp4`));
      const video = info.streams.find((stream) => stream.codec_type === "video")!;
      const audio = info.streams.find((stream) => stream.codec_type === "audio");
      expect(video.width! * 16).toBe(video.height! * 9);
      expect(video.width).toBeGreaterThanOrEqual(540);
      expect(video.avg_frame_rate).toBe("30/1");
      expect(audio?.sample_rate).toBe("48000");
      expect(Number(info.format.duration)).toBeGreaterThan(5);
    });

    it(`${name}: tem pôster com as dimensões do vídeo`, async () => {
      const [clip, poster] = await Promise.all([
        probe(resolve(`site/upsell/videos/${name}.mp4`)),
        probe(resolve(`site/upsell/videos/${name}.jpg`)),
      ]);
      const v = clip.streams.find((stream) => stream.codec_type === "video")!;
      expect(poster.streams[0]).toMatchObject({ width: v.width, height: v.height });
    });
  }
});

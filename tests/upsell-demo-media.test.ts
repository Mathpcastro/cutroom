import { execFile as execFileCallback } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";
import ffprobeStatic from "ffprobe-static";
import { describe, expect, it } from "vitest";

const execFile = promisify(execFileCallback);
const ffprobePath = ffprobeStatic.path;

// Every video the page plays, with its poster (the page is the source of truth).
const page = readFileSync(resolve("site/upsell/index.html"), "utf8");
// Trechos com a narração do episódio original.
const names = [...new Set([...page.matchAll(/<video src="videos\/([\w-]+)\.mp4"[^>]*data-autoplay/g)].map((m) => m[1]))];

const previews = [...page.matchAll(/<video data-src="videos\/(previa-[\w-]+)\.mp4"[^>]*width="(\d+)" height="(\d+)"/g)]
  .map(([, name, width, height]) => ({ name, width: Number(width), height: Number(height) }));

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
  it("mostra 3 canais reais feitos no app (episódios, Shorts e thumbs) com som", () => {
    expect(names).toEqual(expect.arrayContaining(["canal-top", "canal-ese", "canal-receita", "canal-top-short", "canal-ese-short"]));
    for (const thumb of ["canal-top-thumb", "canal-ese-thumb", "canal-receita-thumb"]) expect(page).toContain(`videos/${thumb}.jpg`);
  });

  it("a página toca as duas versões do episódio original", () => {
    expect(names).toEqual(expect.arrayContaining(["niteroi-original", "niteroi-original-vertical"]));
  });

  for (const name of names) {
    it(`${name}: 30 fps com áudio a 48 kHz`, async () => {
      const info = await probe(resolve(`site/upsell/videos/${name}.mp4`));
      const video = info.streams.find((stream) => stream.codec_type === "video")!;
      const audio = info.streams.find((stream) => stream.codec_type === "audio");
      // Vertical clips: Shorts, the vertical cut of Niterói and the vertical recipe channel.
      const aspect = /(-vertical|-short|receita)$/.test(name) ? 9 / 16 : 16 / 9;
      expect(video.width! / video.height!).toBeCloseTo(aspect, 6);
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
  it("carrega amostras da galeria compactas e sem faixa de áudio", async () => {
    expect(previews).toHaveLength(6);
    await Promise.all(previews.map(async ({ name, width, height }) => {
      const file = resolve(`site/upsell/videos/${name}.mp4`);
      const { streams, format } = await probe(file);
      expect(statSync(file).size).toBeLessThan(220_000);
      expect(streams).toHaveLength(1);
      expect(streams[0]).toMatchObject({ codec_type: "video", width, height });
      expect(Number(format.duration)).toBeCloseTo(6, 1);
    }));
  });
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  applyCommand,
  createProject,
  projectDuration,
} from "../electron/core/project";
import {
  createAss,
  detectSilences,
  exportProject,
  ffmpegPath,
  ffprobePath,
  probeMedia,
  tempoFilters,
} from "../electron/core/media";
import type { Media, Project } from "../src/shared/types";

const exec = promisify(execFile);
let dir: string, source: Media, silent: Media;
function fixture(media = source): Project {
  const p = createProject();
  p.media = [media];
  p.clips = [
    {
      id: "a",
      mediaId: media.id,
      start: 0,
      end: media.duration,
      speed: 1,
      zoom: 1,
      muted: false,
    },
  ];
  p.settings.width = 320;
  p.settings.height = 180;
  return p;
}

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "cutroom's-fixture-"));
  const sourcePath = path.join(dir, "source.mp4"),
    silentPath = path.join(dir, "silent.mp4");
  await exec(ffmpegPath, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=320x180:rate=30:duration=4",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=48000:duration=4",
    "-af",
    "volume=0:enable='between(t,1,2)'",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-c:a",
    "aac",
    "-shortest",
    sourcePath,
  ]);
  await exec(ffmpegPath, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    sourcePath,
    "-an",
    "-c:v",
    "copy",
    silentPath,
  ]);
  source = await probeMedia(sourcePath, path.join(dir, "cache"));
  silent = await probeMedia(silentPath, path.join(dir, "cache"));
}, 30000);
afterAll(async () => {
  if (dir) await fs.rm(dir, { recursive: true, force: true });
});

describe("FFmpeg media engine", () => {
  it("probes real video and cached thumbnails, rejects audio-only input", async () => {
    expect(source.duration).toBeCloseTo(4, 1);
    expect(source.hasAudio).toBe(true);
    expect(silent.hasAudio).toBe(false);
    expect(source.width).toBe(320);
    expect(source.fps).toBe(30);
    expect((await probeMedia(source.path, path.join(dir, "cache"))).id).toBe(
      source.id,
    );
    expect((await fs.stat(source.thumbnail!)).size).toBeGreaterThan(100);
    const audio = path.join(dir, "only.wav");
    await exec(ffmpegPath, [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      source.path,
      "-vn",
      audio,
    ]);
    await expect(probeMedia(audio, dir)).rejects.toThrow(/faixa de vídeo/);
  });
  it("detects real source silence and handles absent audio", async () => {
    const ranges = await detectSilences(source);
    expect(
      ranges.some(
        (r) => r.start > 0.9 && r.start < 1.2 && r.end > 1.9 && r.end < 2.2,
      ),
    ).toBe(true);
    expect(await detectSilences(silent)).toEqual([]);
  });
  it("generates and reuses an H264/MP4 preview proxy for incompatible containers with original timing", async () => {
    const mkv = path.join(dir, "incompatible.mkv");
    await exec(ffmpegPath, [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      source.path,
      "-c",
      "copy",
      mkv,
    ]);
    const media = await probeMedia(mkv, path.join(dir, "cache"));
    expect(media.path).toBe(mkv);
    expect(media.proxy).toMatch(/-preview\.mp4$/);
    const proxy = await probeMedia(media.proxy!, path.join(dir, "cache"));
    expect(Math.abs(proxy.duration - media.duration)).toBeLessThan(0.1);
    expect(proxy.hasAudio).toBe(true);
    const before = (await fs.stat(media.proxy!)).mtimeMs;
    expect((await probeMedia(mkv, path.join(dir, "cache"))).proxy).toBe(
      media.proxy,
    );
    expect((await fs.stat(media.proxy!)).mtimeMs).toBe(before);
  }, 30000);
  it("cancels metadata probes and an active proxy import without leaving partial proxy output", async () => {
    const cancelled = new AbortController();
    cancelled.abort();
    await expect(
      probeMedia(source.path, dir, { signal: cancelled.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    const mkv = path.join(dir, "cancel-import.mkv"),
      cache = path.join(dir, "cancel-import-cache");
    await exec(ffmpegPath, [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      source.path,
      "-c",
      "copy",
      mkv,
    ]);
    const controller = new AbortController();
    let sawProxy = false;
    const poll = setInterval(() => {
      void fs
        .readdir(cache)
        .then((files) => {
          if (files.some((file) => file.startsWith(".proxy-"))) {
            sawProxy = true;
            controller.abort();
          }
        })
        .catch(() => undefined);
    }, 2);
    try {
      await expect(
        probeMedia(mkv, cache, { signal: controller.signal }),
      ).rejects.toMatchObject({ name: "AbortError" });
    } finally {
      clearInterval(poll);
    }
    expect(sawProxy).toBe(true);
    expect(
      (await fs.readdir(cache)).filter(
        (file) => file.startsWith(".proxy-") || file.endsWith("-preview.mp4"),
      ),
    ).toEqual([]);
  }, 30000);
  it("chains atempo within supported bounds and escapes ASS user syntax", () => {
    expect(tempoFilters(12)).toBe(
      "atempo=2,atempo=2,atempo=2,atempo=1.50000000",
    );
    const p = fixture();
    p.settings.captions = true;
    p.overlays = [
      {
        id: "x",
        kind: "title",
        text: "{injection} \\ N\nAula",
        start: 0.2,
        end: 1.4,
      },
    ];
    const ass = createAss(p, [
      { text: "Olá", mediaId: source.id, start: 1.25, end: 1.6 },
    ]);
    expect(ass).toContain("0:00:01.25,0:00:01.60");
    expect(ass).toContain("｛injection｝");
    expect(ass).not.toContain("{injection}");
    p.overlays = [
      {
        id: "flow",
        kind: "flow",
        text: "Entrada → Agente → Resultado",
        start: 0,
        end: 3,
      },
    ];
    p.clips[0].speed = 4;
    p.clips[0].muted = true;
    const motion = createAss(p);
    expect(motion).toContain(">> 4x");
    expect(motion).toContain("Entrada");
    p.clips[0].speed = 3;
    expect(createAss(p)).not.toContain(">> 3x");
  });
  it("exports real cut/speed/zoom/mute/motions/captions with synchronized duration and normalized audio", async () => {
    let p = fixture();
    p.clips = [
      { ...p.clips[0], end: 1, zoom: 1.25, focusX: 0.2 },
      { ...p.clips[0], id: "b", start: 1, end: 3, speed: 2, muted: true },
      { ...p.clips[0], id: "c", start: 3, end: 4 },
    ];
    p.words = [{ text: "Olá", mediaId: source.id, start: 0.2, end: 0.6 }];
    p.settings.captions = true;
    for (const [index, kind] of (
      ["title", "statement", "callout", "flow", "promo", "cover"] as const
    ).entries())
      p = applyCommand(p, {
        name: "overlay",
        args: {
          kind,
          text: "Olá, ação → resultado",
          start: index * 0.4,
          end: index * 0.4 + 0.35,
        },
      });
    const out = path.join(dir, "result's export.mp4"),
      progress: number[] = [];
    await exportProject(p, out, {
      onProgress: (value) => progress.push(value),
    });
    const result = await probeMedia(out, path.join(dir, "cache"));
    expect(result.duration).toBeCloseTo(projectDuration(p), 1);
    expect(result.width).toBe(320);
    expect(result.height).toBe(180);
    expect(result.hasAudio).toBe(true);
    expect(progress.at(-1)).toBe(100);
    const { stdout } = await exec(ffprobePath, [
      "-v",
      "error",
      "-show_streams",
      "-of",
      "json",
      out,
    ]);
    const streams = JSON.parse(stdout).streams as {
      codec_type: string;
      duration: string;
    }[];
    expect(
      Math.abs(
        Number(streams.find((s) => s.codec_type === "audio")!.duration) -
          Number(streams.find((s) => s.codec_type === "video")!.duration),
      ),
    ).toBeLessThan(0.06);
    const measure = await exec(ffmpegPath, [
      "-hide_banner",
      "-i",
      out,
      "-af",
      "loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json",
      "-vn",
      "-f",
      "null",
      "-",
    ]);
    const loudness = JSON.parse(
      measure.stderr.match(/\{[^{}]*"input_i"[^{}]*\}/g)!.at(-1)!,
    );
    expect(Math.abs(Number(loudness.input_i) + 14)).toBeLessThan(1.2);
  }, 120000);
  it("exports video without an original audio stream using a silent stereo track", async () => {
    const p = fixture(silent);
    p.clips[0].end = 0.5;
    const out = path.join(dir, "no-audio.mp4");
    await exportProject(p, out);
    const result = await probeMedia(out, dir);
    expect(result.hasAudio).toBe(true);
    expect(result.duration).toBeCloseTo(0.5, 1);
  }, 30000);
  it("cancels before and during rendering without replacing existing output or leaving temporary files", async () => {
    const out = path.join(dir, "preserved.mp4");
    await fs.writeFile(out, "original");
    const cancelled = new AbortController();
    cancelled.abort();
    await expect(
      exportProject(fixture(), out, { signal: cancelled.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    const controller = new AbortController();
    await expect(
      exportProject(fixture(), out, {
        signal: controller.signal,
        onProgress: (progress) => {
          if (progress > 0) controller.abort();
        },
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(await fs.readFile(out, "utf8")).toBe("original");
    expect(
      (await fs.readdir(dir)).filter((name) =>
        name.startsWith(".cutroom-export-"),
      ),
    ).toEqual([]);
    await expect(exportProject(fixture(), source.path)).rejects.toThrow(
      /sobrescrever/,
    );
  }, 30000);
});

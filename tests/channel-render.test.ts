import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ChannelStore } from "../electron/core/channel/channel-store";
import { assignMusic, acquireRenderLock, mixAudio, renderEpisode, renderScenes, renderWorkers, type SceneRenderer } from "../electron/core/channel/episode-render";
import { durationOf, ffmpeg, ffprobeJson, measureLoudness } from "../electron/core/channel/ffmpeg";
import { JobRunner } from "../electron/core/channel/jobs";
import { compileEpisodeScenes, sceneMetaSchema } from "../electron/core/channel/scene-compiler";
import { saveScript } from "../electron/core/channel/script-writer";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});
async function tmp(prefix = "channel-render-") {
  const d = await mkdtemp(join(tmpdir(), prefix));
  roots.push(d);
  return d;
}

/** Fake HyperFrames: a 320×180 clip with exactly the scene's frames. */
function fakeRenderer(log: string[], failOnce = new Set<string>()): SceneRenderer {
  return async (dir, output, { signal }) => {
    const meta = sceneMetaSchema.parse(JSON.parse(await readFile(join(dir, "scene.json"), "utf8")));
    log.push(meta.beatId);
    if (failOnce.delete(meta.beatId)) throw new Error("Chrome caiu");
    await ffmpeg(["-y", "-f", "lavfi", "-i", "color=c=0x223344:s=320x180:r=30", "-frames:v", String(meta.frames), "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", output], { signal });
  };
}

describe("workers, lock and jobs", () => {
  it("uses physical cores − 1 between 2 and 6", () => {
    expect(renderWorkers(4)).toBe(2);
    expect(renderWorkers(16)).toBe(6);
    expect(renderWorkers(10)).toBe(4);
  });

  it("never runs two renders of the same episode; a dead process's lock is taken over", async () => {
    const dir = await tmp();
    const release = await acquireRenderLock(dir);
    await expect(acquireRenderLock(dir)).rejects.toMatchObject({ code: "RENDER_LOCKED" });
    await release();
    await writeFile(join(dir, "render.lock"), JSON.stringify({ pid: 999999, at: "x" }));
    const again = await acquireRenderLock(dir);
    await again();
  });

  it("runs, persists, dedupes, cancels and resumes jobs", async () => {
    const dir = await tmp("jobs-");
    const runner = new JobRunner(dir);
    let calls = 0;
    runner.register("render", async (input, ctx) => {
      calls++;
      ctx.progress(0.5, "metade");
      ctx.addCost(0.25);
      if ((input as { slow?: boolean }).slow) await new Promise((done, fail) => ctx.signal.addEventListener("abort", () => fail(new Error("cancelado"))));
      return { ok: input };
    });
    const a = await runner.start("render", { n: 1 }, { episodeId: "ep_abcd" });
    const done = await a.promise;
    expect(done).toMatchObject({ status: "completed", progress: 1, costUsd: 0.25, result: { ok: { n: 1 } } });
    expect((await runner.get(a.job.id))?.log).toContain("metade");

    const slow = await runner.start("render", { slow: true }, { episodeId: "ep_wxyz" });
    const dup = await runner.start("render", { slow: true }, { episodeId: "ep_wxyz" });
    expect(dup.job.id).toBe(slow.job.id);
    expect(runner.cancel(slow.job.id)).toBe(true);
    expect((await slow.promise).status).toBe("cancelled");

    // A job left "running" by a closed app is resumed by a new runner.
    await writeFile(join(dir, "job_zzzz1111.json"), JSON.stringify({ id: "job_zzzz1111", stage: "render", status: "running", progress: 0.3, startedAt: new Date().toISOString(), log: [], costUsd: 0, input: { n: 2 }, episodeId: "ep_qqqq" }));
    const fresh = new JobRunner(dir);
    fresh.register("render", async (input) => ({ resumed: input }));
    expect(await fresh.resumeInterrupted()).toEqual(["job_zzzz1111"]);
    const resumed = await fresh.wait("job_zzzz1111", 5000);
    expect(resumed).toMatchObject({ status: "completed", result: { resumed: { n: 2 } } });
    expect(calls).toBe(2);
  });
});

async function episode(beatsCount = 4, seconds = 2) {
  const dir = await tmp();
  const store = new ChannelStore(dir);
  const c = await store.createChannel("default", { name: "Canal", handle: "canal" });
  const ep = await store.createEpisode("default", c.id, { title: "x" });
  const ids = { profileId: "default", channelId: c.id, episodeId: ep.id };
  const epDir = store.episodeDir("default", c.id, ep.id);
  const sections = ["gancho", "contexto", "tese", "lado-bom"];
  await saveScript(store, ids, { beats: Array.from({ length: beatsCount }, (_, i) => ({ section: sections[Math.min(3, Math.floor(i / 2))], text: `Fala ${i + 1}.`, scene: { type: "title" as const, data: { lines: [{ text: `Fala ${i + 1}` }] }, media: [] }, cta: i === beatsCount - 1 ? ("endscreen" as const) : undefined })).map((b, i) => (i === beatsCount - 1 ? { ...b, scene: { type: "cta" as const, data: { kind: "endscreen" }, media: [] } } : b)) });
  await store.mutateEpisodeFile("default", c.id, ep.id, "script", () => { throw new Error(); }, (s) => {
    s.beats.forEach((b, i) => (b.timing = { start: i * seconds, end: i * seconds + seconds * 0.8, cut: (i + 1) * seconds - 0.06, words: [] }));
  });
  await mkdir(join(epDir, "audio"), { recursive: true });
  await mkdir(join(epDir, "media"), { recursive: true });
  const audioSec = beatsCount * seconds;
  await ffmpeg(["-y", "-f", "lavfi", "-i", `sine=frequency=180:duration=${audioSec}`, "-af", "volume=0.3", "-ac", "1", "-ar", "44100", join(epDir, "audio", "narracao.wav")]);
  await ffmpeg(["-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=5", "-c:a", "libmp3lame", join(epDir, "media", "m_music1.mp3")]);
  await store.writeEpisodeFile("default", c.id, ep.id, "licenses", { schemaVersion: 1, items: [{ id: "m_music1", kind: "music", file: "media/m_music1.mp3", source: "incompetech", sourceUrl: "u", author: "Kevin MacLeod", license: "CC BY", licenseUrl: "", attribution: "a", usedIn: [] }] });
  const kit = { gsap: createRequire(import.meta.url).resolve("gsap/dist/gsap.min.js"), fontsDir: resolve("resources/film-kit/fonts") };
  await compileEpisodeScenes(store, ids, kit, { audioDuration: audioSec });
  return { store, ids, epDir, audioSec, kit };
}

describe("episode render", () => {
  it("renders scenes in parallel, concatenates exactly, mixes at −16 LUFS and makes a preview", async () => {
    const { store, ids, epDir, audioSec } = await episode();
    const log: string[] = [];
    const out = await renderEpisode(store, ids, { render: fakeRenderer(log), workers: 3 });
    expect(log.sort()).toEqual(["b_001", "b_002", "b_003", "b_004"]);
    // Last scene is the end screen: + 12 s.
    expect(out.durationSec).toBeCloseTo(audioSec + 12, 2);
    expect(await durationOf(out.video)).toBeCloseTo(audioSec + 12, 1);
    expect(Math.abs(out.lufs + 16)).toBeLessThanOrEqual(1);
    const probe = await ffprobeJson(out.video);
    expect(probe.streams.map((s) => s.codec_type).sort()).toEqual(["audio", "video"]);
    expect(out.preview).toBeTruthy();
    const ep = await store.getEpisode(ids.profileId, ids.channelId, ids.episodeId);
    expect(ep.outputs.video).toBe("out/video.mp4");
    expect(ep.stages.render.status).toBe("ok");
    const progress = JSON.parse(await readFile(join(epDir, "out", "render-progress.json"), "utf8"));
    expect(progress).toMatchObject({ done: 4, total: 4 });

    // Idempotent: a second call renders nothing (cache by hash).
    const again = await renderEpisode(store, ids, { render: fakeRenderer(log), workers: 3, preview: false });
    expect(again.scenes).toMatchObject({ rendered: 0, cached: 4 });
  }, 400_000);

  it("changing only one beat's scene re-renders only that scene", async () => {
    const { store, ids, kit, audioSec } = await episode();
    const log: string[] = [];
    await renderEpisode(store, ids, { render: fakeRenderer(log), workers: 2, preview: false });
    await store.mutateEpisodeFile(ids.profileId, ids.channelId, ids.episodeId, "script", () => { throw new Error(); }, (s) => {
      s.beats[1].scene.data = { lines: [{ text: "Outra fala" }] };
    });
    await compileEpisodeScenes(store, ids, kit, { audioDuration: audioSec });
    log.length = 0;
    const out = await renderEpisode(store, ids, { render: fakeRenderer(log), workers: 2, preview: false });
    expect(log).toEqual(["b_002"]);
    expect(out.scenes).toMatchObject({ rendered: 1, cached: 3 });
  }, 400_000);

  it("retries a failed scene with 1 worker and resumes after an interruption without losing scenes", async () => {
    const { store, ids, epDir } = await episode(6, 1);
    const log: string[] = [];
    // Interrupt after 2 scenes are done (the app closing mid-render).
    const controller = new AbortController();
    const slow: SceneRenderer = async (dir, output, opts) => {
      await fakeRenderer(log)(dir, output, opts);
      if (log.length >= 2) controller.abort();
    };
    await expect(renderEpisode(store, ids, { render: slow, workers: 1, signal: controller.signal, preview: false })).rejects.toThrow();
    expect((await readdir(join(epDir, "cache"))).filter((f) => !f.includes("partial"))).toHaveLength(2);
    // Lock was released; the next run reuses the 2 finished scenes; b_004 fails once and is retried.
    log.length = 0;
    const out = await renderEpisode(store, ids, { render: fakeRenderer(log, new Set(["b_004"])), workers: 2, preview: false });
    expect(out.scenes).toMatchObject({ rendered: 4, cached: 2 });
    expect(log.filter((b) => b === "b_004")).toHaveLength(2);
  }, 400_000);

  it("a scene that keeps failing does not stop the others and is reported", async () => {
    const dir = await tmp();
    const metas = ["b_001", "b_002"].map((beatId, i) => ({ beatId, hash: `h${i}`, duration: 1, startFrame: i * 30, frames: 30, sfx: [], texts: [], warnings: [] }));
    for (const m of metas) {
      await mkdir(join(dir, "scenes", m.beatId), { recursive: true });
      await writeFile(join(dir, "scenes", m.beatId, "scene.json"), JSON.stringify(m));
    }
    const res = await renderScenes(dir, metas, async (sceneDir, output, opts) => {
      if (sceneDir.endsWith("b_001")) throw new Error("sempre falha");
      await fakeRenderer([])(sceneDir, output, opts);
    }, { workers: 2 });
    expect(res.failed).toEqual([{ beatId: "b_001", error: "sempre falha" }]);
    expect(res.rendered).toBe(1);
    const timeout = await renderScenes(dir, [{ ...metas[0], hash: "h9" }], (_d, _o, { signal }) => new Promise((_r, fail) => signal.addEventListener("abort", () => fail(new Error("x")))), { timeoutMs: 30 });
    expect(timeout.failed[0].error).toBe("tempo esgotado (120 s)");
  }, 60_000);
});

describe("mix", () => {
  it("music per section, louder on the end screen, ducked under the voice, normalized", async () => {
    const dir = await tmp();
    const voice = join(dir, "v.wav");
    const music = join(dir, "m.mp3");
    await ffmpeg(["-y", "-f", "lavfi", "-i", "sine=frequency=200:duration=4", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono", "-filter_complex", "[0][1]concat=n=2:v=0:a=1,atrim=0:8", "-ac", "1", voice]);
    await ffmpeg(["-y", "-f", "lavfi", "-i", "sine=frequency=600:duration=3", "-c:a", "libmp3lame", music]);
    expect(assignMusic([{ from: 0, to: 2 }, { from: 2, to: 5 }, { from: 5, to: 8 }], [music, music], 8)).toEqual([{ file: music, from: 0, to: 5 }, { file: music, from: 5, to: 8 }]);
    const out = await mixAudio({ narration: voice, music: [{ file: music, from: 0, to: 8 }], duration: 8, endscreenAt: 6, output: join(dir, "mix.wav"), lufs: -16 });
    expect(await durationOf(out)).toBeCloseTo(8, 1);
    expect(Math.abs((await measureLoudness(out)).lufs + 16)).toBeLessThan(1.5);
  }, 60_000);
});

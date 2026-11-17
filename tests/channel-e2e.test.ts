import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { ChannelStore } from "../electron/core/channel/channel-store";
import { CHANNEL_TOOLS, createChannelToolDispatcher } from "../electron/core/channel/channel-tools";
import type { SceneRenderer } from "../electron/core/channel/episode-render";
import { durationOf, ffmpeg, ffprobeJson, measureLoudness } from "../electron/core/channel/ffmpeg";
import { JobRunner } from "../electron/core/channel/jobs";
import type { Speaker } from "../electron/core/channel/narration";
import type { BenchRunner } from "../electron/core/channel/qa";
import { sceneMetaSchema } from "../electron/core/channel/scene-compiler";
import { EDITOR_TOOLS } from "../electron/core/codex";

/**
 * E2E of the channel studio driven only through the MCP tools, as Claude Code or Codex would:
 * channel → idea → episode → facts → script → media → approvals → narration → alignment →
 * scenes → QA → render → package → Shorts, then one beat changed and re-rendered.
 * Voice, transcription and scene rendering are simulated (no keys, no Chrome); FFmpeg is real.
 */

const roots: string[] = [];
afterAll(async () => {
  await Promise.all(roots.map((d) => rm(d, { recursive: true, force: true })));
});

const P = "default";
const WORD_SEC = 0.3;

const speaker: Speaker = async (text) => {
  const dir = await mkdtemp(join(tmpdir(), "e2e-tts-"));
  roots.push(dir);
  const f = join(dir, "a.wav");
  // One 0.25 s tone per word with a 0.05 s pause, so the fake transcriber can "hear" each word.
  const words = text.split(/\s+/).filter(Boolean).length;
  await ffmpeg(["-y", "-f", "lavfi", "-i", `aevalsrc='0.4*sin(2*PI*190*t)*lt(mod(t\,${WORD_SEC})\,0.25)':s=22050:d=${(words * WORD_SEC).toFixed(2)}`, f]);
  return { audio: new Uint8Array(await readFile(f)), extension: "wav" };
};

async function hearWords(file: string, words: string[]) {
  const { spawn } = await import("node:child_process");
  const { ffmpegPath } = await import("../electron/core/media");
  const log = await new Promise<string>((done) => {
    const child = spawn(ffmpegPath, ["-hide_banner", "-nostats", "-i", file, "-af", "silencedetect=n=-35dB:d=0.03", "-f", "null", "-"], { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    child.stderr.on("data", (d: Buffer) => (err += d.toString()));
    child.once("close", () => done(err));
  });
  const total = await durationOf(file);
  const silences = [...log.matchAll(/silence_start: ([\d.]+)[\s\S]*?silence_end: ([\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
  const segments: [number, number][] = [];
  let at = 0;
  for (const [a, b] of silences) {
    if (a - at > 0.05) segments.push([at, a]);
    at = b;
  }
  if (total - at > 0.05) segments.push([at, total]);
  return segments.slice(0, words.length).map(([a, b], i) => ({ text: words[i], start: a, end: b }));
}

describe("channel studio end to end through the MCP tools", () => {
  it("every channel tool is exposed to the agents and has a unique name", () => {
    const names = EDITOR_TOOLS.map((t) => t.name);
    for (const t of CHANNEL_TOOLS) expect(names.filter((n) => n === t.name)).toHaveLength(1);
    expect(new Set(names).size).toBe(names.length);
  });

  it("makes a ~2 min episode, its package and 2 Shorts, then re-renders one changed beat", async () => {
    const dir = await mkdtemp(join(tmpdir(), "channel-e2e-"));
    roots.push(dir);
    const store = new ChannelStore(dir);
    const jobs = new JobRunner(join(dir, "jobs"));
    const rendered: string[] = [];
    const renderer: SceneRenderer = async (sceneDir, output, { signal }) => {
      const meta = sceneMetaSchema.parse(JSON.parse(await readFile(join(sceneDir, "scene.json"), "utf8")));
      rendered.push(meta.beatId);
      await ffmpeg(["-y", "-f", "lavfi", "-i", "testsrc2=s=480x270:r=30", "-frames:v", String(meta.frames), "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", output], { signal });
    };
    const bench: BenchRunner = async (scenes, o) => {
      const out = [];
      for (const s of scenes) {
        const frames = [];
        for (const [i, t] of s.times.entries()) {
          const file = s.output ? join(s.output, `q${i}.png`) : undefined;
          if (file) {
            await (await import("node:fs/promises")).mkdir(s.output!, { recursive: true });
            await ffmpeg(["-y", "-f", "lavfi", "-i", `color=c=0x224466:s=${Math.round(o.width * o.scale)}x${Math.round(o.height * o.scale)}`, "-frames:v", "1", file]);
          }
          frames.push({ t, file, boxes: [], layers: 2 });
        }
        out.push({ directory: s.directory, duration: 1, frames, errors: [] });
      }
      return out;
    };
    const tool = createChannelToolDispatcher({
      store,
      jobs,
      secret: async () => undefined,
      kit: { gsap: createRequire(import.meta.url).resolve("gsap/dist/gsap.min.js"), fontsDir: resolve("resources/film-kit/fonts") },
      runner: async () => {
        throw new Error("sem Chrome no teste");
      },
      transcriber: async () => async (file) => {
        // "Hears" each tone as a word (silencedetect) and labels them with the script's words in order.
        const s = await store.readEpisodeFile(P, channelId, episodeId, "script");
        const words = s!.beats.flatMap((b) => (b.say ?? b.text).split(/\s+/).filter(Boolean));
        return hearWords(file, words);
      },
      speaker: async () => speaker,
      renderer,
      bench,
      waitMs: 120_000,
    });
    const call = (name: string, args: Record<string, unknown> = {}) => tool(name, { profileId: P, ...args }) as Promise<Record<string, unknown>>;

    // Channel, idea, episode.
    const channel = await call("channel_create", { name: "Vale a Pena Morar?", handle: "valeapenamorarem", niche: "cidades do Brasil", longMinMinutes: 1.5 });
    const channelId = channel.id as string;
    await call("channel_update", { channelId, patch: { defaults: { voiceId: "kokoro:pm_alex" }, identity: { palette: ["#0F1115", "#F4F1EA", "#FFC93C", "#FF4D4D", "#36D399"] } } });
    const { added } = await call("backlog_update", { channelId, add: [{ title: "Niterói vale a pena?", angle: "a cidade cara que não é tão cara", whyClick: "contradição", score: 82 }] });
    const ep = await call("channel_episode_create", { channelId, title: "Niterói vale a pena?", ideaId: (added as string[])[0] });
    const episodeId = ep.id as string;
    const E = { channelId, episodeId };

    // Facts the agent researched.
    const facts = await call("research_add_facts", { ...E, facts: [
      { claim: "População de Niterói no Censo", value: "481.749", unit: "habitantes", dataDate: "2022", source: { url: "https://www.ibge.gov.br/cidades/niteroi", publisher: "IBGE", title: "Cidades" } },
      { claim: "Tempo médio na ponte no pico", value: 50, unit: "minutos", dataDate: "2025", source: { url: "https://www.niteroi.rj.gov.br/mobilidade", publisher: "Prefeitura de Niterói", title: "Mobilidade" } },
    ] });
    const [fPop, fPonte] = facts.added as string[];
    expect((facts.summary as { alta: number }).alta).toBe(2);
    const brief = (await call("script_generate", E)).brief as { structure: { section: string }[]; facts: unknown[] };
    expect(brief.structure).toHaveLength(8);
    expect(brief.facts).toHaveLength(2);

    // Script: 8 movements, ≥ 1/3 real images, numbers with facts, CTAs after 1:00, end screen last.
    const filler = "e isso pesa na rotina de quem mora ali todos os dias";
    const sections = brief.structure.map((m) => m.section);
    const photo = (q: string) => ({ type: "photo", data: { move: "in" }, media: [], query: q, place: "Niterói" });
    const title = (t: string) => ({ type: "title", data: { lines: [{ text: t }] }, media: [] });
    const beats: Record<string, unknown>[] = [
      { section: "gancho", text: "A cidade mais cara do Rio pode não ser a capital.", scene: photo("Niterói aérea") },
      { section: "gancho", text: "São 481.749 pessoas e 50 minutos de ponte. Vale a pena? Fica até o final.", facts: [fPop, fPonte], scene: { type: "stat", data: { value: 481749, label: "habitantes" }, media: [] } },
    ];
    let k = 0;
    const ORD = ["um", "dois", "três", "quatro"];
    for (const s of sections.slice(1, -1))
      for (let i = 0; i < 4; i++) {
        k++;
        beats.push({ section: s, text: `Na parte ${s} o ponto ${ORD[i]} mostra ${filler}.`, scene: k % 3 === 0 ? photo(`Niterói ${s}`) : title(`${s} ${ORD[i]}`) });
      }
    beats.splice(17, 0, { section: "virada", text: "Comenta aí de qual cidade você está assistindo agora.", cta: "comment", scene: { type: "cta", data: { kind: "comment", examples: ["Recife", "Niterói"] }, media: [] } });
    beats.push({ section: "assinatura", text: "E você, moraria em Niterói? Tem outro vídeo aqui.", cta: "endscreen", scene: { type: "cta", data: { kind: "endscreen" }, media: [] } });
    // Real images on ≥ 1/3 of the beats.
    beats.forEach((b, i) => {
      if (i % 3 === 2 && (b.scene as { type: string }).type === "title") b.scene = photo(`Niterói ${i}`);
    });
    const saved = await call("script_save", { ...E, beats, wpm: 60 / WORD_SEC });
    const review = saved.review as { ok: boolean; issues: { level: string; code: string }[] };
    expect(review.issues.filter((i) => i.level === "erro")).toEqual([]);

    // Media: the user's own photos for every photo beat.
    const img = join(dir, "foto.jpg");
    await ffmpeg(["-y", "-f", "lavfi", "-i", "testsrc2=size=1920x1080", "-frames:v", "1", img]);
    const script = (await call("script_get", { ...E, page: 1 })) as { beats: { id: string; scene: { type: string } }[]; pages: number };
    const all = [...script.beats];
    for (let p = 2; p <= script.pages; p++) all.push(...((await call("script_get", { ...E, page: p })) as typeof script).beats);
    for (const b of all.filter((x) => x.scene.type === "photo")) await call("media_import", { ...E, file: img, kind: "photo", beatId: b.id, place: "Niterói", author: "Canal" });
    const music = join(dir, "trilha.mp3");
    await ffmpeg(["-y", "-f", "lavfi", "-i", "sine=frequency=330:duration=100", "-af", "volume=0.2", "-c:a", "libmp3lame", music]);
    await call("media_import", { ...E, file: music, kind: "music" });

    // Approvals in order; the pipeline stops where an approval is missing.
    await expect(call("episode_approve", { ...E, gate: "frames" })).rejects.toThrow(/APPROVAL_TOO_EARLY/);
    await call("episode_approve", { ...E, gate: "script" });
    const run = await call("pipeline_run", { ...E, from: "narration", to: "render" });
    expect(run.status).toBe("completed");
    expect(run.result).toMatchObject({ done: ["narration", "align", "scenes", "qa"], stoppedAt: "render" });
    const sheet = await call("frames_sheet", E);
    expect((sheet.sheets as string[]).length).toBeGreaterThan(0);
    await expect(call("episode_render", E)).rejects.toThrow(/APPROVAL_REQUIRED/);
    await call("episode_approve", { ...E, gate: "frames" });

    const render = await call("episode_render", E);
    expect(render.status).toBe("completed");
    const res = render.result as { durationSec: number; video: string; lufs: number };
    expect(res.durationSec).toBeGreaterThan(90);
    expect(res.durationSec).toBeLessThan(170);
    expect(Math.abs(res.lufs + 16)).toBeLessThanOrEqual(1);
    const epDir = store.episodeDir(P, channelId, episodeId);
    expect((await ffprobeJson(join(epDir, "out", "video.mp4"))).streams.length).toBe(2);
    expect((await stat(join(epDir, "out", "preview.mp4"))).size).toBeGreaterThan(1000);

    // Package and Shorts.
    const pkg = await call("package_generate", { ...E, titles: ["Niterói é mais cara que o Rio?", "A cidade do outro lado da ponte", "Vale a pena morar em Niterói?"], thumbs: [{ lines: ["MAIS CARA", "QUE O RIO?"] }, { lines: ["50 MINUTOS", "DE PONTE"] }, { lines: ["VALE", "A PENA?"] }], intro: "Niterói tem fama de cidade cara. Os dados mostram outra história.", hashtags: ["niteroi", "rio", "cidades"], tags: ["niterói", "morar em niterói", "custo de vida", "icaraí", "rio de janeiro", "cidades do brasil", "vale a pena morar", "ponte rio niterói", "mudança", "brasil"] });
    expect(pkg.status).toBe("completed");
    const pkgFile = (await call("package_get", E)) as { description: string; chapters: { t: number }[]; thumbs: unknown[] };
    expect(pkgFile.description).toContain("FONTES\nIBGE — Cidades (2022)");
    expect(pkgFile.description).toContain("Prefeitura de Niterói — Mobilidade (2025)");
    expect(pkgFile.chapters[0].t).toBe(0);
    expect(pkgFile.chapters.length).toBeGreaterThanOrEqual(3);
    expect(pkgFile.thumbs).toHaveLength(3);
    const shorts = await call("shorts_cut", E);
    expect(shorts.status).toBe("completed");
    const cuts = (shorts.result as { shorts: { file: string; duration: number }[] }).shorts;
    expect(cuts).toHaveLength(2);
    for (const c of cuts) {
      expect(c.duration).toBeGreaterThanOrEqual(40);
      expect(c.duration).toBeLessThanOrEqual(58);
      expect(Math.abs((await measureLoudness(join(epDir, c.file))).lufs + 14)).toBeLessThanOrEqual(1);
    }
    const status = await call("episode_status", E);
    expect(status.stages).toMatchObject({ research: "ok", script: "ok", narration: "ok", align: "ok", scenes: "ok", qa: "ok", render: "ok", package: "ok", shorts: "ok" });

    // Change one beat and re-render: only that beat is narrated again; only changed scenes render.
    const target = all[10].id;
    await call("script_edit_beats", { ...E, edits: [{ op: "update", id: target, patch: { text: "Na minha visão este trecho mudou e ficou mais curto." } }] });
    const t0 = Date.now();
    rendered.length = 0;
    const redo = await call("narration_redo_beats", E);
    expect((redo.result as { redone: string[] }).redone).toEqual([target]);
    const recompiled = await call("scenes_compile", E);
    expect((recompiled.result as { errors: number }).errors).toBe(0);
    await call("qa_run", { ...E, beatIds: [target] });
    const again = await call("episode_render", E);
    expect(again.status).toBe("completed");
    expect(rendered).toContain(target);
    expect(rendered.length).toBeLessThan(all.length);
    // Timing is measured on the real renderer (with fakes and a busy CI this is only informative).
    console.log(`re-render de 1 fala: ${Math.round((Date.now() - t0) / 1000)} s, ${rendered.length} de ${all.length} cenas`);
  }, 900_000);

  it("a long tool answers within the wait with a job id and keeps running", async () => {
    const dir = await mkdtemp(join(tmpdir(), "channel-e2e-wait-"));
    roots.push(dir);
    const store = new ChannelStore(dir);
    const jobs = new JobRunner(join(dir, "jobs"));
    const tool = createChannelToolDispatcher({ store, jobs, secret: async () => undefined, kit: { gsap: "", fontsDir: "" }, runner: async () => ({ worker: "", browser: "" }), transcriber: async () => async () => [], speaker: async () => speaker, waitMs: 50 });
    const c = (await tool("channel_create", { profileId: P, name: "Canal", voiceId: "kokoro:pm_alex" })) as { id: string };
    const ep = (await tool("channel_episode_create", { profileId: P, channelId: c.id, title: "x" })) as { id: string };
    await tool("script_save", { profileId: P, channelId: c.id, episodeId: ep.id, beats: Array.from({ length: 6 }, (_, i) => ({ section: "gancho", text: `Fala ${i} com algumas palavras para narrar devagar aqui.` })) });
    const first = (await tool("narration_generate", { profileId: P, channelId: c.id, episodeId: ep.id })) as { jobId: string; status: string; next?: string };
    expect(first.status).toBe("running");
    expect(first.next).toMatch(/channel_job_status/);
    const dup = (await tool("narration_generate", { profileId: P, channelId: c.id, episodeId: ep.id })) as { jobId: string };
    expect(dup.jobId).toBe(first.jobId);
    const done = await jobs.wait(first.jobId, 60_000);
    expect(done?.status).toBe("completed");
    await expect(tool("channel_get", { profileId: P, channelId: "../x" })).rejects.toThrow(/INVALID_INPUT|inválid|Invalid/);
  }, 120_000);
});

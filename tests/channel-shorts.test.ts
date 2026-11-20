import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ChannelStore } from "../electron/core/channel/channel-store";
import { renderEpisode, type SceneRenderer } from "../electron/core/channel/episode-render";
import { ffmpeg, ffprobeJson, measureLoudness } from "../electron/core/channel/ffmpeg";
import { addFacts } from "../electron/core/channel/research";
import { compileEpisodeScenes, lookOf, sceneMetaSchema } from "../electron/core/channel/scene-compiler";
import { saveScript } from "../electron/core/channel/script-writer";
import { candidateWindows, captionGroups, cutShorts, hookLines, pickWindows, scoreWindow, shortAss } from "../electron/core/channel/shorts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

const tb = (id: string, text: string, start: number, end: number, extra = {}) => ({ id, text, start, end, facts: [] as string[], section: "x", ...extra });

describe("short windows", () => {
  it("scores hook (40) + number/opinion (30) + closes on its own (30)", () => {
    const strong = scoreWindow([tb("b_1", "Niterói é mais cara que o Rio?", 0, 5), tb("b_2", "São 481 mil pessoas.", 5, 45, { facts: ["f_ab12"] })]);
    expect(strong.parts).toEqual({ hook: 32, strong: 30, alone: 30 });
    const weak = scoreWindow([tb("b_1", "E isso faz com que a cidade inteira fique parada por horas todos os dias da semana", 0, 5), tb("b_2", "de novo", 5, 45, { cta: "like" })]);
    expect(weak.score).toBeLessThan(20);
  });

  it("only 40–58 s windows on beat boundaries, never with the end screen; cut 1 = opening, no overlap", () => {
    const beats = Array.from({ length: 30 }, (_, i) => tb(`b_${i}`, i === 12 ? "O pior é que ninguém te conta isso? São 3 horas." : `Fala ${i}.`, i * 6, (i + 1) * 6, i === 12 ? { facts: ["f_x"] } : i === 29 ? { cta: "endscreen" } : {}));
    const all = candidateWindows(beats);
    expect(all.every((w) => w.end - w.start >= 40 && w.end - w.start <= 58)).toBe(true);
    expect(all.some((w) => w.beatIds.includes("b_29"))).toBe(false);
    const [a, b] = pickWindows(beats, 2);
    expect(a.from).toBe(0);
    expect(b.beatIds[0]).toBe("b_12");
    expect(b.from).toBeGreaterThan(a.to);
  });

  it("captions in groups of up to 3 words, breaking at punctuation; ASS has hook, captions and footer swap", () => {
    const words = "Niterói é cara, mas o Rio é pior.".split(" ").map((t, i) => ({ t, s: i * 0.4, e: i * 0.4 + 0.3 }));
    expect(captionGroups(words).map((g) => g.words.map((w) => w.t).join(" "))).toEqual(["Niterói é cara,", "mas o Rio", "é pior."]);
    const look = lookOf({ identity: { logo: "", banner: "", palette: ["#000000", "#FFFFFF", "#FFC93C"], fonts: { display: "Anton", body: "Instrument Sans" }, signature: "" }, name: "C", handle: "@canal" });
    const ass = shortAss({ hook: ["Mais cara", "que o Rio?"], chip: "Niterói", words, duration: 45, handle: "@canal", look });
    expect(ass).toContain("MAIS CARA\\N{\\c&H003CC9FF}QUE O RIO?");
    expect(ass).toContain("{\\pos(540,1650)}@canal");
    expect(ass).toContain("0:00:42.50,0:00:45.00,Foot,,0,0,0,,{\\pos(540,1650)\\c&H003CC9FF\\fs52}VÍDEO COMPLETO NO CANAL");
    expect(ass.match(/,Cap,/g)).toHaveLength(8);
    expect(hookLines("Niterói é mais cara que o Rio de Janeiro? Veja.")).toEqual(["Niterói é mais", "cara que o", "Rio de Janeiro?"]);
  });
});

describe("cut shorts end to end (fake scene renderer, real FFmpeg)", () => {
  it("reuses cached scenes, 1080×1920, 40–58 s, −14 LUFS", async () => {
    const dir = await mkdtemp(join(tmpdir(), "channel-shorts-"));
    roots.push(dir);
    const store = new ChannelStore(dir);
    const c = await store.createChannel("default", { name: "Canal", handle: "canal" });
    const ep = await store.createEpisode("default", c.id, { title: "x" });
    const ids = { profileId: "default", channelId: c.id, episodeId: ep.id };
    const epDir = store.episodeDir("default", c.id, ep.id);
    const { added } = await addFacts(store, "default", c.id, ep.id, [{ claim: "Tempo na ponte", value: 3, source: { url: "https://www.niteroi.rj.gov.br/x", publisher: "Prefeitura" } }]);
    const N = 22;
    await saveScript(store, ids, { beats: Array.from({ length: N }, (_, i) => ({ section: ["gancho", "contexto", "tese", "lado-bom", "virada"][Math.min(4, Math.floor(i / 5))], text: i === 0 ? "Niterói é mais cara que o Rio?" : i === 10 ? "O pior: são 3 horas na ponte." : `Fala número ${i} do teste.`, facts: i === 10 ? [added[0]] : [], scene: { type: "title" as const, data: { lines: [{ text: `Fala ${i}` }] }, media: [] } })) });
    await store.mutateEpisodeFile("default", c.id, ep.id, "script", () => { throw new Error(); }, (s) => {
      s.beats.forEach((b, i) => (b.timing = { start: i * 5, end: i * 5 + 4, cut: (i + 1) * 5 - 0.06, words: [] }));
    });
    await mkdir(join(epDir, "audio"), { recursive: true });
    await ffmpeg(["-y", "-f", "lavfi", "-i", `sine=frequency=180:duration=${N * 5}`, "-af", "volume=0.3", "-ac", "1", join(epDir, "audio", "narracao.wav")]);
    const kit = { gsap: createRequire(import.meta.url).resolve("gsap/dist/gsap.min.js"), fontsDir: resolve("resources/film-kit/fonts") };
    await compileEpisodeScenes(store, ids, kit, { audioDuration: N * 5 });
    const rendered: string[] = [];
    const fake: SceneRenderer = async (sceneDir, output, { signal }) => {
      const meta = sceneMetaSchema.parse(JSON.parse(await readFile(join(sceneDir, "scene.json"), "utf8")));
      rendered.push(meta.beatId);
      await ffmpeg(["-y", "-f", "lavfi", "-i", "testsrc2=s=640x360:r=30", "-frames:v", String(meta.frames), "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", output], { signal });
    };
    await renderEpisode(store, ids, { render: fake, workers: 3, preview: false });
    const before = rendered.length;
    const out = await cutShorts(store, ids, { fontsDir: kit.fontsDir });
    expect(rendered.length).toBe(before); // no scene re-rendered
    expect(out.shorts).toHaveLength(2);
    expect(out.shorts[0].start).toBe(0);
    for (const s of out.shorts) {
      expect(s.duration).toBeGreaterThanOrEqual(40);
      expect(s.duration).toBeLessThanOrEqual(58);
      const f = join(epDir, s.file);
      const p = await ffprobeJson(f);
      const v = p.streams.find((x) => x.codec_type === "video")!;
      expect([v.width, v.height]).toEqual([1080, 1920]);
      expect(Number(p.format?.duration)).toBeCloseTo(s.duration, 0);
      expect(Math.abs((await measureLoudness(f)).lufs + 14)).toBeLessThanOrEqual(1);
    }
    expect((await store.getEpisode("default", c.id, ep.id)).outputs.shorts).toEqual(["out/shorts/short_1.mp4", "out/shorts/short_2.mp4"]);
    await expect(cutShorts(store, ids, { fontsDir: kit.fontsDir, windows: [{ beatIds: ["b_001", "b_003"] }] })).rejects.toMatchObject({ code: "SHORT_NOT_CONTIGUOUS" });
  }, 600_000);
});

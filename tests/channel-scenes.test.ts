import { mkdtemp, readFile, rm, stat, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it } from "vitest";
import { ChannelStore } from "../electron/core/channel/channel-store";
import { addFacts } from "../electron/core/channel/research";
import { FPS, frameDuration, compileEpisodeScenes, compileScene, cueTime, lookOf, planScenes, safeText, sceneHash, SceneError, type CompileInput, type SceneMedia } from "../electron/core/channel/scene-compiler";
import { saveScript } from "../electron/core/channel/script-writer";
import { COMPILED_SCENES, defaultBible, type Beat, type Fact } from "../src/shared/channel";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

const look = lookOf({ identity: { logo: "", banner: "", palette: ["#101010", "#FAFAFA", "#FFCC00"], fonts: { display: "Anton", body: "Instrument Sans" }, signature: "" }, name: "Vale a Pena Morar?", handle: "@valeapenamorarem" });
const photoM: SceneMedia = { id: "m_ph0001", kind: "photo", file: "media/m_ph0001.jpg", abs: "C:/x/media/m_ph0001.jpg", source: "commons", sourceUrl: "u", author: "Halley", license: "CC BY-SA", licenseUrl: "", attribution: "a", place: "Niterói", usedIn: [] };
const genericM: SceneMedia = { ...photoM, id: "m_ph0002", file: "media/m_ph0002.jpg", abs: "C:/x/media/m_ph0002.jpg", place: undefined };
const videoM: SceneMedia = { ...photoM, id: "m_vd0001", kind: "video", file: "media/m_vd0001.mp4", abs: "C:/x/media/m_vd0001.mp4", durationSec: 4, place: undefined };
const fact: Fact = { id: "f_ab12", claim: "População", value: 481749, source: { title: "", url: "https://ibge.gov.br", publisher: "IBGE", accessedAt: "x", kind: "oficial" }, dataDate: "2022", confirmations: [], confidence: "alta", usedIn: [] };
const words = "a populacao de niteroi chegou a quatrocentos e oitenta e um mil pessoas".split(" ").map((t, i) => ({ t, s: 0.3 + i * 0.3, e: 0.5 + i * 0.3 }));

function input(scene: Beat["scene"], extra: Partial<CompileInput> = {}): CompileInput {
  return {
    beat: { id: "b_001", text: "A população de Niterói chegou a 481 mil pessoas.", scene, facts: ["f_ab12"] },
    index: 0, startFrame: 0, frames: 150, words, look, aspect: "16:9",
    media: new Map([[photoM.id, photoM], [genericM.id, genericM], [videoM.id, videoM]]),
    facts: new Map([[fact.id, fact]]),
    ...extra,
  };
}

const SAMPLES: Record<(typeof COMPILED_SCENES)[number], Beat["scene"]> = {
  photo: { type: "photo", data: { move: "l", tag: "Niterói", caption: "Vista de Icaraí" }, media: ["m_ph0001"], place: "Niterói" },
  video: { type: "video", data: { clips: [{ media: "m_vd0001" }, { media: "m_vd0001", at: "quatro|400" }], big: "TRÂNSITO" }, media: ["m_vd0001"] },
  stat: { type: "stat", data: { value: 481749, label: "habitantes", at: "quatro" }, media: [] },
  title: { type: "title", data: { lines: [{ text: "Niterói ≠ Rio" }, { text: "mais cara", color: "accent", strike: true, at: "chegou" }], stamp: "Confirmado" }, media: [] },
  list: { type: "list", data: { title: "Vale para quem", items: [{ text: "trabalha na cidade", mark: "ok" }, { text: "depende da ponte", mark: "no", at: "pessoas" }] }, media: [] },
  cta: { type: "cta", data: { kind: "comment", examples: ["Recife", "Niterói"] }, media: [] },
};

describe("scene compiler", () => {
  it("compiles every type of the first set into a HyperFrames composition", () => {
    for (const type of COMPILED_SCENES) {
      const out = compileScene(input(SAMPLES[type]));
      expect(out.html).toContain('data-composition-id="scene"');
      expect(out.html).toContain('window.__timelines["scene"] = tl;');
      expect(out.html).toContain("gsap.timeline({ paused: true })");
      expect(out.html).toContain('blur(14px)');
      expect(out.duration).toBe(5);
      expect(out.html).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
    }
    for (const kind of ["subscribe", "like", "endscreen"] as const) expect(() => compileScene(input({ type: "cta", data: { kind }, media: [] }))).not.toThrow();
  });

  it("keeps the channel identity and the seal", () => {
    const out = compileScene(input(SAMPLES.title));
    expect(out.html).toContain("Vale a Pena Morar?");
    expect(out.html).toContain("@valeapenamorarem");
    expect(out.html).toContain("#FFCC00");
    expect(out.fonts).toEqual(["Anton-Regular.ttf", "InstrumentSans.ttf"]);
  });

  it("never shows fixed text from a component: every label is data of the beat", () => {
    const a = compileScene(input(SAMPLES.title));
    const b = compileScene(input({ type: "title", data: { lines: [{ text: "Serra" }, { text: "Vitória" }] }, media: [] }));
    expect(a.html).not.toMatch(/SERRA|Serra|Vitória/);
    expect(b.texts).toEqual(["Serra", "Vitória"]);
    const cmt = compileScene(input(SAMPLES.cta));
    expect(cmt.html).toContain('"Recife"');
    const other = compileScene(input({ type: "cta", data: { kind: "comment", examples: ["Vitória"] }, media: [] }));
    expect(other.html).not.toContain("Recife");
  });

  it("swaps missing glyphs and removes emoji", () => {
    expect(safeText("Niterói ≠ Rio 🚀")).toEqual({ text: "Niterói NÃO É Rio", replaced: ["≠", "🚀"] });
    const out = compileScene(input(SAMPLES.title));
    expect(out.texts).toContain("Niterói NÃO É Rio");
    expect(out.warnings.join()).toContain("≠");
  });

  it("puts the place tag only on media from that place", () => {
    const ok = compileScene(input(SAMPLES.photo));
    expect(ok.html).toContain(">NITERÓI<");
    const generic = compileScene(input({ type: "photo", data: { tag: "Copacabana" }, media: ["m_ph0002"], place: "Copacabana" }));
    expect(generic.html).not.toContain("COPACABANA");
    expect(generic.warnings.join()).toMatch(/Etiqueta "Copacabana" removida/);
  });

  it("triggers on spoken words with alternatives and shows the first element within 10 frames", () => {
    expect(cueTime("quatro|400", words, 9)).toBeCloseTo(words[6].s, 3);
    expect(cueTime("400", words, 9)).toBeCloseTo(words[6].s, 3);
    expect(cueTime("ponte", words, 1.5)).toBe(1.5);
    const out = compileScene(input(SAMPLES.stat));
    // The value is cued on "quatro" (2.1 s) but, as the first element, enters by 0.333 s.
    expect(out.html).toMatch(/autoAlpha:1, scale:1, duration:0.45, ease:"back.out\(1.7\)"\}, 0.333\)/);
  });

  it("refuses a number on screen without a source and media that is not registered", () => {
    expect(() => compileScene({ ...input(SAMPLES.stat), beat: { id: "b_001", text: "x", scene: SAMPLES.stat, facts: [] } })).toThrow(SceneError);
    expect(compileScene(input({ ...SAMPLES.stat, data: { value: 3, source: "Prefeitura, 2026" } })).html).toContain("Fonte: Prefeitura, 2026");
    expect(() => compileScene(input({ type: "photo", data: {}, media: ["m_nope00"] }))).toThrow(/registro de licenças/);
    expect(() => compileScene(input({ type: "map", data: {}, media: [] }))).toThrow(/ainda não é compilada/);
  });

  it("repeats a short clip in blocks, never a looping <video>", () => {
    const out = compileScene(input({ type: "video", data: {}, media: ["m_vd0001"] }, { frames: 300 }));
    expect(out.html).not.toContain("loop");
    expect(out.html.match(/<video class="clip/g)).toHaveLength(3);
    expect(out.html).toContain('data-start="8" data-duration="2"');
    expect(out.sfx[0]).toMatchObject({ t: 0, kind: "whoosh" });
  });

  it("hash changes only when the scene's inputs change", () => {
    const a = sceneHash(input(SAMPLES.photo));
    expect(sceneHash(input(SAMPLES.photo))).toBe(a);
    expect(sceneHash(input({ ...SAMPLES.photo, media: ["m_ph0002"] }))).not.toBe(a);
    expect(sceneHash(input(SAMPLES.photo, { frames: 151 }))).not.toBe(a);
  });

  it("writes a duration HyperFrames turns into exactly the planned frames (ceil of duration × fps)", () => {
    for (const frames of [126, 154, 155, 169, 170, 194, 406, 557, 1]) expect(Math.ceil(frameDuration(frames) * FPS - 1e-9)).toBe(frames);
    const out = compileScene(input(SAMPLES.title, { frames: 170 }));
    expect(out.html).toContain('data-duration="5.666"');
  });

  it("plans frame-exact scenes that add up to the narration, +12 s on the end screen", () => {
    const t = (s: number) => ({ start: s, end: s + 1, cut: s + 1, words: [] });
    const plans = planScenes([{ id: "b_001", timing: t(0.2) }, { id: "b_002", timing: t(3.01) }, { id: "b_003", timing: t(6.5), cta: "endscreen" }], 9.9);
    expect(plans.map((p) => [p.startFrame, p.frames])).toEqual([[0, 90], [90, 105], [195, 102 + 12 * FPS]]);
    expect(plans.reduce((s, p) => s + p.frames, 0)).toBe(Math.round(9.9 * FPS) + 12 * FPS);
    expect(() => planScenes([{ id: "b_001" }], 3)).toThrow(/alinhamento/);
  });
});

describe("episode scenes on disk", () => {
  it("writes each scene folder with assets, fonts and kit; recompiles only what changed", async () => {
    const dir = await mkdtemp(join(tmpdir(), "channel-scenes-"));
    roots.push(dir);
    const store = new ChannelStore(dir);
    const c = await store.createChannel("default", { name: "Canal" });
    const ep = await store.createEpisode("default", c.id, { title: "x" });
    const ids = { profileId: "default", channelId: c.id, episodeId: ep.id };
    const { added } = await addFacts(store, "default", c.id, ep.id, [{ claim: "População", value: 481749, dataDate: "2022", source: { url: "https://www.ibge.gov.br/x", publisher: "IBGE" } }]);
    const epDir = store.episodeDir("default", c.id, ep.id);
    await mkdir(join(epDir, "media"), { recursive: true });
    await writeFile(join(epDir, "media", "m_ph0001.jpg"), "jpg");
    await writeFile(join(epDir, "media", "m_ph0002.jpg"), "jpg2");
    await store.writeEpisodeFile("default", c.id, ep.id, "licenses", { schemaVersion: 1, items: [{ ...photoM, abs: undefined } as never, { ...genericM, abs: undefined } as never] });
    await saveScript(store, ids, { beats: [
      { section: "gancho", text: "Niterói vista do alto.", scene: { ...SAMPLES.photo } },
      { section: "gancho", text: "São 481 mil pessoas.", facts: [added[0]], scene: { type: "stat", data: { value: 481749, label: "habitantes" }, media: [] } },
      { section: "contexto", text: "E a ponte.", scene: { type: "title", data: { lines: [{ text: "A ponte" }] }, media: [] } },
    ] });
    await store.mutateEpisodeFile("default", c.id, ep.id, "script", () => { throw new Error(); }, (s) => {
      s.beats.forEach((b, i) => (b.timing = { start: i * 2, end: i * 2 + 1.5, cut: i * 2 + 1.94, words: [] }));
    });
    const kit = { gsap: createRequire(import.meta.url).resolve("gsap/dist/gsap.min.js"), fontsDir: resolve("resources/film-kit/fonts") };
    const first = await compileEpisodeScenes(store, ids, kit, { audioDuration: 6 });
    expect(first.errors).toBe(0);
    expect(first.compiled).toBe(3);
    expect(first.totalFrames).toBe(180);
    const b1 = join(epDir, "scenes", "b_001");
    expect((await stat(join(b1, "kit", "gsap.min.js"))).size).toBeGreaterThan(10_000);
    expect((await stat(join(b1, "fonts", "Anton-Regular.ttf"))).size).toBeGreaterThan(1000);
    expect(await readFile(join(b1, "assets", "m_ph0001.jpg"), "utf8")).toBe("jpg");
    const meta = JSON.parse(await readFile(join(b1, "scene.json"), "utf8"));
    expect(meta).toMatchObject({ beatId: "b_001", frames: 60, startFrame: 0 });
    expect((await store.getEpisode("default", c.id, ep.id)).stages.scenes.status).toBe("ok");

    // Change only the media of b_003's neighbour b_001 → only b_001 recompiles.
    await store.mutateEpisodeFile("default", c.id, ep.id, "script", () => { throw new Error(); }, (s) => {
      s.beats[0].scene.media = ["m_ph0002"];
      s.beats[0].scene.data = { move: "in" };
    });
    const second = await compileEpisodeScenes(store, ids, kit, { audioDuration: 6 });
    expect(second.scenes.filter((x) => x.changed).map((x) => x.beatId)).toEqual(["b_001"]);
  });
});

void defaultBible;

import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ChannelStore } from "../electron/core/channel/channel-store";
import { ffmpeg } from "../electron/core/channel/ffmpeg";
import { DESCRIPTION_LIMIT, buildDescription, chaptersFrom, checkTags, fmtTime, generatePackage, shortPackage, thumbOverlap, validateChapters } from "../electron/core/channel/packager";
import { checkSceneFrames, numberedSheet, runQa, silenceCheck, staticChecks, type BenchRunner, type TextBox } from "../electron/core/channel/qa";
import { addFacts } from "../electron/core/channel/research";
import { compileEpisodeScenes } from "../electron/core/channel/scene-compiler";
import { saveScript } from "../electron/core/channel/script-writer";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});
async function tmp() {
  const d = await mkdtemp(join(tmpdir(), "channel-qa-"));
  roots.push(d);
  return d;
}
const FONT = resolve("resources/film-kit/fonts/Anton-Regular.ttf");
const box = (text: string, x: number, y: number, w = 300, h = 80, extra: Partial<TextBox> = {}): TextBox => ({ text, x, y, w, h, id: "", cls: "", clipped: false, ...extra });
const size = { w: 1920, h: 1080 };

describe("QA checks on measured frames", () => {
  const meta = { beatId: "b_001", texts: ["NITERÓI", "A cidade do outro lado"] };
  it("flags overflow, clipped text, foreign text and overlap", () => {
    const issues = checkSceneFrames(meta, [{ t: 0.4, layers: 3, boxes: [box("NITERÓI", 1800, 100, 200), box("SERRA", 100, 100), box("A cidade do outro lado", 120, 120, 300, 80, { clipped: true })] }], size);
    const codes = issues.map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(["TEXT_OVERFLOW", "FOREIGN_TEXT", "TEXT_OVERLAP"]));
    expect(issues.find((i) => i.code === "FOREIGN_TEXT")?.message).toContain("SERRA");
    expect(issues.filter((i) => i.code === "TEXT_OVERFLOW")).toHaveLength(2);
  });
  it("accepts numbers, UI labels and the channel seal; flags an empty start", () => {
    const ok = checkSceneFrames(meta, [{ t: 0.4, layers: 1, boxes: [box("481.749", 100, 300), box("INSCREVER-SE", 100, 600), box("Canal X", 1700, 20, 150, 30)] }], size, ["Canal X"]);
    expect(ok).toEqual([]);
    const lines = checkSceneFrames({ beatId: "b_002", texts: ["NITERÓI", "MAIS CARA"] }, [{ t: 1, layers: 1, boxes: [box("NITERÓI", 100, 300, 600, 120, { id: "tb1_0" }), box("MAIS CARA", 100, 400, 600, 120, { id: "tb1_1" })] }], size);
    expect(lines).toEqual([]);
    const empty = checkSceneFrames(meta, [{ t: 0.4, layers: 0, boxes: [] }], size);
    expect(empty.map((i) => i.code)).toEqual(["EMPTY_START"]);
  });
});

describe("chapters, description and tags", () => {
  it("chapters start at 00:00, merge sections under 10 s and need 3", () => {
    const spans = [{ section: "gancho", from: 0, to: 48 }, { section: "contexto", from: 48, to: 53 }, { section: "tese", from: 53, to: 110 }, { section: "lado-bom", from: 110, to: 300 }, { section: "assinatura", from: 300, to: 305 }];
    const ch = chaptersFrom(spans, { gancho: "Gancho", contexto: "Contexto", tese: "Tese", "lado-bom": "O lado bom", assinatura: "Fim" });
    expect(ch).toEqual([{ t: 0, title: "Gancho" }, { t: 48, title: "Contexto" }, { t: 110, title: "O lado bom" }]);
    expect(validateChapters(ch)).toEqual([]);
    expect(validateChapters([{ t: 0, title: "a" }, { t: 5, title: "b" }])).toHaveLength(2);
    expect(fmtTime(3725)).toBe("1:02:05");
  });

  it("assembles the description in order and moves credits to the pinned comment past 5,000 characters", () => {
    const base = { intro: "Niterói é mais cara que o Rio? Os números mostram outra coisa.", question: "De qual cidade você assiste?", chapters: [{ t: 0, title: "Gancho" }, { t: 50, title: "Contexto" }, { t: 120, title: "Virada" }], sources: ["IBGE (2022): https://ibge.gov.br"], hashtags: ["niteroi", "#rio", "cidades"] };
    const credits = { FOTOS: ['"Ponte" por Ana (CC BY 2.0), via Openverse: https://x'], "VÍDEOS": [], "MÚSICA": ["\"Tense\" Kevin MacLeod (incompetech.com). Licensed under Creative Commons: By Attribution 4.0 License."], EFEITOS: [] };
    const d = buildDescription({ ...base, credits });
    const order = ["Niterói é mais cara", "De qual cidade", "CAPÍTULOS\n00:00 Gancho\n00:50 Contexto\n02:00 Virada", "FONTES", "FOTOS", "MÚSICA", "Narração com voz sintética", "#niteroi #rio #cidades"].map((s) => d.description.indexOf(s));
    expect(order.every((v, i) => v >= 0 && (i === 0 || v > order[i - 1]))).toBe(true);
    expect(d.creditsInComment).toBe(false);
    const big = buildDescription({ ...base, credits: { ...credits, FOTOS: Array.from({ length: 60 }, (_, i) => `"Foto ${i}" por Autor com nome longo ${i} (CC BY-SA 4.0, https://creativecommons.org/licenses/by-sa/4.0/), via Wikimedia Commons: https://commons.wikimedia.org/?curid=${i}`) } });
    expect(big.creditsInComment).toBe(true);
    expect(big.description.length).toBeLessThanOrEqual(DESCRIPTION_LIMIT);
    expect(big.pinnedExtra).toContain("Foto 59");
  });

  it("tags: 10 to 15, up to 500 characters; short package", () => {
    expect(checkTags(["a", "b"])).toHaveLength(1);
    expect(checkTags(Array.from({ length: 12 }, (_, i) => `tag ${i}`))).toEqual([]);
    expect(checkTags(Array.from({ length: 12 }, () => "x".repeat(50)))[0]).toMatch(/500/);
    expect(shortPackage("A capital mais cara do Brasil não é SP, nem Rio, nem Floripa — e o motivo é outro", ["cidades"]).title.length).toBeLessThanOrEqual(61);
  });

  it("detects an element covering the thumb text", () => {
    expect(thumbOverlap([box("MAIS CARA", 40, 300, 600, 140), box("NITERÓI", 1000, 30, 200, 60, { cls: "chip" })])).toBe(false);
    expect(thumbOverlap([box("MAIS CARA?", 40, 300, 800, 140), box("BR", 700, 320, 120, 60, { cls: "chip" })])).toBe(true);
  });
});

/** Bench that writes a PNG per frame and reports the given boxes. */
function fakeBench(boxesFor: (dir: string) => TextBox[] = () => []): BenchRunner {
  return async (scenes, o) => {
    const out = [];
    for (const s of scenes) {
      const frames = [];
      for (const [i, t] of s.times.entries()) {
        let file: string | undefined;
        if (s.output) {
          await mkdir(s.output, { recursive: true });
          file = join(s.output, `q${i}.png`);
          await ffmpeg(["-y", "-f", "lavfi", "-i", `color=c=0x335577:s=${Math.round(o.width * o.scale)}x${Math.round(o.height * o.scale)}`, "-frames:v", "1", file]);
        }
        frames.push({ t, file, boxes: boxesFor(s.directory), layers: 2 });
      }
      out.push({ directory: s.directory, duration: 3, frames, errors: [] });
    }
    return out;
  };
}

async function episode() {
  const dir = await tmp();
  const store = new ChannelStore(dir);
  const c = await store.createChannel("default", { name: "Vale a Pena Morar?", handle: "valeapenamorarem", longMinMinutes: 1 });
  const ep = await store.createEpisode("default", c.id, { title: "Niterói" });
  const ids = { profileId: "default", channelId: c.id, episodeId: ep.id };
  const epDir = store.episodeDir("default", c.id, ep.id);
  const { added } = await addFacts(store, "default", c.id, ep.id, [{ claim: "População", value: 481749, dataDate: "2022", source: { url: "https://www.ibge.gov.br/cidades", publisher: "IBGE", title: "Cidades" } }]);
  await mkdir(join(epDir, "media"), { recursive: true });
  await ffmpeg(["-y", "-f", "lavfi", "-i", "testsrc2=size=1920x1080", "-frames:v", "1", join(epDir, "media", "m_photo1.jpg")]);
  await store.writeEpisodeFile("default", c.id, ep.id, "licenses", { schemaVersion: 1, items: [{ id: "m_photo1", kind: "photo", file: "media/m_photo1.jpg", source: "commons", sourceUrl: "https://commons.wikimedia.org/?curid=1", author: "Halley", license: "CC BY-SA", licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/", attribution: '"Icaraí" por Halley, licenciada sob CC BY-SA 4.0', place: "Niterói", usedIn: ["b_001"] }] });
  const sections = ["gancho", "contexto", "tese", "lado-bom"];
  await saveScript(store, ids, { beats: [
    { section: "gancho", text: "Niterói vista do alto.", scene: { type: "photo", data: { tag: "Niterói" }, media: ["m_photo1"], place: "Niterói" } },
    { section: "gancho", text: "São 481 mil pessoas.", facts: [added[0]], scene: { type: "stat", data: { value: 481749, label: "habitantes" }, media: [] } },
    ...sections.slice(1).map((s) => ({ section: s, text: `Seção ${s}.`, scene: { type: "title" as const, data: { lines: [{ text: s }] }, media: [] } })),
    { section: "lado-bom", text: "Comenta de qual cidade você assiste.", cta: "comment" as const, scene: { type: "cta" as const, data: { kind: "comment" }, media: [] } },
  ] });
  await store.mutateEpisodeFile("default", c.id, ep.id, "script", () => { throw new Error(); }, (s) => {
    s.beats.forEach((b, i) => (b.timing = { start: i * 12, end: i * 12 + 10, cut: (i + 1) * 12 - 0.06, words: [] }));
  });
  const kit = { gsap: createRequire(import.meta.url).resolve("gsap/dist/gsap.min.js"), fontsDir: resolve("resources/film-kit/fonts") };
  await mkdir(join(epDir, "audio"), { recursive: true });
  await ffmpeg(["-y", "-f", "lavfi", "-i", "sine=frequency=200:duration=4", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono", "-filter_complex", "[0][1]concat=n=2:v=0:a=1,atrim=0:7,apad=pad_dur=1", "-f", "lavfi", "-i", "sine=duration=1", "-ac", "1", join(epDir, "audio", "narracao.wav")]).catch(async () => {
    await ffmpeg(["-y", "-f", "lavfi", "-i", "sine=frequency=200:duration=7", "-ac", "1", join(epDir, "audio", "narracao.wav")]);
  });
  await compileEpisodeScenes(store, ids, kit, { audioDuration: 72 });
  return { store, ids, epDir, kit, factId: added[0] };
}

describe("store-backed QA and package", () => {
  it("runs the bench, writes numbered sheets of 20 scenes and a report", async () => {
    const { store, ids, epDir } = await episode();
    const report = await runQa(store, ids, { bench: fakeBench((d) => (d.endsWith("b_003") ? [box("SERRA", 10, 10)] : [])), font: FONT });
    expect(report.scenes).toBe(6);
    expect(report.sheets).toHaveLength(1);
    expect((await stat(report.sheets[0])).size).toBeGreaterThan(1000);
    expect(report.issues.find((i) => i.code === "FOREIGN_TEXT")?.beatId).toBe("b_003");
    expect(report.ok).toBe(false);
    const saved = JSON.parse(await readFile(join(epDir, "qa", "report.json"), "utf8"));
    expect(saved.issues.length).toBe(report.issues.length);
    expect((await store.getEpisode(ids.profileId, ids.channelId, ids.episodeId)).stages.qa.status).toBe("erro");
    const clean = await runQa(store, ids, { bench: fakeBench(), font: FONT, beatIds: ["b_001"] });
    expect(clean.scenes).toBe(1);
  }, 60_000);

  it("static checks: number without source, media without license, static scene", async () => {
    const { store, ids, epDir } = await episode();
    const script = (await store.readEpisodeFile(ids.profileId, ids.channelId, ids.episodeId, "script"))!;
    script.beats[1].facts = [];
    script.beats[0].scene.media = ["m_zzzzzz"];
    const metas = script.beats.map((b, i) => ({ beatId: b.id, hash: "h", duration: 12, startFrame: i * 360, frames: 390, sfx: [], texts: b.id === "b_003" ? ["Ano 2026"] : [], warnings: [] }));
    const codes = staticChecks(script, { metas, research: await store.readEpisodeFile(ids.profileId, ids.channelId, ids.episodeId, "research"), licenses: await store.readEpisodeFile(ids.profileId, ids.channelId, ids.episodeId, "licenses") }).map((i) => `${i.code}:${i.beatId}`);
    expect(codes).toEqual(expect.arrayContaining(["NUMBER_WITHOUT_SOURCE:b_002", "NUMBER_WITHOUT_SOURCE:b_003", "MEDIA_WITHOUT_LICENSE:b_001", "STATIC_SCENE:b_003"]));
    void epDir;
  });

  it("numbered sheet and silence check with real FFmpeg", async () => {
    const dir = await tmp();
    const frames = [];
    for (let i = 0; i < 3; i++) {
      const f = join(dir, `${i}.png`);
      await ffmpeg(["-y", "-f", "lavfi", "-i", "color=c=0x445566:s=768x432", "-frames:v", "1", f]);
      frames.push({ file: f, label: `${i + 1} b_00${i + 1} 20` });
    }
    const sheet = await numberedSheet(frames, join(dir, "s.jpg"), { w: 384, h: 216, cols: 4, font: FONT });
    expect((await stat(sheet)).size).toBeGreaterThan(500);
    const wav = join(dir, "n.wav");
    await ffmpeg(["-y", "-f", "lavfi", "-i", "sine=duration=2", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono:d=2.5", "-f", "lavfi", "-i", "sine=duration=2", "-filter_complex", "[0][1][2]concat=n=3:v=0:a=1", "-ac", "1", wav]);
    const s = await silenceCheck(wav);
    expect(s).toHaveLength(1);
    expect(s[0].message).toMatch(/Silêncio de 2\.\d s/);
  }, 60_000);

  it("generates the package: chapters from real times, sources, credits, thumbs < 2 MB", async () => {
    const { store, ids, epDir, kit } = await episode();
    const bench = fakeBench();
    const pkg = await generatePackage(store, ids, {
      titles: ["Niterói é mais cara que o Rio?", "A cidade do outro lado da ponte", "Vale a pena morar em Niterói?"],
      thumbs: [{ lines: ["MAIS CARA", "QUE O RIO?"] }, { lines: ["DO OUTRO", "LADO"] }, { lines: ["VALE", "A PENA?"] }],
      intro: "Niterói tem fama de cidade cara. Os dados do IBGE mostram outra história.",
      hashtags: ["niteroi", "rio", "cidades"],
      tags: ["niterói", "morar em niterói", "custo de vida niterói", "icaraí", "rio de janeiro", "cidades do brasil", "vale a pena morar", "custo de vida", "mudança de cidade", "brasil"],
    }, { bench, kit });
    expect(pkg.chapters.map((c) => c.t)).toEqual([0, 24, 36, 48]);
    expect(pkg.description).toContain("FONTES\nIBGE — Cidades (2022): https://www.ibge.gov.br/cidades");
    expect(pkg.description).toContain('FOTOS\n"Icaraí" por Halley');
    expect(pkg.pinnedComment).toBe("Comenta de qual cidade você assiste.");
    expect(pkg.thumbs).toHaveLength(3);
    for (const t of pkg.thumbs) expect(t.bytes).toBeLessThan(2_000_000);
    expect(pkg.fields).toMatchObject({ madeForKids: false, syntheticContent: false });
    expect(pkg.issues).toEqual([]);
    const html = await readFile(join(epDir, "out", "thumbs", "t1", "index.html"), "utf8");
    expect(html).toContain('src="assets/m_photo1.jpg"');
    expect(html).toContain(">NITERÓI<");
    expect(JSON.parse(await readFile(join(epDir, "package.json"), "utf8")).titles).toHaveLength(3);
    expect((await store.getEpisode(ids.profileId, ids.channelId, ids.episodeId)).outputs.thumbs).toHaveLength(3);
  }, 60_000);
});

void writeFile;

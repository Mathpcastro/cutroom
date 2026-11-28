import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ChannelStore } from "../electron/core/channel/channel-store";
import { createChannelToolDispatcher } from "../electron/core/channel/channel-tools";
import { channelSkill } from "../electron/core/channel/channel-skill";
import { JobRunner } from "../electron/core/channel/jobs";
import { buildScript, reviewScript, scriptBrief, type BeatInput } from "../electron/core/channel/script-writer";
import { fishSpeech } from "../electron/core/voice";
import { FORMAT_TEMPLATES, formatOf, resolveFormat, type FormatInput } from "../src/shared/channel-formats";
import type { Channel, Research } from "../src/shared/channel";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});
const tmp = async () => {
  const d = await mkdtemp(join(tmpdir(), "formats-"));
  roots.push(d);
  return d;
};

const RECIPE: FormatInput = {
  id: "receita-60s",
  name: "Receita de vó em 60 s",
  aspect: "9:16" as const,
  durationSec: { min: 15, max: 90 },
  scenes: ["custom", "title", "cta"],
  imagery: { sources: ["custom" as const] },
  research: "livre" as const,
  structure: [
    { id: "gancho", title: "Gancho", targetSec: 5, mustHave: "" },
    { id: "passo", title: "Passo a passo", targetSec: 30, mustHave: "" },
  ],
  checklist: [
    { id: "cartoes", kind: "image-share" as const, params: { sources: ["custom"], min: 0.5 } },
    { id: "passos", kind: "section-required" as const, params: { section: "passo" } },
  ],
};

describe("formats: any niche", () => {
  it("templates are examples; a whole format written for a new niche is validated, and old channels read as cidade", () => {
    expect(Object.keys(FORMAT_TEMPLATES)).toEqual(["cidade", "top10", "e-se"]);
    const own = resolveFormat(RECIPE);
    expect(own.format).toMatchObject({ id: "receita-60s", aspect: "9:16", research: "livre" });
    expect(own.bible.structure?.map((m) => m.id)).toEqual(["gancho", "passo"]);
    const ext = resolveFormat({ extends: "top10", id: "top-espaco", name: "Top do espaço", durationSec: { min: 30, max: 120 } });
    expect(ext.format.scenes).toContain("rank");
    expect(ext.format.durationSec).toEqual({ min: 30, max: 120 });
    expect(ext.bible.structure?.[1].id).toBe("contagem");
    expect(ext.format.checklist.map((c) => c.kind)).toContain("ranked-countdown"); // inherited, not reset by defaults
    expect(ext.format.writingRules.length).toBeGreaterThan(0);
    expect(() => resolveFormat({ id: "x", name: "x" })).toThrow(/FORMAT|inválido/i);
    expect(() => resolveFormat("novela")).toThrow(/não existe/);
    expect(() => resolveFormat({ ...RECIPE, durationSec: { min: 90, max: 30 } })).toThrow(/max/);
    const legacy = { defaults: { longMinMinutes: 12 } } as Channel;
    expect(formatOf(legacy)).toMatchObject({ id: "cidade", durationSec: { min: 720, max: 1200 } });
  });

  it("channel_create takes a template or a format and a voice; the brief shows only the format's scenes and checklist", async () => {
    const dir = await tmp();
    const store = new ChannelStore(dir);
    const tool = createChannelToolDispatcher({ store, jobs: new JobRunner(join(dir, "jobs")), secret: async () => undefined, kit: { gsap: "", fontsDir: "" }, runner: async () => ({ worker: "", browser: "" }), transcriber: async () => async () => [], speaker: async () => async () => ({ audio: new Uint8Array(), extension: "wav" }) });
    const templates = (await tool("format_templates", {})) as { id: string; format: { checklist: unknown[]; structure: unknown[] } }[];
    expect(templates.map((t) => t.id)).toEqual(["cidade", "top10", "e-se"]);
    expect(templates[2].format.structure.length).toBeGreaterThan(2);
    const ch = (await tool("channel_create", { profileId: "default", name: "Receita de Vó", format: RECIPE, voice: { provider: "fish", voiceId: "ref123" } })) as Channel;
    const top = (await tool("channel_create", { profileId: "default", name: "Top", format: { extends: "top10", id: "top-x", name: "Top X", durationSec: { min: 30, max: 120 } } })) as Channel;
    expect(top.format?.checklist.map((c) => c.kind)).toContain("ranked-countdown"); // inherited through the MCP tool too
    expect(ch.format?.id).toBe("receita-60s");
    expect(ch.defaults.voiceId).toBe("fish:ref123");
    expect(ch.bible.structure.map((m) => m.id)).toEqual(["gancho", "passo"]);
    const ep = (await tool("channel_episode_create", { profileId: "default", channelId: ch.id, title: "Bolo de caneca" })) as { id: string; aspect: string };
    expect(ep.aspect).toBe("9:16");
    const gen = (await tool("script_generate", { profileId: "default", channelId: ch.id, episodeId: ep.id })) as { needsResearch?: boolean; brief: ReturnType<typeof scriptBrief> };
    expect(gen.needsResearch).toBeUndefined(); // research "livre": no facts needed
    expect(gen.brief.sceneTypes).toEqual(["custom", "title", "cta"]);
    expect(Object.keys(gen.brief.sceneData)).toEqual(["custom", "title", "cta", "any"]);
    expect(gen.brief.checklist.join(" ")).toContain("custom");
    // A format patch is merged and validated.
    const upd = (await tool("channel_update", { profileId: "default", channelId: ch.id, patch: { format: { durationSec: { min: 30, max: 60 } } } })) as Channel;
    expect(upd.format).toMatchObject({ id: "receita-60s", durationSec: { min: 30, max: 60 } });
    await expect(tool("channel_update", { profileId: "default", channelId: ch.id, patch: { format: { scenes: [] } } })).rejects.toThrow(/INVALID/);
    // Fixed character image.
    const png = join(dir, "ze.png");
    await writeFile(png, Buffer.from("89504e470d0a1a0a", "hex"));
    const e = (await tool("channel_create", { profileId: "default", name: "E Se", format: "e-se" })) as Channel & { next: string };
    expect(e.next).toMatch(/channel_character_set/);
    const set = (await tool("channel_character_set", { profileId: "default", channelId: e.id, path: png, name: "Zé" })) as { image: string; character: { name: string } };
    expect(set).toMatchObject({ image: "assets/personagem.png", character: { name: "Zé" } });
    expect(await readFile(join(store.channelDir("default", e.id), "assets", "personagem.png"))).toBeTruthy();
  });
});

const research = (ids: string[]): Research => ({
  schemaVersion: 1,
  questions: [],
  unread: [],
  pages: [],
  updatedAt: "2026-11-19",
  facts: ids.map((id) => ({ id, claim: "c", value: 1, source: { title: "t", url: "https://example.org", publisher: "NASA", accessedAt: "2026-11-19", kind: "oficial" as const }, confirmations: [], confidence: "alta" as const, usedIn: [] })),
});
const channelOf = (format: Parameters<typeof resolveFormat>[0]) => {
  const f = resolveFormat(format);
  return { bible: { ...f.bible, forbidden: [], persona: { voiceTone: "", pov: "narrador neutro", catchphrases: [] }, promise: "" }, format: f.format, defaults: { longMinMinutes: 1, voiceId: "", voiceSpeed: 1, musicMood: [], shortsPerEpisode: 0 }, identity: { palette: [], fonts: { display: "Anton", body: "Inter" } } } as unknown as Channel;
};
const codes = (beats: BeatInput[], ch: Channel, facts: string[] = []) => {
  const script = buildScript({ beats }, ch, {});
  return reviewScript(script, { channel: ch, research: research(facts), format: "long" }).issues.filter((i) => i.level === "erro").map((i) => `${i.code}${i.check ? `(${i.check})` : ""}`);
};
const words = (n: number) => Array.from({ length: n }, (_, i) => `palavra${"abcdefghijklmnopqrstuvwxyz"[i % 26]}`).join(" ");

describe("script_review reads the format's checklist", () => {
  it("top10: the ranking counts down to 1 without gaps; numbers need facts; scenes outside the format are refused", () => {
    const ch = channelOf({ extends: "top10", id: "t", name: "T", durationSec: { min: 15, max: 300 } });
    const rank = (n: number) => ({ section: "contagem", text: `Número ${n}. ${words(8)}.`, scene: { type: "rank" as const, data: { n, title: `Item ${n}` }, media: [], query: "x" } });
    const ok = [{ section: "gancho", text: `Lista. ${words(8)}.`, scene: { type: "title" as const, data: { lines: [{ text: "Lista" }] }, media: [] } }, rank(3), rank(2), rank(1), { section: "pergunta", text: `Fim. ${words(8)}.`, cta: "endscreen" as const, scene: { type: "cta" as const, data: { kind: "endscreen" }, media: [] } }];
    expect(codes(ok, ch)).toEqual([]);
    expect(codes([ok[0], rank(3), rank(1), ok[4]], ch)).toEqual(expect.arrayContaining(["RANK_ORDER(contagem)", "RANK_COUNT(contagem)"]));
    expect(codes([...ok.slice(0, 4), { section: "numero-1", text: `Tem 274 luas. ${words(6)}.`, scene: { type: "photo" as const, data: {}, media: [], query: "x" } }, ok[4]], ch)).toContain("NUMBER_WITHOUT_FACT(numero-com-fonte)");
    expect(codes([...ok.slice(0, 4), { section: "numero-1", text: `Personagem. ${words(6)}.`, scene: { type: "counter" as const, data: { value: 1 }, media: [] } }, ok[4]], ch)).toContain("SCENE_NOT_IN_FORMAT");
  });

  it("e-se: the counter only moves forward, the twist is marked, at least one fact", () => {
    const ch = channelOf({ extends: "e-se", id: "e", name: "E", durationSec: { min: 15, max: 300 } });
    const chr = (section: string, value: number, extra: Record<string, unknown> = {}) => ({ section, text: `Dia ${value}. ${words(8)}.`, scene: { type: "character" as const, data: { counter: { value }, ...extra }, media: [] } });
    const fact = { section: "fato-real", text: `Um dado real. ${words(8)}.`, facts: ["f_ab12"], scene: { type: "character" as const, data: {}, media: [] } };
    const good = [chr("premissa", 1), chr("dias", 5), fact, chr("reviravolta", 30, { twist: true }), { section: "pergunta", text: `E você? ${words(6)}.`, cta: "endscreen" as const, scene: { type: "cta" as const, data: { kind: "endscreen" }, media: [] } }];
    expect(codes(good, ch, ["f_ab12"])).toEqual([]);
    expect(codes([chr("premissa", 5), chr("dias", 3), ...good.slice(2)], ch, ["f_ab12"])).toContain("COUNTER_BACKWARDS(contador)");
    expect(codes([...good.slice(0, 3), chr("reviravolta", 30), good[4]], ch, ["f_ab12"])).toContain("TWIST_MISSING(reviravolta)");
    expect(codes([good[0], good[1], good[3], good[4]], ch)).toContain("FACTS_MIN(fato-real)");
  });

  it("a format written from scratch only checks what it lists (no city rules)", () => {
    const ch = channelOf(RECIPE);
    const card = (section: string) => ({ section, text: `Passo com 4 colheres. ${words(10)}.`, scene: { type: "custom" as const, data: { html: "<b>a</b>" }, media: [] } });
    // No fact for "4 colheres", no endscreen, no real photo: none of that is in this format.
    expect(codes([card("gancho"), card("passo"), card("passo")], ch)).toEqual([]);
    expect(codes([card("gancho"), { section: "gancho", text: `Título. ${words(10)}.`, scene: { type: "title" as const, data: { lines: [{ text: "a" }] }, media: [] } }, { section: "gancho", text: `Outro. ${words(10)}.`, scene: { type: "title" as const, data: { lines: [{ text: "b" }] }, media: [] } }], ch)).toEqual(expect.arrayContaining(["IMAGE_SHARE(cartoes)", "SECTION_MISSING(passos)"]));
  });
});

describe("voice and skill", () => {
  it("Fish Audio: POST /v1/tts with header model s2-pro and reference_id", async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const fake = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await fishSpeech({ apiKey: "k", referenceId: "ref123", text: "Olá", fetch: fake });
    expect(r).toMatchObject({ extension: "mp3" });
    expect(seen?.url).toBe("https://api.fish.audio/v1/tts");
    expect((seen?.init.headers as Record<string, string>).model).toBe("s2-pro");
    expect(JSON.parse(String(seen?.init.body))).toMatchObject({ text: "Olá", reference_id: "ref123" });
    await expect(fishSpeech({ apiKey: "k", referenceId: "", text: "x", fetch: fake })).rejects.toThrow(/reference_id/);
  });

  it("the skill teaches writing a format for any niche and lists the templates", () => {
    const s = channelSkill("0.9.3");
    expect(s).toMatch(/QUALQUER nicho/);
    expect(s).toContain("format_templates");
    expect(s).toContain("channel_character_set");
    for (const id of Object.keys(FORMAT_TEMPLATES)) expect(s).toContain(`\`${id}\``);
  });
});

describe("frame review fixes found by the showcase episodes", () => {
  it("a number counting up with its unit (433 °C → 464 °C) is the beat's own data, a foreign label is not", async () => {
    const { checkSceneFrames } = await import("../electron/core/channel/qa");
    const box = (text: string) => ({ text, x: 100, y: 100, w: 300, h: 80, cls: "statv", clipped: false });
    const issues = checkSceneFrames({ beatId: "b_007", texts: ["464 °C", "na superfície de Vênus"] }, [{ t: 1, boxes: [box("433 °C"), box("na superfície de Vênus")] }] as never, { w: 1920, h: 1080 });
    expect(issues.filter((i) => i.code === "FOREIGN_TEXT")).toEqual([]);
    const foreign = checkSceneFrames({ beatId: "b_007", texts: ["464 °C"] }, [{ t: 1, boxes: [box("SERRA 12")] }] as never, { w: 1920, h: 1080 });
    expect(foreign.map((i) => i.code)).toContain("FOREIGN_TEXT");
  });

  it("photo credits sit outside the slow zoom, so the zoom never pushes them off the edge", async () => {
    const { compileScene, lookOf } = await import("../electron/core/channel/scene-compiler");
    const look = lookOf({ identity: { palette: [], fonts: { display: "Anton", body: "Inter" } } as never, name: "Top", handle: "@top" });
    const media = new Map([["m_ph0001", { id: "m_ph0001", kind: "photo", file: "media/a.jpg", abs: "/x/a.jpg", source: "commons", sourceUrl: "u", author: "NASA/JPL", license: "PD", licenseUrl: "", attribution: "a", usedIn: [] }]]);
    const out = compileScene({ beat: { id: "b_006", text: "Número dois: Vênus.", scene: { type: "rank", data: { n: 2, title: "Vênus" }, media: ["m_ph0001"] }, facts: [] }, index: 0, startFrame: 0, frames: 90, words: [], look, aspect: "16:9", media: media as never, facts: new Map() });
    const zoomEnd = out.html.indexOf("</div></div>", out.html.indexOf('<div id="zoom">'));
    expect(out.html.indexOf('class="credit"')).toBeGreaterThan(zoomEnd);
  });
});

describe("alignment tolerant to how the transcript writes speech", () => {
  it("contractions match the long form and one-letter differences match, so a good take is not refused", async () => {
    const { alignBeats, sameToken, spokenTokens } = await import("../electron/core/channel/aligner");
    expect(spokenTokens("Olha pro céu, pra ver.")).toEqual(["olha", "para", "o", "ceu", "para", "ver"]);
    expect(sameToken("parece", "parecem")).toBe(true);
    expect(sameToken("casa", "caso")).toBe(true);
    expect(sameToken("de", "do")).toBe(false);
    expect(sameToken("rio", "mar")).toBe(false);
    const heard = "existem planetas aqui do lado que parece intersaído de um filme de ficção e o número um vai mudar o jeito que você olha para o céu".split(" ").map((text, i) => ({ text, start: i * 0.3, end: i * 0.3 + 0.25 }));
    const r = alignBeats([{ id: "b_001", text: "Existem planetas aqui do lado que parecem ter saído de um filme de ficção." }, { id: "b_002", text: "E o número um vai mudar o jeito que você olha pro céu." }], heard, 10);
    expect(r.ratio).toBeGreaterThan(0.9);
    expect(r.timings.b_002.start).toBeCloseTo(13 * 0.3, 5); // "e" is the 14th heard word
  });
});

describe("alignment: split decimals and spread slips", () => {
  it("glues a decimal split by the transcript and passes a good take with a few spread slips, but fails a missing beat", async () => {
    const { alignBeats, expandTranscript } = await import("../electron/core/channel/aligner");
    const w = (texts: string[]) => texts.map((text, i) => ({ text, start: i * 0.3, end: i * 0.3 + 0.25 }));
    expect(expandTranscript(w(["92,", "5%"])).map((x) => x.text)).toEqual(["noventa", "e", "dois", "virgula", "cinco", "por", "cento"]);
    expect(expandTranscript(w(["92", ",5", "%", "das"])).map((x) => x.text)).toEqual(["noventa", "e", "dois", "virgula", "cinco", "por", "cento", "das"]);
    const beats = Array.from({ length: 6 }, (_, i) => ({ id: `b_00${i + 1}`, text: `Frase numero ${["um", "dois", "tres", "quatro", "cinco", "seis"][i]} com algumas palavras bem claras aqui.` }));
    const spoken = beats.flatMap((b) => b.text.replace(".", "").toLowerCase().split(" "));
    // Two slips in different beats (> 5% of a short episode, but spread).
    const slipped = [...spoken];
    slipped[3] = "algumaz";
    slipped[2] = "xxx";
    slipped[20] = "yyy";
    slipped[21] = "zzz";
    expect(alignBeats(beats, w(slipped), 20).ok).toBe(true);
    // A whole beat missing from the audio still fails.
    const missing = spoken.filter((_, i) => i < 8 || i >= 16);
    expect(alignBeats(beats, w(missing), 20).ok).toBe(false);
  });
});

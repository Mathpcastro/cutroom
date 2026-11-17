import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ChannelStore } from "../electron/core/channel/channel-store";
import { decimalToWords, integerToWords, toSay } from "../electron/core/channel/pt-numbers";
import { addFacts, emptyResearch, mergeFacts } from "../electron/core/channel/research";
import {
  applyBeatEdits,
  buildScript,
  editScript,
  estimateSeconds,
  pageScript,
  reviewScript,
  saveScript,
  scriptBrief,
  writePronunciations,
  type BeatInput,
} from "../electron/core/channel/script-writer";
import { defaultBible, type Channel } from "../src/shared/channel";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe("pt-BR numbers for the TTS", () => {
  it("reads integers, decimals, money and percentages", () => {
    expect(integerToWords(15938)).toBe("quinze mil, novecentos e trinta e oito");
    expect(integerToWords(481749)).toBe("quatrocentos e oitenta e um mil, setecentos e quarenta e nove");
    expect(integerToWords(1100)).toBe("mil e cem");
    expect(integerToWords(2_000_020)).toBe("dois milhões e vinte");
    expect(integerToWords(100)).toBe("cem");
    expect(decimalToWords("4,70", { money: "real" })).toBe("quatro reais e setenta centavos");
    expect(decimalToWords("0,05")).toBe("zero vírgula zero cinco");
    expect(toSay("O aluguel é R$ 4,70 por m² e subiu 15,5%.")).toBe("O aluguel é quatro reais e setenta centavos por m² e subiu quinze vírgula cinco por cento.");
    expect(toSay("São 481.749 habitantes em 2022.")).toBe("São quatrocentos e oitenta e um mil, setecentos e quarenta e nove habitantes em 2022.");
    expect(toSay("R$ 3,2 milhões")).toBe("três vírgula dois milhões de reais");
  });
  it("spells acronyms and applies the channel dictionary", () => {
    expect(toSay("Segundo o IBGE e o IPTU")).toBe("Segundo o í bê gê é e o IPTU");
    expect(toSay("O IDHM de Niterói", { IDHM: "í dê agá ême", Niterói: "Niterói" })).toBe("O í dê agá ême de Niterói");
  });
});

function channel(): Channel {
  return {
    schemaVersion: 1, id: "c", profileId: "default", name: "C", handle: "", niche: "cidades", language: "pt-BR", platforms: {},
    bible: defaultBible("cidades"),
    identity: { logo: "", banner: "", palette: [], fonts: { display: "Anton", body: "Inter" }, signature: "" },
    defaults: { voiceId: "", voiceSpeed: 1.05, musicMood: [], longMinMinutes: 1, shortsPerEpisode: 2 },
    cadence: { longPerWeek: 3, shortPerWeek: 7, publishTimes: [] }, createdAt: "x", updatedAt: "x",
  };
}

const photo = (q: string) => ({ type: "photo" as const, data: {}, media: [], query: q });
const title = { type: "title" as const, data: {}, media: [] };
const filler = "e isso muda bastante a rotina de quem mora lá todos os dias da semana";

function goodBeats(factId: string): BeatInput[] {
  return [
    { section: "gancho", text: `A cidade mais cara do Rio não é a capital.`, scene: photo("Niterói vista aérea") },
    { section: "gancho", text: `São 481.749 pessoas e aluguel de R$ 4.200. Vale a pena? Fica até o final.`, facts: [factId], scene: { type: "stat", data: {}, media: [] } },
    { section: "contexto", text: `Niterói fica do outro lado da ponte ${filler}.`, scene: photo("Ponte Rio-Niterói aérea") },
    { section: "contexto", text: `Comenta aí de onde você tá assistindo ${filler}.`, cta: "comment", scene: { type: "cta", data: {}, media: [] } },
    { section: "tese", text: `Na minha visão o problema não é o preço ${filler}.`, scene: title },
    { section: "lado-bom", text: `Imagina que você mora em Icaraí ${filler}.`, scene: photo("Praia de Icaraí manhã") },
    { section: "virada", text: `O trânsito na ponte é o lado que não sai no folder ${filler}.`, scene: { type: "video", data: {}, media: [], query: "trânsito em ponte" } },
    { section: "comparacao", text: `Comparado com o Rio a diferença é pequena ${filler}.`, scene: title },
    { section: "veredito", text: `Vale para quem trabalha na cidade ${filler}.`, scene: { type: "list", data: {}, media: [] } },
    { section: "assinatura", text: `E você, moraria lá? Tem outro vídeo aqui pra você.`, cta: "endscreen", scene: { type: "cta", data: {}, media: [] } },
  ];
}

function research() {
  const r = emptyResearch();
  mergeFacts(r, [{ claim: "População e aluguel de Niterói", value: "481.749", dataDate: "2022", source: { url: "https://www.ibge.gov.br/x", publisher: "IBGE" } }]);
  return r;
}

describe("script building and edits by id", () => {
  it("assigns stable ids, fills say and hashes", () => {
    const r = research();
    const s = buildScript({ beats: goodBeats(r.facts[0].id) }, channel());
    expect(s.beats.map((b) => b.id).slice(0, 3)).toEqual(["b_001", "b_002", "b_003"]);
    expect(s.beats[1].say).toContain("quatrocentos e oitenta e um mil");
    expect(s.beats[0].say).toBeUndefined();
    expect(s.nextBeat).toBe(11);
    expect(s.sections.map((x) => x.id)[0]).toBe("gancho");
  });

  it("keeps order when inserting several beats after the same id (bug: beats out of order)", () => {
    const s = buildScript({ beats: goodBeats("f_ab12") }, channel());
    const { script, changed } = applyBeatEdits(s, [
      { op: "insert", after: "b_003", beat: { section: "contexto", text: "Primeira nova." } },
      { op: "insert", after: "b_011", beat: { section: "contexto", text: "Segunda nova." } },
      { op: "insert", before: "b_004", beat: { section: "contexto", text: "Terceira nova." } },
    ]);
    expect(script.beats.slice(2, 7).map((b) => b.id)).toEqual(["b_003", "b_011", "b_012", "b_013", "b_004"]);
    expect(changed).toEqual(["b_011", "b_012", "b_013"]);
    expect(() => applyBeatEdits(s, [{ op: "insert", beat: { section: "contexto", text: "x" } }])).toThrow(/after ou before/);
    expect(() => applyBeatEdits(s, [{ op: "delete", id: "b_999" }])).toThrow(/não existe/);
  });

  it("never reuses an id after a delete, and marks changed beats new once narrated", () => {
    const s = buildScript({ beats: goodBeats("f_ab12") }, channel());
    const a = applyBeatEdits(s, [{ op: "delete", id: "b_010" }]);
    const b = applyBeatEdits(a.script, [{ op: "insert", after: "b_009", beat: { section: "assinatura", text: "Fim." } }], { narrated: true });
    expect(b.script.beats.at(-1)?.id).toBe("b_011");
    expect(b.script.beats.at(-1)?.isNew).toBe(true);
    const c = applyBeatEdits(b.script, [{ op: "update", id: "b_003", patch: { text: "Texto novo da fala." } }], { narrated: true });
    // Editing only the text keeps the scene data and the facts (bug: defaults wiped them).
    expect(c.script.beats.find((x) => x.id === "b_003")!.scene).toEqual(s.beats[2].scene);
    const withFacts = applyBeatEdits(buildScript({ beats: [{ section: "gancho", text: "a", facts: ["f_ab12"], scene: { type: "title", data: { lines: [{ text: "x" }] }, media: [] } }] }, channel()), [{ op: "update", id: "b_001", patch: { text: "b" } }]);
    expect(withFacts.script.beats[0].facts).toEqual(["f_ab12"]);
    expect(withFacts.script.beats[0].scene.data).toEqual({ lines: [{ text: "x" }] });
    expect(c.changed).toEqual(["b_003"]);
    const b3 = c.script.beats.find((x) => x.id === "b_003")!;
    expect(b3.isNew).toBe(true);
    expect(b3.hash).not.toBe(s.beats[2].hash);
    const d = applyBeatEdits(c.script, [{ op: "update", id: "b_004", patch: { scene: { type: "photo", data: {}, media: ["m_ab12"] } } }], { narrated: true });
    expect(d.script.beats.find((x) => x.id === "b_004")!.isNew).toBeUndefined();
    const m = applyBeatEdits(d.script, [{ op: "move", id: "b_005", after: "b_001" }]);
    expect(m.script.beats[1].id).toBe("b_005");
  });

  it("estimates duration from words per minute", () => {
    expect(estimateSeconds([{ text: Array(160).fill("palavra").join(" ") }], 160)).toBeCloseTo(60);
  });
});

describe("automatic script review", () => {
  it("passes a well-formed script", () => {
    const r = research();
    const s = buildScript({ beats: goodBeats(r.facts[0].id), wpm: 60 }, channel());
    const review = reviewScript(s, { channel: channel(), research: r, format: "long" });
    expect(review.issues.filter((i) => i.level === "erro")).toEqual([]);
    expect(review.ok).toBe(true);
    expect(review.stats.realImagePct).toBeGreaterThanOrEqual(34);
  });

  it("catches numbers without facts, text runs, low real imagery, forbidden words, CTAs and order", () => {
    const blogR = emptyResearch();
    mergeFacts(blogR, [{ claim: "x", source: { url: "https://a.blogspot.com/x", publisher: "b" } }]);
    const beats: BeatInput[] = [
      { section: "gancho", text: "Uma frase de abertura muito longa que passa de quinze palavras e não serve como gancho de vídeo nenhum." , cta: "like", scene: title },
      { section: "gancho", text: "Custa 300 reais.", scene: title },
      { section: "gancho", text: "Custa 400 reais.", facts: [blogR.facts[0].id], scene: title },
      { section: "contexto", text: "Imagem ilustrativa da praia.", scene: { type: "photo", data: { tag: "COPACABANA" }, media: [] } },
      { section: "gancho", text: "Voltou ao gancho.", scene: title },
      { section: "assinatura", text: "Tchau", cta: "endscreen", scene: title },
      { section: "veredito", text: "Depois do fim", scene: title },
    ];
    const s = buildScript({ beats }, channel());
    const codes = reviewScript(s, { channel: channel(), research: blogR, format: "long" }).issues.map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(["HOOK_FIRST_SENTENCE", "NUMBER_WITHOUT_FACT", "WEAK_FACT", "TEXT_RUN", "REAL_IMAGE_SHARE", "FORBIDDEN", "PLACE_TAG", "ORDER", "CTA_TOO_EARLY", "ENDSCREEN_NOT_LAST", "TOO_SHORT"]));
  });

  it("builds a brief with usable facts only and the structure scaled to the target", () => {
    const r = research();
    mergeFacts(r, [{ claim: "boato", source: { url: "https://x.blogspot.com/a", publisher: "x" } }]);
    const brief = scriptBrief({ ...channel(), defaults: { ...channel().defaults, longMinMinutes: 10 } }, { title: "Niterói", format: "long" }, r);
    expect(brief.facts).toHaveLength(1);
    expect(brief.targetSeconds).toBe(648);
    expect(brief.structure.reduce((s, m) => s + m.seconds, 0)).toBeGreaterThan(640);
    expect(brief.forbidden).toContain("imagem ilustrativa");
  });
});

describe("store-backed script", () => {
  it("saves, reviews, links facts, edits by id and marks later stages stale", async () => {
    const dir = await mkdtemp(join(tmpdir(), "channel-script-"));
    roots.push(dir);
    const store = new ChannelStore(dir);
    const c = await store.createChannel("default", { name: "Canal", longMinMinutes: 1 });
    const ep = await store.createEpisode("default", c.id, { title: "Niterói" });
    const ids = { profileId: "default", channelId: c.id, episodeId: ep.id };
    await writePronunciations(store, "default", c.id, { Icaraí: "Icaraí" });
    const { added } = await addFacts(store, "default", c.id, ep.id, [{ claim: "População", value: 481749, source: { url: "https://www.ibge.gov.br/x", publisher: "IBGE" } }]);
    const saved = await saveScript(store, ids, { beats: goodBeats(added[0]), wpm: 60 });
    expect(saved.review.ok).toBe(true);
    const r1 = await store.readEpisodeFile("default", c.id, ep.id, "research");
    expect(r1?.facts[0].usedIn).toEqual(["b_002"]);
    await store.setStage("default", c.id, ep.id, "narration", { status: "ok", inputHash: "n" });
    await store.approve("default", c.id, ep.id, "script", "user");
    const edited = await editScript(store, ids, [{ op: "insert", after: "b_005", beat: { section: "tese", text: "Uma fala nova sem número." , scene: title } }]);
    expect(edited.changed).toEqual(["b_011"]);
    const after = await store.getEpisode("default", c.id, ep.id);
    expect(after.stages.narration.status).toBe("desatualizado");
    expect(after.approvals.script).toBeUndefined();
    const page = pageScript(edited.script, 1, 4);
    expect(page).toMatchObject({ page: 1, pages: 3, total: 11 });
    expect(page.beats[0].id).toBe("b_001");
  });
});

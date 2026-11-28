import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ChannelStore } from "../electron/core/channel/channel-store";
import {
  addFacts,
  classifySource,
  emptyResearch,
  factWarnings,
  mergeFacts,
  parseNumber,
  prudentWording,
  setFactExcluded,
  sourceLine,
  usableFact,
} from "../electron/core/channel/research";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "channel-research-"));
  roots.push(dir);
  const store = new ChannelStore(dir);
  const c = await store.createChannel("default", { name: "Canal" });
  const ep = await store.createEpisode("default", c.id, { title: "Niterói" });
  return { store, ids: { profileId: "default", channelId: c.id, episodeId: ep.id } };
}

const ibge = { url: "https://www.ibge.gov.br/cidades/niteroi", publisher: "IBGE", title: "Cidades" };
const g1 = { url: "https://g1.globo.com/rj/noticia/x.ghtml", publisher: "g1" };
const folha = { url: "https://www1.folha.uol.com.br/x.shtml", publisher: "Folha" };
const blog = { url: "https://melhorescidades.blogspot.com/x", publisher: "Blog" };

describe("sources and confidence", () => {
  it("classifies official, press and blog", () => {
    expect(classifySource(ibge.url)).toBe("oficial");
    expect(classifySource("https://www.niteroi.rj.gov.br/x")).toBe("oficial");
    expect(classifySource(g1.url)).toBe("imprensa");
    expect(classifySource(blog.url)).toBe("blog");
    expect(classifySource("https://portalclique.com.br/x")).toBe("outro");
  });

  it("1 official = alta, 1 press = média, blog = baixa, 2 independent = alta", () => {
    const r = emptyResearch();
    mergeFacts(r, [
      { claim: "População de Niterói em 2022", value: "481.749", unit: "habitantes", dataDate: "2022", source: ibge },
      { claim: "Aluguel médio em Icaraí", value: "R$ 4.200", dataDate: "2026", source: g1 },
      { claim: "Niterói tem a melhor praia", source: blog },
    ]);
    expect(r.facts.map((f) => f.confidence)).toEqual(["alta", "média", "baixa"]);
    mergeFacts(r, [{ claim: "Aluguel médio em Icaraí", value: "R$ 4.200,00", source: folha }]);
    expect(r.facts[1].confirmations).toHaveLength(1);
    expect(r.facts[1].confidence).toBe("alta");
    expect(usableFact(r.facts[2])).toBe(false);
  });

  it("never promotes a blog to official, and the same site twice is not independent", () => {
    const r = emptyResearch();
    mergeFacts(r, [{ claim: "x", source: { ...blog, kind: "oficial" } }]);
    expect(r.facts[0].source.kind).toBe("blog");
    mergeFacts(r, [{ claim: "y", value: 1, source: g1 }, { claim: "y", value: 1, source: { url: "https://g1.globo.com/outra", publisher: "g1" } }]);
    expect(r.facts[1].confidence).toBe("média");
  });

  it("turns divergence into conflicts with prudent wording", () => {
    const r = emptyResearch();
    mergeFacts(r, [
      { claim: "População de Niterói", value: "481.749", source: ibge },
      { claim: "população de niterói", value: "481.758", source: g1 },
    ]);
    expect(r.facts).toHaveLength(1);
    expect(r.facts[0].conflicts).toHaveLength(1);
    expect(r.facts[0].prudent).toBe("cerca de 480 mil");
    mergeFacts(r, [{ claim: "Fundação", value: 1549, source: ibge }, { claim: "Fundação", value: 1551, source: g1 }]);
    expect(r.facts[1].prudent).toBe("por volta de 1550");
  });

  it("flags a page date that disagrees with the text, and the text date wins", () => {
    const r = emptyResearch();
    mergeFacts(r, [{ claim: "IPTU sobe", source: { ...g1, publishedAt: "2019-01-01" }, textDate: "3 de março de 2026" }]);
    expect(r.facts[0].suspiciousDate).toBe(true);
    expect(r.facts[0].source.publishedAt).toBe("3 de março de 2026");
  });
});

describe("hard rules", () => {
  const base = (claim: string, extra: object = {}) => {
    const r = emptyResearch();
    mergeFacts(r, [{ claim, source: g1, ...extra }]);
    return r.facts[0];
  };
  it("money needs currency and date; index needs year; accusations are blocked", () => {
    expect(factWarnings(base("Aluguel médio de 4.200")).map((w) => w.code)).toEqual(expect.arrayContaining(["MONEY_NO_CURRENCY", "MONEY_NO_DATE"]));
    expect(factWarnings(base("Aluguel médio de R$ 4.200", { dataDate: "julho de 2026" })).map((w) => w.code)).not.toContain("MONEY_NO_DATE");
    expect(factWarnings(base("IDHM de Niterói é 0,837")).map((w) => w.code)).toContain("INDEX_NO_YEAR");
    expect(factWarnings(base("IDHM de 2010 de Niterói é 0,837")).map((w) => w.code)).not.toContain("INDEX_NO_YEAR");
    const accused = base("Prefeito acusado de desvio");
    expect(usableFact(accused)).toBe(false);
  });
  it("parses Brazilian numbers", () => {
    expect(parseNumber("481.749")).toBe(481749);
    expect(parseNumber("R$ 4,70")).toBeCloseTo(4.7);
    expect(parseNumber("15,5%")).toBeCloseTo(15.5);
    expect(parseNumber("1,2 mil")).toBe(1200);
    expect(parseNumber("3 milhões")).toBe(3e6);
    expect(prudentWording(["3 milhões", "3,2 milhões"])).toBe("cerca de 3,1 milhões");
  });
  it("source line has publisher and date", () => {
    const f = base("População", { dataDate: "2022" });
    expect(sourceLine(f)).toBe("g1 (2022): https://g1.globo.com/rj/noticia/x.ghtml");
  });
});

describe("store-backed facts", () => {
  it("adds, merges and excludes facts", async () => {
    const { store, ids } = await setup();
    const a = await addFacts(store, ids.profileId, ids.channelId, ids.episodeId, [{ claim: "População de Niterói", value: 481749, source: ibge }]);
    expect(a.added).toHaveLength(1);
    expect(a.summary.alta).toBe(1);
    const b = await addFacts(store, ids.profileId, ids.channelId, ids.episodeId, [{ claim: "População de Niterói", value: 481749, source: g1 }]);
    expect(b.merged).toEqual(a.added);
    const r = await setFactExcluded(store, ids.profileId, ids.channelId, ids.episodeId, a.added[0], true);
    expect(r.facts[0].excluded).toBe(true);
  });
});

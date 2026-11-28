import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ChannelStore, channelFromSeries } from "../electron/core/channel/channel-store";
import { SeriesStore } from "../electron/core/series";
import { CHANNEL_SCHEMA_VERSION, STAGES, defaultBible, migrateChannelFile, scoreIdea } from "../src/shared/channel";

const roots: string[] = [];
async function root() {
  const dir = await mkdtemp(join(tmpdir(), "channel-store-"));
  roots.push(dir);
  return dir;
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});
const P = "default";

describe("channel schemas", () => {
  it("default bible has the 8 movements and at most 4 CTAs", () => {
    const b = defaultBible("cidades do Brasil");
    expect(b.structure.map((m) => m.id)).toEqual(["gancho", "contexto", "tese", "lado-bom", "virada", "comparacao", "veredito", "assinatura"]);
    expect(b.ctaPlan.length).toBeLessThanOrEqual(4);
    expect(b.forbidden).toContain("imagem ilustrativa");
  });

  it("migrates files without schemaVersion and bare lists", () => {
    const backlog = migrateChannelFile("backlog", [{ id: "i_ab12", title: "x", angle: "", whyClick: "", format: "long", evidence: [], score: 10, status: "nova" }]);
    expect(backlog).toMatchObject({ schemaVersion: 1, ideas: [{ id: "i_ab12" }] });
    const licenses = migrateChannelFile("licenses", []);
    expect(licenses).toEqual({ schemaVersion: 1, items: [] });
    const research = migrateChannelFile("research", { facts: [], updatedAt: "2026-11-17T00:00:00Z" });
    expect(research.schemaVersion).toBe(CHANNEL_SCHEMA_VERSION);
    expect(research.unread).toEqual([]);
  });

  it("refuses a file from a newer app and invalid data", () => {
    expect(() => migrateChannelFile("licenses", { schemaVersion: 99, items: [] })).toThrow(/mais nova/);
    expect(() => migrateChannelFile("licenses", { schemaVersion: 1, items: [{ id: "m_1", license: "CC BY-NC" }] })).toThrow();
    expect(() => migrateChannelFile("script", null)).toThrow(/inválido/);
  });

  it("scores ideas 40/30/20/10", () => {
    expect(scoreIdea({ demand: 1, gap: 1, fit: 1, imagery: 1 })).toBe(100);
    expect(scoreIdea({ demand: 1, gap: 0, fit: 0, imagery: 0 })).toBe(40);
    expect(scoreIdea({ demand: 2, gap: -1, fit: 0.5, imagery: 1 })).toBe(60);
  });
});

describe("ChannelStore", () => {
  it("creates channels with stable unique ids and atomic files", async () => {
    const store = new ChannelStore(await root());
    const a = await store.createChannel(P, { name: "Vale a Pena Morar?", handle: "valeapenamorarem", niche: "cidades do Brasil" });
    const b = await store.createChannel(P, { name: "Vale a Pena Morar?", handle: "@valeapenamorarem" });
    expect(a.id).toBe("valeapenamorarem");
    expect(b.id).toBe("valeapenamorarem-2");
    expect(a.handle).toBe("@valeapenamorarem");
    expect(a.bible.promise).toContain("cidades do Brasil");
    const files = await readdir(store.channelDir(P, a.id));
    expect(files.sort()).toEqual(["backlog.json", "channel.json"]);
    expect((await store.listChannels(P)).length).toBe(2);
  });

  it("merges a patch one level deep and keeps ids", async () => {
    const store = new ChannelStore(await root());
    const c = await store.createChannel(P, { name: "Mistérios do Mar" });
    const next = await store.updateChannel(P, c.id, { id: "hack", defaults: { voiceId: "andrey" }, cadence: { longPerWeek: 2 } });
    expect(next.id).toBe(c.id);
    expect(next.defaults.voiceId).toBe("andrey");
    expect(next.defaults.voiceSpeed).toBe(1.05);
    expect(next.cadence.longPerWeek).toBe(2);
    expect(next.cadence.shortPerWeek).toBe(7);
  });

  it("keeps backlog order under concurrent writes", async () => {
    const store = new ChannelStore(await root());
    const c = await store.createChannel(P, { name: "Canal" });
    await Promise.all(Array.from({ length: 12 }, (_, n) => store.addIdeas(P, c.id, [{ title: `ideia ${n}` }])));
    const backlog = await store.getBacklog(P, c.id);
    expect(backlog.ideas).toHaveLength(12);
    expect(new Set(backlog.ideas.map((i) => i.id)).size).toBe(12);
  });

  it("creates an episode from an idea with every stage pending, and marks later stages stale", async () => {
    const store = new ChannelStore(await root());
    const c = await store.createChannel(P, { name: "Canal" });
    const [idea] = await store.addIdeas(P, c.id, [{ title: "Niterói vale a pena?" }]);
    const ep = await store.createEpisode(P, c.id, { title: idea.title, ideaId: idea.id });
    expect(ep.id).toMatch(/^ep_[a-z0-9]{4}$/);
    expect(ep.aspect).toBe("16:9");
    expect(Object.keys(ep.stages)).toEqual([...STAGES]);
    expect((await store.getBacklog(P, c.id)).ideas[0].status).toBe("usada");

    await store.setStage(P, c.id, ep.id, "research", { status: "ok", inputHash: "a" });
    await store.setStage(P, c.id, ep.id, "script", { status: "ok", inputHash: "b" });
    await store.setStage(P, c.id, ep.id, "media", { status: "ok", inputHash: "c" });
    const after = await store.setStage(P, c.id, ep.id, "script", { status: "ok", inputHash: "b2" });
    expect(after.stages.research.status).toBe("ok");
    expect(after.stages.media.status).toBe("desatualizado");
    const same = await store.setStage(P, c.id, ep.id, "media", { status: "ok", inputHash: "c" });
    expect(same.stages.media.status).toBe("ok");
  });

  it("adds cost and approvals to the history", async () => {
    const store = new ChannelStore(await root());
    const c = await store.createChannel(P, { name: "Canal" });
    const ep = await store.createEpisode(P, c.id, { title: "x", format: "short" });
    expect(ep.aspect).toBe("9:16");
    await store.addCost(P, c.id, ep.id, { stage: "narration", provider: "elevenlabs", units: 10500, unit: "caracteres", usd: 2.4 });
    const next = await store.addCost(P, c.id, ep.id, { stage: "research", provider: "tavily", units: 12, unit: "buscas", usd: 0.1 });
    expect(next.cost.totalUsd).toBeCloseTo(2.5);
    const ok = await store.approve(P, c.id, ep.id, "script", "user");
    expect(ok.approvals.script?.by).toBe("user");
    expect(ok.history.at(-1)?.action).toBe("aprovou script");
  });

  it("reads and mutates episode files with migration", async () => {
    const store = new ChannelStore(await root());
    const c = await store.createChannel(P, { name: "Canal" });
    const ep = await store.createEpisode(P, c.id, { title: "x" });
    expect(await store.readEpisodeFile(P, c.id, ep.id, "licenses")).toBeUndefined();
    await writeFile(store.episodeFile(P, c.id, ep.id, "licenses"), "[]", "utf8");
    expect(await store.readEpisodeFile(P, c.id, ep.id, "licenses")).toEqual({ schemaVersion: 1, items: [] });
    const research = await store.mutateEpisodeFile(P, c.id, ep.id, "research", () => ({ schemaVersion: 1, questions: [], facts: [], unread: [], pages: [], updatedAt: new Date().toISOString() }), (r) => {
      r.questions.push("Qual a população?");
    });
    expect(research.questions).toEqual(["Qual a população?"]);
    const disk = JSON.parse(await readFile(store.episodeFile(P, c.id, ep.id, "research"), "utf8"));
    expect(disk.schemaVersion).toBe(1);
  });

  it("removes only with confirm:true and rejects unsafe ids", async () => {
    const store = new ChannelStore(await root());
    const c = await store.createChannel(P, { name: "Canal" });
    await expect(store.removeChannel(P, c.id, undefined)).rejects.toThrow(/confirm: true/);
    expect(() => store.channelDir(P, "../fora")).toThrow();
    expect(() => store.episodeDir(P, c.id, "../../x")).toThrow();
    await store.removeChannel(P, c.id, true);
    expect(await store.listChannels(P)).toEqual([]);
  });

  it("skips a broken channel folder instead of failing the list", async () => {
    const dir = await root();
    const store = new ChannelStore(dir);
    await store.createChannel(P, { name: "Bom" });
    await mkdir(join(store.root(P), "quebrado"), { recursive: true });
    await writeFile(join(store.root(P), "quebrado", "channel.json"), "{", "utf8");
    expect((await store.listChannels(P)).map((c) => c.id)).toEqual(["bom"]);
  });
});

describe("migration from series.ts", () => {
  it("maps a series to a channel and its ideas to the backlog", async () => {
    const dir = await root();
    const series = await new SeriesStore(dir).create(P, {
      title: "Os Sócios",
      premise: "dois sócios tentando vender um app",
      tone: "comédia leve",
      rules: "sem palavrão; sempre termina com gancho",
      cta: "Segue pra parte 2",
      ideas: [{ title: "O primeiro cliente", line: "ninguém paga" }],
    });
    const plan = channelFromSeries(series);
    expect(plan.args.bible?.mustHave).toEqual(expect.arrayContaining(["sem palavrão", "sempre termina com gancho"]));
    const store = new ChannelStore(dir);
    const { channel, ideas } = await store.importSeries(P, series);
    expect(ideas).toBe(1);
    expect(channel.importedFrom).toMatchObject({ kind: "series", id: series.id });
    expect(channel.bible.persona.voiceTone).toBe("comédia leve");
    const backlog = await store.getBacklog(P, channel.id);
    expect(backlog.ideas[0]).toMatchObject({ title: "O primeiro cliente", angle: "ninguém paga", format: "short" });
    // The series itself is untouched and still readable.
    expect((await new SeriesStore(dir).get(P, series.id)).series.title).toBe("Os Sócios");
  });
});

import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { assertProfileId } from "../../../src/shared/profile";
import {
  CHANNEL_SCHEMA_VERSION,
  STAGES,
  bibleSchema,
  channelId as channelIdSchema,
  channelSchema,
  defaultBible,
  episodeId as episodeIdSchema,
  episodeSchema,
  freshStages,
  ideaSchema,
  migrateChannelFile,
  scoreIdea,
  type Backlog,
  type Channel,
  type ChannelFileKind,
  type CostItem,
  type Episode,
  type Idea,
  type Licenses,
  type Research,
  type Script,
  type Stage,
} from "../../../src/shared/channel";
import type { Series } from "../../../src/shared/story";
import { KeyedQueue, readJsonOr, shortRandomId, slugify, writeJsonAtomic } from "./fs-json";

/**
 * Channel studio storage (spec "Arquitetura geral" / "Modelo de dados"):
 * `<userData>/profiles/<perfil>/channels/<canal>/channel.json`, `backlog.json`, `episodes/<id>/…`.
 * Every write is atomic and serialized per channel; every read migrates `schemaVersion`.
 */

type EpisodeFiles = { research: Research; script: Script; licenses: Licenses };
type EpisodeFileKind = keyof EpisodeFiles;
const EPISODE_FILE: Record<EpisodeFileKind, string> = { research: "research.json", script: "script.json", licenses: "licenses.json" };

export const createChannelArgs = z.object({
  name: z.string().trim().min(1).max(100),
  handle: z.string().trim().max(31).default(""),
  niche: z.string().trim().max(200).default(""),
  language: z.enum(["pt-BR", "en", "es"]).default("pt-BR"),
  bible: bibleSchema.partial().optional(),
  voiceId: z.string().max(120).default(""),
  voiceSpeed: z.number().min(0.5).max(2).default(1.05),
  longMinMinutes: z.number().min(1).max(60).default(10),
  shortsPerEpisode: z.number().int().min(0).max(6).default(2),
});
export type CreateChannelArgs = z.input<typeof createChannelArgs>;

export const createEpisodeArgs = z.object({
  title: z.string().trim().min(1).max(140),
  format: z.enum(["long", "short"]).default("long"),
  ideaId: z.string().optional(),
});

export class ChannelStore {
  private queue = new KeyedQueue();
  constructor(readonly userDir: string) {}

  // ---------- paths ----------
  root(profileId: string) {
    return join(this.userDir, "profiles", assertProfileId(profileId), "channels");
  }
  channelDir(profileId: string, channelId: string) {
    return join(this.root(profileId), channelIdSchema.parse(channelId));
  }
  episodeDir(profileId: string, channelId: string, episodeId: string) {
    return join(this.channelDir(profileId, channelId), "episodes", episodeIdSchema.parse(episodeId));
  }
  private lock<T>(profileId: string, channelId: string, work: () => Promise<T>) {
    return this.queue.run(`${profileId}/${channelId}`, work);
  }
  private async read<K extends ChannelFileKind>(kind: K, file: string, fallback?: () => unknown) {
    const raw = await readJsonOr(file, fallback ?? (() => {
      throw Object.assign(new Error(`Não encontrei ${kind} em ${file}.`), { code: "NOT_FOUND" });
    }));
    return migrateChannelFile(kind, raw);
  }

  // ---------- channels ----------
  async listChannels(profileId: string) {
    const names = await readdir(this.root(profileId)).catch(() => [] as string[]);
    const out: Channel[] = [];
    for (const name of names) {
      try {
        out.push(await this.getChannel(profileId, name));
      } catch {
        /* A broken folder must not hide the other channels. */
      }
    }
    return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  getChannel(profileId: string, channelId: string): Promise<Channel> {
    return this.read("channel", join(this.channelDir(profileId, channelId), "channel.json"));
  }

  async createChannel(profileId: string, args: CreateChannelArgs, extra: Partial<Pick<Channel, "importedFrom">> = {}) {
    const a = createChannelArgs.parse(args);
    const handle = a.handle ? (a.handle.startsWith("@") ? a.handle : `@${a.handle}`) : "";
    const root = this.root(profileId);
    return this.queue.run(`${profileId}/__create`, async () => {
      const existing = new Set(await readdir(root).catch(() => [] as string[]));
      const base = slugify(handle.replace(/^@/, "") || a.name);
      let id = base;
      for (let n = 2; existing.has(id); n++) id = `${base}-${n}`;
      const now = new Date().toISOString();
      const channel = channelSchema.parse({
        schemaVersion: CHANNEL_SCHEMA_VERSION,
        id,
        profileId,
        name: a.name,
        handle,
        niche: a.niche,
        language: a.language,
        platforms: {},
        bible: { ...defaultBible(a.niche), ...a.bible },
        identity: { logo: "", banner: "", palette: [], fonts: { display: "Anton", body: "Inter" }, signature: "" },
        defaults: { voiceId: a.voiceId, voiceSpeed: a.voiceSpeed, musicMood: [], longMinMinutes: a.longMinMinutes, shortsPerEpisode: a.shortsPerEpisode },
        cadence: { longPerWeek: 3, shortPerWeek: 7, publishTimes: [] },
        ...extra,
        createdAt: now,
        updatedAt: now,
      });
      const dir = this.channelDir(profileId, id);
      await writeJsonAtomic(join(dir, "channel.json"), channel);
      await writeJsonAtomic(join(dir, "backlog.json"), { schemaVersion: CHANNEL_SCHEMA_VERSION, ideas: [] });
      return channel;
    });
  }

  /** Shallow patch of the channel (bible, identity, defaults and cadence are merged one level deep). */
  async updateChannel(profileId: string, channelId: string, patch: Record<string, unknown>) {
    return this.lock(profileId, channelId, async () => {
      const current = await this.getChannel(profileId, channelId);
      const merged: Record<string, unknown> = { ...current };
      for (const [key, value] of Object.entries(patch)) {
        if (["id", "profileId", "schemaVersion", "createdAt"].includes(key)) continue;
        const prev = (current as Record<string, unknown>)[key];
        merged[key] = value && typeof value === "object" && !Array.isArray(value) && prev && typeof prev === "object" ? { ...prev, ...value } : value;
      }
      const next = channelSchema.parse({ ...merged, updatedAt: new Date().toISOString() });
      await writeJsonAtomic(join(this.channelDir(profileId, channelId), "channel.json"), next);
      return next;
    });
  }

  async removeChannel(profileId: string, channelId: string, confirm: unknown) {
    if (confirm !== true) throw new Error("Confirme com o usuário e passe confirm: true para apagar o canal, a pauta e os episódios.");
    return this.lock(profileId, channelId, async () => {
      await rm(this.channelDir(profileId, channelId), { recursive: true, force: true });
      return { removed: channelId };
    });
  }

  // ---------- backlog ----------
  getBacklog(profileId: string, channelId: string): Promise<Backlog> {
    return this.read("backlog", join(this.channelDir(profileId, channelId), "backlog.json"), () => ({ schemaVersion: 1, ideas: [] }));
  }

  async addIdeas(profileId: string, channelId: string, ideas: Array<Partial<Idea> & { title: string }>) {
    return this.lock(profileId, channelId, async () => {
      const backlog = await this.getBacklog(profileId, channelId);
      const taken = new Set(backlog.ideas.map((i) => i.id));
      const added = ideas.map((idea) => {
        let id = idea.id && !taken.has(idea.id) ? idea.id : shortRandomId("i");
        while (taken.has(id)) id = shortRandomId("i");
        taken.add(id);
        return ideaSchema.parse({ angle: "", whyClick: "", format: "long", evidence: [], score: 0, status: "nova", ...idea, id });
      });
      const next = { ...backlog, ideas: [...backlog.ideas, ...added] };
      await writeJsonAtomic(join(this.channelDir(profileId, channelId), "backlog.json"), next);
      return added;
    });
  }

  async updateIdea(profileId: string, channelId: string, ideaId: string, patch: Partial<Idea>) {
    return this.lock(profileId, channelId, async () => {
      const backlog = await this.getBacklog(profileId, channelId);
      const index = backlog.ideas.findIndex((i) => i.id === ideaId);
      if (index < 0) throw new Error(`Ideia ${ideaId} não existe na pauta.`);
      backlog.ideas[index] = ideaSchema.parse({ ...backlog.ideas[index], ...patch, id: ideaId });
      await writeJsonAtomic(join(this.channelDir(profileId, channelId), "backlog.json"), backlog);
      return backlog.ideas[index];
    });
  }

  // ---------- episodes ----------
  async listEpisodes(profileId: string, channelId: string) {
    const dir = join(this.channelDir(profileId, channelId), "episodes");
    const names = await readdir(dir).catch(() => [] as string[]);
    const out: Episode[] = [];
    for (const name of names) {
      if (!episodeIdSchema.safeParse(name).success) continue;
      try {
        out.push(await this.getEpisode(profileId, channelId, name));
      } catch {
        /* skip a broken episode */
      }
    }
    return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  getEpisode(profileId: string, channelId: string, episodeId: string): Promise<Episode> {
    return this.read("episode", join(this.episodeDir(profileId, channelId, episodeId), "episode.json"));
  }

  async createEpisode(profileId: string, channelId: string, args: z.input<typeof createEpisodeArgs>, actor: Episode["history"][number]["actor"] = "user") {
    const a = createEpisodeArgs.parse(args);
    const channel = await this.getChannel(profileId, channelId);
    return this.lock(profileId, channelId, async () => {
      const existing = new Set(await readdir(join(this.channelDir(profileId, channelId), "episodes")).catch(() => [] as string[]));
      let id = shortRandomId("ep");
      while (existing.has(id)) id = shortRandomId("ep");
      const now = new Date().toISOString();
      const episode = episodeSchema.parse({
        schemaVersion: CHANNEL_SCHEMA_VERSION,
        id,
        channelId: channel.id,
        ideaId: a.ideaId,
        format: a.format,
        title: a.title,
        aspect: a.format === "long" ? "16:9" : "9:16",
        stage: "research",
        stages: freshStages(),
        approvals: {},
        cost: { items: [], totalUsd: 0 },
        outputs: { shorts: [], thumbs: [] },
        history: [{ at: now, actor, action: "episódio criado" }],
        createdAt: now,
        updatedAt: now,
      });
      await writeJsonAtomic(join(this.episodeDir(profileId, channelId, id), "episode.json"), episode);
      if (a.ideaId) {
        const backlog = await this.getBacklog(profileId, channelId);
        const idea = backlog.ideas.find((i) => i.id === a.ideaId);
        if (idea) {
          idea.status = "usada";
          await writeJsonAtomic(join(this.channelDir(profileId, channelId), "backlog.json"), backlog);
        }
      }
      return episode;
    });
  }

  /** Read-modify-write of episode.json under the channel lock. */
  async mutateEpisode(profileId: string, channelId: string, episodeId: string, mutate: (episode: Episode) => void | Episode) {
    return this.lock(profileId, channelId, async () => {
      const current = await this.getEpisode(profileId, channelId, episodeId);
      const next = episodeSchema.parse({ ...(mutate(current) ?? current), updatedAt: new Date().toISOString() });
      await writeJsonAtomic(join(this.episodeDir(profileId, channelId, episodeId), "episode.json"), next);
      return next;
    });
  }

  /** Sets a stage state; `ok` on a stage marks every later stage that was `ok` as `desatualizado` when the input changed. */
  async setStage(profileId: string, channelId: string, episodeId: string, stage: Stage, state: Partial<Episode["stages"][Stage]> & { status: Episode["stages"][Stage]["status"] }, actor: Episode["history"][number]["actor"] = "agent") {
    return this.mutateEpisode(profileId, channelId, episodeId, (ep) => {
      const prev = ep.stages[stage];
      const now = new Date().toISOString();
      ep.stages[stage] = { ...prev, ...state, updatedAt: now };
      if (state.status === "ok" && prev.inputHash !== state.inputHash) markStaleAfter(ep, stage);
      if (state.status === "rodando" || state.status === "ok") ep.stage = stage;
      ep.history.push({ at: now, actor, action: `${stage}: ${state.status}${state.error ? ` (${state.error.slice(0, 200)})` : ""}` });
    });
  }

  async addCost(profileId: string, channelId: string, episodeId: string, item: Omit<CostItem, "at">) {
    return this.mutateEpisode(profileId, channelId, episodeId, (ep) => {
      ep.cost.items.push({ ...item, at: new Date().toISOString() });
      ep.cost.totalUsd = Math.round(ep.cost.items.reduce((s, i) => s + i.usd, 0) * 10000) / 10000;
    });
  }

  async approve(profileId: string, channelId: string, episodeId: string, gate: "script" | "frames" | "final", by: Episode["history"][number]["actor"], note?: string) {
    return this.mutateEpisode(profileId, channelId, episodeId, (ep) => {
      const at = new Date().toISOString();
      ep.approvals[gate] = { at, by, note };
      ep.history.push({ at, actor: by, action: `aprovou ${gate}` });
    });
  }

  // ---------- episode files ----------
  episodeFile(profileId: string, channelId: string, episodeId: string, kind: EpisodeFileKind) {
    return join(this.episodeDir(profileId, channelId, episodeId), EPISODE_FILE[kind]);
  }

  async readEpisodeFile<K extends EpisodeFileKind>(profileId: string, channelId: string, episodeId: string, kind: K): Promise<EpisodeFiles[K] | undefined> {
    const raw = await readJsonOr(this.episodeFile(profileId, channelId, episodeId, kind), () => undefined);
    return raw === undefined ? undefined : (migrateChannelFile(kind, raw) as EpisodeFiles[K]);
  }

  async writeEpisodeFile<K extends EpisodeFileKind>(profileId: string, channelId: string, episodeId: string, kind: K, value: EpisodeFiles[K]) {
    const parsed = migrateChannelFile(kind, value) as EpisodeFiles[K];
    await writeJsonAtomic(this.episodeFile(profileId, channelId, episodeId, kind), parsed);
    return parsed;
  }

  /** Read-modify-write of research/script/licenses under the channel lock. */
  async mutateEpisodeFile<K extends EpisodeFileKind>(profileId: string, channelId: string, episodeId: string, kind: K, empty: () => EpisodeFiles[K], mutate: (value: EpisodeFiles[K]) => void | EpisodeFiles[K]) {
    return this.lock(profileId, channelId, async () => {
      const current = (await this.readEpisodeFile(profileId, channelId, episodeId, kind)) ?? empty();
      return this.writeEpisodeFile(profileId, channelId, episodeId, kind, (mutate(current) ?? current) as EpisodeFiles[K]);
    });
  }

  // ---------- migration from series.ts ----------
  /** Turns a story series (`series.ts`) into a channel: premise → promise, tone → voice, rules → must-have, ideas → backlog. The series is left untouched. */
  async importSeries(profileId: string, series: Series) {
    const plan = channelFromSeries(series);
    const channel = await this.createChannel(profileId, plan.args, { importedFrom: { kind: "series", id: series.id, at: new Date().toISOString() } });
    if (plan.ideas.length) await this.addIdeas(profileId, channel.id, plan.ideas);
    return { channel, ideas: plan.ideas.length };
  }
}

/** Stages after `stage` that were ok become `desatualizado` (spec: editing a beat marks the following stages stale). */
export function markStaleAfter(ep: Episode, stage: Stage) {
  const from = STAGES.indexOf(stage);
  for (const later of STAGES.slice(from + 1)) if (ep.stages[later].status === "ok") ep.stages[later] = { ...ep.stages[later], status: "desatualizado" };
}

/** Pure mapping used by `importSeries` (tested on its own). */
export function channelFromSeries(series: Series): { args: CreateChannelArgs; ideas: Array<Partial<Idea> & { title: string }> } {
  const bible = defaultBible(series.premise);
  const rules = series.rules
    .split(/\r?\n|;/)
    .map((r) => r.trim())
    .filter(Boolean)
    .slice(0, 20);
  return {
    args: {
      name: series.title,
      niche: series.premise.slice(0, 200),
      bible: {
        promise: series.premise.slice(0, 300),
        persona: { ...bible.persona, voiceTone: series.tone.slice(0, 300) || bible.persona.voiceTone, pov: "narrador neutro" },
        mustHave: [...bible.mustHave, ...rules].slice(0, 30),
        ctaPlan: series.cta ? [{ kind: "next", at: "end", line: series.cta }] : bible.ctaPlan,
      },
      shortsPerEpisode: 0,
    },
    ideas: series.ideas.map((idea) => ({ title: idea.title, angle: idea.line, whyClick: "", format: "short" as const, score: scoreIdea({ demand: 0.5, gap: 0.5, fit: 1, imagery: 0.5 }) })),
  };
}

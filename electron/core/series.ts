import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { assertProfileId } from "../../src/shared/profile";
import { characterSchema, episodeSchema, ideaSchema, scriptSchema, seriesSchema, type Character, type Episode, type Series } from "../../src/shared/story";

/**
 * Spec 5 F: `<userData>/profiles/<profileId>/series/<seriesId>/series.json` and `episodes/<n>.json`.
 * Validated with zod, written atomically, one queue per profile (like ProfileService).
 */

const slug = (value: string) =>
  value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "serie";
const seriesId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);

async function atomic(file: string, value: unknown) {
  const tmp = `${file}.${randomUUID().slice(0, 8)}.partial`;
  await writeFile(tmp, JSON.stringify(value, null, 2), "utf8");
  await rename(tmp, file);
}

export class SeriesStore {
  private queues = new Map<string, Promise<unknown>>();
  constructor(private userDir: string) {}

  private root(profileId: string) {
    return join(this.userDir, "profiles", assertProfileId(profileId), "series");
  }
  private dir(profileId: string, id: string) {
    return join(this.root(profileId), seriesId.parse(id));
  }
  /** Serializes writes per profile so two edits never interleave. */
  private run<T>(profileId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(profileId) ?? Promise.resolve();
    const next = previous.then(work, work);
    this.queues.set(profileId, next.catch(() => undefined));
    return next;
  }

  async list(profileId: string) {
    let names: string[] = [];
    try {
      names = await readdir(this.root(profileId));
    } catch {
      return [];
    }
    const out: (Series & { episodes: number; nextEpisode?: string; cover?: string })[] = [];
    for (const name of names) {
      try {
        const s = await this.get(profileId, name);
        const next = s.episodes.find((e) => e.state !== "published");
        out.push({ ...s.series, episodes: s.episodes.length, nextEpisode: next?.title ?? s.series.ideas[0]?.title, cover: [...s.episodes].reverse().find((e) => e.output)?.output });
      } catch {
        /* Skip a broken folder instead of hiding every series. */
      }
    }
    return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async get(profileId: string, id: string) {
    const dir = this.dir(profileId, id);
    const series = seriesSchema.parse(JSON.parse(await readFile(join(dir, "series.json"), "utf8")));
    const episodes: Episode[] = [];
    try {
      for (const name of (await readdir(join(dir, "episodes"))).filter((n) => /^\d+\.json$/.test(n)))
        episodes.push(episodeSchema.parse(JSON.parse(await readFile(join(dir, "episodes", name), "utf8"))));
    } catch {
      /* No episodes yet. */
    }
    return { series, episodes: episodes.sort((a, b) => a.number - b.number) };
  }

  static createArgs = z.object({
    title: z.string().trim().min(1).max(120),
    premise: z.string().max(600).default(""),
    tone: z.string().max(300).default(""),
    setting: z.string().max(300).default(""),
    rules: z.string().max(1200).default(""),
    product: z.enum(["never", "sometimes", "end"]).default("sometimes"),
    cta: z.string().max(120).default("Segue pra parte 2"),
    characters: z.array(characterSchema.omit({ id: true }).extend({ id: z.string().optional() })).max(8).default([]),
    ideas: z.array(ideaSchema).max(30).default([]),
  });

  async create(profileId: string, args: unknown) {
    const a = SeriesStore.createArgs.parse(args);
    return this.run(profileId, async () => {
      const now = new Date().toISOString();
      let id = slug(a.title);
      const existing = new Set(await readdir(this.root(profileId)).catch(() => [] as string[]));
      for (let n = 2; existing.has(id); n++) id = `${slug(a.title)}-${n}`;
      const characters = a.characters.map((c) => characterSchema.parse({ ...c, id: c.id && /^[a-z0-9-]+$/.test(c.id) ? c.id : slug(c.name) }));
      if (!characters.some((c) => c.narrator)) characters.push(characterSchema.parse({ id: "narrador", name: "Narrador", role: "Narrador", description: "Conta a história.", speech: "Calmo e claro.", narrator: true }));
      const series = seriesSchema.parse({ version: 1, id, ...a, characters, createdAt: now, updatedAt: now });
      const dir = this.dir(profileId, id);
      await mkdir(join(dir, "episodes"), { recursive: true });
      await atomic(join(dir, "series.json"), series);
      return series;
    });
  }

  async update(profileId: string, id: string, patch: unknown) {
    const p = SeriesStore.createArgs.partial().parse(patch);
    return this.run(profileId, async () => {
      const { series } = await this.get(profileId, id);
      const next = seriesSchema.parse({
        ...series, ...p,
        characters: p.characters ? p.characters.map((c) => characterSchema.parse({ ...c, id: c.id ?? slug(c.name) })) : series.characters,
        updatedAt: new Date().toISOString(),
      });
      await atomic(join(this.dir(profileId, id), "series.json"), next);
      return next;
    });
  }

  async upsertCharacter(profileId: string, id: string, character: unknown) {
    const c = characterSchema.omit({ id: true }).extend({ id: z.string().optional() }).parse(character);
    return this.run(profileId, async () => {
      const { series } = await this.get(profileId, id);
      const cid = c.id ?? slug(c.name);
      const characters = series.characters.some((x) => x.id === cid)
        ? series.characters.map((x) => (x.id === cid ? characterSchema.parse({ ...x, ...c, id: cid }) : x))
        : [...series.characters, characterSchema.parse({ ...c, id: cid })];
      if (characters.length > 8) throw new Error("Uma série tem no máximo 8 personagens.");
      const next = seriesSchema.parse({ ...series, characters, updatedAt: new Date().toISOString() });
      await atomic(join(this.dir(profileId, id), "series.json"), next);
      return next;
    });
  }

  async createEpisode(profileId: string, id: string, args: unknown) {
    const a = z.object({ title: z.string().trim().min(1).max(120), idea: z.string().max(300).default("") }).parse(args);
    return this.run(profileId, async () => {
      const { episodes } = await this.get(profileId, id);
      const number = (episodes.at(-1)?.number ?? 0) + 1;
      const episode = episodeSchema.parse({ version: 1, number, title: a.title, idea: a.idea, state: "idea", updatedAt: new Date().toISOString() });
      await atomic(join(this.dir(profileId, id), "episodes", `${number}.json`), episode);
      return episode;
    });
  }

  async updateEpisode(profileId: string, id: string, number: number, patch: unknown) {
    const p = episodeSchema.omit({ version: true, number: true, updatedAt: true }).partial().extend({ script: scriptSchema.optional() }).parse(patch);
    return this.run(profileId, async () => {
      const file = join(this.dir(profileId, id), "episodes", `${z.number().int().min(1).parse(number)}.json`);
      const current = episodeSchema.parse(JSON.parse(await readFile(file, "utf8")));
      const next = episodeSchema.parse({ ...current, ...p, state: p.state ?? (p.script && current.state === "idea" ? "script" : current.state), updatedAt: new Date().toISOString() });
      await atomic(file, next);
      return next;
    });
  }

  /** Deleting needs confirm:true, like profile_delete. */
  async remove(profileId: string, id: string, confirm: unknown) {
    if (confirm !== true) throw new Error("Confirme com o usuário e passe confirm: true para apagar a série e os episódios.");
    return this.run(profileId, async () => {
      await rm(this.dir(profileId, id), { recursive: true, force: true });
      return { removed: id };
    });
  }
}

export type { Character, Episode, Series };

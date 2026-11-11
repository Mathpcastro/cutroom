import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  assertProfileId,
  assertProjectId,
  parseProfile,
  type StudioProfile,
} from "../../src/shared/profile";

interface ProfileIndex {
  version: 1;
  activeProfileId?: string;
  profileIds: string[];
  legacyMigration?: { version: 1; profileId: string; completedAt: string };
}

interface ProjectIndex {
  version: 1;
  projectIds: string[];
}

function missing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

async function optionalJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (missing(error)) return undefined;
    throw error;
  }
}

function parseIndex(value: unknown): ProfileIndex {
  if (!value) return { version: 1, profileIds: [] };
  const index = value as Partial<ProfileIndex>;
  if (index.version !== 1 || !Array.isArray(index.profileIds)) throw new Error("Profile index inválido.");
  const profileIds = index.profileIds.map(assertProfileId);
  if (new Set(profileIds).size !== profileIds.length) throw new Error("Profile index contém IDs duplicados.");
  if (index.activeProfileId !== undefined) assertProfileId(index.activeProfileId);
  if (index.legacyMigration !== undefined) {
    if (index.legacyMigration.version !== 1 || typeof index.legacyMigration.completedAt !== "string")
      throw new Error("Marcador de migração inválido.");
    assertProfileId(index.legacyMigration.profileId);
  }
  return { ...index, profileIds } as ProfileIndex;
}

function parseProjects(value: unknown): ProjectIndex {
  if (!value) return { version: 1, projectIds: [] };
  const index = value as Partial<ProjectIndex>;
  if (index.version !== 1 || !Array.isArray(index.projectIds)) throw new Error("Project index inválido.");
  const projectIds = index.projectIds.map(assertProjectId);
  if (new Set(projectIds).size !== projectIds.length) throw new Error("Project index contém IDs duplicados.");
  return { version: 1, projectIds };
}

export class ProfileStore {
  private static readonly transactionContext = new AsyncLocalStorage<string>();
  private static readonly queues = new Map<string, Promise<void>>();

  private root: string;
  private initialization: Promise<void> | undefined;

  constructor(userDir: string) {
    this.root = resolve(userDir, "profiles");
  }

  private async initializeRoot(): Promise<void> {
    if (!this.initialization) {
      this.initialization = (async () => {
        await mkdir(this.root, { recursive: true });
        this.root = await realpath(this.root);
      })();
    }
    const initialization = this.initialization;
    try {
      await initialization;
    } catch (error) {
      if (this.initialization === initialization) this.initialization = undefined;
      throw error;
    }
  }

  private lockKey(): string {
    return process.platform === "win32" ? this.root.toLowerCase() : this.root;
  }

  private static enqueue<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = ProfileStore.queues.get(key) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => current);
    ProfileStore.queues.set(key, tail);
    return (async () => {
      await previous;
      try {
        return await operation();
      } finally {
        release();
        if (ProfileStore.queues.get(key) === tail) ProfileStore.queues.delete(key);
      }
    })();
  }

  /** Serializes a complete logical profile transaction across store instances. */
  async runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    await this.initializeRoot();
    const key = this.lockKey();
    if (ProfileStore.transactionContext.getStore() === key) return operation();
    return ProfileStore.enqueue(key, () => ProfileStore.transactionContext.run(key, operation));
  }

  private indexFile() {
    return join(this.root, "index.json");
  }

  private profileDirectory(profileId: string) {
    return join(this.root, assertProfileId(profileId));
  }

  private profileFile(profileId: string) {
    return join(this.profileDirectory(profileId), "profile.json");
  }

  private projectsFile(profileId: string) {
    return join(this.profileDirectory(profileId), "projects.json");
  }

  protected async writeAtomic(file: string, value: unknown): Promise<void> {
    await mkdir(dirname(file), { recursive: true });
    const partial = `${file}.${process.pid}.${randomUUID()}.partial`;
    try {
      await writeFile(partial, `${JSON.stringify(value, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx",
      });
      await rename(partial, file);
    } finally {
      await rm(partial, { force: true });
    }
  }

  private async index(): Promise<ProfileIndex> {
    return parseIndex(await optionalJson(this.indexFile()));
  }

  private async saveIndex(index: ProfileIndex): Promise<void> {
    await this.writeAtomic(this.indexFile(), index);
  }

  async save(input: unknown): Promise<StudioProfile> {
    return this.runExclusive(async () => {
      const profile = parseProfile(input);
      await this.writeAtomic(this.profileFile(profile.id), profile);
      const index = await this.index();
      if (!index.profileIds.includes(profile.id)) index.profileIds.push(profile.id);
      await this.saveIndex(index);
      return profile;
    });
  }

  async get(profileId: string): Promise<StudioProfile> {
    return this.runExclusive(async () => {
      const value = await optionalJson(this.profileFile(assertProfileId(profileId)));
      if (value === undefined) throw new Error("Perfil não encontrado.");
      const profile = parseProfile(value);
      if (profile.id !== profileId) throw new Error("Profile ID não corresponde ao diretório.");
      return profile;
    });
  }

  async list(): Promise<StudioProfile[]> {
    return this.runExclusive(async () => {
      const index = await this.index();
      return Promise.all(index.profileIds.map((profileId) => this.get(profileId)));
    });
  }

  async setActive(profileId: string): Promise<void> {
    return this.runExclusive(async () => {
      const id = assertProfileId(profileId);
      await this.get(id);
      const index = await this.index();
      index.activeProfileId = id;
      await this.saveIndex(index);
    });
  }

  async getActive(): Promise<StudioProfile | undefined> {
    return this.runExclusive(async () => {
      const { activeProfileId } = await this.index();
      return activeProfileId ? this.get(activeProfileId) : undefined;
    });
  }

  async legacyMigration() {
    return this.runExclusive(async () => (await this.index()).legacyMigration);
  }

  async markLegacyMigrated(profileId: string): Promise<void> {
    return this.runExclusive(async () => {
      const id = assertProfileId(profileId);
      await this.get(id);
      const index = await this.index();
      if (index.legacyMigration) {
        if (index.legacyMigration.profileId !== id) throw new Error("Outro perfil já recebeu a migração legada.");
        return;
      }
      index.legacyMigration = { version: 1, profileId: id, completedAt: new Date().toISOString() };
      await this.saveIndex(index);
    });
  }

  async delete(profileId: string): Promise<void> {
    return this.runExclusive(async () => {
      const id = assertProfileId(profileId);
      await this.get(id);
      await rm(this.profileDirectory(id), { recursive: true, force: false });
      const index = await this.index();
      index.profileIds = index.profileIds.filter((candidate) => candidate !== id);
      if (index.activeProfileId === id) delete index.activeProfileId;
      await this.saveIndex(index);
    });
  }

  async linkProject(profileId: string, projectId: string): Promise<void> {
    return this.runExclusive(async () => {
      const id = assertProfileId(profileId);
      const filmId = assertProjectId(projectId);
      await this.get(id);
      const projects = parseProjects(await optionalJson(this.projectsFile(id)));
      if (projects.projectIds.includes(filmId)) throw new Error("Projeto já vinculado a este perfil.");
      const index = await this.index();
      for (const otherId of index.profileIds) {
        if (otherId === id) continue;
        const other = parseProjects(await optionalJson(this.projectsFile(otherId)));
        if (other.projectIds.includes(filmId)) throw new Error("Projeto já pertence a outro perfil.");
      }
      projects.projectIds.push(filmId);
      await this.writeAtomic(this.projectsFile(id), projects);
    });
  }

  async listProjects(profileId: string): Promise<string[]> {
    return this.runExclusive(async () => {
      const id = assertProfileId(profileId);
      await this.get(id);
      return parseProjects(await optionalJson(this.projectsFile(id))).projectIds;
    });
  }
}

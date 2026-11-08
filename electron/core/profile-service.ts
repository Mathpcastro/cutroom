import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  assertProfileHandle,
  assertProfileId,
  parseProfile,
  type CreateStudioProfileInput,
  type StudioProfile,
  type StudioProfilePatch,
} from "../../src/shared/profile";
import { ProfileStore } from "./profile-store";
import type { SecretStore } from "./secrets";

type ProfileSecrets = Pick<SecretStore, "get" | "set">;
type LegacyRecord = Record<string, unknown>;

export interface LegacyProfileMigrationOptions {
  root: string;
  store?: ProfileStore;
  secrets?: ProfileSecrets;
  brand?: unknown;
  voice?: unknown;
  publish?: unknown;
  logger?: (message: string) => void;
}

function record(value: unknown): LegacyRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as LegacyRecord) : {};
}

function string(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function legacyHandle(value: unknown): string {
  const normalized = string(value, "perfil-padrao")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/^@+/, "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 32)
    .replace(/[._-]+$/g, "");
  return assertProfileHandle(normalized || "perfil-padrao");
}

function withoutSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutSecrets);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as LegacyRecord)
      .filter(([key]) => !/(?:api[_-]?key|secret|password|access[_-]?token|refresh[_-]?token|authorization)/i.test(key))
      .map(([key, child]) => [key, withoutSecrets(child)]),
  );
}

function defaultProfile(id: string, name: string, handle: string, now: string): StudioProfile {
  return {
    version: 1,
    id,
    name,
    handle,
    voice: { provider: "local", voiceId: "default" },
    personality: { description: "", presentation: "" },
    brand: { name, accent: "#6445D8", ink: "#141318", paper: "#F7F6F1" },
    instagram: { preferences: {} },
    commercialGoal: "",
    preferences: {},
    createdAt: now,
    updatedAt: now,
  };
}

function applyPatch(profile: StudioProfile, patch: StudioProfilePatch, updatedAt: string): StudioProfile {
  return parseProfile({
    ...profile,
    name: patch.name ?? profile.name,
    handle: patch.handle ?? profile.handle,
    defaultAvatar: patch.defaultAvatar ?? profile.defaultAvatar,
    voice: { ...profile.voice, ...patch.voice },
    personality: { ...profile.personality, ...patch.personality },
    brand: { ...profile.brand, ...patch.brand },
    instagram: {
      ...profile.instagram,
      ...patch.instagram,
      preferences: patch.instagram?.preferences ?? profile.instagram.preferences,
    },
    commercialGoal: patch.commercialGoal ?? profile.commercialGoal,
    preferences: patch.preferences ?? profile.preferences,
    updatedAt,
  });
}

async function readLegacy(root: string, file: string, supplied: unknown): Promise<unknown> {
  if (supplied !== undefined) return supplied;
  try {
    return JSON.parse(await readFile(join(root, file), "utf8"));
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return {};
    throw error;
  }
}

export class ProfileService {
  constructor(private readonly host: { store: ProfileStore; secrets?: ProfileSecrets }) {}

  async create(input: CreateStudioProfileInput): Promise<StudioProfile> {
    const handle = assertProfileHandle(input.handle);
    if ((await this.host.store.list()).some((profile) => profile.id === handle || profile.handle === handle))
      throw new Error("Já existe um perfil com este handle.");
    const now = new Date().toISOString();
    const profile = applyPatch(defaultProfile(handle, input.name, handle, now), input, now);
    await this.host.store.save(profile);
    if (!(await this.host.store.getActive())) await this.host.store.setActive(profile.id);
    return profile;
  }

  async get(profileId: string): Promise<StudioProfile> {
    return this.host.store.get(assertProfileId(profileId));
  }

  async list(): Promise<StudioProfile[]> {
    return this.host.store.list();
  }

  async getActive(): Promise<StudioProfile | undefined> {
    return this.host.store.getActive();
  }

  async setActive(profileId: string): Promise<void> {
    await this.host.store.setActive(assertProfileId(profileId));
  }

  async update(profileId: string, patch: StudioProfilePatch): Promise<StudioProfile> {
    const current = await this.get(profileId);
    const next = applyPatch(current, patch, new Date().toISOString());
    if (next.handle !== current.handle && (await this.list()).some((profile) => profile.handle === next.handle))
      throw new Error("Já existe um perfil com este handle.");
    return this.host.store.save(next);
  }

  async linkProject(profileId: string, projectId: string): Promise<void> {
    await this.host.store.linkProject(profileId, projectId);
  }

  async listProjects(profileId: string): Promise<string[]> {
    return this.host.store.listProjects(profileId);
  }

  async delete(profileId: string, confirmation: "DELETE"): Promise<void> {
    if (confirmation !== "DELETE") throw new Error("Exclusão exige confirmação explícita DELETE.");
    await this.host.store.delete(assertProfileId(profileId));
  }
}

export async function migrateLegacyProfile(options: LegacyProfileMigrationOptions): Promise<StudioProfile> {
  const store = options.store ?? new ProfileStore(options.root);
  const migrated = await store.legacyMigration();
  if (migrated) return store.get(migrated.profileId);

  const [brandInput, voiceInput, publishInput] = await Promise.all([
    readLegacy(options.root, "brand.json", options.brand),
    readLegacy(options.root, "voice.json", options.voice),
    readLegacy(options.root, "publish.json", options.publish),
  ]);
  const legacyBrand = record(brandInput);
  const legacyVoice = record(voiceInput);
  const legacyPublish = record(publishInput);
  const palette = record(legacyBrand.palette);
  const voices = record(legacyVoice.voices);
  const requestedProvider = string(legacyVoice.provider, "local");
  const provider = (["elevenlabs", "kokoro", "openai", "local"] as const).includes(
    requestedProvider as "elevenlabs" | "kokoro" | "openai" | "local",
  )
    ? (requestedProvider as StudioProfile["voice"]["provider"])
    : "local";
  const now = new Date().toISOString();
  const handle = legacyHandle(legacyBrand.handle);
  const publishPreferences = record(legacyPublish.preferences);
  const accounts = Array.isArray(legacyPublish.accounts) ? legacyPublish.accounts : undefined;
  const profile = defaultProfile("perfil-padrao", "Perfil padrão", handle, now);
  profile.brand = {
    name: string(legacyBrand.name, "Minha marca"),
    accent: string(palette.accent, "#7C5CFF"),
    ink: string(palette.ink, "#141318"),
    paper: string(palette.paper, "#F7F6F1"),
  };
  profile.voice = {
    provider,
    voiceId: string(voices[provider] ?? legacyVoice.voiceId, "default"),
    ...(provider === "elevenlabs" || provider === "openai" ? { credentialRef: provider } : {}),
  };
  profile.personality = {
    description: string(legacyBrand.context),
    presentation: string(legacyBrand.designKit),
  };
  profile.commercialGoal = string(legacyBrand.context);
  profile.instagram = {
    ...(string(legacyPublish.defaultAccount) ? { connectionId: string(legacyPublish.defaultAccount) } : {}),
    preferences: (Object.keys(publishPreferences).length
      ? withoutSecrets(publishPreferences)
      : accounts
        ? { accounts: withoutSecrets(accounts) }
        : {}) as Record<string, unknown>,
  };

  const saved = await store.save(parseProfile(profile));
  if (!(await store.getActive())) await store.setActive(saved.id);
  await store.markLegacyMigrated(saved.id);
  options.logger?.("Migração do perfil legado concluída sem copiar credenciais.");
  return saved;
}

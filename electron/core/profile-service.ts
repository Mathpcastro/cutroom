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

const PREFERENCE_ERROR = "Preferências contêm campos ou valores não permitidos.";
const INVALID_PREFERENCE = Symbol("invalid-preference");
const INVALID_STRUCTURE = Symbol("invalid-structure");

type PreferenceRule =
  | { kind: "object"; fields: Record<string, PreferenceRule>; required?: readonly string[] }
  | { kind: "array"; items: PreferenceRule; maxItems: number }
  | { kind: "boolean" }
  | { kind: "string"; nullable?: boolean; maxLength: number; allowEmpty?: boolean }
  | { kind: "id" };

const INSTAGRAM_ACCOUNTS_RULE: PreferenceRule = {
  kind: "array",
  maxItems: 500,
  items: {
    kind: "object",
    required: ["id"],
    fields: {
      id: { kind: "string", maxLength: 200, allowEmpty: false },
      userId: { kind: "id" },
      igUserId: { kind: "id" },
      username: { kind: "string", nullable: true, maxLength: 200 },
      status: { kind: "string", nullable: true, maxLength: 200 },
    },
  },
};

/**
 * Closed allowlist for every free-form profile preference.
 *
 * `preferences` currently has no free keys: brand and voice already use typed fields.
 * Instagram supports `shareToFeed` from publishReel and `accounts` from Publisher's
 * public InstagramAccount metadata (id, userId, igUserId, username, status).
 * Everything else, including credentialRef outside voice, is rejected or discarded.
 * Structural corruption (accessors, cycles, extra array properties, symbols or custom
 * prototypes) discards the entire containing field during legacy migration.
 */
export const PROFILE_FREE_FIELD_ALLOWLIST = {
  preferences: {
    kind: "object",
    fields: {
      // Avatar creator: name, personality and the layer choices (JSON, validated again when saving).
      avatarStudio: {
        kind: "object",
        fields: {
          name: { kind: "string", maxLength: 40, allowEmpty: false },
          personality: { kind: "string", maxLength: 600, allowEmpty: true },
          choice: { kind: "string", maxLength: 600, allowEmpty: false },
        },
      },
    },
  },
  instagramPreferences: {
    kind: "object",
    fields: {
      shareToFeed: { kind: "boolean" },
      accounts: INSTAGRAM_ACCOUNTS_RULE,
    },
  },
} as const satisfies Record<string, PreferenceRule>;

function preferenceValue(
  value: unknown,
  rule: PreferenceRule,
  mode: "reject" | "discard",
  ancestors: WeakSet<object>,
): unknown | typeof INVALID_PREFERENCE | typeof INVALID_STRUCTURE {
  const invalid = (structural = false): typeof INVALID_PREFERENCE | typeof INVALID_STRUCTURE => {
    if (mode === "reject") throw new Error(PREFERENCE_ERROR);
    return structural ? INVALID_STRUCTURE : INVALID_PREFERENCE;
  };
  if (rule.kind === "boolean") return typeof value === "boolean" ? value : invalid();
  if (rule.kind === "string") {
    if (value === null && rule.nullable) return null;
    return typeof value === "string" &&
      value.length <= rule.maxLength &&
      (rule.allowEmpty !== false || value.length > 0)
      ? value
      : invalid();
  }
  if (rule.kind === "id") {
    if (value === null) return null;
    if (typeof value === "string") return value.length <= 200 ? value : invalid();
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : invalid();
  }
  if (!value || typeof value !== "object") return invalid();
  if (ancestors.has(value)) return invalid(true);
  if (rule.kind === "array") {
    if (!Array.isArray(value) || value.length > rule.maxItems) return invalid();
    if (Object.getPrototypeOf(value) !== Array.prototype || Object.getOwnPropertySymbols(value).length)
      return invalid(true);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const key of Reflect.ownKeys(value)) {
      if (key === "length") continue;
      if (typeof key === "symbol" || !/^(0|[1-9]\d*)$/.test(key)) return invalid(true);
      const descriptor = descriptors[key];
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return invalid(true);
    }
    ancestors.add(value);
    try {
      const result: unknown[] = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return invalid(true);
        const parsed = preferenceValue(descriptor.value, rule.items, mode, ancestors);
        if (parsed === INVALID_STRUCTURE) return parsed;
        if (parsed !== INVALID_PREFERENCE) result.push(parsed);
      }
      return result;
    } finally {
      ancestors.delete(value);
    }
  }
  if (Array.isArray(value)) return invalid();
  const prototype = Object.getPrototypeOf(value);
  if ((prototype !== Object.prototype && prototype !== null) || Object.getOwnPropertySymbols(value).length)
    return invalid(true);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.values(descriptors).some((descriptor) => !("value" in descriptor) || !descriptor.enumerable))
    return invalid(true);
  ancestors.add(value);
  try {
    const object = value as Record<string, unknown>;
    for (const key of rule.required ?? []) if (!Object.hasOwn(object, key)) return invalid();
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(descriptors)) {
      const field = Object.hasOwn(rule.fields, key) ? rule.fields[key] : undefined;
      if (!field) {
        if (mode === "reject") return invalid();
        continue;
      }
      const parsed = preferenceValue(child.value, field, mode, ancestors);
      if (parsed === INVALID_STRUCTURE) return parsed;
      if (parsed !== INVALID_PREFERENCE) result[key] = parsed;
    }
    return result;
  } finally {
    ancestors.delete(value);
  }
}

function normalizeFreePreferences<T extends StudioProfilePatch>(patch: T): T {
  const preferences = preferenceValue(
    patch.preferences ?? {},
    PROFILE_FREE_FIELD_ALLOWLIST.preferences,
    "reject",
    new WeakSet(),
  );
  const instagramPreferences =
    patch.instagram?.preferences === undefined
      ? undefined
      : preferenceValue(
          patch.instagram.preferences,
          PROFILE_FREE_FIELD_ALLOWLIST.instagramPreferences,
          "reject",
          new WeakSet(),
        );
  return {
    ...patch,
    ...(patch.preferences === undefined ? {} : { preferences }),
    ...(patch.instagram === undefined
      ? {}
      : {
          instagram: {
            ...patch.instagram,
            ...(instagramPreferences === undefined ? {} : { preferences: instagramPreferences }),
          },
        }),
  } as T;
}

function sanitizeLegacyPreferences(preferences: unknown, accounts: unknown) {
  const parsedPreferences = preferenceValue(
    preferences,
    PROFILE_FREE_FIELD_ALLOWLIST.instagramPreferences,
    "discard",
    new WeakSet(),
  );
  const parsedAccounts = preferenceValue(accounts, INSTAGRAM_ACCOUNTS_RULE, "discard", new WeakSet());
  const safePreferences = record(parsedPreferences);
  if (!Object.hasOwn(safePreferences, "accounts") && Array.isArray(parsedAccounts) && parsedAccounts.length)
    return { ...safePreferences, accounts: parsedAccounts };
  return safePreferences;
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
  patch = normalizeFreePreferences(patch);
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
    return this.host.store.runExclusive(async () => {
      const handle = assertProfileHandle(input.handle);
      if ((await this.host.store.list()).some((profile) => profile.id === handle || profile.handle === handle))
        throw new Error("Já existe um perfil com este handle.");
      const now = new Date().toISOString();
      const profile = applyPatch(defaultProfile(handle, input.name, handle, now), input, now);
      await this.host.store.save(profile);
      if (!(await this.host.store.getActive())) await this.host.store.setActive(profile.id);
      return profile;
    });
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
    await this.host.store.setActive(profileId);
  }

  async update(profileId: string, patch: StudioProfilePatch): Promise<StudioProfile> {
    return this.host.store.runExclusive(async () => {
      const current = await this.get(profileId);
      const next = applyPatch(current, patch, new Date().toISOString());
      if (next.handle !== current.handle && (await this.list()).some((profile) => profile.handle === next.handle))
        throw new Error("Já existe um perfil com este handle.");
      return this.host.store.save(next);
    });
  }

  async linkProject(profileId: string, projectId: string): Promise<void> {
    await this.host.store.linkProject(profileId, projectId);
  }

  async listProjects(profileId: string): Promise<string[]> {
    return this.host.store.listProjects(profileId);
  }

  async delete(profileId: string, confirmation: "DELETE"): Promise<void> {
    await this.host.store.runExclusive(async () => {
      if (confirmation !== "DELETE") throw new Error("Exclusão exige confirmação explícita DELETE.");
      await this.host.store.delete(profileId);
    });
  }
}

export async function migrateLegacyProfile(options: LegacyProfileMigrationOptions): Promise<StudioProfile> {
  const store = options.store ?? new ProfileStore(options.root);
  return store.runExclusive(async () => {
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
    const sanitizedPreferences = sanitizeLegacyPreferences(publishPreferences, accounts);
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
      preferences: sanitizedPreferences,
    };

    const saved = await store.save(parseProfile(profile));
    if (!(await store.getActive())) await store.setActive(saved.id);
    await store.markLegacyMigrated(saved.id);
    options.logger?.("Migração do perfil legado concluída sem copiar credenciais.");
    return saved;
  });
}

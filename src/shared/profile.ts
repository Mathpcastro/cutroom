import { z } from "zod";

export const PROFILE_VERSION = 1;
export const PROFILE_ID_PATTERN = /^[A-Za-z][A-Za-z0-9._-]{0,63}$/;
export const PROFILE_HANDLE_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,30}[a-z0-9])?$/;
export const AVATAR_HASH_PATTERN = /^[a-f0-9]{64}$/;

const id = z.string().regex(PROFILE_ID_PATTERN);
const handle = z.string().regex(PROFILE_HANDLE_PATTERN);
const color = z.string().regex(/^#[0-9a-f]{6}$/i);
const text = (max: number, required = false) => {
  const schema = z.string().max(max).refine((value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value));
  return required ? schema.min(1) : schema;
};
const preferences = z.record(z.string(), z.unknown());

export interface StudioProfile {
  version: 1;
  id: string;
  name: string;
  handle: string;
  defaultAvatar?: { avatarId: string; revision: number; hash: string };
  voice: {
    provider: "elevenlabs" | "kokoro" | "openai" | "local";
    voiceId: string;
    credentialRef?: string;
  };
  personality: { description: string; presentation: string };
  brand: { name: string; accent: string; ink: string; paper: string; logoAssetId?: string };
  instagram: { connectionId?: string; preferences: Record<string, unknown> };
  commercialGoal: string;
  preferences: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export type StudioProfilePatch = {
  name?: string;
  handle?: string;
  defaultAvatar?: StudioProfile["defaultAvatar"];
  voice?: Partial<StudioProfile["voice"]>;
  personality?: Partial<StudioProfile["personality"]>;
  brand?: Partial<StudioProfile["brand"]>;
  instagram?: { connectionId?: string; preferences?: Record<string, unknown> };
  commercialGoal?: string;
  preferences?: Record<string, unknown>;
};

export type CreateStudioProfileInput = StudioProfilePatch & {
  name: string;
  handle: string;
};

export const studioProfileSchema = z.strictObject({
  version: z.literal(PROFILE_VERSION),
  id,
  name: text(200, true),
  handle,
  defaultAvatar: z
    .strictObject({
      avatarId: id,
      revision: z.number().int().positive(),
      hash: z.string().regex(AVATAR_HASH_PATTERN),
    })
    .optional(),
  voice: z.strictObject({
    provider: z.enum(["elevenlabs", "kokoro", "openai", "local"]),
    voiceId: text(200, true),
    credentialRef: z.string().regex(/^[a-z][a-z0-9.-]{0,63}$/).optional(),
  }),
  personality: z.strictObject({ description: text(60_000), presentation: text(60_000) }),
  brand: z.strictObject({
    name: text(200, true),
    accent: color,
    ink: color,
    paper: color,
    logoAssetId: id.optional(),
  }),
  instagram: z.strictObject({ connectionId: id.optional(), preferences }),
  commercialGoal: text(60_000),
  preferences,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export function parseProfile(input: unknown): StudioProfile {
  const serialized = JSON.stringify(input);
  if (serialized !== undefined && Buffer.byteLength(serialized, "utf8") > 512 * 1024)
    throw new Error("Profile JSON exceeds the 512 KiB input limit.");
  return studioProfileSchema.parse(input) as StudioProfile;
}

export function assertProfileId(value: unknown): string {
  if (typeof value !== "string" || !PROFILE_ID_PATTERN.test(value)) throw new Error("Profile ID inválido.");
  return value;
}

export function assertProjectId(value: unknown): string {
  if (typeof value !== "string" || !PROFILE_ID_PATTERN.test(value)) throw new Error("Project ID inválido.");
  return value;
}

export function assertProfileHandle(value: unknown): string {
  if (typeof value !== "string" || !PROFILE_HANDLE_PATTERN.test(value)) throw new Error("Profile handle inválido.");
  return value;
}

import { z } from "zod";
import type {
  CreateStudioProfileInput,
  StudioProfilePatch,
} from "../../src/shared/profile";
import type { ProfileService } from "./profile-service";

const objectSchema = (
  properties: Record<string, unknown> = {},
  required: string[] = [],
) => ({ type: "object", properties, required, additionalProperties: false });

const profileId = {
  type: "string",
  pattern: "^[A-Za-z][A-Za-z0-9._-]{0,63}$",
};
const handle = {
  type: "string",
  pattern: "^[a-z0-9](?:[a-z0-9._-]{0,30}[a-z0-9])?$",
};
const text = (maxLength: number, minLength?: number) => ({
  type: "string",
  maxLength,
  ...(minLength ? { minLength } : {}),
});
const color = { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" };
const account = objectSchema(
  {
    id: text(200, 1),
    userId: {
      anyOf: [
        { type: "string", maxLength: 200 },
        { type: "integer", minimum: 0 },
        { type: "null" },
      ],
    },
    igUserId: {
      anyOf: [
        { type: "string", maxLength: 200 },
        { type: "integer", minimum: 0 },
        { type: "null" },
      ],
    },
    username: { anyOf: [{ type: "string", maxLength: 200 }, { type: "null" }] },
    status: { anyOf: [{ type: "string", maxLength: 200 }, { type: "null" }] },
  },
  ["id"],
);
const instagramPreferences = objectSchema({
  shareToFeed: { type: "boolean" },
  accounts: { type: "array", maxItems: 500, items: account },
});
const profilePatch = {
  name: text(200, 1),
  handle,
  defaultAvatar: objectSchema(
    {
      avatarId: profileId,
      revision: { type: "integer", minimum: 1 },
      hash: { type: "string", pattern: "^[a-f0-9]{64}$" },
    },
    ["avatarId", "revision", "hash"],
  ),
  voice: objectSchema({
    provider: { type: "string", enum: ["elevenlabs", "kokoro", "openai", "local"] },
    voiceId: text(200, 1),
    credentialRef: { type: "string", pattern: "^[a-z][a-z0-9.-]{0,63}$" },
  }),
  personality: objectSchema({
    description: text(60_000),
    presentation: text(60_000),
  }),
  brand: objectSchema({
    name: text(200, 1),
    accent: color,
    ink: color,
    paper: color,
    logoAssetId: profileId,
  }),
  instagram: objectSchema({
    connectionId: profileId,
    preferences: instagramPreferences,
  }),
  commercialGoal: text(60_000),
  preferences: objectSchema(),
};

export const PROFILE_TOOLS = [
  {
    name: "profile_create",
    description:
      "Create a Videosell creator profile. Only documented brand, voice, avatar-reference and preference fields are accepted; never send credential values.",
    inputSchema: objectSchema(profilePatch, ["name", "handle"]),
  },
  {
    name: "profile_get",
    description: "Read one creator profile by its application-issued ID.",
    inputSchema: objectSchema({ profileId }, ["profileId"]),
  },
  {
    name: "profile_list",
    description: "List creator profiles without reading any credential store.",
    inputSchema: objectSchema(),
  },
  {
    name: "profile_update",
    description:
      "Update documented creator-profile fields through ProfileService. Unknown preferences and credential values are rejected.",
    inputSchema: objectSchema(
      { profileId, patch: objectSchema(profilePatch) },
      ["profileId", "patch"],
    ),
  },
  {
    name: "profile_duplicate",
    description:
      "Duplicate brand, safe preferences and avatar reference into a new handle. Credential references, connections and project links are never copied.",
    inputSchema: objectSchema({ profileId, name: text(200, 1), handle }, [
      "profileId",
      "name",
      "handle",
    ]),
  },
  {
    name: "profile_delete",
    description:
      "Delete only creator-profile metadata. Requires exact DELETE confirmation and separate explicit authorization from the trusted caller.",
    inputSchema: objectSchema(
      { profileId, confirmation: { type: "string", const: "DELETE" } },
      ["profileId", "confirmation"],
    ),
  },
  {
    name: "profile_select",
    description: "Select the active creator profile by ID.",
    inputSchema: objectSchema({ profileId }, ["profileId"]),
  },
  {
    name: "profile_list_projects",
    description: "List only project IDs linked to one creator profile.",
    inputSchema: objectSchema({ profileId }, ["profileId"]),
  },
] as const;

export type ProfileToolName = (typeof PROFILE_TOOLS)[number]["name"];

export function isProfileTool(name: string): name is ProfileToolName {
  return PROFILE_TOOLS.some((tool) => tool.name === name);
}

export interface ProfileToolCaller {
  id: "ui" | "agent" | "desktop-mcp";
  authorizeProfileDelete?: boolean;
}

/** Trusted host capability, injected only by the authenticated Desktop MCP transport. */
export const DESKTOP_MCP_PROFILE_CALLER = {
  id: "desktop-mcp",
  authorizeProfileDelete: true,
} as const satisfies ProfileToolCaller;

export type ProfileToolService = Pick<
  ProfileService,
  "create" | "get" | "list" | "update" | "setActive" | "listProjects" | "delete"
>;

const profileData = {
  defaultAvatar: z.unknown().optional(),
  voice: z.unknown().optional(),
  personality: z.unknown().optional(),
  brand: z.unknown().optional(),
  instagram: z.unknown().optional(),
  commercialGoal: z.unknown().optional(),
  preferences: z.unknown().optional(),
};
const createInput = z.strictObject({
  name: z.string(),
  handle: z.string(),
  ...profileData,
});
const updateInput = z.strictObject({
  profileId: z.string(),
  patch: z.strictObject({
    name: z.string().optional(),
    handle: z.string().optional(),
    ...profileData,
  }),
});
const profileIdInput = z.strictObject({ profileId: z.string() });
const duplicateInput = z.strictObject({
  profileId: z.string(),
  name: z.string(),
  handle: z.string(),
});
const deleteInput = z.strictObject({
  profileId: z.string(),
  confirmation: z.literal("DELETE"),
});

/** The only profile operation boundary used by renderer IPC, agents and Desktop MCP. */
export function createProfileToolDispatcher(service: ProfileToolService) {
  return async (
    name: string,
    value: Record<string, unknown>,
    caller?: ProfileToolCaller,
  ): Promise<unknown> => {
    if (!isProfileTool(name)) throw new Error("Ferramenta de perfil desconhecida.");
    switch (name) {
      case "profile_create":
        return service.create(createInput.parse(value) as CreateStudioProfileInput);
      case "profile_get": {
        const { profileId } = profileIdInput.parse(value);
        return service.get(profileId);
      }
      case "profile_list":
        z.strictObject({}).parse(value);
        return service.list();
      case "profile_update": {
        const input = updateInput.parse(value);
        return service.update(input.profileId, input.patch as StudioProfilePatch);
      }
      case "profile_duplicate": {
        const input = duplicateInput.parse(value);
        const source = await service.get(input.profileId);
        const { credentialRef: _credentialRef, ...voice } = source.voice;
        return service.create({
          name: input.name,
          handle: input.handle,
          ...(source.defaultAvatar ? { defaultAvatar: { ...source.defaultAvatar } } : {}),
          voice,
          personality: { ...source.personality },
          brand: { ...source.brand },
          instagram: { preferences: source.instagram.preferences },
          commercialGoal: source.commercialGoal,
          preferences: source.preferences,
        });
      }
      case "profile_delete": {
        const input = deleteInput.parse(value);
        if (caller?.authorizeProfileDelete !== true)
          throw new Error("Exclusão de perfil não autorizada pelo caller.");
        return service.delete(input.profileId, input.confirmation);
      }
      case "profile_select": {
        const { profileId } = profileIdInput.parse(value);
        return service.setActive(profileId);
      }
      case "profile_list_projects": {
        const { profileId } = profileIdInput.parse(value);
        return service.listProjects(profileId);
      }
    }
  };
}

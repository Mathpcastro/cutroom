import { AVATAR_RUBRIC_LIMITS } from "./avatar-service";

/** JSON Schema convention shared by Codex, API agents and the Desktop MCP server. */
const objectSchema = (
  properties: Record<string, unknown> = {},
  required: string[] = [],
) => ({ type: "object", properties, required, additionalProperties: false });

const id = (description: string) => ({
  type: "string",
  description,
  pattern: "^[A-Za-z][A-Za-z0-9._-]{0,63}$",
});
const revision = {
  type: "integer",
  minimum: 1,
  description: "Persisted avatar revision number.",
};
const avatarId = id("Avatar ID returned by avatar_create_candidate.");
const candidateId = id("Candidate ID managed by the AvatarService.");
const avatarPackage = {
  type: "object",
  description:
    "Complete avatar package. The application schema is authoritative: canonical JSON must not exceed 256 KiB, below the 1 MiB MCP transport limit.",
};

export const AVATAR_TOOLS = [
  {
    name: "avatar_get_contract",
    description:
      "Read the deterministic Videosell avatar package, proof-sheet, rubric and reference-analysis contract before creating or revising an avatar.",
    inputSchema: objectSchema(),
  },
  {
    name: "avatar_create_candidate",
    description:
      "Validate and persist one model-authored avatar package through AvatarService. No executable content or file destination is accepted.",
    inputSchema: objectSchema(
      {
        avatarId: avatarId,
        description: {
          type: "string",
          maxLength: 4096,
          description:
            "Candidate description metadata; never used to generate a package.",
        },
        referenceAssetId: id(
          "Previously imported reference asset to associate with the candidate.",
        ),
        package: avatarPackage,
      },
      ["package"],
    ),
  },
  {
    name: "avatar_render",
    description:
      "Render real native PNG proof sheets with the shared rig and return their pixel/content hashes plus one composed inspection JPEG. JPEG is never pixel-exact evidence.",
    inputSchema: objectSchema(
      {
        avatarId,
        revision,
        sheets: {
          type: "array",
          minItems: 1,
          maxItems: 7,
          uniqueItems: true,
          items: {
            type: "string",
            enum: [
              "neutral",
              "silhouette",
              "grayscale",
              "backgrounds",
              "expressions",
              "mouths",
              "motion",
            ],
          },
        },
      },
      ["avatarId", "revision", "sheets"],
    ),
  },
  {
    name: "avatar_validate",
    description:
      "Validate an immutable persisted revision through the shared deterministic quality gates.",
    inputSchema: objectSchema({ avatarId, revision }, ["avatarId", "revision"]),
  },
  {
    name: "avatar_review",
    description:
      "Record a seven-category visual review using only native PNG evidence already registered for the same candidate and revision.",
    inputSchema: objectSchema(
      {
        avatarId,
        candidateId,
        rubric: objectSchema(
          {
            identity: {
              type: "integer",
              minimum: 0,
              maximum: AVATAR_RUBRIC_LIMITS.identity,
            },
            silhouette: {
              type: "integer",
              minimum: 0,
              maximum: AVATAR_RUBRIC_LIMITS.silhouette,
            },
            pixelCraft: {
              type: "integer",
              minimum: 0,
              maximum: AVATAR_RUBRIC_LIMITS.pixelCraft,
            },
            palette: {
              type: "integer",
              minimum: 0,
              maximum: AVATAR_RUBRIC_LIMITS.palette,
            },
            expressions: {
              type: "integer",
              minimum: 0,
              maximum: AVATAR_RUBRIC_LIMITS.expressions,
            },
            rig: {
              type: "integer",
              minimum: 0,
              maximum: AVATAR_RUBRIC_LIMITS.rig,
            },
            export: {
              type: "integer",
              minimum: 0,
              maximum: AVATAR_RUBRIC_LIMITS.export,
            },
          },
          [
            "identity",
            "silhouette",
            "pixelCraft",
            "palette",
            "expressions",
            "rig",
            "export",
          ],
        ),
        evidence: {
          type: "array",
          maxItems: 32,
          uniqueItems: true,
          items: { type: "string", minLength: 1, maxLength: 4096 },
        },
        manualApproved: {
          type: "boolean",
          description:
            "Explicit manual approval only; a high score never implies approval.",
        },
      },
      ["avatarId", "candidateId", "rubric", "evidence"],
    ),
  },
  {
    name: "avatar_select_candidate",
    description:
      "Select the exact persisted candidate and save its immutable revision.",
    inputSchema: objectSchema({ avatarId, candidateId }, [
      "avatarId",
      "candidateId",
    ]),
  },
  {
    name: "avatar_revise_part",
    description:
      "Create a corrected candidate through the shared revision gates. Only allowedPartIds may change; identity and palette remain protected.",
    inputSchema: objectSchema(
      {
        avatarId,
        revision,
        allowedPartIds: {
          type: "array",
          minItems: 1,
          maxItems: 256,
          uniqueItems: true,
          items: id("Avatar part ID authorized for correction."),
        },
        package: avatarPackage,
      },
      ["avatarId", "revision", "allowedPartIds", "package"],
    ),
  },
  {
    name: "avatar_save_revision",
    description:
      "Idempotently save the selected candidate as an immutable approved revision.",
    inputSchema: objectSchema({ avatarId, candidateId }, [
      "avatarId",
      "candidateId",
    ]),
  },
  {
    name: "avatar_compare_revisions",
    description:
      "Compare hashes, frozen identity anchors, changed parts and quality reports of two persisted revisions.",
    inputSchema: objectSchema(
      { avatarId, leftRevision: revision, rightRevision: revision },
      ["avatarId", "leftRevision", "rightRevision"],
    ),
  },
  {
    name: "avatar_cancel",
    description:
      "Cancel one active avatar render job by its service-issued jobId.",
    inputSchema: objectSchema({ jobId: id("Active avatar render job ID.") }, [
      "jobId",
    ]),
  },
  {
    name: "avatar_import_reference",
    description:
      "Import one explicitly named absolute local PNG, JPEG or WebP reference. Signature, extension and size are verified; the store chooses a contained asset ID and destination.",
    inputSchema: objectSchema(
      {
        avatarId,
        path: {
          type: "string",
          minLength: 1,
          maxLength: 4096,
          description:
            "Absolute source path of the PNG/JPEG/WebP reference; never a destination.",
        },
      },
      ["avatarId", "path"],
    ),
  },
  {
    name: "avatar_analyze_reference",
    description:
      "Send a previously imported reference to the selected provider only when supportsVision is true. Returns structured identity anchors and inferred fields, never an avatar package.",
    inputSchema: objectSchema(
      {
        avatarId,
        assetId: id("Imported reference asset ID."),
        providerId: {
          type: "string",
          minLength: 1,
          maxLength: 200,
          description:
            "Connected model/provider ID that explicitly declares supportsVision.",
        },
        prompt: { type: "string", minLength: 1, maxLength: 8000 },
      },
      ["avatarId", "assetId", "providerId", "prompt"],
    ),
  },
] as const;

export type AvatarToolName = (typeof AVATAR_TOOLS)[number]["name"];

export function isAvatarTool(name: string): name is AvatarToolName {
  return AVATAR_TOOLS.some((tool) => tool.name === name);
}

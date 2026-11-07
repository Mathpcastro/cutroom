import { z } from "zod";
import type { FilmRunner } from "./film";
import type { AvatarStore } from "./avatar-store";
import type {
  CreateCandidateInput,
  RenderRevisionInput,
  ReviewCandidateInput,
  RevisePartInput,
} from "./avatar-service";
import type { AnalyzeAvatarReferenceInput } from "./avatar-vision";
import { isAvatarTool, type AvatarToolName } from "./avatar-tool-defs";

const id = z.string().regex(/^[A-Za-z][A-Za-z0-9._-]{0,63}$/);
const revision = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const avatarId = id;
const candidateId = id;
const ids = { avatarId, candidateId };
const packageValue = z.unknown();
const proofSheet = z.enum([
  "neutral",
  "silhouette",
  "grayscale",
  "backgrounds",
  "expressions",
  "mouths",
  "motion",
]);

export interface AvatarToolService {
  getContract(): unknown;
  createCandidate(input: CreateCandidateInput): Promise<any>;
  renderRevision(input: RenderRevisionInput): Promise<any>;
  validateRevision(input: { avatarId: string; revision: number }): Promise<any>;
  reviewCandidate(input: ReviewCandidateInput): Promise<any>;
  selectCandidate(avatarId: string, candidateId: string): Promise<any>;
  revisePart(input: RevisePartInput): Promise<any>;
  saveRevision(input: { avatarId: string; candidateId: string }): Promise<any>;
  compareRevisions(input: {
    avatarId: string;
    leftRevision: number;
    rightRevision: number;
  }): Promise<any>;
  cancel(jobId: string): boolean;
}

export interface AvatarToolDispatcherOptions {
  service: AvatarToolService;
  store: Pick<AvatarStore, "importReference" | "readReference">;
  vision: {
    analyzeReference(input: AnalyzeAvatarReferenceInput): Promise<any>;
  };
  render: {
    engineDir: string;
    runner: () => Promise<FilmRunner>;
  };
}

function assertPackageSize(value: unknown): void {
  const serialized = JSON.stringify(value);
  if (
    serialized === undefined ||
    Buffer.byteLength(serialized, "utf8") > 256 * 1024
  ) {
    throw new Error(
      "Pacote de avatar excede o limite de 256 KiB da aplicação.",
    );
  }
}

function createInput(
  value: unknown,
): CreateCandidateInput & { referenceAssetId?: string } {
  const args = z
    .strictObject({
      avatarId: avatarId.optional(),
      description: z.string().trim().min(1).max(4096).optional(),
      referenceAssetId: id.optional(),
      package: packageValue,
    })
    .parse(value);
  assertPackageSize(args.package);
  if (
    args.avatarId &&
    (!args.package ||
      typeof args.package !== "object" ||
      Array.isArray(args.package) ||
      (args.package as Record<string, unknown>).id !== args.avatarId)
  ) {
    throw new Error("avatarId diverge do ID dentro do pacote.");
  }
  return {
    description: args.description ?? "Candidato criado via MCP",
    package: args.package,
    ...(args.referenceAssetId
      ? { referenceAssetId: args.referenceAssetId }
      : {}),
  };
}

/** One runtime boundary for in-app agents and external MCP; no alternate validation or storage path. */
export function createAvatarToolDispatcher(
  options: AvatarToolDispatcherOptions,
) {
  return async (
    name: string,
    value: Record<string, unknown>,
  ): Promise<unknown> => {
    if (!isAvatarTool(name))
      throw new Error("Ferramenta de avatar desconhecida.");
    const toolName: AvatarToolName = name;
    switch (toolName) {
      case "avatar_get_contract":
        z.strictObject({}).parse(value);
        return options.service.getContract();
      case "avatar_create_candidate": {
        const input = createInput(value);
        if (input.referenceAssetId) {
          const avatarId = (input.package as { id?: string }).id;
          await options.store.readReference(avatarId!, input.referenceAssetId);
        }
        return options.service.createCandidate(input);
      }
      case "avatar_render": {
        const input = z
          .strictObject({
            avatarId,
            revision,
            sheets: z
              .array(proofSheet)
              .min(1)
              .max(7)
              .refine((sheets) => new Set(sheets).size === sheets.length),
          })
          .parse(value);
        const render: RenderRevisionInput = {
          ...input,
          engineDir: options.render.engineDir,
          runner: await options.render.runner(),
        };
        return options.service.renderRevision(render);
      }
      case "avatar_validate":
        return options.service.validateRevision(
          z.strictObject({ avatarId, revision }).parse(value),
        );
      case "avatar_review": {
        const input: ReviewCandidateInput = z
          .strictObject({
            ...ids,
            rubric: z.strictObject({
              identity: z.number().int().min(0).max(20),
              silhouette: z.number().int().min(0).max(15),
              pixelCraft: z.number().int().min(0).max(15),
              palette: z.number().int().min(0).max(15),
              expressions: z.number().int().min(0).max(15),
              rig: z.number().int().min(0).max(15),
              export: z.number().int().min(0).max(5),
            }),
            evidence: z
              .array(z.string().min(1).max(4096))
              .max(32)
              .refine((items) => new Set(items).size === items.length),
            manualApproved: z.boolean().optional(),
          })
          .parse(value);
        return options.service.reviewCandidate(input);
      }
      case "avatar_select_candidate": {
        const input = z.strictObject(ids).parse(value);
        return options.service.selectCandidate(
          input.avatarId,
          input.candidateId,
        );
      }
      case "avatar_revise_part": {
        const input: RevisePartInput = z
          .strictObject({
            avatarId,
            revision,
            allowedPartIds: z
              .array(id)
              .min(1)
              .max(256)
              .refine((items) => new Set(items).size === items.length),
            package: packageValue,
          })
          .parse(value);
        assertPackageSize(input.package);
        return options.service.revisePart(input);
      }
      case "avatar_save_revision":
        return options.service.saveRevision(z.strictObject(ids).parse(value));
      case "avatar_compare_revisions":
        return options.service.compareRevisions(
          z
            .strictObject({
              avatarId,
              leftRevision: revision,
              rightRevision: revision,
            })
            .parse(value),
        );
      case "avatar_cancel": {
        const { jobId } = z.strictObject({ jobId: id }).parse(value);
        return options.service.cancel(jobId);
      }
      case "avatar_import_reference":
        return options.store.importReference(
          z
            .strictObject({ avatarId, path: z.string().min(1).max(4096) })
            .parse(value),
        );
      case "avatar_analyze_reference": {
        const input: AnalyzeAvatarReferenceInput = z
          .strictObject({
            avatarId,
            assetId: id,
            providerId: z.string().trim().min(1).max(200),
            prompt: z.string().trim().min(1).max(8000),
          })
          .parse(value);
        return options.vision.analyzeReference(input);
      }
    }
  };
}

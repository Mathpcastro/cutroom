import { z } from "zod";
import type { AvatarStore } from "./avatar-store";

const token = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z][A-Za-z0-9._-]*$/);
const coordinate = z.number().int().finite().min(-4096).max(4096);

export const avatarReferenceAnalysisSchema = z
  .strictObject({
    identityAnchors: z
      .record(token, z.strictObject({ x: coordinate, y: coordinate }))
      .refine((anchors) => Object.keys(anchors).length <= 64),
    inferredFields: z
      .array(
        z.strictObject({
          field: z.string().min(1).max(256),
          value: z.union([
            z.string().max(4096),
            z.number().finite(),
            z.boolean(),
            z.null(),
          ]),
          reason: z.string().min(1).max(4096),
        }),
      )
      .max(64),
  })
  .strict();

export type AvatarReferenceAnalysis = z.infer<
  typeof avatarReferenceAnalysisSchema
>;

export interface AvatarVisionRequest {
  prompt: string;
  image: {
    mimeType: "image/png" | "image/jpeg" | "image/webp";
    data: string;
  };
}

/** Narrow provider boundary: no avatar package, filesystem or editor tools cross it. */
export interface AvatarVisionProvider {
  id: string;
  supportsVision: boolean;
  analyze(request: AvatarVisionRequest): Promise<unknown>;
}

export interface AnalyzeAvatarReferenceInput {
  avatarId: string;
  assetId: string;
  providerId: string;
  prompt: string;
}

function sanitizeVisionError(error: unknown): Error {
  const text = error instanceof Error ? error.message : String(error);
  const sanitized = text
    .replace(
      /data:image\/[a-z0-9+.-]+;base64,[A-Za-z0-9+/=\s]+/gi,
      "[imagem omitida]",
    )
    .replace(/sk-[A-Za-z0-9_-]+/g, "[chave omitida]")
    .replace(/Bearer\s+\S+/gi, "Bearer [omitido]")
    .replace(
      /(?:api[_-]?key|access[_-]?token|token)\s*[:=]\s*[^\s,;]+/gi,
      "[credencial omitida]",
    )
    .slice(0, 1500);
  return new Error(`Falha na análise visual da referência: ${sanitized}`);
}

function analysisValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const text = value.trim();
  const json = text.startsWith("```")
    ? text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")
    : text;
  try {
    return JSON.parse(json);
  } catch {
    throw new Error("Resposta de visão inválida: JSON obrigatório.");
  }
}

export class AvatarVision {
  constructor(
    private readonly adapters: {
      store: Pick<AvatarStore, "readReference">;
      provider: (providerId: string) => AvatarVisionProvider | undefined;
    },
  ) {}

  async analyzeReference(input: AnalyzeAvatarReferenceInput): Promise<
    AvatarReferenceAnalysis & {
      avatarId: string;
      assetId: string;
      providerId: string;
    }
  > {
    const args = z
      .strictObject({
        avatarId: token,
        assetId: token,
        providerId: z.string().trim().min(1).max(200),
        prompt: z.string().trim().min(1).max(8000),
      })
      .parse(input);
    const provider = this.adapters.provider(args.providerId);
    if (!provider)
      throw new Error("Provider/modelo de visão não está conectado.");
    if (provider.supportsVision !== true) {
      throw new Error(
        "O provider/modelo selecionado não declara suporte a imagem (supportsVision).",
      );
    }
    const reference = await this.adapters.store.readReference(
      args.avatarId,
      args.assetId,
    );
    const prompt = [
      "Analyze only the supplied avatar reference image. Return one JSON object and no markdown.",
      "Required strict shape: { identityAnchors: Record<string, {x: integer, y: integer}>, inferredFields: Array<{field: string, value: string|number|boolean|null, reason: string}> }.",
      "Use full-canvas pixel coordinates. Put every hidden, occluded, ambiguous or uncertain trait in inferredFields with its reason; never state it as a fact.",
      "Do not return or assemble an avatar package, parts, executable code, paths, credentials or provider metadata.",
      `User instruction: ${args.prompt}`,
    ].join("\n");
    let raw: unknown;
    try {
      raw = await provider.analyze({
        prompt,
        image: {
          mimeType: reference.mimeType,
          data: reference.contents.toString("base64"),
        },
      });
    } catch (error) {
      throw sanitizeVisionError(error);
    }
    try {
      const analysis = avatarReferenceAnalysisSchema.parse(analysisValue(raw));
      return {
        avatarId: args.avatarId,
        assetId: args.assetId,
        providerId: args.providerId,
        ...analysis,
      };
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.startsWith("Resposta de visão inválida")
      )
        throw error;
      throw new Error(
        "Resposta de visão inválida: âncoras ou inferredFields fora do contrato.",
      );
    }
  }
}

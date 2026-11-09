import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseAvatar, type AvatarPackage } from "../../src/shared/avatar";
import type {
  AvatarCandidate,
  AvatarService,
  CreatedCandidates,
} from "./avatar-service";

const STARTERS = [
  {
    baseId: "strategist",
    title: "Estrategista",
    summary: "Silhueta estruturada, tablet e postura decidida.",
  },
  {
    baseId: "companion",
    title: "Companheiro",
    summary: "Formas acolhedoras, headphones e gestos abertos.",
  },
  {
    baseId: "expert",
    title: "Especialista",
    summary: "Óculos, ponteiro e apresentação didática.",
  },
] as const;

export interface LocalAvatarStarterCandidate extends AvatarCandidate {
  baseId: (typeof STARTERS)[number]["baseId"];
  title: (typeof STARTERS)[number]["title"];
  summary: (typeof STARTERS)[number]["summary"];
}

export interface LocalAvatarStarters extends Omit<CreatedCandidates, "candidates"> {
  candidates: LocalAvatarStarterCandidate[];
}

interface CreateLocalAvatarStartersInput {
  service: Pick<AvatarService, "createCandidates">;
  examplesDir: string;
  avatarId: string;
  description: string;
}

/** Local authored starting points, never represented as freshly generated AI art. */
export async function createLocalAvatarStarters(
  input: CreateLocalAvatarStartersInput,
): Promise<LocalAvatarStarters> {
  if (!/^[A-Za-z][A-Za-z0-9._-]{0,63}$/.test(input.avatarId)) {
    throw new Error("Avatar ID inválido para os pontos de partida locais.");
  }
  const description = input.description.trim();
  if (!description || description.length > 4096) {
    throw new Error("Descrição do avatar deve ter entre 1 e 4096 caracteres.");
  }

  const packages: AvatarPackage[] = [];
  for (const starter of STARTERS) {
    const source = JSON.parse(
      await readFile(join(input.examplesDir, `${starter.baseId}.json`), "utf8"),
    ) as unknown;
    const avatar = parseAvatar(source);
    packages.push({ ...avatar, id: input.avatarId });
  }

  const created = await input.service.createCandidates({ description, packages });
  return {
    ...created,
    candidates: created.candidates.map((candidate, index) => ({
      ...candidate,
      ...STARTERS[index],
    })),
  };
}

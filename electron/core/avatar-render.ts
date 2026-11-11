import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  AVATAR_EXPRESSIONS,
  AVATAR_MOUTHS,
  AVATAR_POSES,
  parseAvatar,
} from "../../src/shared/avatar";
import type { AvatarRenderState } from "../../resources/avatar-engine/avatar-engine.js";
import { runFilmWorker, type FilmRunner } from "./film";

export const AVATAR_PROOF_SHEETS = [
  "neutral",
  "silhouette",
  "grayscale",
  "backgrounds",
  "expressions",
  "mouths",
  "motion",
] as const;
export type AvatarProofSheet = (typeof AVATAR_PROOF_SHEETS)[number];

export interface AvatarRenderOptions {
  /** Directory containing the immutable revision's avatar.json. */
  revisionDir: string;
  /** resources/avatar-engine, containing the trusted proof and renderer. */
  engineDir: string;
  runner: FilmRunner;
  sheets?: readonly AvatarProofSheet[];
  /** Per-job cancellation forwarded to the existing film worker. */
  signal?: AbortSignal;
}

export interface AvatarSheetArtifact {
  sheet: AvatarProofSheet;
  /** Pixel-exact canvas PNG; hash refers to its unscaled native RGBA source. */
  png: string;
  /** Inspection-only composite. Never used as pixel-exact evidence or hashed. */
  jpeg: string;
  width: number;
  height: number;
  nativeWidth: number;
  nativeHeight: number;
  hash: string;
  /** SHA-256 of the PNG bytes, bound into AvatarService's artifact manifest. */
  contentHash: string;
}

export interface AvatarReviewJpeg {
  path: string;
  width: number;
  height: number;
}

export interface AvatarRenderResult {
  complete: true;
  files: AvatarSheetArtifact[];
  hashes: Partial<Record<AvatarProofSheet, string>>;
  errors: string[];
  networkRequests: string[];
  /** One downscaled contact sheet for model inspection; never pixel evidence. */
  reviewJpeg?: AvatarReviewJpeg;
  /** Host-owned data URL populated by AvatarService after containment checks. */
  imageUrl?: string;
}

interface AvatarWorkerFile {
  sheet: string;
  file: string;
  preview: string;
  width: number;
  height: number;
  nativeWidth: number;
  nativeHeight: number;
}

interface AvatarWorkerResult {
  complete?: boolean;
  files?: AvatarWorkerFile[];
  hashes?: Record<string, string>;
  errors?: string[];
  networkRequests?: string[];
  reviewJpeg?: { preview: string; width: number; height: number };
}

const NEUTRAL_STATE: AvatarRenderState = {
  pose: "neutral",
  expression: "neutral",
  mouth: "X",
  blink: 0,
  frame: 0,
};

export const AVATAR_MOTION_STRIP_POSES = [
  "neutral",
  "explaining",
  "pointing",
] as const;

export function avatarMotionProofStates(): AvatarRenderState[] {
  return AVATAR_MOTION_STRIP_POSES.flatMap((pose) =>
    Array.from({ length: 16 }, (_, frame) => ({
      ...NEUTRAL_STATE,
      pose,
      mouth: AVATAR_MOUTHS[frame % 6],
      blink: frame === 6 || frame === 7 ? 1 : 0,
      frame,
    })),
  );
}

const PROOF_STATES: Record<AvatarProofSheet, AvatarRenderState[]> = {
  neutral: [NEUTRAL_STATE],
  silhouette: AVATAR_POSES.map((pose) => ({ ...NEUTRAL_STATE, pose })),
  grayscale: AVATAR_EXPRESSIONS.map((expression) => ({
    ...NEUTRAL_STATE,
    expression,
  })),
  backgrounds: Array.from({ length: 4 }, () => ({ ...NEUTRAL_STATE })),
  expressions: AVATAR_EXPRESSIONS.map((expression) => ({
    ...NEUTRAL_STATE,
    expression,
  })),
  mouths: AVATAR_MOUTHS.map((mouth) => ({ ...NEUTRAL_STATE, mouth })),
  motion: avatarMotionProofStates(),
};

function samePath(left: string, right: string): boolean {
  const a = resolve(left);
  const b = resolve(right);
  return process.platform === "win32"
    ? a.toLowerCase() === b.toLowerCase()
    : a === b;
}

function assertInsideRevision(root: string, path: string): void {
  const relation = relative(root, resolve(path));
  if (
    !relation ||
    relation === ".." ||
    relation.startsWith(`..${sep}`) ||
    isAbsolute(relation)
  ) {
    throw new Error("Artefato do worker fora da revisão do avatar.");
  }
}

async function assertRealPathInsideRevision(
  root: string,
  path: string,
): Promise<void> {
  assertInsideRevision(root, path);
  const actual = await realpath(path);
  assertInsideRevision(root, actual);
}

function safeProofData(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`Resultado inválido do worker de avatar: ${label}.`);
  }
  return value;
}

export async function renderAvatarRevision(
  options: AvatarRenderOptions,
): Promise<AvatarRenderResult> {
  options.signal?.throwIfAborted();
  const revisionDir = await realpath(resolve(options.revisionDir));
  const engineDir = resolve(options.engineDir);
  const avatar = parseAvatar(
    JSON.parse(await readFile(join(revisionDir, "avatar.json"), "utf8")),
  );
  const sheets = [...new Set(options.sheets ?? AVATAR_PROOF_SHEETS)];
  if (
    sheets.length === 0 ||
    sheets.some((sheet) => !AVATAR_PROOF_SHEETS.includes(sheet))
  ) {
    throw new Error("Folhas de revisão de avatar inválidas.");
  }

  const renders = join(revisionDir, ".renders");
  await mkdir(renders, { recursive: true });
  let output: string | undefined;
  let proofDir: string | undefined;
  let succeeded = false;
  try {
    output = await mkdtemp(join(renders, "avatar-"));
    proofDir = join(output, "proof");
    await mkdir(proofDir, { recursive: true });
    const proofTemplate = await readFile(join(engineDir, "proof.html"), "utf8");
    const states = Object.fromEntries(
      sheets.map((sheet) => [sheet, PROOF_STATES[sheet]]),
    );
    const proofHtml = proofTemplate.replace(
      /(<script id="avatar-proof-data" type="application\/json">)[\s\S]*?(<\/script>)/,
      (_match, start: string, end: string) =>
        `${start}${safeProofData({ avatar, states })}${end}`,
    );
    if (proofHtml === proofTemplate) {
      throw new Error("O proof de avatar não contém seu payload JSON.");
    }
    await writeFile(join(proofDir, "proof.html"), proofHtml, "utf8");
    await Promise.all([
      copyFile(
        join(engineDir, "avatar-engine.js"),
        join(proofDir, "avatar-engine.js"),
      ),
      copyFile(join(engineDir, "proof.js"), join(proofDir, "proof.js")),
    ]);

    const result = (await runFilmWorker(
      revisionDir,
      {
        mode: "avatar",
        output,
        proof: relative(revisionDir, proofDir).replaceAll("\\", "/"),
        sheets,
      },
      { ...options.runner, signal: options.signal ?? options.runner.signal },
    )) as AvatarWorkerResult;

    if (!result.complete || !Array.isArray(result.files)) {
      throw new Error("O worker não concluiu o proof de avatar.");
    }
    const rawHashes = result.hashes;
    if (!rawHashes || typeof rawHashes !== "object") {
      throw new Error("O worker não retornou hashes RGBA do avatar.");
    }
    const errors = stringArray(result.errors ?? [], "errors");
    const networkRequests = stringArray(
      result.networkRequests ?? [],
      "networkRequests",
    );
    const files: AvatarSheetArtifact[] = [];
    const hashes: Partial<Record<AvatarProofSheet, string>> = {};

    for (const sheet of sheets) {
      const matches = result.files.filter((file) => file.sheet === sheet);
      if (matches.length !== 1) {
        throw new Error(`O worker não retornou exatamente uma folha ${sheet}.`);
      }
      const file = matches[0];
      const png = join(output, `${sheet}.png`);
      const jpeg = join(output, `${sheet}.jpg`);
      assertInsideRevision(revisionDir, file.file);
      assertInsideRevision(revisionDir, file.preview);
      if (!samePath(file.file, png) || !samePath(file.preview, jpeg)) {
        throw new Error("Destino de artefato do worker inválido.");
      }
      await assertRealPathInsideRevision(revisionDir, png);
      await assertRealPathInsideRevision(revisionDir, jpeg);

      const nativeWidth =
        avatar.canvas.full *
        (sheet === "motion" ? 16 : PROOF_STATES[sheet].length);
      const nativeHeight =
        avatar.canvas.full *
        (sheet === "motion" ? AVATAR_MOTION_STRIP_POSES.length : 1);
      if (
        file.nativeWidth !== nativeWidth ||
        file.nativeHeight !== nativeHeight ||
        file.width !== nativeWidth * 4 ||
        file.height !== nativeHeight * 4
      ) {
        throw new Error(`Dimensões inválidas para a folha ${sheet}.`);
      }
      const hash = rawHashes[sheet];
      if (typeof hash !== "string" || !/^[a-f0-9]{64}$/.test(hash)) {
        throw new Error(`Hash RGBA inválido para a folha ${sheet}.`);
      }
      hashes[sheet] = hash;
      files.push({
        sheet,
        png,
        jpeg,
        width: file.width,
        height: file.height,
        nativeWidth: file.nativeWidth,
        nativeHeight: file.nativeHeight,
        hash,
        contentHash: createHash("sha256")
          .update(await readFile(png))
          .digest("hex"),
      });
    }

    const workerReview = result.reviewJpeg;
    if (!workerReview)
      throw new Error("O worker não retornou o JPEG composto.");
    const reviewPath = join(output, "review.jpg");
    assertInsideRevision(revisionDir, workerReview.preview);
    if (!samePath(workerReview.preview, reviewPath)) {
      throw new Error("Destino do JPEG composto inválido.");
    }
    await assertRealPathInsideRevision(revisionDir, reviewPath);
    const reviewBytes = await readFile(reviewPath);
    if (
      workerReview.width !== 1200 ||
      !Number.isSafeInteger(workerReview.height) ||
      workerReview.height < 1 ||
      reviewBytes.length > 768 * 1024 ||
      reviewBytes[0] !== 0xff ||
      reviewBytes[1] !== 0xd8
    ) {
      throw new Error("JPEG composto de revisão inválido ou acima do limite.");
    }
    const response = {
      complete: true as const,
      files,
      hashes,
      errors,
      networkRequests,
      reviewJpeg: {
        path: reviewPath,
        width: workerReview.width,
        height: workerReview.height,
      },
    };
    succeeded = true;
    return response;
  } finally {
    if (output) {
      if (succeeded && proofDir)
        await rm(proofDir, { recursive: true, force: true });
      else if (!succeeded) await rm(output, { recursive: true, force: true });
    }
  }
}

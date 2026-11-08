import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "@playwright/test";
import { createAvatarToolDispatcher } from "../../electron/core/avatar-mcp";
import {
  AVATAR_PROOF_SHEETS,
  renderAvatarRevision,
} from "../../electron/core/avatar-render";
import { AvatarService } from "../../electron/core/avatar-service";
import { AvatarStore } from "../../electron/core/avatar-store";

const root = process.cwd();
const proofRoot = resolve("artifacts/avatar-proof");
const inspectionRoot = resolve("artifacts/avatar-inspection");
const versionedStoreRoot = resolve("artifacts/avatar-store");
const names = ["strategist", "companion", "expert"] as const;
const sheets = [...AVATAR_PROOF_SHEETS];
const writeMode = process.argv.includes("--write");
const inspectMode = process.argv.includes("--inspect");
if (
  (writeMode && inspectMode) ||
  process.argv
    .slice(2)
    .some((argument) => argument !== "--write" && argument !== "--inspect")
) {
  throw new Error(
    "Usage: npx tsx artifacts/avatar-proof/reproduce.ts [--inspect|--write]",
  );
}

function browserPath() {
  const candidates = [
    process.env.CHROME_PATH,
    process.env.PUPPETEER_EXECUTABLE_PATH,
    process.platform === "win32"
      ? "C:/Program Files/Google/Chrome/Application/chrome.exe"
      : undefined,
    process.platform === "win32"
      ? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
      : undefined,
    process.platform === "darwin"
      ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
      : undefined,
    process.platform === "linux" ? "/usr/bin/chromium" : undefined,
    chromium.executablePath(),
  ].filter((candidate): candidate is string => Boolean(candidate));
  const executable = candidates.find((candidate) => existsSync(candidate));
  if (!executable) {
    throw new Error(`No Chromium executable found: ${candidates.join(", ")}`);
  }
  return executable;
}

function sha256(contents: Buffer | string) {
  return createHash("sha256").update(contents).digest("hex");
}

interface CandidateRecord {
  candidateId: string;
  hash: string;
  quality: { hashes: Record<string, string> };
}

interface RenderedFile {
  sheet: (typeof sheets)[number];
  png: string;
  width: number;
  height: number;
  nativeWidth: number;
  nativeHeight: number;
  hash: string;
  contentHash: string;
}

interface RenderedCandidate {
  id: (typeof names)[number];
  candidateId: string;
  revision: number;
  packageHash: string;
  qualityHashes: Record<string, string>;
  review: {
    file: string;
    width: number;
    height: number;
    jpegSha256: string;
    storePath: string;
  };
  files: Array<{
    sheet: (typeof sheets)[number];
    file: string;
    width: number;
    height: number;
    nativeWidth: number;
    nativeHeight: number;
    pixelHash: string;
    pngSha256: string;
    storePath: string;
  }>;
  mcpOperations: Array<{
    tool: string;
    arguments: Record<string, unknown>;
  }>;
}

async function renderCandidates(storeRoot: string): Promise<{
  candidates: RenderedCandidate[];
  engine: {
    rendererSha256: string;
    proofSha256: string;
    worker: string;
  };
  engineVersion: string;
  browser: string;
}> {
  await mkdir(storeRoot, { recursive: true });
  const store = new AvatarStore(storeRoot);
  const service = new AvatarService({ store, renderer: renderAvatarRevision });
  const runner = {
    worker: resolve("electron/render-motion.ts"),
    browser: browserPath(),
  };
  const call = createAvatarToolDispatcher({
    service,
    store,
    vision: {
      analyzeReference: async () => {
        throw new Error("Vision is intentionally disabled for this proof.");
      },
    },
    render: {
      engineDir: resolve("resources/avatar-engine"),
      runner: async () => runner,
    },
  });
  const contract = (await call("avatar_get_contract", {})) as {
    schemaVersion: number;
  };
  const application = JSON.parse(
    await readFile(resolve("package.json"), "utf8"),
  ) as { version: string };
  const candidates: RenderedCandidate[] = [];

  for (const name of names) {
    const packagePath = resolve(
      `resources/avatar-engine/examples/${name}.json`,
    );
    const avatar = JSON.parse(await readFile(packagePath, "utf8"));
    if (writeMode) {
      await rm(join(storeRoot, name), { recursive: true, force: true });
    }
    const created = (await call("avatar_create_candidate", {
      avatarId: name,
      description: `Task 9 reauthored ${name} visual proof`,
      package: avatar,
    })) as { candidates: CandidateRecord[] };
    const candidate = created.candidates[0];
    const selected = (await call("avatar_select_candidate", {
      avatarId: name,
      candidateId: candidate.candidateId,
    })) as { revision: number };
    const saved = (await call("avatar_save_revision", {
      avatarId: name,
      candidateId: candidate.candidateId,
    })) as { revision: number };
    if (selected.revision !== saved.revision) {
      throw new Error(`Select/save revision mismatch for ${name}.`);
    }
    const rendered = (await call("avatar_render", {
      avatarId: name,
      revision: saved.revision,
      sheets,
    })) as {
      complete: boolean;
      errors: string[];
      networkRequests: string[];
      files: RenderedFile[];
      reviewJpeg?: { path: string; width: number; height: number };
    };
    if (
      !rendered.complete ||
      rendered.errors.length ||
      rendered.networkRequests.length
    ) {
      throw new Error(
        `Incomplete proof for ${name}: ${JSON.stringify(rendered)}`,
      );
    }
    if (!rendered.reviewJpeg) throw new Error(`Missing review JPEG: ${name}`);

    const files = [];
    for (const artifact of rendered.files) {
      const contents = await readFile(artifact.png);
      if (sha256(contents) !== artifact.contentHash) {
        throw new Error(`Rendered PNG hash mismatch: ${artifact.png}`);
      }
      files.push({
        sheet: artifact.sheet,
        file: `${name}/${artifact.sheet}.png`,
        width: artifact.width,
        height: artifact.height,
        nativeWidth: artifact.nativeWidth,
        nativeHeight: artifact.nativeHeight,
        pixelHash: artifact.hash,
        pngSha256: artifact.contentHash,
        storePath: artifact.png,
      });
    }
    const reviewContents = await readFile(rendered.reviewJpeg.path);
    candidates.push({
      id: name,
      candidateId: candidate.candidateId,
      revision: saved.revision,
      packageHash: candidate.hash,
      qualityHashes: candidate.quality.hashes,
      review: {
        file: `${name}/review.jpg`,
        width: rendered.reviewJpeg.width,
        height: rendered.reviewJpeg.height,
        jpegSha256: sha256(reviewContents),
        storePath: rendered.reviewJpeg.path,
      },
      files,
      mcpOperations: [
        {
          tool: "avatar_create_candidate",
          arguments: {
            avatarId: name,
            description: `Task 9 reauthored ${name} visual proof`,
            package: `resources/avatar-engine/examples/${name}.json`,
          },
        },
        {
          tool: "avatar_select_candidate",
          arguments: { avatarId: name, candidateId: candidate.candidateId },
        },
        {
          tool: "avatar_save_revision",
          arguments: { avatarId: name, candidateId: candidate.candidateId },
        },
        {
          tool: "avatar_render",
          arguments: { avatarId: name, revision: saved.revision, sheets },
        },
      ],
    });
    console.log(
      `${name}: revision=${saved.revision} package=${candidate.hash} neutral=${candidate.quality.hashes.neutral}`,
    );
  }

  return {
    candidates,
    engineVersion: `avatar-schema-${contract.schemaVersion}+cutroom-${application.version}`,
    engine: {
      rendererSha256: sha256(
        await readFile(resolve("resources/avatar-engine/avatar-engine.js")),
      ),
      proofSha256: sha256(
        await readFile(resolve("resources/avatar-engine/proof.js")),
      ),
      worker: "electron/render-motion.ts",
    },
    browser: runner.browser,
  };
}

function deterministicManifest(
  rendered: Awaited<ReturnType<typeof renderCandidates>>,
) {
  return {
    engineVersion: rendered.engineVersion,
    engine: rendered.engine,
    candidates: rendered.candidates.map((candidate) => ({
      id: candidate.id,
      revision: candidate.revision,
      packageHash: candidate.packageHash,
      qualityHashes: candidate.qualityHashes,
      review: {
        file: candidate.review.file,
        width: candidate.review.width,
        height: candidate.review.height,
      },
      files: candidate.files.map(({ storePath: _storePath, ...file }) => file),
    })),
  };
}

const temporaryStore = writeMode
  ? undefined
  : await mkdtemp(join(tmpdir(), "cutroom-avatar-proof-"));
const storeRoot = temporaryStore ?? versionedStoreRoot;
try {
  const rendered = await renderCandidates(storeRoot);
  const deterministic = deterministicManifest(rendered);

  if (writeMode || inspectMode) {
    const outputRoot = inspectMode ? inspectionRoot : proofRoot;
    await mkdir(outputRoot, { recursive: true });
    for (const candidate of rendered.candidates) {
      await mkdir(join(outputRoot, candidate.id), { recursive: true });
      for (const file of candidate.files) {
        await copyFile(file.storePath, join(outputRoot, file.file));
      }
      await copyFile(
        candidate.review.storePath,
        join(outputRoot, candidate.review.file),
      );
    }
    console.log(`Wrote inspection sheets: ${outputRoot}`);
  }

  if (writeMode) {
    const manifest = {
      schemaVersion: 2,
      deterministic,
      volatile: {
        reproduction: {
          cwd: root,
          store: storeRoot,
          browser: rendered.browser,
          verifyCommand: "npx tsx artifacts/avatar-proof/reproduce.ts",
          writeCommand: "npx tsx artifacts/avatar-proof/reproduce.ts --write",
        },
        candidates: rendered.candidates.map((candidate) => ({
          id: candidate.id,
          candidateId: candidate.candidateId,
          review: {
            jpegSha256: candidate.review.jpegSha256,
            storePath: candidate.review.storePath,
          },
          files: candidate.files.map((file) => ({
            sheet: file.sheet,
            storePath: file.storePath,
          })),
          mcpOperations: candidate.mcpOperations,
        })),
      },
    };
    await writeFile(
      join(proofRoot, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8",
    );
    console.log(`Wrote proof manifest: ${join(proofRoot, "manifest.json")}`);
  } else if (!inspectMode) {
    const manifest = JSON.parse(
      await readFile(join(proofRoot, "manifest.json"), "utf8"),
    ) as { schemaVersion: number; deterministic: unknown };
    assert.equal(manifest.schemaVersion, 2, "Proof manifest schema changed");
    assert.deepEqual(
      deterministic,
      manifest.deterministic,
      "Fresh MCP render differs from the versioned deterministic proof manifest",
    );
    for (const candidate of deterministic.candidates) {
      for (const file of candidate.files) {
        const versionedPng = await readFile(join(proofRoot, file.file));
        assert.equal(
          sha256(versionedPng),
          file.pngSha256,
          `Versioned PNG differs from manifest: ${file.file}`,
        );
      }
    }
    console.log(
      "VERIFY passed: package hashes, quality hashes, fresh PNGs and versioned PNGs match; versioned artifacts/store were not modified.",
    );
  }
} finally {
  if (temporaryStore) {
    await rm(temporaryStore, { recursive: true, force: true });
  }
}

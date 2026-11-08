import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
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
const storeRoot = resolve("artifacts/avatar-store");
const names = ["strategist", "companion", "expert"] as const;
const sheets = [...AVATAR_PROOF_SHEETS];

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

await mkdir(proofRoot, { recursive: true });
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
const candidates = [];

for (const name of names) {
  const packagePath = resolve(`resources/avatar-engine/examples/${name}.json`);
  const avatar = JSON.parse(await readFile(packagePath, "utf8"));
  await rm(join(storeRoot, name), { recursive: true, force: true });
  const created = (await call("avatar_create_candidate", {
    avatarId: name,
    description: `Task 9 authored ${name} visual proof`,
    package: avatar,
  })) as any;
  const candidate = created.candidates[0];
  const selected = (await call("avatar_select_candidate", {
    avatarId: name,
    candidateId: candidate.candidateId,
  })) as any;
  const saved = (await call("avatar_save_revision", {
    avatarId: name,
    candidateId: candidate.candidateId,
  })) as any;
  if (selected.revision !== saved.revision) {
    throw new Error(`Select/save revision mismatch for ${name}.`);
  }
  const rendered = (await call("avatar_render", {
    avatarId: name,
    revision: saved.revision,
    sheets,
  })) as any;
  if (
    !rendered.complete ||
    rendered.errors.length ||
    rendered.networkRequests.length
  ) {
    throw new Error(
      `Incomplete proof for ${name}: ${JSON.stringify(rendered)}`,
    );
  }

  const destination = join(proofRoot, name);
  await mkdir(destination, { recursive: true });
  const files = [];
  for (const artifact of rendered.files) {
    const filename = `${artifact.sheet}.png`;
    const output = join(destination, filename);
    await copyFile(artifact.png, output);
    const contents = await readFile(output);
    if (sha256(contents) !== artifact.contentHash) {
      throw new Error(`Copied PNG hash mismatch: ${output}`);
    }
    files.push({
      sheet: artifact.sheet,
      file: `${name}/${filename}`,
      width: artifact.width,
      height: artifact.height,
      nativeWidth: artifact.nativeWidth,
      nativeHeight: artifact.nativeHeight,
      pixelHash: artifact.hash,
      pngSha256: artifact.contentHash,
      storePath: artifact.png,
    });
  }
  if (!rendered.reviewJpeg) throw new Error(`Missing review JPEG: ${name}`);
  const reviewOutput = join(destination, "review.jpg");
  await copyFile(rendered.reviewJpeg.path, reviewOutput);
  const reviewContents = await readFile(reviewOutput);
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
          description: `Task 9 authored ${name} visual proof`,
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
    `${name}: revision=${saved.revision} package=${candidate.hash} neutral=${rendered.hashes.neutral}`,
  );
}

const manifest = {
  schemaVersion: 1,
  engineVersion: `avatar-schema-${contract.schemaVersion}+cutroom-${application.version}`,
  engine: {
    rendererSha256: sha256(
      await readFile(resolve("resources/avatar-engine/avatar-engine.js")),
    ),
    proofSha256: sha256(
      await readFile(resolve("resources/avatar-engine/proof.js")),
    ),
    worker: "electron/render-motion.ts",
    browser: runner.browser,
    networkRequests: [],
  },
  reproduction: {
    command: "npx tsx artifacts/avatar-proof/reproduce.ts",
    cwd: root,
    store: storeRoot,
    notes:
      "Runs the real Avatar MCP dispatcher with the production AvatarService, AvatarStore and Chromium renderer; no model calls.",
  },
  candidates,
};
await writeFile(
  join(proofRoot, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8",
);
console.log(`Manifest: ${join(proofRoot, "manifest.json")}`);

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { chromium } from "@playwright/test";
import { describe, expect, it, vi } from "vitest";
import {
  renderAvatarRevision,
  type AvatarProofSheet,
} from "../electron/core/avatar-render";
import { renderAvatarProof } from "../electron/render-motion";
import { canonicalAvatar } from "../src/shared/avatar";
import { validateAvatarPackage } from "../src/shared/avatar-quality";
import { avatarFixture } from "./fixtures/avatar-fixture";

function chromiumCandidates(): string[] {
  const platformPaths =
    process.platform === "win32"
      ? [
          join(
            process.env.PROGRAMFILES ?? "C:\\Program Files",
            "Google\\Chrome\\Application\\chrome.exe",
          ),
          join(
            process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)",
            "Microsoft\\Edge\\Application\\msedge.exe",
          ),
          join(
            process.env.LOCALAPPDATA ?? "C:\\Users\\Default\\AppData\\Local",
            "Google\\Chrome\\Application\\chrome.exe",
          ),
        ]
      : process.platform === "darwin"
        ? [
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/Applications/Chromium.app/Contents/MacOS/Chromium",
            "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
          ]
        : [
            "/usr/bin/chromium",
            "/usr/bin/chromium-browser",
            "/usr/bin/google-chrome",
            "/usr/bin/microsoft-edge",
          ];
  return [
    ...new Set(
      [
        process.env.CHROME_PATH,
        process.env.PUPPETEER_EXECUTABLE_PATH,
        ...platformPaths,
        chromium.executablePath(),
      ].filter((candidate): candidate is string => Boolean(candidate)),
    ),
  ];
}

function requireChromium(): string {
  const candidates = chromiumCandidates();
  const executable = candidates.find((candidate) => existsSync(candidate));
  if (!executable) {
    throw new Error(
      `BLOCKED: no existing Chromium executable found. Checked: ${candidates.join(", ")}`,
    );
  }
  return executable;
}

async function fixtureRevision() {
  const artifacts = join(process.cwd(), "artifacts");
  await mkdir(artifacts, { recursive: true });
  const root = await mkdtemp(join(artifacts, "avatar-render-integration-"));
  const revisionDir = join(root, "videosell-presenter", "revisions", "1");
  await mkdir(revisionDir, { recursive: true });
  await writeFile(
    join(revisionDir, "avatar.json"),
    canonicalAvatar(avatarFixture()),
    "utf8",
  );
  return { root, revisionDir };
}

const expectedDimensions: Record<
  AvatarProofSheet,
  { width: number; height: number; nativeWidth: number; nativeHeight: number }
> = {
  neutral: { width: 384, height: 384, nativeWidth: 96, nativeHeight: 96 },
  silhouette: { width: 1920, height: 384, nativeWidth: 480, nativeHeight: 96 },
  grayscale: { width: 2304, height: 384, nativeWidth: 576, nativeHeight: 96 },
  backgrounds: { width: 1536, height: 384, nativeWidth: 384, nativeHeight: 96 },
  expressions: {
    width: 2304,
    height: 384,
    nativeWidth: 576,
    nativeHeight: 96,
  },
  mouths: {
    width: 2688,
    height: 384,
    nativeWidth: 672,
    nativeHeight: 96,
  },
  motion: { width: 6144, height: 384, nativeWidth: 1536, nativeHeight: 96 },
};

describe("avatar review-sheet Chromium integration", () => {
  it("honors an already aborted render signal before touching revision files", async () => {
    const controller = new AbortController();
    controller.abort(new Error("Render cancelado pelo job."));

    await expect(
      renderAvatarRevision({
        revisionDir: join(process.cwd(), "missing-revision"),
        engineDir: join(process.cwd(), "missing-engine"),
        runner: { worker: "unused", browser: "unused" },
        signal: controller.signal,
      }),
    ).rejects.toThrow("Render cancelado pelo job.");
  });

  it("writes native PNG sheets with identical RGBA hashes and no external network", async () => {
    const executablePath = requireChromium();
    const { root, revisionDir } = await fixtureRevision();
    const avatar = avatarFixture();
    const qualityHashes = validateAvatarPackage(avatar).hashes;
    const options = {
      revisionDir,
      engineDir: resolve("resources/avatar-engine"),
      runner: {
        worker: resolve("electron/render-motion.ts"),
        browser: executablePath,
      },
    };

    const first = await renderAvatarRevision(options);
    const second = await renderAvatarRevision(options);

    expect(first.complete).toBe(true);
    expect(first.errors).toEqual([]);
    expect(first.networkRequests).toEqual([]);
    expect(second.errors).toEqual([]);
    expect(second.networkRequests).toEqual([]);
    expect(first.files.map((artifact) => artifact.sheet)).toEqual([
      "neutral",
      "silhouette",
      "grayscale",
      "backgrounds",
      "expressions",
      "mouths",
      "motion",
    ]);
    expect(second.hashes).toEqual(first.hashes);
    expect(second.files.map((artifact) => artifact.hash)).toEqual(
      first.files.map((artifact) => artifact.hash),
    );

    for (const artifact of first.files) {
      const dimensions = expectedDimensions[artifact.sheet];
      expect({
        width: artifact.width,
        height: artifact.height,
        nativeWidth: artifact.nativeWidth,
        nativeHeight: artifact.nativeHeight,
      }).toEqual(dimensions);

      const png = await readFile(artifact.png);
      expect(png.subarray(0, 8)).toEqual(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      );
      expect(png.readUInt32BE(16)).toBe(dimensions.width);
      expect(png.readUInt32BE(20)).toBe(dimensions.height);
      expect(artifact.contentHash).toBe(
        createHash("sha256").update(png).digest("hex"),
      );

      const jpeg = await readFile(artifact.jpeg);
      expect(jpeg.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
      expect(artifact.jpeg).not.toBe(artifact.png);
      expect(artifact.hash).toMatch(/^[a-f0-9]{64}$/);
    }
    expect(first.hashes).toMatchObject({
      neutral: qualityHashes.neutral,
      expressions: qualityHashes.expressionSheet,
      mouths: qualityHashes.mouthSheet,
    });
    expect(first.files.every((artifact) => artifact.png.startsWith(root))).toBe(
      true,
    );
    expect(first.reviewJpeg).toBeDefined();
    const review = await readFile(first.reviewJpeg!.path);
    expect(review.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
    expect(review.length).toBeLessThan(768 * 1024);
    expect(first.reviewJpeg!.path.startsWith(root)).toBe(true);
    expect(first.hashes).not.toHaveProperty("reviewJpeg");
    console.info(
      `Avatar integration artifacts: ${first.files
        .map(
          (artifact) =>
            `${artifact.sheet}=${artifact.width}x${artifact.height}:${artifact.hash}:${artifact.png}`,
        )
        .join("\n")}`,
    );
  }, 60_000);

  it("closes the proof server exactly once when Chromium launch fails", async () => {
    const { root } = await fixtureRevision();
    const close = vi.fn();
    const createServer = vi.fn().mockResolvedValue({
      url: "http://127.0.0.1:49152",
      close,
    });
    const launch = vi.fn().mockRejectedValue(new Error("invalid Chromium"));
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error("launch did not reject promptly")),
        1_000,
      );
    });

    try {
      await expect(
        Promise.race([
          renderAvatarProof(
            {
              mode: "avatar",
              browser: join(root, "missing-chromium.exe"),
              fps: 30,
              directory: root,
              output: join(root, "output"),
              proof: ".renders/proof",
            },
            { createServer, launch },
          ),
          timeout,
        ]),
      ).rejects.toThrow("invalid Chromium");
    } finally {
      if (timer) clearTimeout(timer);
    }
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("cleans staging when proof preparation fails before the worker", async () => {
    const { root, revisionDir } = await fixtureRevision();
    const previousDir = join(revisionDir, ".renders", "previous");
    const previousArtifact = join(previousDir, "neutral.png");
    await mkdir(previousDir, { recursive: true });
    await writeFile(previousArtifact, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    await expect(
      renderAvatarRevision({
        revisionDir,
        engineDir: join(root, "missing-engine"),
        runner: { worker: join(root, "must-not-run.mjs"), browser: "unused" },
      }),
    ).rejects.toThrow(/ENOENT/);

    expect(await readdir(join(revisionDir, ".renders"))).toEqual(["previous"]);
    expect(await readFile(previousArtifact)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    );
    expect(await readFile(join(revisionDir, "avatar.json"), "utf8")).toBe(
      canonicalAvatar(avatarFixture()),
    );
  });

  it("rejects worker artifacts outside the avatar revision", async () => {
    const { root, revisionDir } = await fixtureRevision();
    const worker = join(root, "traversal-worker.mjs");
    const escaped = resolve(revisionDir, "..", "..", "escaped.png");
    await writeFile(
      worker,
      `console.log(JSON.stringify(${JSON.stringify({
        complete: true,
        files: [
          {
            sheet: "neutral",
            file: escaped,
            preview: escaped,
            width: 384,
            height: 384,
            nativeWidth: 96,
            nativeHeight: 96,
          },
        ],
        hashes: { neutral: "0".repeat(64) },
        errors: [],
        networkRequests: [],
      })}));\n`,
      "utf8",
    );

    await expect(
      renderAvatarRevision({
        revisionDir,
        engineDir: resolve("resources/avatar-engine"),
        runner: { worker, browser: "unused" },
      }),
    ).rejects.toThrow(/fora da revisão|destino.*inválido/i);
  });
});

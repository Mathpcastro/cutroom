// Runs in the application's private Node utility process, never the UI process.
// Modes: "scene" (one motion scene → MOV with alpha), "film" (a HyperFrames project → MP4 with audio),
// "stills" (seek the film and screenshot chosen seconds) and "lint" (HyperFrames static checks).
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Browser, LaunchOptions } from "puppeteer-core";
import {
  createFileServer,
  createRenderJob,
  executeRenderJob,
  resolveConfig,
  runHyperframeLint,
} from "@hyperframes/producer";

interface Spec {
  mode?:
    "scene" | "film" | "stills" | "lint" | "capture" | "analyze" | "avatar";
  browser: string;
  fps: number;
  directory: string;
  output: string;
  workers?: number;
  quality?: "draft" | "standard" | "high";
  width?: number;
  height?: number;
  times?: number[];
  scale?: number;
  proof?: string;
  sheets?: string[];
}
const say = (value: unknown) => console.log(JSON.stringify(value));

async function lint(spec: Spec) {
  const html = await readFile(join(spec.directory, "index.html"), "utf8");
  const result = await runHyperframeLint({
    entryFile: "index.html",
    html,
    source: "projectDir",
  });
  return result.findings.map((f) => {
    const finding = f as unknown as Record<string, unknown>;
    return {
      severity: String(finding.severity ?? "warning"),
      message: String(finding.message ?? finding.code ?? ""),
      code: finding.code ? String(finding.code) : undefined,
      selector: finding.selector ? String(finding.selector) : undefined,
      fix: finding.fixHint ? String(finding.fixHint) : undefined,
    };
  });
}

async function stills(spec: Spec) {
  const { default: puppeteer } = await import("puppeteer-core");
  await mkdir(spec.output, { recursive: true });
  const server = await createFileServer({
    projectDir: spec.directory,
    fps: { num: spec.fps, den: 1 },
  });
  const browser = await puppeteer.launch({
    executablePath: spec.browser,
    headless: true,
    args: ["--autoplay-policy=no-user-gesture-required", "--mute-audio"],
  });
  const errors: string[] = [];
  try {
    const page = await browser.newPage();
    page.on("pageerror", (e) =>
      errors.push(
        `Erro de script: ${e instanceof Error ? e.message : String(e)}`,
      ),
    );
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(`Console: ${m.text()}`);
    });
    // Films are written by agents: nothing outside the film folder is fetched.
    await page.setRequestInterception(true);
    page.on("request", (r) => {
      const url = r.url();
      if (
        url.startsWith(server.url) ||
        url.startsWith("data:") ||
        url.startsWith("blob:")
      )
        void r.continue();
      else {
        errors.push(`Bloqueado (fora da pasta do filme): ${url.slice(0, 120)}`);
        void r.abort();
      }
    });
    page.on("requestfailed", (r) => {
      // Chrome cancels media range requests on seek (net::ERR_ABORTED): that is not a missing file.
      if (
        r.url().startsWith(server.url) &&
        r.failure()?.errorText !== "net::ERR_ABORTED"
      )
        errors.push(`Arquivo não carregou: ${r.url().replace(server.url, "")}`);
    });
    await page.setViewport({
      width: spec.width ?? 1080,
      height: spec.height ?? 1920,
      deviceScaleFactor: spec.scale ?? 0.5,
    });
    await page.goto(`${server.url}/index.html`, { waitUntil: "load" });
    await page.waitForFunction(
      () => {
        const hf = (
          window as unknown as { __hf?: { seek?: unknown; duration?: number } }
        ).__hf;
        return !!hf && typeof hf.seek === "function" && (hf.duration ?? 0) > 0;
      },
      { timeout: 60_000 },
    );
    const duration = await page.evaluate(
      () => (window as unknown as { __hf: { duration: number } }).__hf.duration,
    );
    const files: { t: number; file: string }[] = [];
    for (const t of spec.times ?? []) {
      const at = Math.max(0, Math.min(t, duration - 1 / spec.fps));
      await page.evaluate(
        (s) =>
          (window as unknown as { __hf: { seek(t: number): void } }).__hf.seek(
            s,
          ),
        at,
      );
      await page.evaluate(
        () =>
          new Promise((done) =>
            requestAnimationFrame(() => requestAnimationFrame(done)),
          ),
      );
      const file = join(
        spec.output,
        `quadro-${at.toFixed(2).padStart(6, "0")}.png`,
      );
      await page.screenshot({ path: file as `${string}.png` });
      files.push({ t: +at.toFixed(2), file });
    }
    return { duration, files, errors: [...new Set(errors)].slice(0, 20) };
  } finally {
    await browser.close();
    server.close();
  }
}

/**
 * Motion analysis for film_review: seeks the film every `step` seconds at a tiny size and measures
 * how much the picture changes between samples (mean absolute difference, 0–1).
 */
async function analyze(spec: Spec & { step?: number }) {
  const { default: puppeteer } = await import("puppeteer-core");
  const server = await createFileServer({
    projectDir: spec.directory,
    fps: { num: spec.fps, den: 1 },
  });
  const browser = await puppeteer.launch({
    executablePath: spec.browser,
    headless: true,
    args: ["--mute-audio"],
  });
  try {
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on("request", (r) =>
      r.url().startsWith(server.url) || r.url().startsWith("data:")
        ? void r.continue()
        : void r.abort(),
    );
    await page.setViewport({
      width: spec.width ?? 1080,
      height: spec.height ?? 1920,
      deviceScaleFactor: 0.1,
    });
    await page.goto(`${server.url}/index.html`, { waitUntil: "load" });
    await page.waitForFunction(
      () =>
        ((window as unknown as { __hf?: { duration?: number } }).__hf
          ?.duration ?? 0) > 0,
      { timeout: 60_000 },
    );
    const duration = await page.evaluate(
      () => (window as unknown as { __hf: { duration: number } }).__hf.duration,
    );
    const lab = await browser.newPage(); // decodes and compares frames away from the film page
    const step = spec.step ?? 0.25,
      samples: { t: number; diff: number }[] = [];
    let previous = "";
    for (let t = 0; t < duration - 0.05; t += step) {
      await page.evaluate(
        (s) =>
          (window as unknown as { __hf: { seek(t: number): void } }).__hf.seek(
            s,
          ),
        t,
      );
      await page.evaluate(
        () =>
          new Promise((done) =>
            requestAnimationFrame(() => requestAnimationFrame(done)),
          ),
      );
      const shot = (await page.screenshot({
        type: "jpeg",
        quality: 70,
        encoding: "base64",
      })) as string;
      if (previous)
        samples.push({
          t: +t.toFixed(2),
          diff: await lab.evaluate(
            async (a, b) => {
              const load = async (src: string) => {
                const img = new Image();
                img.src = `data:image/jpeg;base64,${src}`;
                await img.decode();
                const c = document.createElement("canvas");
                c.width = img.width;
                c.height = img.height;
                const g = c.getContext("2d")!;
                g.drawImage(img, 0, 0);
                return g.getImageData(0, 0, c.width, c.height).data;
              };
              const [x, y] = [await load(a), await load(b)];
              let sum = 0;
              for (let i = 0; i < x.length; i += 4)
                sum +=
                  Math.abs(x[i] - y[i]) +
                  Math.abs(x[i + 1] - y[i + 1]) +
                  Math.abs(x[i + 2] - y[i + 2]);
              return sum / ((x.length / 4) * 3 * 255);
            },
            previous,
            shot,
          ),
        });
      previous = shot;
    }
    return { duration, step, samples };
  } finally {
    await browser.close();
    server.close();
  }
}

interface AvatarProofResult {
  sheet: string;
  width: number;
  height: number;
  nativeWidth: number;
  nativeHeight: number;
  hash: string;
  png: string;
  jpeg: string;
}

interface AvatarProofDependencies {
  createServer: typeof createFileServer;
  launch: (options: LaunchOptions) => Promise<Browser>;
}

/** Native RGBA review sheets from the isolated, data-only avatar proof document. */
export async function renderAvatarProof(
  spec: Spec,
  dependencies?: AvatarProofDependencies,
) {
  if (
    !spec.proof ||
    !/^(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+$/.test(spec.proof) ||
    spec.proof.split("/").includes("..")
  )
    throw new Error("Caminho do proof de avatar inválido.");
  const { default: puppeteer } = await import("puppeteer-core");
  await mkdir(spec.output, { recursive: true });
  const server = await (dependencies?.createServer ?? createFileServer)({
    projectDir: spec.directory,
    fps: { num: spec.fps, den: 1 },
  });
  const errors: string[] = [];
  const networkRequests: string[] = [];
  let browser: Browser | undefined;
  try {
    browser = await (dependencies?.launch ?? puppeteer.launch)({
      executablePath: spec.browser,
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage", "--mute-audio"],
    });
    const page = await browser.newPage();
    page.on("pageerror", (error) =>
      errors.push(
        `Erro de script: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
    page.on("console", (message) => {
      if (message.type() === "error")
        errors.push(`Console: ${message.text()} (${message.location().url})`);
    });
    await page.setRequestInterception(true);
    const origin = new URL(server.url).origin;
    page.on("request", (request) => {
      const url = request.url();
      if (
        url.startsWith("data:") ||
        url.startsWith("blob:") ||
        new URL(url).origin === origin
      )
        void request.continue();
      else {
        networkRequests.push(url.slice(0, 200));
        errors.push(`Bloqueado (rede externa no proof): ${url.slice(0, 120)}`);
        void request.abort();
      }
    });
    page.on("requestfailed", (request) => {
      if (
        new URL(request.url()).origin === origin &&
        request.failure()?.errorText !== "net::ERR_ABORTED"
      )
        errors.push(
          `Arquivo não carregou: ${request.url().replace(server.url, "")}`,
        );
    });

    const proofPath = spec.proof.split("/").map(encodeURIComponent).join("/");
    await page.goto(`${server.url}/${proofPath}/proof.html`, {
      waitUntil: "load",
    });
    await page.waitForFunction(
      () =>
        typeof (window as unknown as { __avatarProof?: { render?: unknown } })
          .__avatarProof?.render === "function",
      { timeout: 30_000 },
    );
    const files: (Omit<AvatarProofResult, "png" | "jpeg" | "hash"> & {
      file: string;
      preview: string;
    })[] = [];
    const hashes: Record<string, string> = {};
    const sheetNames = spec.sheets ?? [
      "neutral",
      "silhouette",
      "grayscale",
      "backgrounds",
      "expressions",
      "mouths",
      "motion",
    ];
    for (const sheet of sheetNames) {
      if (!/^[a-z][a-z0-9-]*$/.test(sheet))
        throw new Error("Nome de folha de avatar inválido.");
      const result = await page.evaluate(
        async (name) =>
          (
            window as unknown as {
              __avatarProof: {
                render(sheet: string): Promise<AvatarProofResult>;
              };
            }
          ).__avatarProof.render(name),
        sheet,
      );
      if (
        !result ||
        typeof result.png !== "string" ||
        typeof result.jpeg !== "string"
      )
        throw new Error(`Proof de avatar inválido: ${sheet}`);
      const file = join(spec.output, `${sheet}.png`);
      const preview = join(spec.output, `${sheet}.jpg`);
      await writeFile(file, Buffer.from(result.png, "base64"));
      await writeFile(preview, Buffer.from(result.jpeg, "base64"));
      files.push({
        sheet,
        file,
        preview,
        width: result.width,
        height: result.height,
        nativeWidth: result.nativeWidth,
        nativeHeight: result.nativeHeight,
      });
      hashes[sheet] = result.hash;
    }
    const review = await page.evaluate(
      (names) =>
        (
          window as unknown as {
            __avatarProof: {
              compose(sheets: string[]): {
                width: number;
                height: number;
                jpeg: string;
              };
            };
          }
        ).__avatarProof.compose(names),
      sheetNames,
    );
    if (!review || typeof review.jpeg !== "string")
      throw new Error("JPEG composto de avatar inválido.");
    const reviewPath = join(spec.output, "review.jpg");
    await writeFile(reviewPath, Buffer.from(review.jpeg, "base64"));
    return {
      files,
      hashes,
      reviewJpeg: {
        preview: reviewPath,
        width: review.width,
        height: review.height,
      },
      errors: [...new Set(errors)].slice(0, 20),
      networkRequests: [...new Set(networkRequests)],
    };
  } finally {
    try {
      await browser?.close();
    } finally {
      server.close();
    }
  }
}

/** Full-page screenshot of a public page (the user's landing page) for the fly-over format. */
async function capture(spec: Spec & { url: string; maxHeight?: number }) {
  const { default: puppeteer } = await import("puppeteer-core");
  const browser = await puppeteer.launch({
    executablePath: spec.browser,
    headless: true,
    args: ["--hide-scrollbars", "--mute-audio"],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({
      width: spec.width ?? 1440,
      height: 900,
      deviceScaleFactor: 1,
    });
    await page.goto(spec.url, { waitUntil: "networkidle2", timeout: 45_000 });
    // Scroll once so lazy images and scroll-triggered animations finish, then back to the top.
    await page.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += 600) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 120));
      }
      window.scrollTo(0, 0);
      await new Promise((r) => setTimeout(r, 800));
    });
    const height = await page.evaluate(() =>
      Math.ceil(document.documentElement.scrollHeight),
    );
    const clipHeight = Math.min(height, spec.maxHeight ?? 9000);
    await page.screenshot({
      path: spec.output as `${string}.jpg`,
      type: "jpeg",
      quality: 88,
      clip: { x: 0, y: 0, width: spec.width ?? 1440, height: clipHeight },
      captureBeyondViewport: true,
    });
    return {
      width: spec.width ?? 1440,
      height: clipHeight,
      pageHeight: height,
      title: await page.title(),
    };
  } finally {
    await browser.close();
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
) {
  try {
    const spec: Spec = JSON.parse(await readFile(process.argv[2], "utf8"));
    const mode = spec.mode ?? "scene";
    if (mode === "lint") say({ complete: true, findings: await lint(spec) });
    else if (mode === "analyze")
      say({ complete: true, ...(await analyze(spec)) });
    else if (mode === "capture")
      say({
        complete: true,
        ...(await capture(spec as Spec & { url: string })),
      });
    else if (mode === "stills")
      say({ complete: true, ...(await stills(spec)) });
    else if (mode === "avatar")
      say({ complete: true, ...(await renderAvatarProof(spec)) });
    else {
      const film = mode === "film",
        workers = film ? Math.max(1, spec.workers ?? 2) : 1;
      const config = resolveConfig({
        chromePath: spec.browser,
        concurrency: workers,
        enableBrowserPool: false,
        ...(film
          ? {}
          : {
              forceScreenshot: true,
              useDrawElement: false,
              enablePageSideCompositing: false,
            }),
      });
      const job = createRenderJob({
        fps: spec.fps,
        format: film ? "mp4" : "mov",
        quality: spec.quality ?? "high",
        workers,
        hdrMode: "force-sdr",
        // Films are written by agents: render what is renderable and report the rest.
        strictness: film ? "best-effort" : "strict",
        producerConfig: config,
      });
      await executeRenderJob(
        job,
        spec.directory,
        spec.output,
        (job, message) => {
          say({ progress: job.progress, label: message });
        },
      );
      say({ complete: true });
    }
  } catch (error) {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  }
}

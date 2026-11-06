// Runs in the application's private Node utility process, never the UI process.
// Modes: "scene" (one motion scene → MOV with alpha), "film" (a HyperFrames project → MP4 with audio),
// "stills" (seek the film and screenshot chosen seconds) and "lint" (HyperFrames static checks).
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createFileServer,
  createRenderJob,
  executeRenderJob,
  resolveConfig,
  runHyperframeLint,
} from "@hyperframes/producer";

interface Spec {
  mode?: "scene" | "film" | "stills" | "lint";
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
}
const say = (value: unknown) => console.log(JSON.stringify(value));

async function lint(spec: Spec) {
  const html = await readFile(join(spec.directory, "index.html"), "utf8");
  const result = await runHyperframeLint({ entryFile: "index.html", html, source: "projectDir" });
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
  const server = await createFileServer({ projectDir: spec.directory, fps: { num: spec.fps, den: 1 } });
  const browser = await puppeteer.launch({
    executablePath: spec.browser,
    headless: true,
    args: ["--autoplay-policy=no-user-gesture-required", "--mute-audio"],
  });
  const errors: string[] = [];
  try {
    const page = await browser.newPage();
    page.on("pageerror", (e) => errors.push(`Erro de script: ${e instanceof Error ? e.message : String(e)}`));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(`Console: ${m.text()}`);
    });
    // Films are written by agents: nothing outside the film folder is fetched.
    await page.setRequestInterception(true);
    page.on("request", (r) => {
      const url = r.url();
      if (url.startsWith(server.url) || url.startsWith("data:") || url.startsWith("blob:")) void r.continue();
      else {
        errors.push(`Bloqueado (fora da pasta do filme): ${url.slice(0, 120)}`);
        void r.abort();
      }
    });
    page.on("requestfailed", (r) => {
      // Chrome cancels media range requests on seek (net::ERR_ABORTED): that is not a missing file.
      if (r.url().startsWith(server.url) && r.failure()?.errorText !== "net::ERR_ABORTED")
        errors.push(`Arquivo não carregou: ${r.url().replace(server.url, "")}`);
    });
    await page.setViewport({ width: spec.width ?? 1080, height: spec.height ?? 1920, deviceScaleFactor: spec.scale ?? 0.5 });
    await page.goto(`${server.url}/index.html`, { waitUntil: "load" });
    await page.waitForFunction(
      () => {
        const hf = (window as unknown as { __hf?: { seek?: unknown; duration?: number } }).__hf;
        return !!hf && typeof hf.seek === "function" && (hf.duration ?? 0) > 0;
      },
      { timeout: 60_000 },
    );
    const duration = await page.evaluate(() => (window as unknown as { __hf: { duration: number } }).__hf.duration);
    const files: { t: number; file: string }[] = [];
    for (const t of spec.times ?? []) {
      const at = Math.max(0, Math.min(t, duration - 1 / spec.fps));
      await page.evaluate((s) => (window as unknown as { __hf: { seek(t: number): void } }).__hf.seek(s), at);
      await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
      const file = join(spec.output, `quadro-${at.toFixed(2).padStart(6, "0")}.png`);
      await page.screenshot({ path: file as `${string}.png` });
      files.push({ t: +at.toFixed(2), file });
    }
    return { duration, files, errors: [...new Set(errors)].slice(0, 20) };
  } finally {
    await browser.close();
    server.close();
  }
}

try {
  const spec: Spec = JSON.parse(await readFile(process.argv[2], "utf8"));
  const mode = spec.mode ?? "scene";
  if (mode === "lint") say({ complete: true, findings: await lint(spec) });
  else if (mode === "stills") say({ complete: true, ...(await stills(spec)) });
  else {
    const film = mode === "film",
      workers = film ? Math.max(1, spec.workers ?? 2) : 1;
    const config = resolveConfig({
      chromePath: spec.browser,
      concurrency: workers,
      enableBrowserPool: false,
      ...(film ? {} : { forceScreenshot: true, useDrawElement: false, enablePageSideCompositing: false }),
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
    await executeRenderJob(job, spec.directory, spec.output, (job, message) => {
      say({ progress: job.progress, label: message });
    });
    say({ complete: true });
  }
} catch (error) {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
}

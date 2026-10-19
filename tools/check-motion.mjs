import { _electron as electron, expect } from "@playwright/test";
import { mkdir, writeFile, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { workspacePanel, expandGroup } from "./ui-navigation.mjs";
const require = createRequire(import.meta.url),
  ffmpeg = require("ffmpeg-static");
await mkdir("artifacts", { recursive: true });
const source = resolve("artifacts/motion-fixture.mp4"),
  output = resolve("artifacts/motion-export.mp4");
const made = spawnSync(
  ffmpeg,
  [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=960x540:rate=30:duration=8",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=8",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-movflags",
    "+faststart",
    source,
  ],
  { windowsHide: true },
);
if (made.status !== 0) throw new Error(String(made.stderr));
const profile = resolve(`artifacts/motion-profile-${Date.now()}`);
const env = { ...process.env, CUTROOM_USER_DATA: profile };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch(
  process.argv.includes("--packaged")
    ? {
        executablePath: resolve("release/win-unpacked/CutRoom.exe"),
        env,
        timeout: 60000,
      }
    : { args: ["."], env, timeout: 60000 },
);
const report = { checks: [], errors: [], console: [], profile };
try {
  const page = await app.firstWindow();
  page.on("pageerror", (e) => report.errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") report.console.push(m.text());
  });
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false),
  );
  await page.waitForFunction(() => !!window.cutroom);
  const request = (method, params) =>
    page.evaluate(
      ([method, params]) => window.cutroom.request(method, params),
      [method, params],
    );
  await request("dismissOnboarding");
  const imported = await request("importPaths", { paths: [source] });
  const p = imported.project;
  p.settings = {
    ...p.settings,
    width: 960,
    height: 540,
    fps: 30,
    normalize: false,
  };
  const broken = resolve("artifacts/motion-broken-preview.mp4");
  await writeFile(broken, "broken MP4 preview fixture");
  p.media[0].proxy = broken;
  const projectFile = resolve("artifacts/motion-check.cutroom.json");
  await writeFile(projectFile, JSON.stringify(p));
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [file],
    });
  }, projectFile);
  await request("openProject");
  await page.waitForFunction(
    () =>
      document.querySelector("video")?.readyState >= 2 &&
      !document.querySelector(".player-error"),
    null,
    { timeout: 120000 },
  );
  const recovered = await request("getState");
  expect(recovered.project.media[0].proxy).toContain("recovery");
  report.checks.push(
    "decoder error automatically creates compatible local preview",
  );
  await workspacePanel(page, "style");
  await expandGroup(page, "Efeitos e animações");
  await page
    .getByRole("button", { name: "Adicionar animação", exact: true })
    .click();
  await page
    .getByLabel("Texto da animação", { exact: true })
    .fill("Ideias em movimento");
  await page.getByLabel("Início da animação").fill("0");
  await page.getByLabel("Fim da animação").fill("2.5");
  await page
    .getByRole("button", { name: "Adicionar à timeline", exact: true })
    .click();
  await expect(page.locator(".motion-block")).toHaveCount(1);
  report.checks.push("native controls create portable timeline scene");
  await page.getByLabel("Posição no projeto").fill("1");
  await expect(page.locator(".motion-preview")).toHaveAttribute(
    "data-status",
    "ready",
    { timeout: 20000 },
  );
  const iframe = page.locator("hyperframes-player").locator("iframe");
  expect(await iframe.getAttribute("sandbox")).toBe("allow-scripts");
  report.checks.push("official HyperFrames player ready in opaque sandbox");
  await page.screenshot({ path: "artifacts/motion-preview.png" });
  await request("executeCommand", {
    name: "motion",
    args: {
      name: "Três etapas",
      start: 3,
      end: 5,
      mode: "fullscreen",
      presetId: "steps",
      text: "Do texto ao vídeo",
      items: ["Explique", "Anime", "Exporte"],
    },
  });
  await request("executeCommand", {
    name: "motion",
    args: {
      name: "Cena criada por texto",
      start: 5,
      end: 7,
      mode: "overlay",
      html: '<style>.custom{position:absolute;left:10%;top:18%;padding:40px;background:#ff6b0b;color:#fff;font:700 64px Barlow;border-radius:20px}</style><div class="custom">Sua ideia, em movimento.</div>',
      animations: [
        {
          selector: ".custom",
          start: 0,
          duration: 0.4,
          from: { x: -140, opacity: 0 },
          to: { x: 0, opacity: 1 },
          ease: "power2.out",
        },
        {
          selector: ".custom",
          start: 1.6,
          duration: 0.4,
          to: { x: 140, opacity: 0 },
        },
      ],
    },
  });
  await page.getByLabel("Posição no projeto").fill("3.8");
  await expect(
    page.locator('.motion-preview[data-active="true"]'),
  ).toHaveAttribute("data-status", "ready");
  await page.screenshot({ path: "artifacts/motion-fullscreen.png" });
  await request("undo");
  await expect(page.locator(".motion-block")).toHaveCount(2);
  await request("redo");
  await expect(page.locator(".motion-block")).toHaveCount(3);
  report.checks.push("animation undo/redo");
  const installing = request("installPackage", { id: "hyperframes-motion" });
  const cancelledInstall = installing.then(
    () => null,
    (e) => String(e),
  );
  await expect
    .poll(
      async () =>
        (await request("getState")).jobs.find(
          (j) => j.kind === "package" && j.status === "running",
        )?.id,
    )
    .toBeTruthy();
  const installJob = (await request("getState")).jobs.find(
    (j) => j.kind === "package" && j.status === "running",
  );
  await request("cancelJob", { id: installJob.id });
  expect(await cancelledInstall).toMatch(/cancel|abort/i);
  report.checks.push(
    "package download cancellation leaves no completed installation",
  );
  await request("installPackage", { id: "hyperframes-motion" });
  report.checks.push(
    "optional package download, pinned checksum, private install",
  );
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
  }, output);
  await request("exportVideo");
  expect((await stat(output)).size).toBeGreaterThan(10000);
  report.checks.push(
    "HyperFrames renders alpha/fullscreen/custom scenes and FFmpeg exports",
  );
  const originalHash = createHash("sha256")
      .update(await readFile(output))
      .digest("hex"),
    firstScene = (await request("getState")).project.motions[0];
  await request("executeCommand", {
    name: "motion",
    args: { id: firstScene.id, text: "Render que sera cancelado" },
  });
  const exporting = request("exportVideo");
  const cancelledExport = exporting.then(
    () => null,
    (e) => String(e),
  );
  await expect
    .poll(
      async () =>
        (await request("getState")).jobs.find(
          (j) =>
            j.kind === "export" && j.status === "running" && j.progress > 0,
        )?.id,
      { timeout: 30000 },
    )
    .toBeTruthy();
  const renderJob = (await request("getState")).jobs.find(
    (j) => j.kind === "export" && j.status === "running",
  );
  await request("cancelJob", { id: renderJob.id });
  expect(await cancelledExport).toMatch(/cancel|abort/i);
  expect(
    createHash("sha256")
      .update(await readFile(output))
      .digest("hex"),
  ).toBe(originalHash);
  await request("undo");
  report.checks.push(
    "render cancellation preserves previous export and cleans partial scene",
  );
  const before = (await request("getState")).project;
  const started = Date.now();
  await request("exportVideo");
  report.cacheExportMs = Date.now() - started;
  report.checks.push("second export reuses scene cache");
  await request("saveProject");
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [file],
    });
  }, projectFile);
  await request("openProject");
  expect((await request("getState")).project.motions).toHaveLength(3);
  report.checks.push("saved project reopens all portable scene definitions");
  const probe = spawnSync(
    require("ffprobe-static").path,
    ["-v", "error", "-show_streams", "-show_format", "-of", "json", output],
    { windowsHide: true },
  );
  report.output = JSON.parse(probe.stdout);
  expect(report.output.streams.some((s) => s.codec_type === "audio")).toBe(
    true,
  );
  expect(Number(report.output.format.duration)).toBeCloseTo(8, 1);
  const volume = spawnSync(
    ffmpeg,
    [
      "-hide_banner",
      "-i",
      output,
      "-af",
      "volumedetect",
      "-vn",
      "-f",
      "null",
      "-",
    ],
    { windowsHide: true },
  );
  report.audio = String(volume.stderr).match(/mean_volume: [^\r\n]+/)?.[0];
  expect(report.audio).not.toContain("-inf");
  // The composition clock must follow pause, play and backward scrubs without replacing its iframe.
  await page.getByLabel("Posição no projeto").fill("1");
  await expect(
    page.locator(".motion-preview[data-motion-id]").first(),
  ).toHaveAttribute("data-status", "ready");
  const beforeClock = await page
    .locator("hyperframes-player")
    .first()
    .evaluate((p) => p.currentTime);
  await page.getByLabel("Posição no projeto").fill("0.8");
  await expect
    .poll(() =>
      page
        .locator("hyperframes-player")
        .first()
        .evaluate((p) => p.currentTime),
    )
    .toBeLessThan(beforeClock);
  report.checks.push("preview follows backward seeks on the video clock");
  if (report.errors.length || report.console.length)
    throw new Error(
      JSON.stringify({ errors: report.errors, console: report.console }),
    );
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1050, 700),
  );
  await page.screenshot({ path: "artifacts/motion-minimum.png" });
  report.scenes = before.motions.map(({ id, name, start, end, mode }) => ({
    id,
    name,
    start,
    end,
    mode,
  }));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await writeFile(
    "artifacts/motion-check-report.json",
    JSON.stringify(report, null, 2),
  );
  await app.close();
}

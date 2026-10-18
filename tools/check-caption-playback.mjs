import { _electron as electron, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { workspacePanel, expandGroup } from "./ui-navigation.mjs";

const require = createRequire(import.meta.url);
await mkdir("artifacts", { recursive: true });
const sourceArg = process.argv.indexOf("--source");
const source =
  sourceArg >= 0
    ? resolve(process.argv[sourceArg + 1])
    : resolve("artifacts/caption-playback-source.mp4");
const made =
  sourceArg >= 0
    ? { status: 0 }
    : spawnSync(
        require("ffmpeg-static"),
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-y",
          "-f",
          "lavfi",
          "-i",
          "testsrc2=size=1920x1080:rate=60:duration=30",
          "-f",
          "lavfi",
          "-i",
          "sine=frequency=440:duration=30",
          "-c:v",
          "libx264",
          "-preset",
          "ultrafast",
          "-crf",
          "28",
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
const env = {
  ...process.env,
  CUTROOM_USER_DATA: resolve(
    `artifacts/caption-playback-profile-${Date.now()}`,
  ),
};
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
const report = { checks: [], samples: [], errors: [], console: [] };
let page;
try {
  page = await app.firstWindow();
  // Keep the test equivalent to a foreground editor even if another desktop
  // window covers this isolated test window while automation is running.
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false),
  );
  page.on("pageerror", (e) => report.errors.push(e.message));
  page.on("console", (e) => {
    if (e.type() === "error") report.console.push(e.text());
  });
  await page.waitForFunction(() => !!window.cutroom);
  const request = (m, p) =>
    page.evaluate(
      ([method, params]) => window.cutroom.request(method, params),
      [m, p],
    );
  await request("dismissOnboarding");
  const imported = await request("importPaths", { paths: [source] });
  const project = imported.project;
  const mediaId = project.media[0].id;
  project.settings = {
    ...project.settings,
    width: 1920,
    height: 1080,
    fps: 60,
    captions: true,
  };
  const clipLength = sourceArg >= 0 ? 4.3 : 0.5;
  const clipStride = sourceArg >= 0 ? 4.7 : 0.6;
  project.clips = Array.from({ length: 47 }, (_, i) => ({
    id: `caption-cut-${i}`,
    mediaId,
    start: i * clipStride,
    end: i * clipStride + clipLength,
    speed: 1,
    zoom: i % 4 === 0 ? 1.25 : 1,
    focusX: 0.5,
    focusY: 0.5,
    muted: false,
  }));
  project.words = Array.from(
    { length: Math.floor(project.media[0].duration / 0.3) },
    (_, i) => ({
      mediaId,
      text: ["Legenda", "sobre", "vídeo", "em", "movimento."][i % 5],
      start: i * 0.3,
      end: i * 0.3 + 0.28,
    }),
  );
  project.overlays = [];
  const file = resolve("artifacts/caption-playback.cutroom.json");
  await writeFile(file, JSON.stringify(project));
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [file],
    });
  }, file);
  await request("openProject");
  await page.waitForFunction(
    () => document.querySelector("video")?.readyState >= 2,
  );
  await workspacePanel(page, "style");
  await expandGroup(page, "Legendas");
  await expect(page.locator(".caption-ass-preview")).toHaveAttribute(
    "data-render-status",
    "ready",
    { timeout: 45000 },
  );
  // Import/open replaces the temporary project's media allowlist. Only errors
  // from the loaded fixture and its caption interactions belong to this check.
  report.setupConsole = [...report.console];
  report.console.length = 0;
  await page.evaluate(() => {
    window.__playbackVideo = document.querySelector("video");
    window.__captionPresentedFrames = 0;
    const presented = () => {
      window.__captionPresentedFrames++;
      window.__playbackVideo.requestVideoFrameCallback(presented);
    };
    window.__playbackVideo.requestVideoFrameCallback(presented);
  });
  const read = () =>
    page.locator("video").evaluate((v) => ({
      time: v.currentTime,
      paused: v.paused,
      ready: v.readyState,
      frames: v.getVideoPlaybackQuality().totalVideoFrames,
      presented: window.__captionPresentedFrames,
      error: v.error?.message,
      sameElement: v === window.__playbackVideo,
    }));
  const visiblePixels = async () => {
    const screenshot = await page.locator(".video-composition").screenshot();
    return app.evaluate(({ nativeImage }, base64) => {
      const image = nativeImage.createFromBuffer(Buffer.from(base64, "base64"));
      const { width, height } = image.getSize(),
        bytes = image.toBitmap();
      let sum = 0,
        count = 0;
      for (let y = Math.floor(height * 0.15); y < height * 0.6; y += 4)
        for (let x = Math.floor(width * 0.2); x < width * 0.8; x += 4) {
          const i = (y * width + x) * 4;
          sum += bytes[i] + bytes[i + 1] + bytes[i + 2];
          count += 3;
        }
      return sum / count;
    }, screenshot.toString("base64"));
  };
  for (let i = 0; i < 24; i++) {
    await page
      .getByRole("slider", { name: "Posição no projeto" })
      .fill(
        String(Number((1.1 + (i * (47 * clipLength - 3)) / 24).toFixed(2))),
      );
    if (
      await page
        .getByRole("button", { name: "Reproduzir", exact: true })
        .count()
    )
      await page
        .getByRole("button", { name: "Reproduzir", exact: true })
        .click();
    await page.waitForFunction(() => {
      const v = document.querySelector("video");
      return !v.paused && !v.seeking && v.readyState >= 2;
    });
    const before = await read();
    await page.evaluate(() => {
      window.__captionTimelineSamples = [];
      const record = () => {
        window.__captionTimelineSamples.push(
          Number(document.querySelector(".player-seek").value),
        );
        window.__captionSampleRequest = requestAnimationFrame(record);
      };
      window.__captionSampleRequest = requestAnimationFrame(record);
    });
    await page.locator(".caption-preset").nth(i).click();
    await page.waitForTimeout(700);
    await expect
      .poll(
        async () => {
          const current = await read();
          return (
            !current.paused &&
            current.presented > before.presented &&
            current.time > before.time + 0.15
          );
        },
        { timeout: 5000 },
      )
      .toBeTruthy();
    const after = await read();
    const backwards = await page.evaluate(() => {
      cancelAnimationFrame(window.__captionSampleRequest);
      return window.__captionTimelineSamples.some(
        (value, index, values) => index > 0 && value < values[index - 1] - 0.05,
      );
    });
    const brightness = await visiblePixels();
    const alpha = await page
      .locator(".caption-ass-canvas")
      .evaluate((canvas) => {
        const copy = document.createElement("canvas");
        copy.width = canvas.width;
        copy.height = canvas.height;
        const ctx = copy.getContext("2d");
        ctx.drawImage(canvas, 0, 0);
        const pixels = ctx.getImageData(0, 0, copy.width, copy.height).data;
        let covered = 0,
          samples = 0;
        for (let index = 3; index < pixels.length; index += 64) {
          samples++;
          if (pixels[index] > 0) covered++;
        }
        return { corner: pixels[3], coverage: covered / samples };
      });
    const sample = { preset: i, before, after, brightness, alpha };
    report.samples.push(sample);
    if (
      !process.argv.includes("--observe") &&
      (after.paused ||
        after.time <= before.time + 0.15 ||
        after.frames <= before.frames ||
        after.presented <= before.presented ||
        backwards ||
        !after.sameElement ||
        brightness < 20 ||
        alpha.corner !== 0 ||
        alpha.coverage >= 0.75)
    )
      throw new Error(
        `Caption preset interrupted or hid video: ${JSON.stringify(sample)}`,
      );
  }
  report.checks.push(
    process.argv.includes("--observe")
      ? "diagnostic observations only; assertions intentionally disabled"
      : "24 actual caption-card clicks preserve decoded moving video on a 47-cut 1080p60 project",
  );
  if (!process.argv.includes("--observe"))
    report.checks.push(
      "caption canvas alpha remains transparent outside glyphs/backgrounds for all 24 styles",
    );
  if (report.samples.every((sample) => sample.alpha.coverage === 0))
    throw new Error("No actual caption pixels were drawn by any preset.");
  await page.getByRole("slider", { name: "Posição no projeto" }).fill("3.1");
  for (let i = 0; i < 6; i++) {
    await page
      .getByRole("button", { name: "Legendas ativadas", exact: true })
      .click();
    await expect(page.locator(".caption-ass-canvas")).toHaveCount(0);
    await page
      .getByRole("button", { name: "Legendas desativadas", exact: true })
      .click();
    await expect(page.locator(".caption-ass-preview")).toHaveAttribute(
      "data-render-status",
      "ready",
      { timeout: 15000 },
    );
    await expect(page.locator(".caption-ass-canvas")).toHaveCount(1);
    if ((await read()).paused)
      throw new Error("Caption toggle paused playback.");
  }
  report.checks.push(
    "six caption disable/enable cycles create only one transparent canvas",
  );
  if (await page.getByRole("button", { name: "Pausar", exact: true }).count())
    await page.getByRole("button", { name: "Pausar", exact: true }).click();
  const pausedBefore = await read();
  await page.locator(".caption-preset").first().click();
  await page.waitForTimeout(300);
  const pausedAfter = await read();
  if (
    !pausedAfter.paused ||
    Math.abs(pausedAfter.time - pausedBefore.time) > 0.05
  )
    throw new Error("Changing style restarted paused video.");
  await page.getByRole("button", { name: "Reproduzir", exact: true }).click();
  await expect
    .poll(async () => (await read()).time, { timeout: 8000 })
    .toBeGreaterThan(pausedAfter.time + 0.2);
  report.checks.push(
    "style changes preserve a paused playhead, and the Play button resumes actual decoded video",
  );
  await page.screenshot({ path: "artifacts/caption-playback.png" });
  if (report.errors.length || report.console.length)
    throw new Error(
      JSON.stringify({ errors: report.errors, console: report.console }),
    );
  console.log(
    JSON.stringify(
      {
        checks: report.checks,
        sampleCount: report.samples.length,
        minBrightness: Math.min(...report.samples.map((s) => s.brightness)),
        pausedSamples: report.samples.filter((s) => s.after.paused).length,
        errors: report.errors,
        console: report.console,
      },
      null,
      2,
    ),
  );
} catch (error) {
  report.failure = String(error);
  await page
    ?.screenshot({ path: "artifacts/caption-playback-failure.png" })
    .catch(() => {});
  throw error;
} finally {
  await writeFile(
    "artifacts/caption-playback-verification.json",
    JSON.stringify(report, null, 2),
  );
  await app.close();
}

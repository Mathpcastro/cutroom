import { _electron as electron, expect } from "@playwright/test";
import { mkdir, readFile, writeFile, stat, cp } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
const require = createRequire(import.meta.url),
  ffmpeg = require("ffmpeg-static"),
  probe = require("ffprobe-static").path;
await mkdir("artifacts", { recursive: true });
const fixture = resolve("artifacts/commands-fixture.mp4"),
  output = resolve("artifacts/commands-export.mp4");
const generated = spawnSync(
  ffmpeg,
  [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=640x360:rate=30:duration=18",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=18",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-crf",
    "18",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-movflags",
    "+faststart",
    fixture,
  ],
  { windowsHide: true },
);
if (generated.status) throw new Error(String(generated.stderr));
const profile = resolve(`artifacts/commands-profile-${Date.now()}`);
await mkdir(profile, { recursive: true });
// Reuse the already checksum-verified optional browser in isolated test data.
const previous = JSON.parse(
  await readFile("artifacts/motion-check-report.json", "utf8"),
);
await cp(join(previous.profile, "packages"), join(profile, "packages"), {
  recursive: true,
});
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
  page.on("console", (e) => {
    if (e.type() === "error") report.console.push(e.text());
  });
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false),
  );
  await page.waitForFunction(() => !!window.cutroom);
  const request = (m, p) =>
    page.evaluate(([m, p]) => window.cutroom.request(m, p), [m, p]);
  await request("dismissOnboarding");
  await request("importPaths", { paths: [fixture] });
  const input = page.getByRole("textbox", { name: "Descreva sua edição" });
  await input.fill("/normalizar");
  await input.press("Enter");
  await expect
    .poll(
      async () =>
        (await request("getState")).messages.filter(
          (m) => m.role === "user" && m.text.startsWith("/normalizar"),
        ).length,
    )
    .toBe(1);
  expect((await request("getState")).connection.status).toBe("disconnected");
  report.checks.push("exact slash executes once without any AI connection");
  await input.fill("/comando-inexistente");
  await input.press("Enter");
  await expect(input).toHaveValue("/comando-inexistente");
  report.checks.push(
    "unknown slash preserved as helpful error without AI send",
  );
  await input.fill("");
  await request("runChatCommand", {
    id: "soco-pb",
    options: { start: 0, end: 3, text: "PARE AGORA OLHE" },
  });
  let state = await request("getState");
  expect(state.project.motions).toHaveLength(1);
  expect(state.project.clips[0].look).toBe("monochrome");
  await request("runChatCommand", { id: "desfazer" });
  state = await request("getState");
  expect(state.project.motions).toHaveLength(0);
  expect(state.project.clips[0].look).toBeUndefined();
  await request("runChatCommand", { id: "refazer" });
  report.checks.push(
    "compound effect undoes and redoes image + zoom + motion in one step",
  );
  for (const [id, options] of [
    ["modo-cinema", { start: 3, end: 6, text: "Uma ideia muda tudo" }],
    [
      "prompt-digitando",
      { start: 6, end: 9, text: "Crie um video a partir desta ideia" },
    ],
    [
      "lista-check",
      {
        start: 9,
        end: 12,
        text: "Passo a passo",
        items: ["Planejar", "Gravar", "Publicar"],
      },
    ],
    ["cortina-cor", { start: 12, end: 15 }],
  ])
    await request("runChatCommand", { id, options });
  await page.getByLabel("Posição no projeto").fill("13.5");
  await expect(
    page.locator('.motion-preview[data-active="true"]'),
  ).toHaveAttribute("data-status", "ready", { timeout: 20000 });
  await page.screenshot({ path: "artifacts/commands-wipe-preview.png" });
  const beforeMissing = (await request("getState")).project;
  await request("runChatCommand", { id: "legendar" }).then(
    () => {
      throw new Error("Expected missing transcription package");
    },
    () => {},
  );
  expect((await request("getState")).project.settings.captions).toBe(
    beforeMissing.settings.captions,
  );
  report.checks.push(
    "speech command reports missing transcription without partially editing",
  );
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
  }, output);
  await request("runChatCommand", { id: "exportar" });
  expect((await stat(output)).size).toBeGreaterThan(10000);
  const info = JSON.parse(
    spawnSync(
      probe,
      ["-v", "error", "-show_streams", "-show_format", "-of", "json", output],
      { windowsHide: true },
    ).stdout,
  );
  expect(info.streams.some((s) => s.codec_type === "audio")).toBe(true);
  expect(Number(info.format.duration)).toBeCloseTo(18, 1);
  function sample(t, x, y, w = 40, h = 40) {
    const p = spawnSync(
      ffmpeg,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-ss",
        String(t),
        "-i",
        output,
        "-frames:v",
        "1",
        "-vf",
        `crop=${w}:${h}:${x}:${y},format=rgb24`,
        "-f",
        "rawvideo",
        "pipe:1",
      ],
      { windowsHide: true },
    );
    if (p.status) throw new Error(String(p.stderr));
    let delta = 0,
      light = 0;
    for (let i = 0; i < p.stdout.length; i += 3) {
      const [r, g, b] = p.stdout.subarray(i, i + 3);
      delta += Math.abs(r - g) + Math.abs(g - b);
      light += (r + g + b) / 3;
    }
    return {
      delta: delta / (p.stdout.length / 3),
      light: light / (p.stdout.length / 3),
    };
  }
  report.samples = {
    impact: sample(1.3, 60, 60),
    cinemaBar: sample(4.5, 80, 0, 80, 25),
    wipeLeft: sample(13.5, 60, 60),
    wipeRight: sample(13.5, 540, 60),
    wipeLater: sample(14.8, 540, 60),
  };
  expect(report.samples.impact.delta).toBeLessThan(6);
  expect(report.samples.cinemaBar.light).toBeLessThan(8);
  expect(report.samples.wipeLeft.delta).toBeGreaterThan(30);
  expect(report.samples.wipeRight.delta).toBeLessThan(8);
  expect(report.samples.wipeLater.delta).toBeGreaterThan(30);
  for (const [name, time] of [
    ["impact", 1.3],
    ["cinema", 4.5],
    ["typing", 7.8],
    ["checklist", 11],
    ["wipe", 13.5],
  ]) {
    const f = spawnSync(
      ffmpeg,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-ss",
        String(time),
        "-i",
        output,
        "-frames:v",
        "1",
        resolve(`artifacts/command-${name}.png`),
      ],
      { windowsHide: true },
    );
    if (f.status) throw new Error(String(f.stderr));
  }
  report.checks.push(
    "five reference commands render with original audio; decoded pixels prove grayscale, cinema bars and left-to-right color reveal",
  );
  if (report.errors.length || report.console.length)
    throw new Error(
      JSON.stringify({ errors: report.errors, console: report.console }),
    );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await writeFile(
    "artifacts/commands-report.json",
    JSON.stringify(report, null, 2),
  );
  await app.close();
}

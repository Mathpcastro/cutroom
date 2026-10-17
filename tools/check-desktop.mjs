import { _electron as electron } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const ffmpeg = require("ffmpeg-static");
await mkdir("artifacts", { recursive: true });
const source = resolve("artifacts/desktop-fixture.mp4");
const make = spawnSync(
  ffmpeg,
  [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=640x360:rate=30:duration=7",
    "-i",
    resolve("artifacts/speech.wav"),
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-shortest",
    source,
  ],
  { windowsHide: true },
);
if (make.status !== 0) throw new Error(String(make.stderr));
const env = {
  ...process.env,
  CUTROOM_USER_DATA: resolve("artifacts/electron-profile"),
};
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch(
  process.argv.includes("--packaged")
    ? {
        executablePath: resolve("release/win-unpacked/CutRoom.exe"),
        args: [],
        env,
        timeout: 60_000,
      }
    : { args: ["."], env, timeout: 60_000 },
);
const result = { errors: [], checks: [] };
let currentPage;
try {
  const page = await app.firstWindow();
  currentPage = page;
  page.on("pageerror", (error) => result.errors.push(error.message));
  await page.waitForFunction(() => !!window.cutroom);
  await page.getByRole("heading", { name: "Da ideia ao corte." }).waitFor();
  await page.screenshot({ path: "artifacts/desktop-empty.png" });
  const request = (method, params) =>
    page.evaluate(([m, p]) => window.cutroom.request(m, p), [method, params]);
  let state = await request("importPaths", { paths: [source] });
  if (state.project.media.length !== 1 || state.project.clips.length !== 1)
    throw new Error("Import failed.");
  const media = state.project.media[0];
  await page.locator("video").waitFor();
  await page.waitForFunction(
    () => document.querySelector("video")?.readyState >= 2,
  );
  await page.getByRole("slider", { name: "Posição no projeto" }).fill("1");
  await page.waitForFunction(
    () =>
      Math.abs(document.querySelector("video").currentTime - 1) < 0.2 &&
      !document.querySelector("video").seeking,
  );
  result.checks.push(
    "native bridge, import, custom media protocol and actual video decode",
  );
  state = await request("executeCommand", {
    name: "split",
    args: { clipId: state.project.clips[0].id, time: 3 },
  });
  if (state.project.clips.length !== 2) throw new Error("Split failed.");
  state = await request("undo");
  if (state.project.clips.length !== 1) throw new Error("Undo failed.");
  state = await request("redo");
  if (state.project.clips.length !== 2) throw new Error("Redo failed.");
  result.checks.push("split, undo and redo via actual app state");
  state = await request("executeCommand", {
    name: "overlay",
    args: {
      kind: "callout",
      text: "Edição por texto, no seu PC.",
      start: 0.5,
      end: 2.7,
    },
  });
  state = await request("executeCommand", {
    name: "zoom",
    args: { clipId: state.project.clips[1].id, factor: 1.25 },
  });
  await page.screenshot({ path: "artifacts/desktop-project.png" });
  const account = await request("connectCodex", {});
  if (account.connection.status !== "connected")
    throw new Error("Codex connection failed.");
  result.account = account.connection.account;
  result.models = account.connection.models.map((model) => model.id);
  result.checks.push(
    "real bundled Codex App Server existing-session connection",
  );
  if (process.argv.includes("--ai")) {
    state = await request("sendChat", {
      text: "Consulte o projeto e renomeie-o para Teste real CutRoom. Ative as legendas com a ferramenta do editor. Não exporte nem transcreva agora. Responda em uma frase curta.",
      model: account.connection.model,
    });
    if (
      state.project.name !== "Teste real CutRoom" ||
      !state.project.settings.captions
    )
      throw new Error(
        `AI edit not applied: ${state.project.name}, captions=${state.project.settings.captions}`,
      );
    result.checks.push(
      "real natural-language turn called project tools and changed editor state",
    );
    result.assistant = state.messages
      .filter((message) => message.role === "assistant")
      .at(-1)?.text;
  }
  const hasTranscription = (await request("getState")).packages.some(
    (item) => item.installed,
  );
  if (hasTranscription) {
    state = await request("transcribe");
    if (state.project.words.length < 3)
      throw new Error("Desktop transcription empty.");
    result.words = state.project.words.length;
    result.checks.push("real local transcription through Electron job system");
  }
  const projectPath = resolve("artifacts/desktop-saved.cutroom.json");
  const exportPath = resolve("artifacts/desktop-export.mp4");
  await app.evaluate(
    ({ dialog }, paths) => {
      dialog.showSaveDialog = async (...args) => ({
        canceled: false,
        filePath:
          args.at(-1).title === "Exportar vídeo"
            ? paths.exportPath
            : paths.projectPath,
      });
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [paths.projectPath],
      });
    },
    { projectPath, exportPath },
  );
  state = await request("saveProject");
  state = await request("exportVideo");
  if (
    !state.jobs.some(
      (job) =>
        job.kind === "export" &&
        job.status === "completed" &&
        job.output === exportPath,
    )
  )
    throw new Error("Export failed.");
  result.checks.push(
    "real FFmpeg MP4 export through desktop save dialog route",
  );
  const expected = state.project;
  await request("newProject");
  state = await request("openProject");
  if (
    state.project.id !== expected.id ||
    state.project.clips.length !== expected.clips.length
  )
    throw new Error("Saved project did not reopen.");
  result.checks.push("atomic save and reopened project preserve timeline");
  await page.getByRole("button", { name: "Transcrição", exact: true }).click();
  await page.screenshot({ path: "artifacts/desktop-transcript.png" });
  if (result.errors.length)
    throw new Error(`Renderer errors: ${result.errors.join("; ")}`);
  await writeFile(
    process.argv.includes("--packaged")
      ? "artifacts/packaged-verification.json"
      : "artifacts/desktop-verification.json",
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  result.failure = String(error);
  if (currentPage && !currentPage.isClosed())
    await currentPage
      .screenshot({ path: "artifacts/desktop-failure.png" })
      .catch(() => {});
  await writeFile(
    "artifacts/desktop-verification-failed.json",
    JSON.stringify(result, null, 2),
  );
  console.error(JSON.stringify(result, null, 2));
  throw error;
} finally {
  await app.close();
}

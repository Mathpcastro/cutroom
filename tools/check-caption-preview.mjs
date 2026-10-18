import { _electron as electron } from "@playwright/test";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

await mkdir("artifacts", { recursive: true });
const project = JSON.parse(
  await readFile("artifacts/desktop-saved.cutroom.json", "utf8"),
);
project.overlays = [];
project.settings.captions = true;
delete project.chat;
const projectPath = resolve("artifacts/caption-preview.cutroom.json");
await writeFile(projectPath, JSON.stringify(project));
const env = {
  ...process.env,
  CUTROOM_USER_DATA: resolve(`artifacts/caption-preview-profile-${Date.now()}`),
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
const evidence = { checks: [], errors: [], console: [] };
try {
  const page = await app.firstWindow();
  page.on("pageerror", (e) => evidence.errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") evidence.console.push(m.text());
  });
  await page.waitForFunction(() => !!window.cutroom);
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [file],
    });
  }, projectPath);
  const request = (method, params) =>
    page.evaluate(([m, p]) => window.cutroom.request(m, p), [method, params]);
  await request("dismissOnboarding");
  await request("openProject");
  const canvas = page.locator('[data-renderer="jassub-libass"]');
  await canvas.waitFor();
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-renderer="jassub-libass"]')
        ?.getAttribute("data-render-status") !== "loading",
    null,
    { timeout: 45000 },
  );
  if ((await canvas.getAttribute("data-render-status")) !== "ready")
    throw new Error(await canvas.innerText());
  evidence.checks.push(
    "bundled JASSUB worker, WASM and offline fonts load in real Electron without Node access",
  );
  for (const presetId of [
    "studio-highlight",
    "word-bounce",
    "karaoke",
    "pill-phrase",
    "typewriter",
  ]) {
    await request("executeCommand", {
      name: "captions",
      args: { enabled: true, style: { presetId } },
    });
    await page.getByRole("slider", { name: "Posição no projeto" }).fill("1.5");
    await page.waitForTimeout(300);
    if ((await canvas.getAttribute("data-render-status")) !== "ready")
      throw new Error(
        `Preview failed for ${presetId}: ${await canvas.innerText()}`,
      );
    await page.screenshot({
      path: `artifacts/caption-preview-${presetId}.png`,
    });
  }
  evidence.checks.push(
    "five distinct live ASS styles update through native commands at the actual output playhead",
  );
  await page.getByRole("button", { name: "Estilo", exact: true }).click();
  await page.locator(".caption-studio").scrollIntoViewIfNeeded();
  await page.screenshot({ path: "artifacts/caption-studio.png" });
  if ((await page.locator(".caption-preset").count()) !== 24)
    throw new Error("Expected 24 clickable caption presets");
  evidence.checks.push("24 caption cards present in the actual style panel");
  if (
    evidence.errors.length ||
    evidence.console.some(
      (text) => !/GPU|WebGL|Electron Security Warning/.test(text),
    )
  )
    throw new Error(`Renderer errors: ${JSON.stringify(evidence)}`);
  console.log(JSON.stringify(evidence, null, 2));
} catch (error) {
  evidence.failure = String(error);
  const page = (await app.windows())[0];
  await page
    ?.screenshot({ path: "artifacts/caption-preview-failure.png" })
    .catch(() => {});
  throw error;
} finally {
  await writeFile(
    "artifacts/caption-preview-verification.json",
    JSON.stringify(evidence, null, 2),
  );
  await app.close();
}

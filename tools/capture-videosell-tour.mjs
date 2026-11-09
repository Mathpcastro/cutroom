import { _electron as electron, expect } from "@playwright/test";
import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function localChrome() {
  const candidates = process.platform === "win32"
    ? [
        join(process.env.PROGRAMFILES ?? "C:\\Program Files", "Google\\Chrome\\Application\\chrome.exe"),
        join(process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)", "Microsoft\\Edge\\Application\\msedge.exe"),
        join(process.env.LOCALAPPDATA ?? "C:\\Users\\Default\\AppData\\Local", "Google\\Chrome\\Application\\chrome.exe"),
      ]
    : process.platform === "darwin"
      ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
      : ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome"];
  const executable = candidates.find((candidate) => existsSync(candidate));
  if (!executable) throw new Error(`Nenhum Chromium local encontrado: ${candidates.join(", ")}`);
  return executable;
}

async function sha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

export async function captureVideosellTour({ projectRoot = defaultRoot } = {}) {
  const artifactsDir = resolve(projectRoot, "artifacts/upsell-tour");
  const publicDir = resolve(projectRoot, "site/upsell/videos");
  const uiFramesDir = resolve(projectRoot, "artifacts/upsell-demos/ui-frames");
  const userData = resolve(artifactsDir, `user-data-${Date.now()}`);
  await Promise.all([artifactsDir, publicDir, uiFramesDir].map((dir) => mkdir(dir, { recursive: true })));
  const env = { ...process.env, CUTROOM_USER_DATA: userData };
  delete env.ELECTRON_RUN_AS_NODE;
  for (const key of Object.keys(env)) {
    if (/(?:API_KEY|TOKEN|SECRET)/i.test(key)) delete env[key];
  }
  const chrome = localChrome();
  env.CHROME_PATH = chrome;
  const packageDir = join(userData, "packages", "hyperframes-155.0.8059.79");
  const targetDir = join(packageDir, "chrome-headless-shell-win64");
  await mkdir(targetDir, { recursive: true });
  await writeFile(join(targetDir, "chrome-headless-shell.exe"), "Fixture marker; CHROME_PATH selects installed Chromium.");
  await writeFile(join(packageDir, "ready.json"), JSON.stringify({
    sha256: "c4cc49fa7908cf018600b04c95918d336565d90f9c72241fd83dacd9ec41855c",
    fixture: "local-existing-chromium-no-download",
  }));

  const evidence = {
    generatedAt: new Date().toISOString(),
    viewport: { width: 1440, height: 1000 },
    fixture: { profile: "Demonstração Videosell", handle: "demo-videosell", avatar: "Estrategista", synthetic: true },
    captures: [], pageErrors: [], consoleErrors: [], userData,
  };
  let app;
  let page;
  const capture = async (name, locator) => {
    await expect(locator).toBeVisible({ timeout: 180_000 });
    await page.evaluate(() => document.fonts.ready);
    const output = join(publicDir, `${name}.png`);
    await page.screenshot({ path: output, fullPage: true });
    await copyFile(output, join(uiFramesDir, `${name}.png`));
    evidence.captures.push({ name, file: `site/upsell/videos/${name}.png`, sha256: await sha256(output), width: 1440, height: 1000 });
  };

  try {
    const { stdout: commit } = await execFile("git", ["rev-parse", "HEAD"], { cwd: projectRoot });
    evidence.appCommit = commit.trim();
    app = await electron.launch({ args: ["."], cwd: projectRoot, env, timeout: 60_000 });
    page = await app.firstWindow();
    page.on("pageerror", (error) => evidence.pageErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") evidence.consoleErrors.push(message.text());
    });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 1000));
    await page.waitForFunction(() => Boolean(window.cutroom));

    await page.getByRole("button", { name: "Criar perfil", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Criar perfil", exact: true });
    await dialog.getByLabel("Nome do perfil", { exact: true }).fill("Demonstração Videosell");
    await dialog.getByLabel("Handle do perfil", { exact: true }).fill("demo-videosell");
    await dialog.getByRole("button", { name: "Salvar perfil", exact: true }).click();
    await expect(page.getByLabel("Perfil ativo", { exact: true })).toHaveValue("demo-videosell");

    await page.getByRole("button", { name: "Criar meu avatar", exact: true }).click();
    await capture("studio-avatar", page.getByRole("heading", { name: "Criar meu avatar", exact: true }));
    await page.getByLabel("Descrição do avatar", { exact: true }).fill("Estrategista cordial que apresenta produtos com clareza.");
    await page.getByRole("button", { name: "Criar três pontos de partida", exact: true }).click();
    await expect(page.locator(".avatar-candidate")).toHaveCount(3, { timeout: 60_000 });
    await page.getByRole("button", { name: "Selecionar Estrategista", exact: true }).click();
    await expect(page.getByAltText("Avatar renderizado pelo AvatarEngine")).toBeVisible({ timeout: 120_000 });
    await page.getByRole("button", { name: "Confirmar aprovação manual", exact: true }).click();
    await page.getByRole("button", { name: "Finalizar e salvar no perfil", exact: true }).click();
    await expect(page.getByText(/Avatar salvo no perfil/i)).toBeVisible({ timeout: 60_000 });
    await page.getByRole("button", { name: "Voltar ao início", exact: true }).click();
    await capture("studio-profiles", page.getByLabel("Contexto do perfil", { exact: true }));

    await page.getByRole("button", { name: "Criar um Reel com avatar", exact: true }).click();
    await page.getByRole("textbox", { name: "Objetivo", exact: true }).fill("Apresentar o Videosell com clareza");
    await page.getByRole("textbox", { name: "Oferta", exact: true }).fill("Criação local de vídeos verticais");
    await page.getByRole("textbox", { name: "Roteiro", exact: true }).fill("Crie seu avatar. Escolha um formato. Revise cada quadro real e exporte seu vídeo vertical.");
    await page.getByRole("combobox", { name: "Efeito visual", exact: true }).selectOption("pulse");
    await page.getByRole("button", { name: "Gerar filme e revisar", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Revisar Reel", exact: true })).toBeVisible({ timeout: 240_000 });
    await expect(page.locator(".reel-review-still").first()).toBeVisible({ timeout: 240_000 });
    await capture("studio-reel", page.locator(".reel-review"));
    evidence.fixture.filmId = await page.locator(".reel-review").getAttribute("data-film-id");

    await page.getByRole("button", { name: "Abrir no editor avançado", exact: true }).click();
    await expect(page.locator(".workspace")).toBeVisible();
    await page.getByRole("button", { name: "Fechar estúdio", exact: true }).click();
    await capture("studio-editor", page.locator(".workspace"));
    if (evidence.pageErrors.length || evidence.consoleErrors.length) {
      throw new Error(JSON.stringify({ pageErrors: evidence.pageErrors, consoleErrors: evidence.consoleErrors }));
    }
    await writeFile(join(artifactsDir, "manifest.json"), JSON.stringify(evidence, null, 2));
    return evidence;
  } catch (error) {
    evidence.failure = error instanceof Error ? error.stack : String(error);
    if (page && !page.isClosed()) await page.screenshot({ path: join(artifactsDir, "failure.png"), fullPage: true }).catch(() => {});
    await writeFile(join(artifactsDir, "manifest.json"), JSON.stringify(evidence, null, 2));
    throw error;
  } finally {
    if (app) await app.close().catch(() => {});
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await captureVideosellTour();
  console.log(JSON.stringify(result, null, 2));
}

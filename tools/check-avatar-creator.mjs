import { _electron as electron, expect } from "@playwright/test";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const evidenceDir = resolve(".kimi-temp/avatar-creator");
await mkdir(evidenceDir, { recursive: true });
const red = process.argv.includes("--red");
const label = red ? "red" : "green";
const userData = resolve(`.kimi-temp/avatar-creator/user-data-${Date.now()}`);
const env = { ...process.env, CUTROOM_USER_DATA: userData };
delete env.ELECTRON_RUN_AS_NODE;

const evidence = {
  label,
  userData,
  checks: [],
  pageErrors: [],
  consoleErrors: [],
  screenshots: [],
  hashes: {},
  analysisCalls: 0,
};
let app;
let relaunchedApp;
let page;

async function screenshot(name) {
  const path = resolve(`.kimi-temp/avatar-creator/${label}-${name}.png`);
  await page.screenshot({ path, fullPage: true });
  evidence.screenshots.push(path);
}

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

async function seedLocalMotionPackage() {
  if (process.platform !== "win32") {
    throw new Error("O fixture de pacote local deste check está implementado para Windows.");
  }
  const chrome = localChrome();
  const packageDir = join(userData, "packages", "hyperframes-155.0.8059.79");
  const targetDir = join(packageDir, "chrome-headless-shell-win64");
  await mkdir(targetDir, { recursive: true });
  // This Windows installation cannot execute copies/hardlinks of its Chrome.
  // Use the actual installed binary; never replace the production engine.
  env.CHROME_PATH = chrome;
  const targetBrowser = join(targetDir, "chrome-headless-shell.exe");
  await writeFile(targetBrowser, "Fixture marker; CHROME_PATH selects the installed browser.");
  await writeFile(
    join(packageDir, "ready.json"),
    JSON.stringify({
      sha256: "c4cc49fa7908cf018600b04c95918d336565d90f9c72241fd83dacd9ec41855c",
      fixture: "local-existing-chromium-no-download",
    }),
  );
  evidence.localBrowser = chrome;
}

function observe(target) {
  target.on("pageerror", (error) => evidence.pageErrors.push(error.message));
  target.on("console", (message) => {
    if (message.type() === "error") evidence.consoleErrors.push(message.text());
  });
}

async function createProfile() {
  await page.getByRole("button", { name: "Criar perfil", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Criar perfil", exact: true });
  await dialog.getByLabel("Nome do perfil", { exact: true }).fill("Avatar Real");
  await dialog.getByLabel("Handle do perfil", { exact: true }).fill("avatar-real");
  await dialog.getByRole("button", { name: "Salvar perfil", exact: true }).click();
  await expect(page.getByLabel("Perfil ativo", { exact: true })).toHaveValue("avatar-real");
}

async function openCreator() {
  await page.getByRole("button", { name: "Criar meu avatar", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Criar meu avatar", exact: true })).toBeVisible();
  await expect(page.getByText(/bases autorais locais/i)).toBeVisible();
  await expect(page.getByText(/não é gerada por IA/i)).toBeVisible();
}

try {
  await seedLocalMotionPackage();
  app = await electron.launch({ args: ["."], env, timeout: 60_000 });
  page = await app.firstWindow();
  observe(page);
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setSize(1440, 1000);
  });
  await page.waitForFunction(() => !!window.cutroom?.avatarCreator);
  await createProfile();
  await openCreator();
  const description = page.getByLabel("Descrição do avatar", { exact: true });
  await expect(description).toBeFocused();
  await description.fill("Engenheiro que apresenta produtos com clareza e confiança.");
  evidence.checks.push("creator uses honest local-authored-base copy and initial field focus");

  await page.evaluate(() => {
    window.__avatarAnalysisCalls = 0;
    const original = window.cutroom.avatarCreator.analyzeReference;
    window.cutroom.avatarCreator.analyzeReference = async (...args) => {
      window.__avatarAnalysisCalls += 1;
      return original(...args);
    };
  });
  await page.getByLabel("Foto de referência (opcional)", { exact: true })
    .setInputFiles(resolve("resources/branding/icon-64.png"));
  await expect(page.getByAltText("Prévia local da referência")).toBeVisible();
  await expect(page.getByText(/Nenhum modelo remoto com visão conectado/i)).toBeVisible();
  await expect(page.getByRole("button", { name: "Analisar foto remotamente", exact: true })).toBeDisabled();
  evidence.analysisCalls = await page.evaluate(() => window.__avatarAnalysisCalls);
  if (evidence.analysisCalls !== 0) throw new Error("A foto acionou análise sem consentimento/modelo.");
  evidence.checks.push("photo stays local without a vision model and never invokes analysis implicitly");

  await page.getByRole("button", { name: "Criar três pontos de partida", exact: true }).click();
  await expect(page.locator(".avatar-candidate")).toHaveCount(3, { timeout: 60_000 });
  const candidateHashes = await page.locator(".avatar-candidate").evaluateAll((items) =>
    items.map((item) => item.getAttribute("data-hash")),
  );
  if (new Set(candidateHashes).size !== 3 || candidateHashes.some((hash) => !/^[a-f0-9]{64}$/.test(hash ?? ""))) {
    throw new Error(`Candidatos sem três hashes reais distintos: ${JSON.stringify(candidateHashes)}`);
  }
  evidence.hashes.candidates = candidateHashes;
  evidence.checks.push("description produces exactly three distinct candidates through AvatarService");

  await page.getByRole("button", { name: "Selecionar Estrategista", exact: true }).click();
  const stage = page.getByAltText("Avatar renderizado pelo AvatarEngine");
  await expect(stage).toBeVisible({ timeout: 120_000 });
  await expect.poll(() => stage.evaluate((image) => image.complete && image.naturalWidth > 0)).toBe(true);
  const pixelRendering = await stage.evaluate((image) => getComputedStyle(image).imageRendering);
  if (pixelRendering !== "pixelated") throw new Error(`Renderização não pixelada: ${pixelRendering}`);
  const avatarId = await page.locator(".avatar-creator").getAttribute("data-avatar-id");
  const firstRevision = await page.evaluate(async (avatarId) => {
    const revisions = await window.cutroom.avatarCreator.listRevisions({ avatarId });
    return revisions[0];
  }, avatarId);
  const before = await page.evaluate(async ({ avatarId, revision }) =>
    window.cutroom.avatarCreator.getRevision({ avatarId, revision }), {
      avatarId,
      revision: firstRevision.revision,
    });
  evidence.hashes.initial = before.hash;
  evidence.checks.push("selection freezes identity and displays a real pixelated AvatarEngine PNG");

  await page.getByLabel("Parte", { exact: true }).selectOption("mouth");
  await page.getByLabel("Cor atual", { exact: true }).selectOption("mouth");
  await page.getByLabel("Nova cor da paleta", { exact: true }).selectOption("accent");
  await page.getByRole("button", { name: "Aplicar à parte", exact: true }).click();
  await expect.poll(async () => {
    const revisions = await page.evaluate(async (avatarId) =>
      window.cutroom.avatarCreator.listRevisions({ avatarId }), avatarId);
    return revisions.length;
  }, { timeout: 120_000 }).toBeGreaterThan(firstRevision.revision);
  const revisionsAfterEdit = await page.evaluate(async (avatarId) =>
    window.cutroom.avatarCreator.listRevisions({ avatarId }), avatarId);
  const editedRevision = revisionsAfterEdit.at(-1).revision;
  const after = await page.evaluate(async ({ avatarId, revision }) =>
    window.cutroom.avatarCreator.getRevision({ avatarId, revision }), {
      avatarId,
      revision: editedRevision,
    });
  if (after.hash === before.hash) throw new Error("A edição não produziu um novo hash.");
  if (JSON.stringify(after.package.palette) !== JSON.stringify(before.package.palette) ||
      JSON.stringify(after.package.identity) !== JSON.stringify(before.package.identity)) {
    throw new Error("A edição alterou palette/identity protegidos.");
  }
  const changedParts = after.package.parts.filter((part, index) =>
    JSON.stringify(part) !== JSON.stringify(before.package.parts[index]));
  if (changedParts.length !== 1 || changedParts[0].id !== "mouth") {
    throw new Error(`Partes não autorizadas mudaram: ${changedParts.map((part) => part.id).join(",")}`);
  }
  evidence.hashes.edited = after.hash;
  evidence.checks.push("mouth-only recolor creates a real revision/hash/render and preserves protected data");

  await page.getByRole("tab", { name: "Expressões e poses", exact: true }).click();
  for (const sheet of ["neutral", "silhouette", "grayscale", "backgrounds", "expressions", "mouths", "motion"]) {
    await page.getByRole("button", { name: sheet, exact: true }).click();
    const sheetImage = page.getByAltText(`Folha ${sheet} do AvatarEngine`);
    await expect(sheetImage).toBeVisible({ timeout: 60_000 });
    await expect.poll(() => sheetImage.evaluate((image) => image.complete && image.naturalWidth > 0)).toBe(true);
  }
  await expect(page.getByText("Rede externa durante o render: 0", { exact: true })).toBeVisible();
  evidence.checks.push("all seven real proof sheets render with zero external network requests");

  await page.getByRole("button", { name: "Confirmar aprovação manual", exact: true }).click();
  await expect(page.getByText(/Aprovado pelo usuário em /i)).toBeVisible();
  const approvedCandidate = await page.evaluate(async ({ avatarId, candidateId }) =>
    window.cutroom.avatarCreator.getCandidate({ avatarId, candidateId }), {
      avatarId,
      candidateId: after.candidate.candidateId,
    });
  if (approvedCandidate.review.total !== 0 || !approvedCandidate.approvedByUserAt) {
    throw new Error(`Score/timestamp de aprovação incorretos: ${JSON.stringify(approvedCandidate)}`);
  }
  evidence.approvedByUserAt = approvedCandidate.approvedByUserAt;
  evidence.checks.push("manual approval uses real manifest evidence, zero-as-unscored rubric and separate timestamp");

  await screenshot("editor-1440x1000");
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setSize(1050, 700);
  });
  await expect.poll(() => page.evaluate(() => innerWidth)).toBeLessThanOrEqual(1050);
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) {
    throw new Error("AvatarCreator tem overflow horizontal em 1050×700.");
  }
  await screenshot("editor-1050x700");
  await page.emulateMedia({ reducedMotion: "reduce" });
  evidence.checks.push("desktop screenshots at 1440×1000 and 1050×700 without page overflow");

  await page.getByRole("button", { name: "Finalizar e salvar no perfil", exact: true }).click();
  await expect(page.getByText(/Avatar salvo no perfil/i)).toBeVisible({ timeout: 60_000 });
  const savedProfile = await page.evaluate(() => window.cutroom.studioProfiles.get("avatar-real"));
  if (savedProfile.defaultAvatar.avatarId !== avatarId ||
      savedProfile.defaultAvatar.revision !== editedRevision ||
      savedProfile.defaultAvatar.hash !== after.hash) {
    throw new Error(`defaultAvatar divergente: ${JSON.stringify(savedProfile.defaultAvatar)}`);
  }
  evidence.defaultAvatar = savedProfile.defaultAvatar;
  evidence.checks.push("final save persists exact avatarId/revision/hash in the active profile");

  await app.close();
  app = undefined;
  relaunchedApp = await electron.launch({ args: ["."], env, timeout: 60_000 });
  page = await relaunchedApp.firstWindow();
  observe(page);
  await page.waitForFunction(() => !!window.cutroom?.avatarCreator);
  await page.getByRole("button", { name: "Meus avatares", exact: true }).click();
  await expect(page.locator(".avatar-creator")).toHaveAttribute("data-avatar-id", avatarId);
  const reopened = page.getByAltText("Avatar renderizado pelo AvatarEngine");
  await expect(reopened).toBeVisible({ timeout: 120_000 });
  await expect(page.getByLabel("Revisão salva", { exact: true })).toHaveValue(String(editedRevision));
  evidence.checks.push("Meus avatares reopens the persisted default revision and its real render after relaunch");

  if (evidence.pageErrors.length || evidence.consoleErrors.length) {
    throw new Error(JSON.stringify({ pageErrors: evidence.pageErrors, consoleErrors: evidence.consoleErrors }));
  }
  evidence.checks.push("zero renderer page errors and console errors");
  console.log(JSON.stringify(evidence, null, 2));
} catch (error) {
  evidence.failure = String(error);
  if (page && !page.isClosed()) {
    await page.screenshot({ path: resolve(`.kimi-temp/avatar-creator/${label}-failure.png`) }).catch(() => {});
  }
  throw error;
} finally {
  await writeFile(
    resolve(`.kimi-temp/avatar-creator/${label}-verification.json`),
    JSON.stringify(evidence, null, 2),
  );
  if (app) await app.close().catch(() => {});
  if (relaunchedApp) await relaunchedApp.close().catch(() => {});
}

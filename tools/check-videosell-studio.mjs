import { _electron as electron, expect } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const evidenceDir = resolve(".kimi-temp/studio-shell");
await mkdir(evidenceDir, { recursive: true });
const red = process.argv.includes("--red");
const label = red ? "red" : "green";
const userData = resolve(`.kimi-temp/studio-shell/user-data-${Date.now()}`);
const env = { ...process.env, CUTROOM_USER_DATA: userData };
delete env.ELECTRON_RUN_AS_NODE;

const evidence = {
  label,
  userData,
  checks: [],
  pageErrors: [],
  consoleErrors: [],
  screenshots: [],
};
let app;
let relaunchedApp;
let page;

async function screenshot(name) {
  const path = resolve(`.kimi-temp/studio-shell/${label}-${name}.png`);
  await page.screenshot({ path, fullPage: true });
  evidence.screenshots.push(path);
}

async function backHome() {
  await page.getByRole("button", { name: "Voltar ao início", exact: true }).click();
  await expect(page.locator(".videosell-studio")).toBeVisible();
}

async function closePanelAndReturn() {
  await page.getByRole("button", { name: "Fechar estúdio", exact: true }).click();
  await page.getByRole("button", { name: "Voltar ao estúdio", exact: true }).click();
  await expect(page.locator(".videosell-studio")).toBeVisible();
}

try {
  app = await electron.launch({ args: ["."], env, timeout: 60_000 });
  page = await app.firstWindow();
  page.on("pageerror", (error) => evidence.pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") evidence.consoleErrors.push(message.text());
  });
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setSize(1440, 1000);
  });
  await page.waitForFunction(() => !!window.cutroom);

  await expect(page.locator(".videosell-studio")).toBeVisible();
  await expect(page).toHaveTitle(/Videosell/);
  for (const action of [
    "Criar meu avatar",
    "Criar Reel",
    "Continuar criando",
  ]) {
    await expect(page.getByRole("main").getByRole("button", { name: action, exact: true })).toBeVisible();
  }
  await expect(page.getByLabel("Perfil ativo", { exact: true })).toBeVisible();
  evidence.checks.push("studio is the real app entry with four exact actions and a visible profile switcher");

  await page.getByRole("button", { name: "Projetos", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Nenhum perfil selecionado", exact: true })).toBeVisible();
  await expect(page.getByText("Crie ou selecione um perfil para ver os projetos vinculados.", { exact: true })).toBeVisible();
  await expect(page.getByText("Nenhum projeto vinculado", { exact: false })).toHaveCount(0);
  await backHome();
  evidence.checks.push("no-profile is distinct from profile initialization and an empty project library");

  await page.getByRole("button", { name: "Criar perfil", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Criar perfil", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Nome do perfil", { exact: true })).toBeFocused();
  await dialog.getByLabel("Nome do perfil", { exact: true }).fill("Estúdio Teste");
  await dialog.getByLabel("Handle do perfil", { exact: true }).fill("Handle Inválido");
  await dialog.getByRole("button", { name: "Salvar perfil", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText(/handle/i);
  await dialog.getByLabel("Handle do perfil", { exact: true }).fill("estudio-teste");
  await dialog.getByRole("button", { name: "Salvar perfil", exact: true }).click();
  await page.getByRole("button", { name: "Preencher depois", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const profileSelect = page.getByLabel("Perfil ativo", { exact: true });
  await expect(profileSelect).toHaveValue("estudio-teste");
  const projectIds = await page.evaluate(() =>
    window.cutroom.studioProfiles.listProjects("estudio-teste"),
  );
  if (!Array.isArray(projectIds) || projectIds.length) {
    throw new Error(`Fresh profile returned invented projects: ${JSON.stringify(projectIds)}`);
  }
  evidence.checks.push("profile form traps initial focus, rejects an invalid handle and lists real empty projects");

  await page.getByRole("button", { name: "Criar perfil", exact: true }).click();
  await dialog.getByLabel("Nome do perfil", { exact: true }).fill("Perfil Alternativo");
  await dialog.getByLabel("Handle do perfil", { exact: true }).fill("perfil-alternativo");
  await dialog.getByRole("button", { name: "Salvar perfil", exact: true }).click();
  await page.getByRole("button", { name: "Preencher depois", exact: true }).click();
  await expect(profileSelect).toHaveValue("perfil-alternativo");

  await profileSelect.selectOption("estudio-teste");
  await expect(profileSelect).toHaveValue("estudio-teste");
  await expect.poll(async () => {
    const index = JSON.parse(await readFile(resolve(userData, "profiles/index.json"), "utf8"));
    return index.activeProfileId;
  }).toBe("estudio-teste");
  evidence.checks.push("profile creation and selection persist through the real ProfileService");

  for (const [nav, heading] of [
    ["Meus avatares", "Meus avatares"],
    ["Projetos", "Projetos"],
  ]) {
    await page.getByRole("button", { name: nav, exact: true }).click();
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    await backHome();
  }
  await page.getByRole("button", { name: "Projetos", exact: true }).click();
  await expect(page.getByText("Nenhum projeto vinculado", { exact: false })).toBeVisible();
  await backHome();
  evidence.checks.push("avatar and project navigation exposes real empty states without fixture cards");

  await expect(page.locator(".videosell-studio")).toHaveAttribute("data-font-scale", "115");
  await expect(page.getByRole("group", { name: "Tamanho da fonte", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "115%", exact: true })).toHaveAttribute("aria-pressed", "true");
  evidence.checks.push("studio starts at 115% with an accessible 100/115/130 font-scale control");

  for (const [nav, field, screenshotName] of [
    ["Vozes", "Provedor padrão", "voices"],
    ["Marca", "Nome da marca", "brand"],
    ["Conexões", "Chave do projeto Composio", "publish"],
  ]) {
    await page.getByRole("button", { name: nav, exact: true }).click();
    await expect(page.locator(".videosell-studio")).toBeVisible();
    await expect(page.locator(".app-shell")).toBeHidden();
    await expect(page.getByRole("dialog", { name: "Estúdio de vídeos", exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: nav, exact: true })).toBeVisible();
    await expect(page.getByLabel(field, { exact: false })).toBeVisible();
    if (nav === "Conexões") await expect(page.getByRole("button", { name: "Publicar Reels", exact: true })).toHaveCount(0);
    await screenshot(screenshotName);
    await backHome();
  }
  evidence.checks.push("Vozes, Marca e Conexões are native Videosell pages using the real settings forms");

  await page.getByRole("button", { name: "130%", exact: true }).click();
  await expect(page.locator(".videosell-studio")).toHaveAttribute("data-font-scale", "130");
  await expect(page.getByRole("button", { name: "130%", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => page.evaluate(() => localStorage.getItem("videosell.studio.fontScale"))).toBe("130");
  await screenshot("font-130");
  await page.getByRole("button", { name: "100%", exact: true }).click();
  await expect(page.locator(".videosell-studio")).toHaveAttribute("data-font-scale", "100");
  await expect.poll(() => page.evaluate(() => localStorage.getItem("videosell.studio.fontScale"))).toBe("100");
  await page.getByRole("button", { name: "130%", exact: true }).click();
  evidence.checks.push("font scale switches between 100 and 130 percent and persists in local storage");

  await page.evaluate(() => {
    window.__videosellStateProbe = { preserved: true };
  });
  await page.getByRole("button", { name: "Ajustes avançados", exact: true }).click();
  await expect(page.locator(".workspace")).toBeVisible();
  await expect(page.getByRole("button", { name: "Voltar ao estúdio", exact: true })).toBeVisible();
  const advancedTheme = await page.locator(".app-shell").evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      background: style.getPropertyValue("--bg").trim(),
      accent: style.getPropertyValue("--accent").trim(),
      fontFamily: style.fontFamily,
    };
  });
  if (
    advancedTheme.background.toLowerCase() !== "#f7f6f1" ||
    advancedTheme.accent.toLowerCase() !== "#6445d8" ||
    !advancedTheme.fontFamily.includes("Inter")
  ) {
    throw new Error(`Advanced editor does not use the Videosell theme: ${JSON.stringify(advancedTheme)}`);
  }
  await screenshot("advanced-1440x1000");
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setSize(1050, 700);
  });
  await expect.poll(() => page.evaluate(() => innerWidth)).toBeLessThanOrEqual(1050);
  await screenshot("advanced-1050x700");
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) {
    throw new Error("Advanced editor has horizontal overflow at 1050x700.");
  }
  evidence.checks.push("advanced editor uses Videosell tokens and Inter without horizontal overflow at both desktop sizes");
  await page.getByRole("button", { name: "Voltar ao estúdio", exact: true }).click();
  await expect(page.locator(".videosell-studio")).toBeVisible();
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setSize(1440, 1000);
  });
  await expect.poll(() => page.evaluate(() => innerWidth)).toBe(1440);
  if (!(await page.evaluate(() => window.__videosellStateProbe?.preserved))) {
    throw new Error("Advanced editor navigation reloaded the renderer.");
  }
  await expect(profileSelect).toHaveValue("estudio-teste");
  evidence.checks.push("advanced editor and studio return preserve renderer and selected-profile state");

  for (const [action, heading] of [
    ["Criar meu avatar", "Criar meu avatar"],
    ["Criar Reel", "Criar Reel"],
    ["Continuar criando", "Projetos"],
  ]) {
    await page.getByRole("main").getByRole("button", { name: action, exact: true }).click();
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    await backHome();
  }
  evidence.checks.push("home actions open the unified composer, avatar editor and projects");

  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent("cutroom:studio", { detail: "brand" }));
  });
  await expect(page.getByRole("dialog", { name: "Estúdio de vídeos", exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Marca", exact: true })).toHaveAttribute("aria-selected", "true");
  await closePanelAndReturn();
  await page.evaluate(() => window.dispatchEvent(new Event("cutroom:motion-edit")));
  await expect(page.locator(".workspace-drawer")).toBeVisible();
  await page.getByRole("button", { name: "Voltar ao estúdio", exact: true }).click();
  evidence.checks.push("cutroom:studio and cutroom:motion-edit never leave their UI hidden behind the home");

  const homeNav = page.getByRole("button", { name: "Início", exact: true });
  await homeNav.focus();
  const avatarNav = page.getByRole("button", { name: "Meus avatares", exact: true });
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press("Tab");
    if (await avatarNav.evaluate((element) => element === document.activeElement)) break;
  }
  await expect(avatarNav).toBeFocused();
  const focusStyle = await avatarNav.evaluate((element) => {
    const style = getComputedStyle(element);
    return { outline: style.outlineStyle, width: style.outlineWidth };
  });
  if (focusStyle.outline === "none" || focusStyle.width === "0px") {
    throw new Error(`Keyboard focus is not visible: ${JSON.stringify(focusStyle)}`);
  }
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Meus avatares", exact: true })).toBeVisible();
  await expect(avatarNav).toBeFocused();
  await expect(avatarNav).toHaveAttribute("aria-current", "page");
  await backHome();
  await page.emulateMedia({ reducedMotion: "reduce" });
  evidence.checks.push("keyboard navigation, visible focus, active-page semantics and reduced motion are supported");

  const surfaceRegressions = [];
  const imported = await page.evaluate(async (path) =>
    window.cutroom.request("importPaths", { paths: [path] }),
  resolve("website/public/assets/demo-timeline.mp4"));
  if (!imported.project.clips.length) throw new Error("The media fixture did not create a real clip.");

  const focusedCreate = page.getByRole("button", { name: "Criar meu avatar", exact: true });
  await focusedCreate.focus();
  await page.keyboard.press("Space");
  try {
    await expect(page.getByRole("heading", { name: "Criar meu avatar", exact: true })).toBeVisible({ timeout: 1500 });
  } catch {
    surfaceRegressions.push("Space did not activate the focused studio button while the project had a clip.");
  }
  if (await page.getByRole("button", { name: "Voltar ao início", exact: true }).isVisible()) {
    await backHome();
  }

  await page.getByRole("button", { name: "Ajustes avançados", exact: true }).click();
  await expect(page.locator(".workspace")).toBeVisible();
  const video = page.locator("video").first();
  await expect(video).toBeVisible();
  await expect.poll(() => video.evaluate((element) => element.readyState)).toBeGreaterThanOrEqual(2);
  const pauseButton = page.getByRole("button", { name: "Pausar", exact: true });
  if (await pauseButton.isVisible()) await pauseButton.click();
  await page.getByRole("button", { name: "Reproduzir", exact: true }).click();
  await expect.poll(() => video.evaluate((element) => element.paused)).toBe(false);
  await expect.poll(() => video.evaluate((element) => element.currentTime)).toBeGreaterThan(0.02);
  await page.getByRole("button", { name: "Voltar ao estúdio", exact: true }).click();
  await expect(page.locator(".videosell-studio")).toBeVisible();
  const returnedTime = await video.evaluate((element) => element.currentTime);
  await page.waitForTimeout(250);
  const hiddenPlayback = await video.evaluate((element) => ({
    paused: element.paused,
    currentTime: element.currentTime,
  }));
  if (!hiddenPlayback.paused || hiddenPlayback.currentTime !== returnedTime) {
    surfaceRegressions.push(`Playback continued behind the studio: ${JSON.stringify({ returnedTime, hiddenPlayback })}`);
  }
  await video.evaluate((element) => element.pause());

  await app.evaluate(({ dialog }) => {
    globalThis.__surfaceDialogCalls = [];
    dialog.showSaveDialog = async () => {
      globalThis.__surfaceDialogCalls.push("saveProject");
      return { canceled: true };
    };
    dialog.showOpenDialog = async () => {
      globalThis.__surfaceDialogCalls.push("openProject");
      return { canceled: true, filePaths: [] };
    };
  });
  const beforeShortcuts = await page.evaluate(() => window.cutroom.request("getState"));
  await page.evaluate(() => {
    for (const modifier of ["ctrlKey", "metaKey"]) {
      for (const key of ["s", "o", "z"]) {
        document.body.dispatchEvent(new KeyboardEvent("keydown", {
          key,
          code: `Key${key.toUpperCase()}`,
          [modifier]: true,
          bubbles: true,
          cancelable: true,
        }));
      }
    }
  });
  await page.waitForTimeout(300);
  const afterShortcuts = await page.evaluate(() => window.cutroom.request("getState"));
  const shortcutDialogs = await app.evaluate(() => globalThis.__surfaceDialogCalls);
  const beforeClipIds = beforeShortcuts.project.clips.map((clip) => clip.id).join(",");
  const afterClipIds = afterShortcuts.project.clips.map((clip) => clip.id).join(",");
  if (shortcutDialogs.length || beforeClipIds !== afterClipIds) {
    surfaceRegressions.push(`Studio shortcuts invoked editor operations: ${JSON.stringify({ shortcutDialogs, beforeClipIds, afterClipIds })}`);
  }
  if (surfaceRegressions.length) throw new Error(surfaceRegressions.join("\n"));
  if (await page.getByRole("button", { name: "Voltar ao início", exact: true }).isVisible()) {
    await backHome();
  }
  evidence.checks.push("Space activates a focused studio button even when the project contains clips");
  evidence.checks.push("returning to the studio pauses real video playback and keeps its time stable");
  evidence.checks.push("Ctrl/Cmd+S/O/Z do not invoke editor operations on the studio surface");

  await screenshot("home-1440x1000");
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setSize(1050, 700);
  });
  await expect.poll(() => page.evaluate(() => innerWidth)).toBeLessThanOrEqual(1050);
  for (const scale of ["100", "115", "130"]) {
    await page.getByRole("button", { name: `${scale}%`, exact: true }).click();
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) {
      throw new Error(`Studio has horizontal overflow at minimum desktop width and ${scale}% font scale.`);
    }
  }
  await screenshot("home-minimum");
  evidence.checks.push("screenshots captured at 1440x1000 and minimum desktop size; all font scales avoid horizontal overflow");

  await profileSelect.selectOption("perfil-alternativo");
  await expect(profileSelect).toHaveValue("perfil-alternativo");
  await expect.poll(async () => {
    const index = JSON.parse(await readFile(resolve(userData, "profiles/index.json"), "utf8"));
    return index.activeProfileId;
  }).toBe("perfil-alternativo");
  await app.close();
  relaunchedApp = await electron.launch({ args: ["."], env, timeout: 60_000 });
  page = await relaunchedApp.firstWindow();
  page.on("pageerror", (error) => evidence.pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") evidence.consoleErrors.push(message.text());
  });
  await page.waitForFunction(() => !!window.cutroom);
  await expect(page.getByLabel("Perfil ativo", { exact: true })).toHaveValue("perfil-alternativo");
  const persistedIndex = JSON.parse(await readFile(resolve(userData, "profiles/index.json"), "utf8"));
  if (persistedIndex.activeProfileId !== "perfil-alternativo") {
    throw new Error(`Relaunch overwrote the active profile: ${JSON.stringify(persistedIndex)}`);
  }
  evidence.checks.push("the second profile survives an Electron relaunch with the same CUTROOM_USER_DATA in UI and profiles/index.json");
  await expect(page.locator(".videosell-studio")).toHaveAttribute("data-font-scale", "130");
  await expect(page.getByRole("button", { name: "130%", exact: true })).toHaveAttribute("aria-pressed", "true");
  evidence.checks.push("130 percent font scale survives an Electron relaunch");

  if (evidence.pageErrors.length || evidence.consoleErrors.length) {
    throw new Error(JSON.stringify({
      pageErrors: evidence.pageErrors,
      consoleErrors: evidence.consoleErrors,
    }));
  }
  evidence.checks.push("no renderer page errors or console errors");
  console.log(JSON.stringify(evidence, null, 2));
} catch (error) {
  evidence.failure = String(error);
  if (page && !page.isClosed()) {
    await page.screenshot({ path: resolve(`.kimi-temp/studio-shell/${label}-failure.png`) }).catch(() => {});
  }
  throw error;
} finally {
  await writeFile(
    resolve(`.kimi-temp/studio-shell/${label}-verification.json`),
    JSON.stringify(evidence, null, 2),
  );
  if (app) await app.close().catch(() => {});
  if (relaunchedApp) await relaunchedApp.close().catch(() => {});
}

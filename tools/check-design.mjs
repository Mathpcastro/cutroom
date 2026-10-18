import { _electron as electron, expect } from "@playwright/test";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import {
  workspacePanel,
  conversationPanel,
  expandGroup,
} from "./ui-navigation.mjs";

await mkdir("artifacts", { recursive: true });
const profile = resolve(`artifacts/design-profile-${Date.now()}`);
const env = { ...process.env, CUTROOM_USER_DATA: profile };
delete env.ELECTRON_RUN_AS_NODE;
const launch = () =>
  electron.launch(
    process.argv.includes("--packaged")
      ? {
          executablePath: resolve("release/win-unpacked/CutRoom.exe"),
          env,
          timeout: 60000,
        }
      : { args: ["."], env, timeout: 60000 },
  );
const evidence = {
  checks: [],
  errors: [],
  consoleErrors: [],
  themes: [],
  profile,
};
let app = await launch();
let page;
const themeOptions = [
  ["graphite", "Grafite", "dark"],
  ["light", "Claro", "light"],
  ["dark-plus", "Dark+", "dark"],
  ["light-plus", "Light+", "light"],
  ["nord", "Nord", "dark"],
  ["tokyo-night", "Tokyo Night", "dark"],
];
try {
  page = await app.firstWindow();
  page.on("pageerror", (error) => evidence.errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") evidence.consoleErrors.push(message.text());
  });
  await page.waitForFunction(() => !!window.cutroom);
  await page.getByLabel("Assistente de edição", { exact: true }).waitFor();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "graphite");
  await page.screenshot({ path: "artifacts/design-empty-graphite.png" });
  await page
    .getByRole("button", { name: "Configurações", exact: true })
    .click();
  await page.getByRole("menuitemradio", { name: "Claro", exact: true }).click();
  await page.screenshot({ path: "artifacts/design-empty-light.png" });
  await page
    .getByRole("button", { name: "Configurações", exact: true })
    .click();
  await page
    .getByRole("menuitemradio", { name: "Grafite", exact: true })
    .click();
  const request = (method, params) =>
    page.evaluate(([m, p]) => window.cutroom.request(m, p), [method, params]);
  await request("dismissOnboarding");
  const projectPath = resolve("artifacts/desktop-saved.cutroom.json");
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [path],
    });
  }, projectPath);
  await request("openProject");
  await page.waitForFunction(
    () => document.querySelector("video")?.readyState >= 2,
  );
  await page.getByRole("slider", { name: "Posição no projeto" }).fill("1.5");
  await page.waitForTimeout(250);
  await expect(page.locator(".workspace-drawer")).toHaveCount(0);
  const beforeProject = (await request("getState")).project;
  const buttons = await page.locator("button:visible").evaluateAll((items) =>
    items.map((item) => ({
      text: item.textContent.trim(),
      label: item.getAttribute("aria-label"),
    })),
  );
  evidence.visibleButtons = buttons.length;
  evidence.buttonScope =
    "loaded project, default panels, onboarding dismissed, no open menus";
  try {
    evidence.previousVisibleButtons = JSON.parse(
      await readFile("artifacts/design-before.json", "utf8"),
    ).count;
  } catch {}
  if (buttons.length > 24)
    throw new Error(
      `Default screen still has ${buttons.length} visible buttons; expected material consolidation.`,
    );
  evidence.checks.push(
    "default two-column workspace opens auxiliary panels only on demand and has <=24 visible buttons",
  );

  for (const [id, name, mode] of themeOptions) {
    await page
      .getByRole("button", { name: "Configurações", exact: true })
      .click();
    const choice = page.getByRole("menuitemradio", { name, exact: true });
    await choice.focus();
    await choice.press("Enter");
    await expect(page.locator("html")).toHaveAttribute("data-theme", id);
    await expect(
      page.getByRole("menu", { name: "Configurações", exact: true }),
    ).toHaveCount(0);
    await expect
      .poll(() => app.evaluate(({ nativeTheme }) => nativeTheme.themeSource))
      .toBe(mode);
    const details = await page.evaluate(() => ({
      theme: document.documentElement.dataset.theme,
      scheme: getComputedStyle(document.documentElement).colorScheme,
      background: getComputedStyle(document.body).backgroundColor,
      text: getComputedStyle(document.body).color,
      overflow: document.documentElement.scrollWidth > innerWidth,
      stored: localStorage.getItem("cutroom.appearance.theme"),
    }));
    if (details.overflow || details.scheme !== mode || details.stored !== id)
      throw new Error(`Theme not applied: ${JSON.stringify(details)}`);
    evidence.themes.push(details);
    await page.screenshot({ path: `artifacts/design-loaded-${id}.png` });
  }
  const afterProject = (await request("getState")).project;
  if (JSON.stringify(afterProject) !== JSON.stringify(beforeProject))
    throw new Error("Changing app theme modified project/video settings.");
  evidence.checks.push(
    "six real menu-selected themes update CSS/native window theme and preserve project/video settings",
  );

  await page.getByRole("button", { name: "Ferramentas", exact: true }).focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("End");
  await page.keyboard.press("Home");
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Ferramentas", exact: true }),
  ).toBeFocused();
  await workspacePanel(page, "media");
  await expect(
    page.getByLabel("Mídia do projeto", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Recolher painel", exact: true })
    .click();
  await workspacePanel(page, "transcript");
  await expect(page.getByLabel("Transcrição", { exact: true })).toBeVisible();
  await workspacePanel(page, "style");
  await expandGroup(page, "Legendas");
  await page.locator(".caption-studio").scrollIntoViewIfNeeded();
  if ((await page.locator(".caption-preset").count()) !== 24)
    throw new Error("Caption options lost during menu consolidation.");
  await page.screenshot({ path: "artifacts/design-caption-panel.png" });
  await page
    .getByRole("button", { name: "Recolher painel", exact: true })
    .click();
  await conversationPanel(page, "packages");
  await expect(
    page.getByText("O download acontece aqui;", { exact: false }),
  ).toBeVisible();
  await conversationPanel(page, "chat");
  evidence.checks.push(
    "keyboard menus restore focus; media, transcript,24captions and local package onboarding remain reachable",
  );

  await page.getByRole("slider", { name: "Posição no projeto" }).fill("1.5");
  const priorClips = (await request("getState")).project.clips.length;
  await page.getByRole("button", { name: "Editar", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "Dividir na posição atual", exact: true })
    .click();
  await expect
    .poll(async () => (await request("getState")).project.clips.length)
    .toBe(priorClips + 1);
  await page.getByRole("button", { name: "Editar", exact: true }).click();
  await page.getByRole("menuitem", { name: /^Desfazer/ }).click();
  await expect
    .poll(async () => (await request("getState")).project.clips.length)
    .toBe(priorClips);
  evidence.checks.push(
    "consolidated Editar menu really splits video and undo restores the timeline",
  );

  for (const [id, name] of [
    ["graphite", "Grafite"],
    ["light", "Claro"],
  ]) {
    await page
      .getByRole("button", { name: "Configurações", exact: true })
      .click();
    await page.getByRole("menuitemradio", { name, exact: true }).click();
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(1050, 700),
    );
    await expect
      .poll(() => page.evaluate(() => innerWidth))
      .toBeLessThanOrEqual(1050);
    if (
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      )
    )
      throw new Error("Horizontal overflow at minimum desktop size.");
    await page
      .getByRole("button", { name: "Configurações", exact: true })
      .click();
    const bounds = await page
      .getByRole("menu", { name: "Configurações", exact: true })
      .boundingBox();
    const viewport = await page.evaluate(() => ({
      w: innerWidth,
      h: innerHeight,
    }));
    if (
      !bounds ||
      bounds.x < 0 ||
      bounds.x + bounds.width > viewport.w + 1 ||
      bounds.y + bounds.height > viewport.h + 1
    )
      throw new Error("Theme menu clipped at minimum window size.");
    await page.keyboard.press("Escape");
    await page.screenshot({ path: `artifacts/design-min-${id}.png` });
  }
  evidence.checks.push(
    "dark/light layouts and theme menus fit minimum1050x700 desktop window",
  );
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1480, 940),
  );
  await page
    .getByRole("button", { name: "Configurações", exact: true })
    .click();
  await page.getByRole("menuitemradio", { name: "Nord", exact: true }).click();
  await expect
    .poll(
      async () =>
        JSON.parse(await readFile(resolve(profile, "appearance.json"), "utf8"))
          .mode,
    )
    .toBe("dark");
  const expectedNative = JSON.parse(
    await readFile(resolve(profile, "appearance.json"), "utf8"),
  );
  await app.close();
  app = await launch();
  page = await app.firstWindow();
  page.on("pageerror", (error) => evidence.errors.push(error.message));
  await page.waitForFunction(() => !!window.cutroom);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "nord");
  const native = await app.evaluate(({ nativeTheme, BrowserWindow }) => ({
    source: nativeTheme.themeSource,
    background: BrowserWindow.getAllWindows()[0].getBackgroundColor(),
  }));
  if (
    native.source !== "dark" ||
    !native.background
      .toLowerCase()
      .endsWith(expectedNative.background.slice(1).toLowerCase())
  )
    throw new Error(`Native theme not persisted: ${JSON.stringify(native)}`);
  evidence.checks.push(
    "chosen Nord theme persists across actual Electron relaunch including native frame appearance",
  );
  if (evidence.errors.length || evidence.consoleErrors.length)
    throw new Error(
      JSON.stringify({
        errors: evidence.errors,
        console: evidence.consoleErrors,
      }),
    );
  console.log(JSON.stringify(evidence, null, 2));
} catch (error) {
  evidence.failure = String(error);
  await page
    ?.screenshot({ path: "artifacts/design-failure.png" })
    .catch(() => {});
  throw error;
} finally {
  await writeFile(
    "artifacts/design-verification.json",
    JSON.stringify(evidence, null, 2),
  );
  await app.close();
}

import { _electron as electron, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

await mkdir("artifacts", { recursive: true });
const profile = resolve(`artifacts/pickers-profile-${Date.now()}`);
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
const report = { checks: [], errors: [], models: [], profile };
let page;
try {
  page = await app.firstWindow();
  page.on("pageerror", (error) => report.errors.push(error.message));
  await page.waitForFunction(() => !!window.cutroom);
  const request = (method, params) =>
    page.evaluate(([m, p]) => window.cutroom.request(m, p), [method, params]);
  await request("dismissOnboarding");
  const connected = await request("connectCodex", {});
  if (!connected.connection.models.length)
    throw new Error("No actual Codex models available.");
  const messagesBefore = connected.messages.length;
  const modelTrigger = page.getByRole("button", {
    name: "Modelo",
    exact: true,
  });
  const effortTrigger = page.getByRole("button", {
    name: "Raciocínio",
    exact: true,
  });
  const modelList = () =>
    page.getByRole("listbox", { name: "Modelo", exact: true });
  const effortDialog = () =>
    page.getByRole("dialog", { name: "Raciocínio", exact: true });
  const slider = () =>
    page.getByRole("slider", { name: "Nível de raciocínio", exact: true });
  const chooseModel = async (index) => {
    await modelTrigger.click();
    await expect(modelList().getByRole("option")).toHaveCount(
      connected.connection.models.length,
    );
    await modelList().getByRole("option").nth(index).click();
    await expect(modelList()).toHaveCount(0);
  };
  const effortLabels = {
    none: "Sem",
    minimal: "Mínimo",
    low: "Baixo",
    medium: "Médio",
    high: "Alto",
    xhigh: "Muito alto",
    max: "Máximo",
  };
  for (let index = 0; index < connected.connection.models.length; index++) {
    const model = connected.connection.models[index];
    await chooseModel(index);
    if (!model.reasoningEfforts?.length) continue;
    await effortTrigger.click();
    await expect(effortDialog()).toBeVisible();
    const range = slider();
    if (
      Number(await range.getAttribute("max")) + 1 !==
      model.reasoningEfforts.length
    )
      throw new Error(`Unsupported slider stops for ${model.id}`);
    await range.press("End");
    await expect(range).toHaveValue(String(model.reasoningEfforts.length - 1));
    await expect(range).toHaveAttribute(
      "aria-valuetext",
      effortLabels[model.reasoningEfforts.at(-1)],
    );
    await range.press("Home");
    await expect(range).toHaveValue("0");
    await range.press("ArrowRight");
    await expect(range).toHaveValue(
      String(Math.min(1, model.reasoningEfforts.length - 1)),
    );
    const reset = effortDialog().getByRole("button", { name: /Restaurar/ });
    if (await reset.isEnabled()) await reset.click();
    const defaultIndex = Math.max(
      0,
      model.reasoningEfforts.indexOf(model.defaultReasoningEffort),
    );
    await expect(range).toHaveValue(String(defaultIndex));
    await range.press("Enter");
    await expect(effortDialog()).toHaveCount(0);
    await expect(effortTrigger).toBeFocused();
    report.models.push({
      id: model.id,
      stops: model.reasoningEfforts.length,
      defaultIndex,
    });
  }
  report.checks.push(
    "every real Codex model maps only its supported efforts to slider stops; arrows/Home/End/default reset work",
  );
  await chooseModel(0);
  await effortTrigger.click();
  await modelTrigger.click();
  await expect(effortDialog()).toHaveCount(0);
  await expect(modelList()).toBeVisible();
  await modelList().press("Escape");
  await expect(modelTrigger).toBeFocused();
  await effortTrigger.click();
  await page.locator(".player-meta").click({ position: { x: 10, y: 10 } });
  await expect(effortDialog()).toHaveCount(0);
  if ((await request("getState")).messages.length !== messagesBefore)
    throw new Error("Picker interaction accidentally submitted the composer.");
  report.checks.push(
    "popovers are mutually exclusive, dismiss outside/Escape, restore focus and never submit the chat",
  );

  for (const [id, name] of [
    ["graphite", "Grafite"],
    ["light", "Claro"],
    ["nord", "Nord"],
  ]) {
    await page
      .getByRole("button", { name: "Configurações", exact: true })
      .click();
    await page.getByRole("menuitemradio", { name, exact: true }).click();
    const bounds = await modelTrigger.boundingBox();
    const effortBounds = await effortTrigger.boundingBox();
    if (
      !bounds ||
      !effortBounds ||
      bounds.height > 32 ||
      effortBounds.height > 32
    )
      throw new Error("Selectors still use oversized boxed fields.");
    await page
      .locator(".composer-controls")
      .screenshot({ path: `artifacts/pickers-${id}-closed.png` });
    await modelTrigger.click();
    if (
      (await modelList().getByRole("textbox").count()) ||
      (await page.getByRole("combobox", { name: "Buscar modelo" }).count())
    )
      throw new Error("Large search field remains visible.");
    const option = modelList().getByRole("option").first();
    const row = await option.boundingBox();
    if (!row || row.height > 34 || (await option.locator("small").count()))
      throw new Error("Model rows still show tall duplicate-ID cards.");
    await page.screenshot({ path: `artifacts/pickers-${id}-model.png` });
    await page
      .locator(".choice-popover")
      .screenshot({ path: `artifacts/pickers-${id}-model-detail.png` });
    await modelList().press("Escape");
    await effortTrigger.click();
    await slider().fill(
      String(
        Math.floor(
          (connected.connection.models[0].reasoningEfforts.length - 1) / 2,
        ),
      ),
    );
    await page.screenshot({ path: `artifacts/pickers-${id}-effort.png` });
    const popupBounds = await effortDialog().boundingBox();
    const controlsBounds = await page
      .locator(".composer-controls")
      .boundingBox();
    const x = Math.max(0, Math.min(popupBounds.x, controlsBounds.x) - 8);
    const y = Math.max(0, popupBounds.y - 8);
    await page.screenshot({
      path: `artifacts/pickers-${id}-effort-detail.png`,
      clip: {
        x,
        y,
        width:
          Math.max(
            popupBounds.x + popupBounds.width,
            controlsBounds.x + controlsBounds.width,
          ) -
          x +
          8,
        height: controlsBounds.y + controlsBounds.height - y + 8,
      },
    });
    await slider().press("Escape");
    await expect(page.locator("html")).toHaveAttribute("data-theme", id);
  }
  report.checks.push(
    "compact pills, single-line model rows without duplicate IDs/search box, and slider render in dark/light/Nord",
  );
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1050, 700),
  );
  for (const trigger of [modelTrigger, effortTrigger]) {
    await trigger.click();
    const popup = await (
      (await modelList().count()) ? modelList() : effortDialog()
    ).boundingBox();
    const viewport = await page.evaluate(() => ({
      width: innerWidth,
      height: innerHeight,
      overflow: document.documentElement.scrollWidth > innerWidth,
    }));
    if (
      !popup ||
      popup.x < 0 ||
      popup.y < 0 ||
      popup.x + popup.width > viewport.width ||
      popup.y + popup.height > viewport.height ||
      viewport.overflow
    )
      throw new Error("Picker clipped at minimum window size.");
    await page.screenshot({
      path: `artifacts/pickers-min-${(await modelList().count()) ? "model" : "effort"}.png`,
    });
    await page.keyboard.press("Escape");
  }
  report.checks.push("both popovers fit the minimum1050x700 window");
  if (report.errors.length) throw new Error(JSON.stringify(report.errors));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.failure = String(error);
  await page
    ?.screenshot({ path: "artifacts/pickers-failure.png" })
    .catch(() => {});
  throw error;
} finally {
  await writeFile(
    "artifacts/pickers-verification.json",
    JSON.stringify(report, null, 2),
  );
  await app.close();
}

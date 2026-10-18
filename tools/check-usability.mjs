import { _electron as electron, expect } from "@playwright/test";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

await mkdir("artifacts", { recursive: true });
const profile = resolve(`artifacts/usability-profile-${Date.now()}`);
const env = { ...process.env, CUTROOM_USER_DATA: profile };
delete env.ELECTRON_RUN_AS_NODE;
const checks = [],
  errors = [];
const launch = () =>
  electron.launch(
    process.argv.includes("--packaged")
      ? {
          executablePath: resolve("release/win-unpacked/CutRoom.exe"),
          env,
          timeout: 60_000,
        }
      : { args: ["."], env, timeout: 60_000 },
  );
let app = await launch();
let page;
try {
  page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.waitForFunction(() => !!window.cutroom);
  const request = (method, params) =>
    page.evaluate(([m, p]) => window.cutroom.request(m, p), [method, params]);
  await page.getByLabel("Primeiros passos", { exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Instalar transcrição", exact: true })
    .click();
  await page.getByText("O download acontece aqui;", { exact: false }).waitFor();
  await page.screenshot({ path: "artifacts/usability-packages.png" });
  checks.push(
    "fresh Electron profile shows transcription download guidance and navigates to actual Packages",
  );
  await page.getByRole("button", { name: "Assistente", exact: true }).click();
  await page
    .getByRole("button", { name: "Dispensar primeiros passos" })
    .click();
  await expect(
    page.getByLabel("Primeiros passos", { exact: true }),
  ).toHaveCount(0);
  if (!(await request("getState")).onboarding.dismissed)
    throw new Error("Onboarding dismissal not recorded.");
  checks.push("onboarding dismiss updates backend state");

  let state = await request("importPaths", {
    paths: [resolve("artifacts/desktop-fixture.mp4")],
  });
  await page.waitForFunction(
    () => document.querySelector("video")?.readyState >= 2,
  );
  await page.getByRole("button", { name: "Estilo", exact: true }).click();
  await page
    .getByRole("button", { name: "Remover muletas", exact: true })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: /transcri|pacote/i }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Abrir Pacotes", exact: true })
    .last()
    .click();
  await page.getByRole("button", { name: "Assistente", exact: true }).click();
  checks.push(
    "filler button gives actual missing-package error with direct Packages navigation",
  );
  await page
    .getByRole("button", { name: "Remover pausas", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      !document.querySelector(".tool-row:disabled") ||
      !document.querySelector(".activity-row.running"),
    null,
    { timeout: 20_000 },
  );
  state = await request("getState");
  if (
    !state.jobs.some(
      (job) => job.status === "completed" && /pausa/i.test(job.label),
    )
  )
    throw new Error(
      `Silence action did not complete: ${JSON.stringify(state.jobs)}`,
    );
  if (!(await page.locator(".activity-feed").first().isVisible()))
    throw new Error("Activity is hidden.");
  checks.push(
    "silence cleanup runs without transcription and displays real completion state",
  );

  await request("executeCommand", { name: "reset", args: {} });
  await page
    .getByRole("button", { name: "Recolher painel", exact: true })
    .click();
  for (let i = 0; i < 12; i++) {
    await page.locator(".play-button").click();
    await page
      .getByRole("slider", { name: "Posição no projeto" })
      .fill(String(Number((0.2 + (i % 5) * 0.8).toFixed(2))));
  }
  await page
    .getByRole("button", { name: "Voltar ao início", exact: true })
    .click();
  if (await page.getByRole("button", { name: "Pausar", exact: true }).count())
    await page.getByRole("button", { name: "Pausar", exact: true }).click();
  state = await request("getState");
  await request("executeCommand", {
    name: "split",
    args: { clipId: state.project.clips[0].id, time: 3 },
  });
  await page.getByRole("slider", { name: "Posição no projeto" }).fill("2.8");
  await page.getByRole("button", { name: "Reproduzir", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector("video")?.currentTime > 3.15,
    null,
    { timeout: 5000 },
  );
  await page.getByRole("button", { name: "Pausar", exact: true }).click();
  if (await page.locator(".player-error").count())
    throw new Error(await page.locator(".player-error").innerText());
  checks.push(
    "12 rapid play/pause/scrub interactions and split boundary playback continue without interruption errors",
  );

  const second = resolve("artifacts/usability-second.mp4");
  await copyFile(resolve("artifacts/desktop-fixture.mp4"), second);
  state = await request("importPaths", { paths: [second] });
  const boundary = state.project.clips
    .slice(0, -1)
    .reduce((sum, clip) => sum + (clip.end - clip.start) / clip.speed, 0);
  await page
    .getByRole("slider", { name: "Posição no projeto" })
    .fill(String(Number((boundary - 0.15).toFixed(2))));
  await page.getByRole("button", { name: "Reproduzir", exact: true }).click();
  await page.waitForFunction(
    () =>
      document.querySelector("video")?.src.includes("usability-second") &&
      document.querySelector("video").currentTime > 0.15 &&
      !document.querySelector("video").paused,
    null,
    { timeout: 8000 },
  );
  await page.getByRole("button", { name: "Pausar", exact: true }).click();
  if (await page.locator(".player-error").count())
    throw new Error(await page.locator(".player-error").innerText());
  checks.push(
    "playback crosses into a different real media source without a stale play promise error",
  );

  // Deterministic timed transcript fixture exercises real saved-project and edit routes.
  // It tests removal behavior, independently of ASR recognition quality.
  const fixtureMedia = state.project.media[0];
  const fixture = {
    ...state.project,
    id: crypto.randomUUID(),
    name: "Fixture de muletas",
    media: [fixtureMedia],
    clips: [
      {
        ...state.project.clips[0],
        id: crypto.randomUUID(),
        start: 0,
        end: fixtureMedia.duration,
        speed: 1,
        zoom: 1,
      },
    ],
    words: [
      { mediaId: fixtureMedia.id, text: "Olá", start: 0.2, end: 0.6 },
      { mediaId: fixtureMedia.id, text: "né", start: 1, end: 1.4 },
      { mediaId: fixtureMedia.id, text: "vídeo", start: 2, end: 2.5 },
    ],
    overlays: [],
    settings: { ...state.project.settings, captions: false },
  };
  const fixturePath = resolve("artifacts/usability-fillers.cutroom.json");
  await writeFile(fixturePath, JSON.stringify(fixture, null, 2));
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [path],
    });
  }, fixturePath);
  await request("openProject");
  await page.getByRole("button", { name: "Estilo", exact: true }).click();
  await page
    .getByRole("button", { name: "Remover muletas", exact: true })
    .click();
  await expect
    .poll(async () => (await request("getState")).jobs.at(-1)?.status)
    .toBe("completed");
  state = await request("getState");
  const editedDuration = state.project.clips.reduce(
    (sum, clip) => sum + (clip.end - clip.start) / clip.speed,
    0,
  );
  if (
    editedDuration >= fixtureMedia.duration - 0.2 ||
    !state.messages.at(-1)?.text.startsWith("Muletas removidas:")
  )
    throw new Error(
      "Real filler button did not remove timed filler from timeline.",
    );
  const feed = page.locator(".activity-feed").first();
  if (await feed.locator(".activity-result").count())
    throw new Error("Completed job summary is duplicated in activity feed.");
  await page
    .getByRole("button", { name: "Remover muletas", exact: true })
    .click();
  await expect
    .poll(async () => (await request("getState")).jobs.at(-1)?.status)
    .toBe("completed");
  state = await request("getState");
  const secondDuration = state.project.clips.reduce(
    (sum, clip) => sum + (clip.end - clip.start) / clip.speed,
    0,
  );
  if (
    Math.abs(secondDuration - editedDuration) > 0.001 ||
    !state.messages.at(-1)?.text.includes("nenhuma muleta reconhecida")
  )
    throw new Error(
      "Repeat cleanup must report a real no-op and preserve duration.",
    );
  await page.screenshot({ path: "artifacts/usability-filler-noop.png" });
  checks.push(
    "actual filler button removes timed fixture filler; second click explicitly reports no-op; completed summary is not duplicated",
  );

  state = await request("connectCodex", {});
  if (state.connection.status !== "connected")
    throw new Error("Existing Codex session could not connect.");
  await page.getByRole("button", { name: "Modelo", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Buscar modelo" })
    .fill(state.connection.models[0].name);
  await page
    .getByRole("combobox", { name: "Buscar modelo" })
    .press("ArrowDown");
  await page.getByRole("combobox", { name: "Buscar modelo" }).press("Enter");
  const selected = state.connection.models[0];
  if (selected.reasoningEfforts?.length) {
    await page.getByRole("button", { name: "Raciocínio", exact: true }).click();
    const values = await page
      .getByRole("listbox", { name: "Raciocínio", exact: true })
      .getByRole("option")
      .count();
    if (values !== selected.reasoningEfforts.length)
      throw new Error("Effort selector disagrees with actual model support.");
    await page
      .getByRole("listbox", { name: "Raciocínio", exact: true })
      .press("End");
    await page
      .getByRole("listbox", { name: "Raciocínio", exact: true })
      .press("Enter");
  }
  await page.getByRole("button", { name: "Modelo", exact: true }).click();
  await page.screenshot({ path: "artifacts/usability-models.png" });
  await page.getByRole("combobox", { name: "Buscar modelo" }).press("Escape");
  checks.push(
    "real Codex catalog appears in searchable dark keyboard selector; reasoning options equal model-supported values",
  );
  if (process.argv.includes("--ai")) {
    if (selected.reasoningEfforts?.length) {
      await page
        .getByRole("button", { name: "Raciocínio", exact: true })
        .click();
      await page
        .getByRole("listbox", { name: "Raciocínio", exact: true })
        .press("Home");
      await page
        .getByRole("listbox", { name: "Raciocínio", exact: true })
        .press("Enter");
    }
    await page
      .getByRole("textbox", { name: "Descreva sua edição" })
      .fill(
        "Consulte o projeto com a ferramenta do editor e diga apenas a quantidade de clipes. Não altere, transcreva nem exporte nada.",
      );
    await page
      .getByRole("button", { name: "Enviar mensagem", exact: true })
      .click();
    await expect(
      page
        .locator(".activity-feed")
        .first()
        .locator(".activity-row.running")
        .first(),
    ).toBeVisible({ timeout: 20000 });
    await page.screenshot({ path: "artifacts/usability-live-agent.png" });
    await expect
      .poll(
        async () => {
          const current = await request("getState");
          return (
            !current.busy &&
            current.activities?.some(
              (entry) => entry.kind === "turn" && entry.status === "completed",
            )
          );
        },
        { timeout: 120000, intervals: [500, 1000, 2000] },
      )
      .toBeTruthy();
    await request("executeCommand", {
      name: "trim",
      args: { clipId: "missing-fixture-clip", start: 0, end: 1 },
    }).catch(() => {});
    const failedFeed = page.locator(".activity-feed").first();
    await expect(failedFeed.locator(".activity-row.failed")).toBeVisible();
    await expect(failedFeed.locator(".activity-row.completed")).toHaveCount(0);
    await expect(failedFeed.locator(".activity-result")).toHaveCount(0);
    await page.screenshot({ path: "artifacts/usability-failed-after-ai.png" });
    checks.push(
      "real Codex turn shows live running activity; later failed edit replaces old completed activity and cannot inherit green summary",
    );
  }
  await page.screenshot({ path: "artifacts/usability-completed.png" });
  await app.close();
  app = await launch();
  page = await app.firstWindow();
  await page.waitForFunction(() => !!window.cutroom);
  await expect(
    page.getByLabel("Primeiros passos", { exact: true }),
  ).toHaveCount(0);
  const restored = await page.evaluate(() =>
    window.cutroom.request("getState"),
  );
  if (!restored.onboarding.dismissed)
    throw new Error(
      "Onboarding dismissal was not persisted across real Electron launches.",
    );
  checks.push("onboarding dismissal persists across actual Electron relaunch");
  if (errors.length) throw new Error(`Renderer errors: ${errors.join("; ")}`);
  await writeFile(
    "artifacts/usability-verification.json",
    JSON.stringify({ checks, errors, profile }, null, 2),
  );
  console.log(JSON.stringify({ checks, errors }, null, 2));
} catch (error) {
  if (page && !page.isClosed())
    await page
      .screenshot({ path: "artifacts/usability-failure.png" })
      .catch(() => {});
  await writeFile(
    "artifacts/usability-verification-failed.json",
    JSON.stringify(
      { checks, errors, failure: String(error), profile },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await app.close();
}

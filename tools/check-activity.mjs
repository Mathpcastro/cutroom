import { _electron as electron, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

await mkdir("artifacts", { recursive: true });
const env = {
  ...process.env,
  CUTROOM_USER_DATA: resolve(`artifacts/activity-profile-${Date.now()}`),
};
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch(
  process.argv.includes("--packaged")
    ? { executablePath: resolve("release/win-unpacked/CutRoom.exe"), env }
    : { args: ["."], env },
);
const report = { checks: [], frames: [], errors: [] };
let page;
try {
  page = await app.firstWindow();
  page.on("pageerror", (error) => report.errors.push(error.message));
  await page.waitForFunction(() => !!window.cutroom);
  const base = await page.evaluate(() =>
    window.cutroom.request("dismissOnboarding"),
  );
  base.onboarding.transcriptionReady = true;
  const time = new Date().toISOString();
  base.messages = [
    {
      id: "fixture-request",
      role: "user",
      text: "Aplique zoom nos trechos relevantes.",
      createdAt: time,
    },
    {
      id: "fixture-response",
      role: "assistant",
      text: "Vou revisar os trechos do projeto.",
      createdAt: time,
    },
  ];
  await page.evaluate(() => {
    const original = Element.prototype.scrollIntoView;
    window.__activityScrollCalls = 0;
    Element.prototype.scrollIntoView = function (...args) {
      if (this.closest(".messages")) window.__activityScrollCalls++;
      return original.apply(this, args);
    };
  });
  const turn = {
    id: "fixture-turn",
    kind: "turn",
    label: "Agente trabalhando no projeto",
    status: "running",
    startedAt: time,
  };
  const tool = {
    id: "fixture-tool",
    kind: "tool",
    label: "Aplicando zoom nos trechos selecionados",
    status: "running",
    startedAt: time,
  };
  const job = {
    id: "fixture-job",
    kind: "export",
    label: "Renderizando vídeo…",
    status: "running",
    progress: 0,
    startedAt: time,
  };
  const publish = async (patch) => {
    await app.evaluate(
      ({ BrowserWindow }, state) =>
        BrowserWindow.getAllWindows()[0].webContents.send("editor:event", {
          type: "state",
          state,
        }),
      { ...base, ...patch },
    );
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
  };
  const feed = page.locator(".activity-feed").first();
  const sample = async (name, patch) => {
    await publish(patch);
    await expect(feed).toBeVisible();
    const frame = await feed.evaluate((element) => ({
      rows: element.querySelectorAll(".activity-row").length,
      bars: element.querySelectorAll("progress").length,
      height: element.getBoundingClientRect().height,
    }));
    report.frames.push({ name, ...frame });
    await page.screenshot({ path: `artifacts/activity-${name}.png` });
    if (frame.rows !== 1)
      throw new Error(`${name}: duplicate progress rows (${frame.rows})`);
    if (frame.bars !== 1)
      throw new Error(
        `${name}: running progress bar disappeared (${frame.bars})`,
      );
  };
  await sample("tool-job", {
    busy: true,
    activities: [turn, tool],
    jobs: [job],
  });
  await page.evaluate(() => {
    window.__activityScrollCalls = 0;
  });
  await sample("turn", { busy: true, activities: [turn] });
  await sample("progress", {
    busy: true,
    activities: [turn, tool],
    jobs: [{ ...job, progress: 42 }],
  });
  await sample("job-finished", {
    busy: true,
    activities: [turn, tool],
    jobs: [{ ...job, progress: 100, status: "completed", finishedAt: time }],
  });
  await sample("between-tools", {
    busy: true,
    activities: [turn, { ...tool, status: "completed", finishedAt: time }],
  });
  await sample("reasoning", {
    busy: true,
    activities: [
      turn,
      {
        ...tool,
        id: "reasoning",
        kind: "reasoning",
        detail: "Uma atualização extensa do agente. ".repeat(100),
      },
    ],
  });
  await sample("starting", { busy: true, activities: [] });
  if (
    Math.max(...report.frames.map((f) => f.height)) -
      Math.min(...report.frames.map((f) => f.height)) >
    1
  )
    throw new Error(
      "Collapsed progress changes height between task transitions.",
    );
  report.checks.push(
    "one stable row and persistent progress track across turn/tool/job/delta/transition snapshots",
  );
  if ((await page.evaluate(() => window.__activityScrollCalls)) !== 0)
    throw new Error(
      "Progress-only snapshots restart conversation auto-scroll.",
    );
  await publish({
    busy: true,
    activities: [turn],
    messages: [
      ...base.messages.slice(0, -1),
      { ...base.messages.at(-1), text: "Trechos revisados." },
    ],
  });
  await expect
    .poll(() => page.evaluate(() => window.__activityScrollCalls))
    .toBe(1);
  report.checks.push(
    "progress-only updates do not scroll the conversation; actual message changes still do",
  );

  await publish({
    busy: true,
    activities: [turn, tool],
    jobs: [job, { ...job, id: "other-job" }],
  });
  await expect(feed.locator(".activity-row")).toHaveCount(1);
  const liveRow = await feed.locator(".activity-row").elementHandle();
  const liveBar = await feed.locator("progress").elementHandle();
  await publish({ busy: true, activities: [turn] });
  if (
    !(await liveRow.evaluate((el) => el.isConnected)) ||
    !(await liveBar.evaluate((el) => el.isConnected))
  )
    throw new Error("Active indicator remounted between local task and agent.");
  report.checks.push(
    "existing row and progress DOM nodes survive transitions; concurrent tasks do not add collapsed rows",
  );
  for (let cycle = 0; cycle < 20; cycle++) {
    for (const patch of [
      {
        activities: [turn, { ...tool, id: `tool-${cycle}` }],
        jobs: [{ ...job, id: `job-${cycle}`, progress: cycle * 5 }],
      },
      {
        activities: [
          turn,
          { ...tool, id: `tool-${cycle}`, status: "completed" },
        ],
        jobs: [
          { ...job, id: `job-${cycle}`, status: "completed", progress: 100 },
        ],
      },
      { activities: [turn], jobs: [] },
    ]) {
      await publish({ busy: true, ...patch });
      const stable = await liveRow.evaluate(
        (el) =>
          el.isConnected &&
          el.parentElement.querySelectorAll(".activity-row").length === 1,
      );
      const stableBar = await liveBar.evaluate((el) => el.isConnected);
      if (
        !stable ||
        !stableBar ||
        Math.abs((await feed.boundingBox()).height - report.frames[0].height) >
          1
      )
        throw new Error(
          `Indicator flickered or changed size during task cycle ${cycle}.`,
        );
    }
  }
  report.checks.push(
    "20 rapid tool/job cycles (60 state transitions) keep the same indicator and card height",
  );
  await publish({ busy: true, activities: [turn, tool], jobs: [job] });
  await feed.getByRole("button", { name: "Histórico" }).click();
  await expect(feed.locator(".activity-row")).toHaveCount(3);
  await feed.getByRole("button", { name: "Recolher" }).click();
  await expect(feed.locator(".activity-row")).toHaveCount(1);
  report.checks.push(
    "history retains parent agent, tool and local job; collapsing restores one indicator",
  );
  for (const status of ["completed", "failed", "cancelled"]) {
    await publish({
      busy: false,
      activities: [
        {
          ...turn,
          status,
          finishedAt: time,
          detail: status === "failed" ? "Falha de teste" : undefined,
        },
      ],
    });
    await expect(feed.locator(`.activity-row.${status}`)).toBeVisible();
    await expect(feed.locator(".activity-row.running")).toHaveCount(0);
    await expect(feed.locator("progress")).toHaveCount(0);
  }
  report.checks.push(
    "completion, failure and cancellation stop the live indicator with correct terminal status",
  );
  if (report.errors.length) throw new Error(report.errors.join("; "));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.failure = String(error);
  await page
    ?.screenshot({ path: "artifacts/activity-failure.png" })
    .catch(() => {});
  throw error;
} finally {
  await writeFile(
    "artifacts/activity-verification.json",
    JSON.stringify(report, null, 2),
  );
  await app.close();
}

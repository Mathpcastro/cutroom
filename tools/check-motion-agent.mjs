import { _electron as electron, expect } from "@playwright/test";
import { resolve } from "node:path";
import { writeFile } from "node:fs/promises";
const env = {
  ...process.env,
  CUTROOM_USER_DATA: resolve(`artifacts/motion-agent-${Date.now()}`),
};
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ["."], env, timeout: 60000 });
const report = {};
try {
  const page = await app.firstWindow();
  await page.waitForFunction(() => !!window.cutroom);
  const request = (m, p) =>
    page.evaluate(([m, p]) => window.cutroom.request(m, p), [m, p]);
  await request("dismissOnboarding");
  await request("importPaths", {
    paths: [resolve("artifacts/motion-fixture.mp4")],
  });
  const connection = await request("connectCodex", {});
  const model =
    connection.connection.models.find((m) => /luna/i.test(m.id)) ??
    connection.connection.models[0];
  report.model = model.id;
  const text =
    "Crie um diagrama ORIGINAL de três cartões conectados: Ideia, Movimento, Vídeo. Use HTML/CSS personalizado e GSAP declarativo, sem presetId, com entrada e saída, laranja e branco. Não transcreva nem exporte. Responda brevemente ao terminar.";
  await request(
    process.argv.includes("--command") ? "runChatCommand" : "sendChat",
    process.argv.includes("--command")
      ? {
          id: "animar",
          options: { text, start: 1, end: 4 },
          model: model.id,
          reasoningEffort: model.reasoningEfforts?.[0],
        }
      : {
          text: 'Leia o projeto e crie uma animação ORIGINAL HyperFrames sobre o vídeo, com HTML/CSS personalizado e GSAP declarativo: um diagrama minimalista de três cartões conectados "Ideia", "Movimento", "Vídeo". De 1 a 4 segundos da timeline, com entrada e saída, usando laranja e branco. Use edit_project com motion, sem presetId; não transcreva nem exporte. Responda brevemente ao terminar.',
          model: model.id,
          reasoningEffort: model.reasoningEfforts?.[0],
        },
  );
  await expect
    .poll(async () => !(await request("getState")).busy, {
      timeout: 180000,
      intervals: [500, 1000],
    })
    .toBe(true);
  const state = await request("getState");
  report.activities = state.activities;
  report.messages = state.messages;
  report.scenes = state.project.motions;
  expect(state.project.motions.length).toBeGreaterThan(0);
  expect(state.project.motions[0].presetId).toBeUndefined();
  expect(
    state.activities.some(
      (a) => a.tool === "edit_project" && a.status === "completed",
    ),
  ).toBe(true);
  console.log(
    JSON.stringify(
      {
        model: report.model,
        scenes: report.scenes.length,
        checks: [
          "actual Codex inference generates custom HTML/CSS/tweens through editor tool",
          "live tool activity completes",
        ],
      },
      null,
      2,
    ),
  );
} finally {
  await writeFile(
    "artifacts/motion-agent-report.json",
    JSON.stringify(report, null, 2),
  );
  await app.close();
}

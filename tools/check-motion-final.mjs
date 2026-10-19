import { _electron as electron, expect } from "@playwright/test";
import { mkdir, cp, readFile, writeFile, stat } from "node:fs/promises";
import { resolve, join } from "node:path";
const previous = JSON.parse(
  await readFile("artifacts/motion-check-report.json", "utf8"),
);
const profile = resolve(`artifacts/motion-final-${Date.now()}`);
await mkdir(profile, { recursive: true });
await cp(join(previous.profile, "packages"), join(profile, "packages"), {
  recursive: true,
});
const env = { ...process.env, CUTROOM_USER_DATA: profile };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath: resolve("release/win-unpacked/CutRoom.exe"),
  env,
  timeout: 60000,
});
try {
  const page = await app.firstWindow();
  await page.waitForFunction(() => !!window.cutroom);
  const request = (m, p) =>
    page.evaluate(([m, p]) => window.cutroom.request(m, p), [m, p]);
  await request("dismissOnboarding");
  await request("importPaths", {
    paths: [resolve("artifacts/motion-fixture.mp4")],
  });
  await request("executeCommand", {
    name: "motion",
    args: {
      name: "Relogio preservado",
      start: 1,
      end: 7,
      mode: "overlay",
      html: '<div class="idea" style="position:absolute;left:10%;top:20%;font:700 80px Barlow;color:#fff;background:#ff6b0b;padding:30px">Do texto ao video</div>',
      animations: [
        {
          selector: ".idea",
          start: 0,
          duration: 0.4,
          from: { opacity: 0, y: 30 },
          to: { opacity: 1, y: 0 },
        },
        { selector: ".idea", start: 5, duration: 1, to: { opacity: 0 } },
      ],
    },
  });
  const p = (await request("getState")).project;
  await request("executeCommand", {
    name: "remove_range",
    args: { mediaId: p.media[0].id, start: 3, end: 5 },
  });
  let scenes = (await request("getState")).project.motions;
  expect(scenes).toHaveLength(2);
  await request("executeCommand", {
    name: "motion",
    args: { id: scenes[1].id, name: "Segunda parte", end: 6 },
  });
  scenes = (await request("getState")).project.motions;
  expect(scenes[1].sourceOffset).toBe(4);
  expect(scenes[1].playbackRate).toBeCloseTo(2 / 3);
  const output = resolve("artifacts/motion-final-export.mp4");
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
  }, output);
  await request("exportVideo");
  expect((await stat(output)).size).toBeGreaterThan(10000);
  await writeFile(
    "artifacts/motion-final-report.json",
    JSON.stringify(
      {
        checks: [
          "final packaged build imports source, adds custom scene, cuts video, retimes scene preserving phase, renders and exports",
        ],
        profile,
        scenes: scenes.map(({ duration, sourceOffset, playbackRate }) => ({
          duration,
          sourceOffset,
          playbackRate,
        })),
      },
      null,
      2,
    ),
  );
  console.log("PASS final packaged motion edit/cut/retime/render/export");
} finally {
  await app.close();
}

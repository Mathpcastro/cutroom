import { mkdir, writeFile, readFile, cp } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import {
  CAPTION_PRESETS,
  createCaptionAss,
  resolveCaptionSettings,
} from "../src/shared/captions";
import { createProject, timelineWords } from "../electron/core/project";
import { exportProject, ffmpegPath, ffprobePath } from "../electron/core/media";
import type { Project } from "../src/shared/types";

const exec = promisify(execFile),
  dir = path.resolve("artifacts/caption-engine");
await mkdir(dir, { recursive: true });
await cp(path.resolve("resources/fonts"), path.join(dir, "fonts"), {
  recursive: true,
});
const p = createProject();
p.settings = {
  ...p.settings,
  captions: true,
  normalize: false,
  width: 960,
  height: 540,
};
p.media = [
  {
    id: "specimen",
    name: "Synthetic caption typography specimen",
    path: "C:/specimen.mp4",
    duration: 4,
    width: 960,
    height: 540,
    fps: 30,
    hasAudio: true,
  },
];
p.clips = [
  {
    id: "specimen",
    mediaId: "specimen",
    start: 0,
    end: 4,
    speed: 1,
    zoom: 1,
    muted: false,
  },
];
p.words = ["Sua", "voz", "em", "foco.", "Legendas", "com", "intenção."].map(
  (text, i) => ({
    text,
    mediaId: "specimen",
    start: 0.1 + i * 0.32,
    end: 0.38 + i * 0.32,
  }),
);
const report: {
  specimen: string;
  presets: { id: string; sha256: string; filename: string }[];
  exports: {
    id: string;
    file: string;
    duration: number;
    width: number;
    height: number;
  }[];
} = {
  specimen:
    "Synthetic typography specimens; source text is intentionally fabricated to compare caption rendering, not a transcription claim. MP4 exports below use the existing desktop fixture and its real local ASR words.",
  presets: [],
  exports: [],
};
for (let i = 0; i < CAPTION_PRESETS.length; i++) {
  const preset = CAPTION_PRESETS[i];
  p.settings.captionStyle = preset.settings;
  const file = `${String(i + 1).padStart(2, "0")}-${preset.id}.png`;
  await writeFile(path.join(dir, "current.ass"), createCaptionAss(p));
  const label = `${String(i + 1).padStart(2, "0")}. ${preset.name}`;
  await writeFile(path.join(dir, "label.txt"), label);
  await exec(
    ffmpegPath,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=0x16161d:s=960x540:r=30:d=2",
      "-vf",
      "ass=filename=current.ass:fontsdir=fonts,scale=480:270,pad=480:300:0:0:color=0x111114,drawtext=fontfile=fonts/Barlow-Regular.ttf:textfile=label.txt:fontsize=17:fontcolor=white:x=12:y=277",
      "-ss",
      "0.90",
      "-frames:v",
      "1",
      file,
    ],
    { cwd: dir, maxBuffer: 2_000_000 },
  );
  const data = await readFile(path.join(dir, file));
  report.presets.push({
    id: preset.id,
    filename: file,
    sha256: createHash("sha256").update(data).digest("hex"),
  });
}
const inputs = report.presets.flatMap((entry) => ["-i", entry.filename]);
const layout = report.presets
  .map((_, i) => `${(i % 4) * 480}_${Math.floor(i / 4) * 300}`)
  .join("|");
await exec(
  ffmpegPath,
  [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    ...inputs,
    "-filter_complex",
    `${report.presets.map((_, i) => `[${i}:v]`).join("")}xstack=inputs=24:layout=${layout}:fill=0x111114[out]`,
    "-map",
    "[out]",
    "-frames:v",
    "1",
    "24-presets-contact-sheet.png",
  ],
  { cwd: dir, maxBuffer: 2_000_000 },
);
const actual = JSON.parse(
  await readFile(
    path.resolve("artifacts/caption-preview.cutroom.json"),
    "utf8",
  ),
) as Project;
actual.settings.normalize = false;
actual.overlays = [];
for (const id of ["studio-highlight", "karaoke", "word-bounce"]) {
  actual.settings.captionStyle = resolveCaptionSettings({ presetId: id });
  const file = path.join(dir, `actual-export-${id}.mp4`);
  await exportProject(actual, file, {
    fontPath: path.resolve("resources/fonts/Barlow-Regular.ttf"),
  });
  const { stdout } = await exec(ffprobePath, [
    "-v",
    "error",
    "-show_format",
    "-show_streams",
    "-of",
    "json",
    file,
  ]);
  const metadata = JSON.parse(stdout),
    video = metadata.streams.find(
      (s: { codec_type: string }) => s.codec_type === "video",
    );
  report.exports.push({
    id,
    file,
    duration: Number(metadata.format.duration),
    width: video.width,
    height: video.height,
  });
  await exec(ffmpegPath, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-ss",
    "1.45",
    "-i",
    file,
    "-frames:v",
    "1",
    path.join(dir, `actual-export-${id}.png`),
  ]);
}
await writeFile(
  path.join(dir, "specimen.cutroom.json"),
  JSON.stringify(p, null, 2),
);
await writeFile(
  path.join(dir, "actual-export.cutroom.json"),
  JSON.stringify(actual, null, 2),
);
await writeFile(
  path.join(dir, "verification.json"),
  JSON.stringify(
    {
      ...report,
      uniqueRasterImages: new Set(report.presets.map((p) => p.sha256)).size,
      mappedActualWords: timelineWords(actual).length,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify(
    {
      presetFrames: report.presets.length,
      uniqueRasterImages: new Set(report.presets.map((p) => p.sha256)).size,
      exports: report.exports,
      contactSheet: path.join(dir, "24-presets-contact-sheet.png"),
    },
    null,
    2,
  ),
);

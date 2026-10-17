import { join, resolve } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import {
  PackageManager,
  TRANSCRIPTION_PACKAGE,
} from "../electron/core/packages";
const root = resolve("artifacts/electron-profile");
const manager = new PackageManager(
  join(root, "packages"),
  resolve("resources"),
);
await mkdir(root, { recursive: true });
await manager.install(TRANSCRIPTION_PACKAGE, (progress, message) =>
  process.stdout.write(`${Math.round(progress)}% ${message}\n`),
);
const words = await manager.transcribe(
  {
    id: "speech-fixture",
    name: "speech.wav",
    path: resolve("artifacts/speech.wav"),
    duration: 8,
    width: 640,
    height: 360,
    fps: 30,
    hasAudio: true,
  },
  join(root, "cache"),
  (progress) =>
    process.stdout.write(`transcription ${Math.round(progress)}%\n`),
);
if (
  words.length < 3 ||
  words.some((word) => !Number.isFinite(word.start) || word.end < word.start)
)
  throw new Error("Transcrição inválida.");
await writeFile(
  resolve("artifacts/transcription-result.json"),
  JSON.stringify({ words, packages: await manager.list() }, null, 2),
);
console.log(`Verified ${words.length} real words with local runtime.`);

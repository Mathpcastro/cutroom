import { resolve, join } from "node:path";
import { writeFile } from "node:fs/promises";
import { PackageManager } from "../electron/core/packages";
const manager = new PackageManager(
  resolve("artifacts/electron-profile/packages"),
  resolve("resources"),
);
const words = await manager.transcribe(
  {
    id: "speech-pt-fixture",
    name: "speech-pt.wav",
    path: resolve("artifacts/speech-pt.wav"),
    duration: 9,
    width: 640,
    height: 360,
    fps: 30,
    hasAudio: true,
  },
  resolve("artifacts/electron-profile/cache"),
  (percent) => console.log(`Local PT ${Math.round(percent)}%`),
  undefined,
  true,
);
const transcript = words.map((word) => word.text).join(" ");
const expected = ["teste", "edição", "vídeo", "local", "pausas", "legendas"];
const hits = expected.filter((word) => transcript.toLowerCase().includes(word));
if (hits.length < 4)
  throw new Error(`Transcrição da amostra PT insuficiente: ${transcript}`);
await writeFile(
  join("artifacts", "transcription-pt-result.json"),
  JSON.stringify({ transcript, matched: hits, words }, null, 2),
);
console.log(JSON.stringify({ transcript, matched: hits }, null, 2));

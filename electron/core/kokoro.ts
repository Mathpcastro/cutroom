import { randomUUID } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runProcess } from "./process";
import type { SpeechResult, VoiceOption } from "./voice";

/**
 * Kokoro-82M (Apache-2.0 weights) via kokoro-onnx, int8 model (~90 MB), offline on the CPU.
 * About 2x faster than real time on an 8-thread laptop. Word timings come from the local
 * transcription afterwards (the same path as OpenAI voices).
 */
export const KOKORO_PACKAGE = "kokoro-voice";
export const KOKORO_VERSION = "1.0-int8.1";
const RELEASE = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0";
export const KOKORO_FILES = [
  {
    name: "kokoro-v1.0.int8.onnx",
    url: `${RELEASE}/kokoro-v1.0.int8.onnx`,
    sha256: "6e742170d309016e5891a994e1ce1559c702a2ccd0075e67ef7157974f6406cb",
    bytes: 92_361_271,
  },
  {
    name: "voices-v1.0.bin",
    url: `${RELEASE}/voices-v1.0.bin`,
    sha256: "bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d",
    bytes: 28_214_398,
  },
] as const;

/** Brazilian Portuguese voices first; Alex had the best intelligibility in our tests (5% WER). */
export const KOKORO_VOICES: (VoiceOption & { lang: string })[] = [
  { id: "pm_alex", name: "Alex", provider: "kokoro", language: "pt-BR", description: "Masculina, clara (padrão)", lang: "pt-br" },
  { id: "pf_dora", name: "Dora", provider: "kokoro", language: "pt-BR", description: "Feminina", lang: "pt-br" },
  { id: "pm_santa", name: "Santa", provider: "kokoro", language: "pt-BR", description: "Masculina, grave", lang: "pt-br" },
  { id: "af_heart", name: "Heart", provider: "kokoro", language: "en-US", description: "Feminina (inglês)", lang: "en-us" },
  { id: "am_michael", name: "Michael", provider: "kokoro", language: "en-US", description: "Masculina (inglês)", lang: "en-us" },
  { id: "ef_dora", name: "Dora (ES)", provider: "kokoro", language: "es", description: "Feminina (espanhol)", lang: "es" },
];
export const KOKORO_DEFAULT_VOICE = "pm_alex";

/**
 * Spoken spelling for words the Portuguese phonemizer reads letter by letter or in English.
 * Only the audio uses it: captions keep the script as written.
 */
export const KOKORO_RESPELL: [RegExp, string][] = [
  [/\bSaaS\b/g, "sás"],
  [/\bIA\b/g, "i-á"],
  [/\bAPI\b/g, "a-pê-i"],
];
export function kokoroSpokenText(text: string, lang = "pt-br") {
  if (lang !== "pt-br") return text;
  return KOKORO_RESPELL.reduce((t, [re, to]) => t.replace(re, to), text);
}

export async function kokoroSpeech(options: {
  python: string;
  worker: string;
  models: string;
  text: string;
  voice?: string;
  signal?: AbortSignal;
  tempDir: string;
}): Promise<SpeechResult> {
  const voice = KOKORO_VOICES.find((v) => v.id === (options.voice ?? KOKORO_DEFAULT_VOICE));
  if (!voice) throw new Error(`Voz Kokoro desconhecida. Use: ${KOKORO_VOICES.map((v) => v.id).join(", ")}.`);
  const id = randomUUID(),
    textFile = join(options.tempDir, `kokoro-${id}.txt`),
    out = join(options.tempDir, `kokoro-${id}.wav`);
  await writeFile(textFile, kokoroSpokenText(options.text, voice.lang), "utf8");
  try {
    await runProcess(
      options.python,
      ["-X", "utf8", options.worker, "speak", "--model", join(options.models, KOKORO_FILES[0].name), "--voices", join(options.models, KOKORO_FILES[1].name), "--text-file", textFile, "--voice", voice.id, "--lang", voice.lang, "--out", out],
      { signal: options.signal, env: { ...process.env, PYTHONUTF8: "1" } },
    ).catch((error: Error) => {
      const reported = /"error":\s*"([^"]+)"/.exec(error.message)?.[1];
      throw new Error(reported ? `Voz Kokoro: ${reported}` : error.message);
    });
    return { audio: await readFile(out), extension: "wav" };
  } finally {
    await rm(textFile, { force: true });
    await rm(out, { force: true });
  }
}

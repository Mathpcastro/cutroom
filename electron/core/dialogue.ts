import type { AudioWord } from "../../src/shared/types";

/**
 * Spec 5 E: a dialogue with one voice per character. Each line is synthesized with its own voice,
 * the pieces are joined with short pauses and the word timings are shifted into one timeline, so the
 * story engine (CRM.autoStory) moves only the speaker's mouth on each line.
 */

export interface DialogueLine {
  text: string;
  provider?: "elevenlabs" | "openai" | "kokoro" | "local";
  voice?: string;
}

export interface DialogueDeps {
  /** Same contract as Studio.synthesize: null while a voice is still being generated in the background. */
  synthesize(line: DialogueLine): Promise<{ file: string; words?: AudioWord[] } | null | undefined>;
  probe(file: string): Promise<number>;
  /** Joins the files with `pause` seconds of silence after each one but the last, into `out`. */
  concat(files: string[], pause: number, out: string): Promise<void>;
  wait?(ms: number): Promise<void>;
}

export interface DialogueResult {
  file: string;
  words: AudioWord[];
  duration: number;
  lines: { start: number; end: number }[];
}

/** Synthesizes every line (retrying while a voice is still generating) and builds one timeline. */
export async function buildDialogue(lines: DialogueLine[], deps: DialogueDeps, out: string, pause = 0.35, timeoutMs = 180_000): Promise<DialogueResult> {
  if (!lines.length) throw new Error("O roteiro não tem falas.");
  const wait = deps.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const parts: { file: string; words: AudioWord[]; duration: number }[] = [];
  for (const line of lines) {
    const started = Date.now();
    let voiced = await deps.synthesize(line);
    while (!voiced) {
      if (Date.now() - started > timeoutMs) throw new Error("Uma das vozes ainda está sendo preparada. Tente de novo em alguns minutos.");
      await wait(1500);
      voiced = await deps.synthesize(line);
    }
    parts.push({ file: voiced.file, words: voiced.words ?? [], duration: await deps.probe(voiced.file) });
  }
  await deps.concat(parts.map((p) => p.file), pause, out);
  return { file: out, ...joinTimings(parts, pause) };
}

/** Pure: shifts each part's words by the time already spoken (+ pauses). */
export function joinTimings(parts: { words: AudioWord[]; duration: number }[], pause: number) {
  const words: AudioWord[] = [];
  const lines: { start: number; end: number }[] = [];
  let offset = 0;
  parts.forEach((part, i) => {
    for (const w of part.words) words.push({ ...w, start: +(w.start + offset).toFixed(3), end: +(w.end + offset).toFixed(3) });
    lines.push({ start: +offset.toFixed(3), end: +(offset + part.duration).toFixed(3) });
    offset += part.duration + (i < parts.length - 1 ? pause : 0);
  });
  return { words, lines, duration: +offset.toFixed(3) };
}

/** ffmpeg arguments for the join (48 kHz mono WAV, silence padded after each piece). */
export function concatArgs(files: string[], pause: number, out: string) {
  const inputs = files.flatMap((f) => ["-i", f]);
  const chains = files.map((_, i) => `[${i}:a]aresample=48000,aformat=channel_layouts=mono${i < files.length - 1 ? `,apad=pad_dur=${pause}` : ""}[a${i}]`);
  const filter = `${chains.join(";")};${files.map((_, i) => `[a${i}]`).join("")}concat=n=${files.length}:v=0:a=1[out]`;
  return ["-v", "error", "-y", ...inputs, "-filter_complex", filter, "-map", "[out]", "-c:a", "pcm_s16le", out];
}

import type { Beat } from "../../../src/shared/channel";
import { integerToWords, toSay } from "./pt-numbers";

/**
 * Alinhamento (spec "Narração e alinhamento"): matches the script tokens with the
 * transcription's timed words (sequence alignment, like `align_beats.py`). Numbers are
 * accepted both ways: the transcript may write "15.938" or "R$ 4,70" where the script says
 * "quinze mil…"; both sides are expanded to words before matching.
 * Each beat ends where the next one starts in the audio, minus 60 ms — never at the end of
 * its last matched word (that cut "quatro e setenta" when the transcript wrote "R$ 4,70").
 */

export type TimedWord = { text: string; start: number; end: number };
export type BeatTiming = NonNullable<Beat["timing"]>;
export type Transcriber = (file: string, options: { language?: string; signal?: AbortSignal }) => Promise<TimedWord[]>;

export const MATCH_TARGET = 0.97;
export const MATCH_FAIL = 0.95;
export const CUT_GAP = 0.06;

export function normToken(word: string) {
  return word.toLocaleLowerCase("pt-BR").normalize("NFD").replace(/\p{M}/gu, "").replace(/[^\p{L}\p{N}]/gu, "");
}

/** Spoken tokens of a text: numbers, money, % and acronyms expanded; connectors kept. */
export function spokenTokens(text: string) {
  // toSay keeps plain integers and years as digits; for matching every number becomes words.
  return toSay(text)
    .replace(/\d+/g, (n) => ` ${integerToWords(Number(n))} `)
    .split(/[\s,;:]+/)
    .map(normToken)
    .filter(Boolean);
}

/** Transcript words → spoken tokens, each sharing its word's time span. */
export function expandTranscript(words: TimedWord[]) {
  const out: TimedWord[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    // "R$" alone followed by the number: glue so the money reads as "quatro reais…".
    let text = w.text;
    let end = w.end;
    if (/^(R\$|US\$|€)$/.test(text.trim()) && words[i + 1]) {
      text = `${text}${words[i + 1].text}`;
      end = words[i + 1].end;
      i++;
    }
    const tokens = spokenTokens(text);
    if (!tokens.length) continue;
    const step = Math.max(0.001, (end - w.start) / tokens.length);
    tokens.forEach((t, k) => out.push({ text: t, start: w.start + k * step, end: w.start + (k + 1) * step }));
  }
  return out;
}

/** LCS alignment of two token lists: `match[i]` = index in `b` or -1. */
export function lcsMatch(a: string[], b: string[]) {
  const cols = b.length + 1;
  const table = new Uint16Array((a.length + 1) * cols);
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      table[i * cols + j] = a[i] === b[j] ? table[(i + 1) * cols + j + 1] + 1 : Math.max(table[(i + 1) * cols + j], table[i * cols + j + 1]);
  const match = new Array<number>(a.length).fill(-1);
  for (let i = 0, j = 0; i < a.length && j < b.length; ) {
    // On a tie, skip the heard word: a beat matches the latest audio that loses nothing,
    // so a deleted beat's leftover audio does not pull the next beat's start back.
    if (a[i] === b[j] && table[i * cols + j + 1] < table[i * cols + j]) {
      match[i++] = j++;
    } else if (a[i] === b[j]) j++;
    else if (table[(i + 1) * cols + j] >= table[i * cols + j + 1]) i++;
    else j++;
  }
  return match;
}

export type AlignResult = {
  ratio: number;
  timings: Record<string, BeatTiming>;
  /** Beats in script order whose matched audio goes backwards (order of beats ≠ order of audio). */
  outOfOrder: string[];
  worst?: { beatId: string; ratio: number; text: string };
  ok: boolean;
  error?: string;
};

/**
 * Aligns the beats (in script order) with the transcript of the assembled narration.
 * `duration` is the audio length; the last beat is cut there.
 */
export function alignBeats(beats: Pick<Beat, "id" | "text" | "say">[], transcript: TimedWord[], duration: number): AlignResult {
  const tokens: { t: string; beat: number }[] = [];
  beats.forEach((b, i) => {
    for (const t of spokenTokens(b.say ?? b.text)) tokens.push({ t, beat: i });
  });
  const heard = expandTranscript(transcript);
  if (!tokens.length || !heard.length) return { ratio: 0, timings: {}, outOfOrder: [], ok: false, error: "Transcrição vazia: confira a narração." };
  const match = lcsMatch(tokens.map((x) => x.t), heard.map((w) => w.text));
  const matched = match.filter((m) => m >= 0).length;
  const ratio = matched / tokens.length;

  // Times per token: matched → heard time; unmatched → spread in the gap between matched neighbours.
  const times: { s: number; e: number; matched: boolean }[] = new Array(tokens.length);
  for (let i = 0; i < tokens.length; ) {
    if (match[i] >= 0) {
      const w = heard[match[i]];
      times[i] = { s: w.start, e: w.end, matched: true };
      i++;
      continue;
    }
    let k = i;
    while (k < tokens.length && match[k] < 0) k++;
    const from = i > 0 ? times[i - 1].e : (heard[0]?.start ?? 0);
    const to = k < tokens.length ? heard[match[k]].start : Math.max(from, heard.at(-1)!.end);
    const step = Math.max(0.01, to - from) / (k - i);
    for (let m = i; m < k; m++) times[m] = { s: from + (m - i) * step, e: from + (m - i + 1) * step, matched: false };
    i = k;
  }

  const timings: Record<string, BeatTiming> = {};
  const perBeat = beats.map((b, i) => {
    const idx = tokens.map((t, k) => (t.beat === i ? k : -1)).filter((k) => k >= 0);
    const m = idx.filter((k) => times[k].matched).length;
    return { beat: b, idx, ratio: idx.length ? m / idx.length : 1 };
  });
  const starts = perBeat.map((p) => (p.idx.length ? times[p.idx[0]].s : undefined));
  // A beat with no tokens starts where the previous one ended.
  for (let i = 0; i < starts.length; i++) if (starts[i] === undefined) starts[i] = i > 0 ? (starts[i - 1] ?? 0) : 0;
  const outOfOrder: string[] = [];
  perBeat.forEach((p, i) => {
    const start = Math.max(0, i === 0 ? Math.min(starts[0]!, times[p.idx[0]]?.s ?? 0) : starts[i]!);
    const nextStart = i + 1 < starts.length ? starts[i + 1]! : duration;
    const lastEnd = p.idx.length ? times[p.idx.at(-1)!].e : start;
    const end = Math.min(Math.max(lastEnd, start), nextStart);
    const cut = i + 1 < starts.length ? Math.max(end, nextStart - CUT_GAP) : duration;
    if (i > 0 && starts[i]! < starts[i - 1]!) outOfOrder.push(p.beat.id);
    timings[p.beat.id] = {
      start: round(start),
      end: round(end),
      cut: round(cut),
      words: p.idx.map((k) => ({ t: tokens[k].t, s: round(times[k].s), e: round(times[k].e) })),
    };
  });
  const worst = [...perBeat].sort((a, b) => a.ratio - b.ratio)[0];
  const ok = ratio >= MATCH_FAIL && !outOfOrder.length;
  return {
    ratio: round(ratio, 4),
    timings,
    outOfOrder,
    worst: worst ? { beatId: worst.beat.id, ratio: round(worst.ratio, 3), text: worst.beat.text.slice(0, 160) } : undefined,
    ok,
    error: !ok
      ? outOfOrder.length
        ? `Ordem das falas no áudio diferente do roteiro (${outOfOrder.join(", ")}).`
        : `Casamento de ${Math.round(ratio * 1000) / 10}% (mínimo ${MATCH_FAIL * 100}%). Pior trecho: ${worst?.beat.id} "${worst?.beat.text.slice(0, 80)}".`
      : undefined,
  };
}

const round = (n: number, d = 3) => Math.round(n * 10 ** d) / 10 ** d;

/** Final check (spec QA "Palavra cortada"): transcript of the final audio vs script, ratio ≥ 0.97 and no word deleted. */
export function wordCheck(beats: Pick<Beat, "id" | "text" | "say">[], transcript: TimedWord[]) {
  const tokens = beats.flatMap((b) => spokenTokens(b.say ?? b.text));
  const heard = expandTranscript(transcript).map((w) => w.text);
  const match = lcsMatch(tokens, heard);
  const missing = tokens.filter((_, i) => match[i] < 0);
  return { ratio: tokens.length ? (tokens.length - missing.length) / tokens.length : 1, missing };
}

// ---------- transcribers ----------

/** ElevenLabs Scribe (speech-to-text with word timestamps), with the user's key. */
export function scribeTranscriber(apiKey: string, options: { modelId?: string; fetch?: (u: string, i?: RequestInit) => Promise<Response>; readFile?: (f: string) => Promise<Uint8Array> } = {}): Transcriber {
  return async (file, opts) => {
    const read = options.readFile ?? (async (f: string) => new Uint8Array(await (await import("node:fs/promises")).readFile(f)));
    const form = new FormData();
    form.set("model_id", options.modelId ?? "scribe_v1");
    form.set("timestamps_granularity", "word");
    if (opts.language) form.set("language_code", opts.language.startsWith("pt") ? "por" : opts.language.slice(0, 2));
    form.set("file", new Blob([new Uint8Array(await read(file))]), file.split(/[\\/]/).pop() ?? "audio.wav");
    const res = await (options.fetch ?? fetch)("https://api.elevenlabs.io/v1/speech-to-text", { method: "POST", headers: { "xi-api-key": apiKey }, body: form, signal: opts.signal });
    if (res.status === 401) throw Object.assign(new Error("ElevenLabs: chave recusada para o Scribe."), { code: "ALIGN_AUTH" });
    if (!res.ok) throw Object.assign(new Error(`Scribe respondeu ${res.status}.`), { code: "ALIGN_FAILED" });
    const body = (await res.json()) as { words?: { text: string; start: number; end: number; type?: string }[] };
    return (body.words ?? []).filter((w) => (w.type ?? "word") === "word" && w.text.trim()).map((w) => ({ text: w.text.trim(), start: w.start, end: w.end }));
  };
}

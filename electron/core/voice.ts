import type { AudioWord } from "../../src/shared/types";

export const VOICE_PROVIDERS = ["elevenlabs", "openai", "kokoro", "local"] as const;
export type VoiceProvider = (typeof VOICE_PROVIDERS)[number];

export interface VoiceOption {
  id: string;
  name: string;
  provider: VoiceProvider;
  language?: string;
  description?: string;
  preview?: string;
}

export interface SpeechResult {
  audio: Uint8Array;
  extension: "mp3" | "wav";
  /** Word timings in file seconds, when the provider returns them. */
  words?: AudioWord[];
}

const fail = (message: string): never => {
  throw new Error(message);
};

async function request(url: string, init: RequestInit, label: string) {
  const response = await fetch(url, init);
  if (response.ok) return response;
  let detail = "";
  try {
    const body = (await response.json()) as {
      detail?: { message?: string } | string;
      error?: { message?: string };
    };
    detail =
      (typeof body.detail === "string" ? body.detail : body.detail?.message) ||
      body.error?.message ||
      "";
  } catch {
    /* Body was not JSON. */
  }
  if (response.status === 401)
    fail(`${label}: chave de API recusada. Confira a chave em Vozes.`);
  if (response.status === 429)
    fail(`${label}: limite ou créditos da conta esgotados.`);
  return fail(`${label} respondeu ${response.status}${detail ? `: ${detail}` : "."}`);
}

/** Groups per-character timings (ElevenLabs alignment) into words. */
export function wordsFromCharacters(
  characters: string[],
  starts: number[],
  ends: number[],
): AudioWord[] {
  const words: AudioWord[] = [];
  let current: AudioWord | undefined;
  characters.forEach((char, i) => {
    if (/\s/.test(char)) {
      if (current) words.push(current);
      current = undefined;
      return;
    }
    if (!current) current = { text: char, start: starts[i], end: ends[i] };
    else {
      current.text += char;
      current.end = ends[i];
    }
  });
  if (current) words.push(current);
  return words
    .map((w) => ({ ...w, end: Math.max(w.end, w.start + 0.02) }))
    .filter((w) => /[\p{L}\p{N}]/u.test(w.text));
}

const normalize = (word: string) =>
  word
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}]/gu, "");

/**
 * Keeps the script's spelling with the recognizer's timing. Script words the recognizer
 * missed are spread inside the gap between their recognized neighbours.
 */
export function alignScript(script: string, recognized: AudioWord[]): AudioWord[] {
  const tokens = script.split(/\s+/).filter((t) => /[\p{L}\p{N}]/u.test(t));
  if (!tokens.length || !recognized.length) return [];
  const a = tokens.map(normalize),
    b = recognized.map((w) => normalize(w.text));
  // Longest common subsequence on normalized words (scripts are short: a few hundred words).
  const rows = a.length + 1,
    cols = b.length + 1,
    table = new Uint16Array(rows * cols);
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      table[i * cols + j] =
        a[i] && a[i] === b[j]
          ? table[(i + 1) * cols + j + 1] + 1
          : Math.max(table[(i + 1) * cols + j], table[i * cols + j + 1]);
  const match = new Array<number>(a.length).fill(-1);
  for (let i = 0, j = 0; i < a.length && j < b.length; ) {
    if (a[i] && a[i] === b[j]) {
      match[i] = j;
      i++;
      j++;
    } else if (table[(i + 1) * cols + j] >= table[i * cols + j + 1]) i++;
    else j++;
  }
  const result: AudioWord[] = [];
  for (let i = 0; i < tokens.length; ) {
    if (match[i] >= 0) {
      const w = recognized[match[i]];
      result.push({ text: tokens[i], start: w.start, end: w.end });
      i++;
      continue;
    }
    let k = i;
    while (k < tokens.length && match[k] < 0) k++;
    const from = result.at(-1)?.end ?? recognized[0].start,
      to = k < tokens.length ? recognized[match[k]].start : recognized.at(-1)!.end;
    const span = Math.max(0.05 * (k - i), to - from),
      step = span / (k - i);
    for (let m = i; m < k; m++)
      result.push({
        text: tokens[m],
        start: from + (m - i) * step,
        end: from + (m - i + 1) * step,
      });
    i = k;
  }
  return result;
}

export async function elevenLabsVoices(apiKey: string): Promise<VoiceOption[]> {
  const response = await request(
    "https://api.elevenlabs.io/v2/voices?page_size=100",
    { headers: { "xi-api-key": apiKey } },
    "ElevenLabs",
  );
  const body = (await response.json()) as {
    voices?: {
      voice_id: string;
      name: string;
      description?: string;
      preview_url?: string;
      labels?: Record<string, string>;
    }[];
  };
  return (body.voices ?? []).map((v) => ({
    id: v.voice_id,
    name: v.name,
    provider: "elevenlabs",
    language: v.labels?.language,
    description: v.description || Object.values(v.labels ?? {}).join(", "),
    preview: v.preview_url,
  }));
}

export async function elevenLabsSpeech(options: {
  apiKey: string;
  voiceId: string;
  text: string;
  modelId?: string;
  signal?: AbortSignal;
}): Promise<SpeechResult> {
  const response = await request(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(options.voiceId)}/with-timestamps?output_format=mp3_44100_128`,
    {
      method: "POST",
      signal: options.signal,
      headers: { "xi-api-key": options.apiKey, "content-type": "application/json" },
      body: JSON.stringify({
        text: options.text,
        model_id: options.modelId ?? "eleven_multilingual_v2",
      }),
    },
    "ElevenLabs",
  );
  const body = (await response.json()) as {
    audio_base64?: string;
    alignment?: {
      characters: string[];
      character_start_times_seconds: number[];
      character_end_times_seconds: number[];
    };
  };
  if (!body.audio_base64) fail("A ElevenLabs não devolveu o áudio.");
  const a = body.alignment;
  return {
    audio: Buffer.from(body.audio_base64!, "base64"),
    extension: "mp3",
    words: a
      ? wordsFromCharacters(
          a.characters,
          a.character_start_times_seconds,
          a.character_end_times_seconds,
        )
      : undefined,
  };
}

export const OPENAI_VOICES = [
  "alloy",
  "ash",
  "ballad",
  "coral",
  "echo",
  "fable",
  "nova",
  "onyx",
  "sage",
  "shimmer",
  "verse",
];

export async function openAiSpeech(options: {
  apiKey: string;
  voice: string;
  text: string;
  model?: string;
  instructions?: string;
  signal?: AbortSignal;
}): Promise<SpeechResult> {
  const response = await request(
    "https://api.openai.com/v1/audio/speech",
    {
      method: "POST",
      signal: options.signal,
      headers: {
        authorization: `Bearer ${options.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: options.model ?? "gpt-4o-mini-tts",
        voice: options.voice,
        input: options.text,
        ...(options.instructions ? { instructions: options.instructions } : {}),
        response_format: "mp3",
      }),
    },
    "OpenAI",
  );
  return { audio: new Uint8Array(await response.arrayBuffer()), extension: "mp3" };
}

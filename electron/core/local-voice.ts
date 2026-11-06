import { randomUUID } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AudioWord } from "../../src/shared/types";
import { runProcess } from "./process";
import type { SpeechResult, VoiceOption } from "./voice";

/**
 * Offline narration with the voices the operating system already has: no download.
 * Windows: SAPI (System.Speech) with exact word timings from SpeakProgress.
 * macOS: `say`, aligned afterwards by the local transcription when available.
 */
const WINDOWS_LIST = `[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$s.GetInstalledVoices() | Where-Object { $_.Enabled } | ForEach-Object { [pscustomobject]@{ id = $_.VoiceInfo.Name; culture = $_.VoiceInfo.Culture.Name; gender = "$($_.VoiceInfo.Gender)" } } | ConvertTo-Json -Compress`;

const WINDOWS_SPEAK = `param([string]$TextFile, [string]$OutFile, [string]$Voice)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -AssemblyName System.Speech
$text = [IO.File]::ReadAllText($TextFile, [Text.Encoding]::UTF8)
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
if ($Voice) { $s.SelectVoice($Voice) }
$s.Rate = 1
$script:words = New-Object System.Collections.ArrayList
$s.add_SpeakProgress({ param($sender, $e) [void]$script:words.Add(@{ t = $e.Text; at = $e.AudioPosition.TotalSeconds; pos = $e.CharacterPosition; len = $e.CharacterCount }) })
# AudioPosition is only consistent with the file at 16 kHz (the default 22 kHz file drifts ~35%).
$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
$s.SetOutputToWaveFile($OutFile, $fmt)
$s.Speak($text)
$s.Dispose()
$script:words | ConvertTo-Json -Compress`;

async function powershell(script: string, args: string[], signal?: AbortSignal) {
  const file = join(process.env.TEMP ?? ".", `cutroom-voice-${randomUUID()}.ps1`);
  // UTF-8 with BOM so Windows PowerShell 5.1 reads accented text in the script correctly.
  await writeFile(file, `﻿${script}`, "utf8");
  try {
    return await runProcess(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", file, ...args],
      { signal },
    );
  } finally {
    await rm(file, { force: true });
  }
}

export async function localVoices(): Promise<VoiceOption[]> {
  if (process.platform === "win32") {
    const raw = JSON.parse((await powershell(WINDOWS_LIST, [])) || "[]");
    const list = (Array.isArray(raw) ? raw : [raw]) as { id: string; culture: string; gender: string }[];
    return list
      .map((v) => ({ id: v.id, name: v.id.replace(/^Microsoft /, "").replace(/ Desktop$/, ""), provider: "local" as const, language: v.culture, description: v.gender }))
      .sort((a, b) => Number(b.language?.startsWith("pt")) - Number(a.language?.startsWith("pt")));
  }
  if (process.platform === "darwin") {
    const out = await runProcess("say", ["-v", "?"]);
    return out
      .split("\n")
      .map((line) => /^(.+?)\s{2,}([a-z]{2}[_-][A-Z]{2})/.exec(line))
      .filter((m): m is RegExpExecArray => !!m)
      .map((m) => ({ id: m[1].trim(), name: m[1].trim(), provider: "local" as const, language: m[2].replace("_", "-") }))
      .sort((a, b) => Number(b.language.startsWith("pt")) - Number(a.language.startsWith("pt")));
  }
  return [];
}

/** SAPI reports each word's start; a word ends where the next starts (or at the file end). */
export function sapiWords(events: { t: string; at: number }[], fileDuration: number): AudioWord[] {
  return events
    .filter((e) => /[\p{L}\p{N}]/u.test(e.t))
    .map((e, i, all) => ({
      text: e.t,
      start: e.at,
      end: Math.min(fileDuration, Math.max(e.at + 0.05, (all[i + 1]?.at ?? fileDuration) - 0.02)),
    }));
}

export async function localSpeech(
  text: string,
  voice: string | undefined,
  signal: AbortSignal,
  dir: string,
  probe: (path: string) => Promise<number>,
): Promise<SpeechResult> {
  const id = randomUUID();
  if (process.platform === "win32") {
    const textFile = join(dir, `${id}.txt`),
      out = join(dir, `${id}.wav`);
    await writeFile(textFile, text, "utf8");
    try {
      const raw = (await powershell(WINDOWS_SPEAK, [textFile, out, voice ?? ""], signal)).trim();
      const parsed = raw ? JSON.parse(raw) : [];
      const events = (Array.isArray(parsed) ? parsed : [parsed]) as { t: string; at: number }[];
      const audio = await readFile(out);
      return { audio, extension: "wav", words: sapiWords(events, await probe(out)) };
    } finally {
      await rm(textFile, { force: true });
      await rm(out, { force: true });
    }
  }
  if (process.platform === "darwin") {
    const out = join(dir, `${id}.aiff`),
      wav = join(dir, `${id}.wav`);
    await runProcess("say", [...(voice ? ["-v", voice] : []), "-o", out, "--", text], { signal });
    await runProcess(
      (await import("./media")).ffmpegPath,
      ["-hide_banner", "-loglevel", "error", "-y", "-i", out, wav],
      { signal },
    );
    const audio = await readFile(wav);
    await rm(out, { force: true });
    await rm(wav, { force: true });
    return { audio, extension: "wav" };
  }
  throw new Error("A voz local está disponível no Windows e no Mac.");
}

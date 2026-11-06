import type { AudioTrack, AudioWord, Project } from "../../src/shared/types";
import { AUDIO_KINDS } from "../../src/shared/audio";

const fail = (message: string): never => {
  throw new Error(message);
};
const num = (v: unknown, label: string, min: number, max: number): number =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max
    ? v
    : fail(`${label} inválido.`);
const text = (v: unknown, label: string, max: number) =>
  typeof v === "string" && v.length > 0 && v.length <= max
    ? v
    : fail(`${label} inválido.`);
const n = (v: number) => Number(v.toFixed(6)).toString();

export const MAX_AUDIO_TRACKS = 40;
const SOURCE_KEYS = ["provider", "title", "author", "license", "url", "voice"];

export function validateAudioTrack(raw: unknown, timeline: number): AudioTrack {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    fail("Faixa de áudio inválida.");
  const t = raw as Record<string, unknown>;
  text(t.id, "ID da faixa", 200);
  text(t.name, "Nome da faixa", 300);
  text(t.path, "Arquivo da faixa", 32768);
  if (!AUDIO_KINDS.includes(t.kind as AudioTrack["kind"]))
    fail("Tipo de faixa inválido: use voice, music ou sfx.");
  const fileDuration = num(t.fileDuration, "Duração do arquivo", 0.01, 7 * 86400);
  const start = num(t.start, "Início da faixa", 0, Math.max(0, timeline));
  const offset = num(t.offset ?? 0, "Corte inicial da faixa", 0, fileDuration);
  const duration = num(t.duration, "Duração da faixa", 0.01, 7 * 86400);
  if (!t.loop && offset + duration > fileDuration + 0.01)
    fail("A faixa passa do fim do arquivo. Use loop ou uma duração menor.");
  if (t.gain !== undefined) num(t.gain, "Volume da faixa", -60, 20);
  for (const key of ["fadeIn", "fadeOut"])
    if (t[key] !== undefined) num(t[key], "Fade", 0, duration / 2 + 0.001);
  for (const key of ["loop", "duck"])
    if (t[key] !== undefined && typeof t[key] !== "boolean")
      fail("Opção de faixa inválida.");
  if (t.words !== undefined) {
    if (!Array.isArray(t.words) || t.words.length > 100000)
      fail("Palavras da narração inválidas.");
    for (const w of t.words as AudioWord[]) {
      text(w?.text, "Palavra", 1000);
      const ws = num(w.start, "Início da palavra", 0, fileDuration + 0.01);
      if (num(w.end, "Fim da palavra", 0, fileDuration + 0.05) <= ws)
        fail("Tempo de palavra inválido.");
    }
  }
  if (t.source !== undefined) {
    if (!t.source || typeof t.source !== "object" || Array.isArray(t.source))
      fail("Origem da faixa inválida.");
    for (const [key, value] of Object.entries(t.source as object))
      if (!SOURCE_KEYS.includes(key) || typeof value !== "string" || value.length > 2000)
        fail("Origem da faixa inválida.");
  }
  return t as unknown as AudioTrack;
}

/** Merges `args` into an existing track (args.id) or builds a new one. File facts come from the caller. */
export function makeAudioTrack(
  project: Project,
  args: Record<string, unknown>,
  newId: string,
  timeline: number,
): AudioTrack {
  const previous = args.id
    ? ((project.audio ?? []).find((t) => t.id === args.id) ??
      fail("Faixa de áudio não encontrada."))
    : undefined;
  const merged: Record<string, unknown> = { ...previous, ...args, id: previous?.id ?? newId };
  if (merged.duration === undefined) {
    const file = num(merged.fileDuration, "Duração do arquivo", 0.01, 7 * 86400);
    const offset = (merged.offset as number | undefined) ?? 0;
    // Looped music fills the rest of the timeline by default; other tracks play the file once.
    merged.duration = merged.loop
      ? Math.max(0.01, timeline - ((merged.start as number) ?? 0))
      : file - offset;
  }
  merged.start ??= 0;
  if (merged.kind === "music") merged.duck ??= true;
  return validateAudioTrack(merged, timeline);
}

/**
 * FFmpeg graph that mixes clip audio (input 0) with every track (inputs 1..n, in order).
 * Music ducks under voice and clip audio with a sidechain compressor. Output label [mix],
 * exactly `length` seconds, 48 kHz stereo.
 */
export function audioMixGraph(tracks: AudioTrack[], length: number): string {
  const lines: string[] = [
    `[0:a:0]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,apad,atrim=duration=${n(length)},asetpts=PTS-STARTPTS[base]`,
  ];
  const voices: string[] = ["base"],
    music: string[] = [],
    effects: string[] = [];
  tracks.forEach((track, index) => {
    const label = `t${index}`,
      delay = Math.round(track.start * 1000),
      fadeIn = track.fadeIn ?? 0,
      fadeOut = track.fadeOut ?? 0;
    const chain = [
      `atrim=start=${n(track.offset ?? 0)}:duration=${n(track.duration)}`,
      "asetpts=PTS-STARTPTS",
      "aresample=48000",
      "aformat=sample_fmts=fltp:channel_layouts=stereo",
      `volume=${n(track.gain ?? 0)}dB`,
      ...(fadeIn > 0 ? [`afade=t=in:st=0:d=${n(fadeIn)}`] : []),
      ...(fadeOut > 0
        ? [`afade=t=out:st=${n(Math.max(0, track.duration - fadeOut))}:d=${n(fadeOut)}`]
        : []),
      ...(delay > 0 ? [`adelay=${delay}|${delay}`] : []),
      "apad",
      `atrim=duration=${n(length)}`,
    ];
    lines.push(`[${index + 1}:a:0]${chain.join(",")}[${label}]`);
    (track.kind === "voice" ? voices : track.kind === "music" ? music : effects).push(label);
  });
  const sum = (labels: string[], out: string) =>
    labels.length === 1
      ? `[${labels[0]}]anull[${out}]`
      : `${labels.map((l) => `[${l}]`).join("")}amix=inputs=${labels.length}:duration=first:dropout_transition=0:normalize=0[${out}]`;
  lines.push(sum(voices, "speech"));
  const finalInputs = ["speechmain"];
  if (music.length) {
    lines.push(`[speech]asplit=2[speechmain][speechkey]`);
    const ducked = tracks.some((t) => t.kind === "music" && t.duck !== false);
    lines.push(sum(music, "musicsum"));
    if (ducked)
      lines.push(
        `[musicsum][speechkey]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=350:makeup=1[musicout]`,
      );
    else lines.push(`[speechkey]anullsink`, `[musicsum]anull[musicout]`);
    finalInputs.push("musicout");
  } else lines.push(`[speech]anull[speechmain]`);
  if (effects.length) {
    lines.push(sum(effects, "sfxsum"));
    finalInputs.push("sfxsum");
  }
  // asetpts after amix: FFmpeg 8 can emit broken audio timestamps from amix otherwise.
  lines.push(
    sum(finalInputs, "mixed"),
    `[mixed]atrim=duration=${n(length)},asetpts=N/SR/TB[mix]`,
  );
  return lines.join(";\n");
}

/** Input arguments for the track files (loops repeat the file). */
/**
 * FFmpeg inputs for the tracks. A looped track is an infinite input: it is also bounded with -t
 * (offset + timeline length) so FFmpeg always ends, whatever the platform build does with atrim.
 */
export function audioMixInputs(tracks: AudioTrack[], length?: number): string[] {
  return tracks.flatMap((t) => [
    ...(t.loop ? ["-stream_loop", "-1", ...(length ? ["-t", (length + (t.offset ?? 0) + 1).toFixed(3)] : [])] : []),
    "-i",
    t.path,
  ]);
}

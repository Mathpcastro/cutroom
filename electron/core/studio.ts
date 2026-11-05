import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { z } from "zod";
import type { AudioTrack, AudioWord, EditCommand, Media, Project, Word } from "../../src/shared/types";
import { voiceTimelineWords } from "../../src/shared/audio";
import { ffmpegPath, ffprobePath } from "./media";
import { runProcess } from "./process";
import type { SecretStore } from "./secrets";
import type { BrandStore } from "./brand";
import {
  OPENAI_VOICES,
  VOICE_PROVIDERS,
  alignScript,
  elevenLabsSpeech,
  elevenLabsVoices,
  openAiSpeech,
  type SpeechResult,
  type VoiceOption,
  type VoiceProvider,
} from "./voice";
import { musicDetails, searchMusic } from "./music";
import { FORMATS, formatGuide } from "./formats";

export const AUDIO_EXTENSIONS = [".mp3", ".wav", ".m4a", ".aac", ".ogg", ".opus", ".flac"];
const PREVIEW_WAIT_MS = 40_000;
export const VOICE_KEYS = { elevenlabs: "voice.elevenlabs", openai: "voice.openai" } as const;

type Progress = (value: number, label?: string) => void;
export interface StudioHost {
  project(): Project;
  command(command: EditCommand): Promise<void>;
  job<T>(kind: string, label: string, run: (signal: AbortSignal, progress: Progress) => Promise<T>): Promise<T>;
  allowFile(path: string): Promise<void>;
  cacheDir: string;
  userDir: string;
  secrets: SecretStore;
  brand: BrandStore;
  /** Local Faster Whisper on an arbitrary audio file (throws when the package is missing). */
  transcribeFile(media: Media, signal: AbortSignal, progress: (v: number) => void): Promise<Word[]>;
  /** Render scenes + export the project to `output` (no dialog). */
  exportTo(project: Project, output: string, signal: AbortSignal, progress: Progress): Promise<void>;
  /** Local text-to-speech, when the offline voice package is installed. */
  localSpeech?(text: string, voice: string | undefined, signal: AbortSignal): Promise<SpeechResult>;
  localVoices?(): Promise<VoiceOption[]>;
}

export interface VoicePreferences {
  provider?: VoiceProvider;
  voices?: Partial<Record<VoiceProvider, string>>;
}

export async function probeAudio(path: string, signal?: AbortSignal) {
  const output = await runProcess(
    ffprobePath,
    ["-v", "error", "-show_entries", "format=duration:stream=codec_type", "-of", "json", path],
    { signal },
  );
  const info = JSON.parse(output) as { format?: { duration?: string }; streams?: { codec_type: string }[] };
  const duration = Number(info.format?.duration);
  if (!info.streams?.some((s) => s.codec_type === "audio") || !Number.isFinite(duration) || duration <= 0)
    throw new Error("O arquivo não tem uma faixa de áudio válida.");
  return duration;
}

export class Studio {
  constructor(private host: StudioHost) {}

  private prefsFile() {
    return join(this.host.userDir, "voice.json");
  }
  async voicePreferences(): Promise<VoicePreferences> {
    try {
      return JSON.parse(await readFile(this.prefsFile(), "utf8"));
    } catch {
      return {};
    }
  }
  async setVoicePreferences(value: unknown) {
    const prefs = z
      .object({
        provider: z.enum(VOICE_PROVIDERS).optional(),
        voices: z.record(z.enum(VOICE_PROVIDERS), z.string().max(200)).optional(),
      })
      .strict()
      .parse(value);
    const next = { ...(await this.voicePreferences()), ...prefs };
    await writeFile(this.prefsFile(), JSON.stringify(next, null, 2), "utf8");
    return next;
  }
  /** Settings summary for the renderer: never the keys themselves. */
  async voiceSettings() {
    return {
      keys: await this.host.secrets.describe(Object.values(VOICE_KEYS)),
      preferences: await this.voicePreferences(),
      localAvailable: !!this.host.localSpeech,
    };
  }
  async setVoiceKey(provider: string, key: string | undefined) {
    const name = VOICE_KEYS[provider as keyof typeof VOICE_KEYS] ?? (() => {
      throw new Error("Provedor de voz sem chave.");
    })();
    await this.host.secrets.set(name, key?.trim() || undefined);
    return this.voiceSettings();
  }

  private async key(provider: "elevenlabs" | "openai") {
    const key = await this.host.secrets.get(VOICE_KEYS[provider]);
    if (!key)
      throw new Error(
        `Cadastre a chave da ${provider === "elevenlabs" ? "ElevenLabs" : "OpenAI"} em Vozes, no CutRoom. Não envie a chave pelo chat.`,
      );
    return key;
  }

  async addAudio(args: Record<string, unknown>, source?: AudioTrack["source"]) {
    const a = z
      .object({
        path: z.string().min(1).max(32768),
        kind: z.enum(["voice", "music", "sfx"]),
        name: z.string().max(300).optional(),
        start: z.number().min(0).optional(),
        offset: z.number().min(0).optional(),
        duration: z.number().positive().optional(),
        gain: z.number().min(-60).max(20).optional(),
        fadeIn: z.number().min(0).optional(),
        fadeOut: z.number().min(0).optional(),
        loop: z.boolean().optional(),
        duck: z.boolean().optional(),
        words: z.array(z.object({ text: z.string(), start: z.number(), end: z.number() })).optional(),
      })
      .strict()
      .parse(args);
    if (!AUDIO_EXTENSIONS.includes(extname(a.path).toLowerCase()))
      throw new Error(`Formato de áudio não aceito. Use ${AUDIO_EXTENSIONS.join(", ")}.`);
    await stat(a.path);
    const fileDuration = await probeAudio(a.path);
    await this.host.allowFile(a.path);
    const before = new Set((this.host.project().audio ?? []).map((t) => t.id));
    await this.host.command({
      name: "audio",
      args: {
        ...a,
        name: a.name ?? (a.kind === "voice" ? "Narração" : a.kind === "music" ? "Música" : "Efeito"),
        fileDuration,
        ...(source ? { source } : {}),
      },
    });
    const track = (this.host.project().audio ?? []).find((t) => !before.has(t.id))!;
    return { track: { ...track, words: undefined }, words: track.words?.length ?? 0 };
  }

  async listVoices(provider?: VoiceProvider) {
    const prefs = await this.voicePreferences();
    const chosen = provider ?? prefs.provider ?? "elevenlabs";
    const configured = await this.host.secrets.describe(Object.values(VOICE_KEYS));
    let voices: VoiceOption[] = [];
    if (chosen === "elevenlabs") voices = await elevenLabsVoices(await this.key("elevenlabs"));
    else if (chosen === "openai") {
      await this.key("openai");
      voices = OPENAI_VOICES.map((id) => ({ id, name: id, provider: "openai" as const, language: "multilíngue" }));
    } else {
      if (!this.host.localVoices)
        throw new Error("A voz local está disponível no Windows e no Mac.");
      voices = await this.host.localVoices();
    }
    return {
      provider: chosen,
      defaultVoice: prefs.voices?.[chosen],
      configured: {
        elevenlabs: !!configured[VOICE_KEYS.elevenlabs],
        openai: !!configured[VOICE_KEYS.openai],
        local: !!this.host.localSpeech,
      },
      voices,
    };
  }

  async addVoiceover(args: Record<string, unknown>) {
    const a = z
      .object({
        text: z.string().trim().min(1).max(5000),
        provider: z.enum(VOICE_PROVIDERS).optional(),
        voice: z.string().max(200).optional(),
        model: z.string().max(100).optional(),
        instructions: z.string().max(1000).optional(),
        start: z.number().min(0).optional(),
        gain: z.number().min(-60).max(20).optional(),
        name: z.string().max(300).optional(),
      })
      .strict()
      .parse(args);
    const prefs = await this.voicePreferences();
    const provider = a.provider ?? prefs.provider ?? "elevenlabs";
    const voice = a.voice ?? prefs.voices?.[provider] ?? (provider === "openai" ? "coral" : undefined);
    if (!voice && provider === "elevenlabs")
      throw new Error("Escolha uma voz: chame list_voices e passe o id em voice, ou defina a voz padrão em Vozes.");
    const key = createHash("sha256")
      .update(JSON.stringify(["voice-2", provider, voice, a.model, a.instructions, a.text]))
      .digest("hex")
      .slice(0, 32);
    const dir = join(this.host.cacheDir, "voice");
    await mkdir(dir, { recursive: true });
    const meta = join(dir, `${key}.json`);
    let file: string, words: AudioWord[] | undefined;
    try {
      // Same script + voice = same audio: never pay the provider twice.
      ({ file, words } = JSON.parse(await readFile(meta, "utf8")));
      await stat(file);
    } catch {
      const result = await this.host.job("voice", "Gerando a narração…", async (signal, progress) => {
        progress(10, "Gerando a narração…");
        const speech =
          provider === "elevenlabs"
            ? await elevenLabsSpeech({ apiKey: await this.key("elevenlabs"), voiceId: voice!, text: a.text, modelId: a.model, signal })
            : provider === "openai"
              ? await openAiSpeech({ apiKey: await this.key("openai"), voice: voice!, text: a.text, model: a.model, instructions: a.instructions, signal })
              : await (this.host.localSpeech ??
                  (() => {
                    throw new Error("A voz local está disponível no Windows e no Mac.");
                  }))(a.text, voice, signal);
        const out = join(dir, `${key}.${speech.extension}`);
        await writeFile(out, speech.audio);
        let timings = speech.words;
        if (!timings?.length) {
          progress(60, "Sincronizando as palavras…");
          const duration = await probeAudio(out, signal);
          const recognized = await this.host.transcribeFile(
            { id: `voice-${key}`, name: "Narração", path: out, duration, width: 1, height: 1, fps: 1, hasAudio: true },
            signal,
            (v) => progress(60 + v * 0.35),
          );
          timings = alignScript(a.text, recognized);
        }
        return { file: out, words: timings };
      });
      file = result.file;
      words = result.words;
      await writeFile(meta, JSON.stringify({ file, words }), "utf8");
    }
    const added = await this.addAudio(
      {
        path: file,
        kind: "voice",
        name: a.name ?? "Narração",
        ...(a.start !== undefined ? { start: a.start } : {}),
        ...(a.gain !== undefined ? { gain: a.gain } : {}),
        ...(words?.length ? { words } : {}),
      },
      { provider, voice, ...(a.model ? { title: a.model } : {}) },
    );
    const project = this.host.project();
    return {
      ...added,
      timelineWords: voiceTimelineWords(project)
        .filter((w) => w.mediaId === added.track.id)
        .map(({ text, start, end }) => ({ text, start: +start.toFixed(3), end: +end.toFixed(3) })),
    };
  }

  searchMusic(args: Record<string, unknown>) {
    const a = z
      .object({ query: z.string().trim().min(1).max(200), kind: z.enum(["music", "sfx"]).optional(), limit: z.number().int().min(1).max(30).optional() })
      .strict()
      .parse(args);
    return searchMusic(a).then((results) => ({ results }));
  }

  async addMusic(args: Record<string, unknown>) {
    const { id, kind = "music", ...placement } = z
      .object({
        id: z.string(),
        kind: z.enum(["music", "sfx"]).optional(),
        start: z.number().min(0).optional(),
        offset: z.number().min(0).optional(),
        duration: z.number().positive().optional(),
        gain: z.number().min(-60).max(20).optional(),
        fadeIn: z.number().min(0).optional(),
        fadeOut: z.number().min(0).optional(),
        loop: z.boolean().optional(),
      })
      .strict()
      .parse(args);
    const item = await musicDetails(id);
    const dir = join(this.host.cacheDir, "music");
    await mkdir(dir, { recursive: true });
    const file = join(dir, `${id}.mp3`);
    try {
      await stat(file);
    } catch {
      await this.host.job("music", `Baixando ${item.title}…`, async (signal) => {
        const response = await fetch(item.url, { signal, headers: { "user-agent": "CutRoom (video editor)" } });
        if (!response.ok) throw new Error(`Não foi possível baixar a faixa (${response.status}).`);
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.length > 60_000_000) throw new Error("Faixa grande demais.");
        const partial = `${file}.partial`;
        await writeFile(partial, bytes);
        await probeAudio(partial, signal).catch(async (error) => {
          await rm(partial, { force: true });
          throw error;
        });
        await writeFile(file, bytes);
        await rm(partial, { force: true });
      });
    }
    return this.addAudio(
      { path: file, kind, name: item.title, ...(kind === "music" ? { gain: -16, loop: true } : {}), ...placement },
      {
        provider: `openverse/${item.source}`,
        title: item.title,
        author: item.creator,
        license: item.license,
        url: item.page ?? item.url,
      },
    ).then((added) => ({ ...added, attribution: item.attribution || undefined }));
  }

  async getBrand() {
    const brand = await this.host.brand.get();
    if (!brand)
      return {
        configured: false,
        message: "A marca ainda não foi configurada. Peça ao usuário para abrir Marca no CutRoom (importar do Carrossell ou preencher à mão).",
      };
    return { configured: true, ...brand, logo: brand.logo ? "(disponível: use <img data-asset=\"logo\">)" : undefined };
  }

  listFormats() {
    return { formats: FORMATS.map(({ guide: _guide, checklist: _checklist, ...summary }) => summary) };
  }
  getFormatGuide(args: Record<string, unknown>) {
    const { id } = z.object({ id: z.string() }).strict().parse(args);
    return formatGuide(id);
  }

  private pending?: { key: string; done: Promise<string>; progress: number; label: string };
  /**
   * The final-look render used by render_frame/review_video, cached per project state.
   * Rendering a 60 s reel takes minutes and MCP clients cut tool calls at ~60 s (Codex), so the
   * render keeps running in the background: callers get `undefined` and ask again.
   */
  private async previewExport(): Promise<{ file: string; project: Project } | undefined> {
    const project = this.host.project();
    if (!project.clips.length) throw new Error("A timeline está vazia.");
    const brand = await this.host.brand.get();
    const key = createHash("sha256").update(JSON.stringify([project, brand?.logo ?? ""])).digest("hex");
    const dir = join(this.host.cacheDir, "review");
    await mkdir(dir, { recursive: true });
    const file = join(dir, `${key}.mp4`);
    try {
      if ((await stat(file)).size > 0) return { file, project };
    } catch {
      /* Not rendered yet. */
    }
    if (this.pending?.key !== key) {
      const pending = { key, progress: 0, label: "Renderizando cenas…", done: Promise.resolve("") };
      pending.done = this.host
        .job("review", "Renderizando a prévia final…", async (signal, progress) => {
          await this.host.exportTo(project, file, signal, (value, label) => {
            pending.progress = value;
            if (label) pending.label = label;
            progress(value, label);
          });
          return file;
        })
        .finally(() => {
          if (this.pending === pending) this.pending = undefined;
        });
      pending.done.catch(() => undefined);
      this.pending = pending;
    }
    const current = this.pending!;
    const finished = await Promise.race([
      current.done.then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), PREVIEW_WAIT_MS)),
    ]);
    return finished ? { file, project } : undefined;
  }
  private rendering() {
    return {
      status: "rendering",
      progress: Math.round(this.pending?.progress ?? 0),
      step: this.pending?.label,
      message:
        "A prévia final ainda está sendo renderizada no computador do usuário. Chame a mesma ferramenta de novo em 30 a 60 segundos; não altere o projeto enquanto isso, senão a renderização recomeça.",
    };
  }
  private async frame(file: string, time: number, width: number, signal: AbortSignal) {
    const out = join(this.host.cacheDir, `frame-${randomUUID()}.jpg`);
    await runProcess(
      ffmpegPath,
      ["-hide_banner", "-loglevel", "error", "-ss", String(time), "-i", file, "-frames:v", "1", "-vf", `scale=${width}:-2`, "-q:v", "4", "-y", out],
      { signal },
    );
    const data = `data:image/jpeg;base64,${(await readFile(out)).toString("base64")}`;
    await rm(out, { force: true });
    return data;
  }

  async renderFrame(args: Record<string, unknown>) {
    const { time } = z.object({ time: z.number().min(0) }).strict().parse(args);
    const preview = await this.previewExport();
    if (!preview) return this.rendering();
    return this.host.job("inspection", "Lendo o quadro renderizado…", async (signal) => {
      const { file, project } = preview;
      const total = project.clips.reduce((s, c) => s + (c.end - c.start) / c.speed, 0);
      const at = Math.min(time, Math.max(0, total - 0.05));
      const portrait = project.settings.height > project.settings.width;
      return {
        imageUrl: await this.frame(file, at, portrait ? 540 : 960, signal),
        text: `Quadro renderizado da saída final em ${at.toFixed(2)}s (${project.settings.width}x${project.settings.height}).`,
      };
    });
  }

  async reviewVideo(args: Record<string, unknown>) {
    const { format, frames = 6 } = z
      .object({ format: z.string().optional(), frames: z.number().int().min(1).max(12).optional() })
      .strict()
      .parse(args);
    const preview = await this.previewExport();
    if (!preview) return this.rendering();
    return this.host.job("inspection", "Revisando o vídeo…", async (signal) => {
      const { file, project } = preview;
      const total = project.clips.reduce((s, c) => s + (c.end - c.start) / c.speed, 0);
      const portrait = project.settings.height > project.settings.width;
      const times = Array.from({ length: frames }, (_, i) => +((total * (i + 0.5)) / frames).toFixed(2));
      const images: string[] = [];
      for (const t of times) images.push(await this.frame(file, t, portrait ? 360 : 640, signal));
      const guide = format ? FORMATS.find((f) => f.id === format) : undefined;
      return {
        images,
        frameTimes: times,
        duration: +total.toFixed(2),
        size: `${project.settings.width}x${project.settings.height}`,
        scenes: (project.motions ?? []).map((s) => ({ id: s.id, name: s.name, start: +s.start.toFixed(2), end: +s.end.toFixed(2), mode: s.mode })),
        audio: (project.audio ?? []).map((t) => ({
          id: t.id,
          kind: t.kind,
          name: t.name,
          start: t.start,
          duration: +t.duration.toFixed(2),
          gain: t.gain ?? 0,
          license: t.source?.license,
          credit: t.source?.license?.startsWith("CC BY") ? `${t.source.title} — ${t.source.author} (${t.source.license})` : undefined,
        })),
        narration: voiceTimelineWords(project).map((w) => `${w.start.toFixed(2)} ${w.text}`).join(" "),
        captions: project.settings.captions,
        checklist: guide?.checklist ?? [],
        instructions:
          "Look at every frame: text cut off, overlap, contrast, empty frames, scenes out of sync with the words. Score each checklist row 1-10 and fix every row below 8 before exporting.",
      };
    });
  }
}

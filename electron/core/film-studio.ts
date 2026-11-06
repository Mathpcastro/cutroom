import { mkdir, readFile, rm, stat } from "node:fs/promises";
import { extname, isAbsolute, join } from "node:path";
import { z } from "zod";
import { ffmpegPath } from "./media";
import { runProcess } from "./process";
import { FILM_SIZES, Films, analyzeFilm, capturePage, checkFilm, filmStills, renderFilm, slug, type FilmRunner } from "./film";
import { FORMATS, formatGuide } from "./formats";
import { Studio, probeAudio } from "./studio";
import type { BrandStore } from "./brand";

type Progress = (value: number, label?: string) => void;
export interface FilmHost {
  films: Films;
  brand: BrandStore;
  /** Worker script + headless browser (throws a friendly error when the motion package is missing). */
  runner(): Promise<Pick<FilmRunner, "worker" | "browser">>;
  videosDir: string;
  job<T>(kind: string, label: string, run: (signal: AbortSignal, progress: Progress) => Promise<T>): Promise<T>;
}

const RENDER_WAIT_MS = 40_000;
const MEDIA = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".mp4", ".webm", ".mov", ".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac"];
const film = z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/, "Use o id devolvido por create_film ou list_films.");

/** Film-in-code tools: the agent writes HTML/GSAP, CutRoom supplies voice, timing, kit, checks and the render. */
export class FilmStudio {
  private renders = new Map<string, { done: Promise<string>; progress: number; label: string; output: string; error?: string }>();
  constructor(
    private host: FilmHost,
    private studio: Studio,
  ) {}

  list() {
    return this.host.films.list().then((films) => ({ films }));
  }

  async create(args: Record<string, unknown>) {
    const a = z
      .object({
        name: z.string().trim().min(1).max(120),
        aspect: z.enum(Object.keys(FILM_SIZES) as [keyof typeof FILM_SIZES, ...(keyof typeof FILM_SIZES)[]]).optional(),
        format: z.string().max(60).optional(),
      })
      .strict()
      .parse(args);
    const guide = a.format ? formatGuide(a.format) : undefined;
    const brand = await this.host.brand.get();
    const created = await this.host.films.create({
      name: a.name,
      aspect: a.aspect ?? (guide?.aspect as keyof typeof FILM_SIZES | undefined),
      format: a.format,
      brand,
      guide: guide ? `${guide.guide}\n\n### Checklist\n${guide.checklist.map((c) => `- ${c}`).join("\n")}` : undefined,
    });
    return {
      film: created.id,
      path: created.path,
      size: `${created.width}x${created.height}`,
      files: created.files,
      brand: brand ? { name: brand.name, palette: brand.palette } : { configured: false },
      next: [
        "Leia CUTROOM.md (contrato, kit, regras de qualidade) com read_film_file ou direto da pasta.",
        "Escreva o roteiro e chame film_voiceover: grava a narração e timing.js (palavras + volume por quadro).",
        "Escreva index.html (write_film_file ou edite a pasta) e use CR.word() para colar cada cena na palavra.",
        "film_check → film_stills em 4–6 momentos → corrija → render_film.",
      ],
    };
  }

  async voiceover(args: Record<string, unknown>) {
    const a = Studio.voiceArgs.extend({ film }).strict().parse(args);
    const { film: id, ...voiceArgs } = a;
    await this.host.films.meta(id);
    const voiced = await this.studio.synthesize(voiceArgs);
    if (!voiced) return Studio.generating;
    const { file, words, provider, voice } = voiced;
    return this.host.job("voice", "Preparando os tempos da narração…", async (signal) => {
      const duration = await probeAudio(file, signal);
      const set = await this.host.films.setVoice(id, { file, words, duration, provider, voice }, signal);
      return {
        ...set,
        words: set.words.map((w) => `${w.start.toFixed(2)} ${w.text}`).join(" "),
        suggestedDuration: +(set.voiceEnd + 2).toFixed(1),
        audioTag: `<audio id="voz" data-start="0" data-duration="${set.duration}" data-track-index="20" data-volume="1" src="${set.file}"></audio>`,
        note: "timing.js já tem window.TIMING (words, envelope, voiceEnd). Use CR.word(\"palavra\", n) para o segundo de cada palavra.",
      };
    });
  }

  async asset(args: Record<string, unknown>) {
    const a = z
      .object({ film, music: z.string().optional(), path: z.string().max(1000).optional(), name: z.string().trim().min(1).max(80).optional() })
      .strict()
      .refine((v) => !!v.music !== !!v.path, "Passe music (id de search_music) ou path (arquivo local), um dos dois.")
      .parse(args);
    if (a.music) {
      const { item, file } = await this.studio.downloadAudio(a.music);
      return this.host.films.addAsset(a.film, file, a.name ?? item.title, {
        file: "",
        title: item.title,
        author: item.creator,
        license: item.license,
        url: item.page,
        attribution: item.attribution || undefined,
      });
    }
    const path = a.path!;
    if (!isAbsolute(path)) throw new Error("Use o caminho absoluto do arquivo.");
    if (!MEDIA.includes(extname(path).toLowerCase())) throw new Error(`Tipos aceitos: ${MEDIA.join(", ")}.`);
    const info = await stat(path);
    if (!info.isFile() || info.size > 200_000_000) throw new Error("Arquivo inválido ou grande demais (máx. 200 MB).");
    return this.host.films.addAsset(a.film, path, a.name ?? path.split(/[\\/]/).pop()!);
  }

  write(args: Record<string, unknown>) {
    const a = z.object({ film, path: z.string().min(1).max(200), content: z.string() }).strict().parse(args);
    return this.host.films.writeFile(a.film, a.path, a.content);
  }

  async read(args: Record<string, unknown>) {
    const a = z.object({ film, path: z.string().max(200).optional() }).strict().parse(args);
    if (!a.path) return { files: await this.host.films.files(a.film), path: this.host.films.dir(a.film) };
    return this.host.films.readFile(a.film, a.path);
  }

  async capture(args: Record<string, unknown>) {
    const a = z.object({ film, url: z.string().url().max(2000), name: z.string().max(60).optional() }).strict().parse(args);
    const runner = await this.host.runner();
    return this.host.job("inspection", "Capturando a página…", (signal) => capturePage(this.host.films, a.film, a.url, { ...runner, signal }, a.name));
  }

  async check(args: Record<string, unknown>) {
    const { film: id } = z.object({ film }).strict().parse(args);
    const runner = await this.host.runner();
    return this.host.job("inspection", "Checando o filme…", (signal) => checkFilm(this.host.films, id, { ...runner, signal }));
  }

  async stills(args: Record<string, unknown>) {
    const a = z.object({ film, times: z.array(z.number().min(0)).min(1).max(8) }).strict().parse(args);
    const runner = await this.host.runner();
    return this.host.job("inspection", "Gerando quadros do filme…", async (signal) => {
      const result = await filmStills(this.host.films, a.film, a.times, { ...runner, signal });
      const images: string[] = [];
      for (const { file } of result.files) {
        const jpg = `${file}.jpg`;
        await runProcess(ffmpegPath, ["-v", "error", "-y", "-i", file, "-q:v", "4", jpg], { signal });
        images.push(`data:image/jpeg;base64,${(await readFile(jpg)).toString("base64")}`);
        await rm(file, { force: true });
        await rm(jpg, { force: true });
      }
      return {
        images,
        frameTimes: result.files.map((f) => f.t),
        duration: result.duration,
        errors: result.errors,
        instructions:
          "Olhe cada quadro: texto cortado ou pequeno, sobreposição, contraste, tela vazia, elemento fora de hora. Erros de script acima quebram a timeline: corrija antes de renderizar.",
      };
    });
  }

  /**
   * Self-review before rendering: key frames, measured pace and motion, and the format checklist.
   * The agent scores each row as a viewer who did not make the film and fixes rows below 8.
   */
  async review(args: Record<string, unknown>) {
    const { film: id } = z.object({ film }).strict().parse(args);
    const meta = await this.host.films.meta(id);
    const runner = await this.host.runner();
    const analysis = await this.host.job("inspection", "Medindo ritmo e movimento do filme…", (signal) => analyzeFilm(this.host.films, id, { ...runner, signal }));
    const D = analysis.duration || meta.voice?.duration || 10;
    const times = [0.5, 2.5, D * 0.25, D * 0.45, D * 0.65, D * 0.85, D - 0.8].map((t) => +Math.max(0, Math.min(t, D - 0.1)).toFixed(2));
    const frames = (await this.stills({ film: id, times })) as { images: string[]; frameTimes: number[]; errors: string[] };
    const m = analysis.motion, s = analysis.speech;
    const flags: string[] = [];
    if (m.firstMotion > 1) flags.push(`Primeiro movimento só em ${m.firstMotion}s: o gancho precisa mexer já no primeiro segundo.`);
    if (m.longestStill > 1.5) flags.push(`Trecho parado de ${m.longestStill}s a partir de ${m.longestStillAt}s: entre com câmera, um elemento ou corte.`);
    if (m.shotChangesPer10s < 2) flags.push(`Só ${m.shotChangesPer10s} trocas de plano a cada 10 s: o ritmo bom de Reels fica entre 3 e 6.`);
    if (s.words && (s.wordsPerMinute < 140 || s.wordsPerMinute > 220)) flags.push(`Narração a ${s.wordsPerMinute} palavras/min: o confortável fica entre 150 e 200.`);
    if (s.longestPause > 1.2) flags.push(`Pausa de ${s.longestPause}s na narração: preencha com imagem ou encurte.`);
    const format = FORMATS.find((f) => f.id === meta.format);
    return {
      images: frames.images,
      frameTimes: frames.frameTimes,
      errors: frames.errors,
      duration: +D.toFixed(2),
      metrics: { ...m, ...s },
      flags,
      checklist: format?.checklist ?? [],
      instructions:
        "Avalie como alguém que NÃO fez o filme e vai decidir em 1 s se continua assistindo. Dê nota de 1 a 10 para cada item do checklist (justifique em uma linha olhando os quadros e as métricas), mais duas notas: 'história' (gancho, virada, final) e 'execução' (legibilidade, ritmo, acabamento). Corrija tudo abaixo de 8 e as flags antes de render_film.",
    };
  }

  /** Renders in the background: answers within 40 s (Codex cuts MCP calls at ~60 s); job_status / render_film again for the result. */
  async render(args: Record<string, unknown>) {
    const { film: id } = z.object({ film }).strict().parse(args);
    const meta = await this.host.films.meta(id);
    let current = this.renders.get(id);
    if (!current || current.error) {
      const runner = await this.host.runner();
      // The HyperFrames linter catches what breaks a render silently (e.g. <audio> without id renders mute).
      const report = await this.host.job("inspection", "Checando o filme…", (signal) => checkFilm(this.host.films, id, { ...runner, signal }));
      if (!report.ok) return { status: "blocked", errors: report.errors, warnings: report.warnings };
      await mkdir(this.host.videosDir, { recursive: true });
      const output = join(this.host.videosDir, `${slug(meta.name)}-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-")}.mp4`);
      const entry = { progress: 0, label: "Começando…", output, done: Promise.resolve(""), error: undefined as string | undefined };
      entry.done = this.host
        .job("export", `Renderizando o filme ${meta.name}…`, async (signal, progress) => {
          await renderFilm(this.host.films, id, output, {
            ...runner,
            signal,
            onProgress: (value, label) => {
              entry.progress = value;
              if (label) entry.label = label;
              progress(value, label);
            },
          });
          return output;
        })
        .catch((error) => {
          entry.error = error instanceof Error ? error.message : String(error);
          throw error;
        });
      entry.done.catch(() => undefined);
      this.renders.set(id, entry);
      current = entry;
    }
    const finished = await Promise.race([
      current.done.then(
        () => true,
        () => true,
      ),
      new Promise<boolean>((done) => setTimeout(() => done(false), RENDER_WAIT_MS)),
    ]);
    if (current.error) {
      const error = current.error;
      this.renders.delete(id);
      return { status: "failed", error };
    }
    if (!finished)
      return {
        status: "rendering",
        progress: Math.round(current.progress),
        step: current.label,
        message: "O filme está renderizando no computador do usuário (≈ 2–4 min para 45 s). Chame render_film de novo em 60 s ou acompanhe por job_status.",
      };
    this.renders.delete(id);
    const report = await this.host.films.check(id);
    return { status: "done", output: current.output, credits: report.credits, note: report.credits.length ? "Coloque os créditos de música na legenda do post." : undefined };
  }
}

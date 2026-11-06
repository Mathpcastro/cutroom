import { copyFile, cp, link, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { availableParallelism } from "node:os";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import type { AudioWord } from "../../src/shared/types";
import type { Brand } from "./brand";
import { ffmpegPath, ffprobePath } from "./media";
import { runProcess } from "./process";

/**
 * Films are HyperFrames projects the agent writes (HTML + GSAP + kit) and CutRoom renders.
 * Each lives in its own folder under Videos/CutRoom/filmes so Claude Code or Codex can edit it
 * with their own file tools; agents without file access use writeFile/readFile below.
 */
export interface FilmMeta {
  id: string;
  name: string;
  width: number;
  height: number;
  fps: number;
  format?: string;
  createdAt: string;
  voice?: { file: string; duration: number; words: number; provider?: string; voice?: string };
  credits: { file: string; title: string; author: string; license: string; url?: string; attribution?: string }[];
}

export const FILM_SIZES = {
  "9:16": [1080, 1920],
  "16:9": [1920, 1080],
  "1:1": [1080, 1080],
  "4:5": [1080, 1350],
} as const;
const TEXT_FILES = [".html", ".css", ".js", ".mjs", ".json", ".svg", ".md", ".txt"];
const MAX_FILE = 2_000_000;
const fail = (message: string): never => {
  throw new Error(message);
};

export const slug = (name: string) =>
  name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "filme";

/** Loudness per video frame (dB RMS), for mouths and beat-driven motion. */
export function envelopeFromSamples(samples: Float32Array, sampleRate: number, fps: number) {
  const hop = Math.round(sampleRate / fps),
    db: number[] = [];
  for (let i = 0; i + hop <= samples.length; i += hop) {
    let sum = 0;
    for (let k = i; k < i + hop; k++) sum += samples[k] * samples[k];
    db.push(Math.round(20 * Math.log10(Math.sqrt(sum / hop) + 1e-9) * 10) / 10);
  }
  return db;
}

export async function audioEnvelope(file: string, fps = 30, signal?: AbortSignal) {
  const raw = await new Promise<Buffer>((done, reject) => {
    const chunks: Buffer[] = [];
    import("node:child_process").then(({ spawn }) => {
      const child = spawn(ffmpegPath, ["-v", "error", "-i", file, "-ac", "1", "-ar", "48000", "-f", "f32le", "-"], { windowsHide: true });
      signal?.addEventListener("abort", () => child.kill(), { once: true });
      child.stdout.on("data", (c: Buffer) => chunks.push(c));
      child.once("error", reject);
      child.once("close", (code) => (code === 0 ? done(Buffer.concat(chunks)) : reject(new Error("Não foi possível ler o áudio da narração."))));
    }, reject);
  });
  const samples = new Float32Array(raw.buffer, raw.byteOffset, Math.floor(raw.length / 4));
  return envelopeFromSamples(samples, 48000, fps);
}

/**
 * Remote URLs in a film would let a page reach the network while it renders on the user's
 * computer. Films must be self-contained: data: URLs and relative files only.
 */
export function remoteReferences(source: string) {
  const found = new Set<string>();
  for (const m of source.matchAll(/\b(?:https?|wss?):\/\/[^\s"'`)<>]+/gi)) {
    const url = m[0];
    if (/^https?:\/\/(?:www\.)?w3\.org\//i.test(url)) continue; // XML namespaces, never fetched
    found.add(url.slice(0, 200));
  }
  if (/\bimport\s*\(\s*["'`]https?:/i.test(source)) found.add("import() remoto");
  return [...found];
}

export class Films {
  constructor(
    private root: string,
    private kit: string,
    private gsap: string,
    /** resources/film-recipes: one folder per format with its starter film (our own example). */
    private recipes?: string,
  ) {}

  dir(id: string) {
    if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(id)) fail("Filme inválido.");
    return join(this.root, id);
  }
  private inside(id: string, path: string) {
    const base = resolve(this.dir(id)),
      target = resolve(base, path);
    if (target !== base && !target.startsWith(base + sep)) fail("O caminho precisa ficar dentro da pasta do filme.");
    return target;
  }
  async meta(id: string): Promise<FilmMeta> {
    try {
      return JSON.parse(await readFile(join(this.dir(id), "film.json"), "utf8"));
    } catch {
      return fail(`Filme "${id}" não encontrado. Use list_films ou create_film.`);
    }
  }
  private async save(meta: FilmMeta) {
    const file = join(this.dir(meta.id), "film.json");
    await writeFile(`${file}.partial`, JSON.stringify(meta, null, 2), "utf8");
    await rename(`${file}.partial`, file);
  }

  async list() {
    await mkdir(this.root, { recursive: true });
    const films = [];
    for (const entry of await readdir(this.root, { withFileTypes: true }))
      if (entry.isDirectory())
        try {
          const m = await this.meta(entry.name);
          films.push({ id: m.id, name: m.name, size: `${m.width}x${m.height}`, format: m.format, path: this.dir(m.id), createdAt: m.createdAt });
        } catch {
          /* Not a film folder. */
        }
    return films.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async create(options: { name: string; aspect?: keyof typeof FILM_SIZES; format?: string; brand?: Brand; guide?: string }) {
    await mkdir(this.root, { recursive: true });
    let id = slug(options.name);
    for (let n = 2; await stat(join(this.root, id)).then(() => true, () => false); n++) id = `${slug(options.name)}-${n}`;
    const dir = this.dir(id),
      [width, height] = FILM_SIZES[options.aspect ?? "9:16"];
    await mkdir(join(dir, "assets"), { recursive: true });
    await cp(join(this.kit, "fonts"), join(dir, "fonts"), { recursive: true });
    await mkdir(join(dir, "kit"), { recursive: true });
    await cp(join(this.kit, "cutroom-kit.js"), join(dir, "kit", "cutroom-kit.js"));
    // three.js (MIT) for 3D sets and post-processing; use an import map: {"three": "./kit/three/three.module.min.js"}.
    if (await stat(join(this.kit, "three")).then(() => true, () => false)) await cp(join(this.kit, "three"), join(dir, "kit", "three"), { recursive: true });
    await writeFile(join(dir, "kit", "gsap.min.js"), await readFile(this.gsap)); // may live inside app.asar
    const meta: FilmMeta = { id, name: options.name, width, height, fps: 30, format: options.format, createdAt: new Date().toISOString(), credits: [] };
    await this.save(meta);
    const brand = options.brand;
    await writeFile(
      join(dir, "brand.js"),
      `window.BRAND = ${JSON.stringify(
        brand
          ? { name: brand.name, handle: brand.handle, palette: brand.palette, fonts: brand.fonts ?? {}, website: brand.website }
          : { name: "", palette: { accent: "#E8462F", ink: "#1E1C1A", paper: "#EBE7E1" }, fonts: {} },
      )};\n`,
      "utf8",
    );
    if (brand?.logo) {
      const [, type, data] = /^data:image\/(png|jpeg|webp|svg\+xml);base64,(.+)$/.exec(brand.logo) ?? [];
      if (data) await writeFile(join(dir, "assets", `logo.${type === "svg+xml" ? "svg" : type === "jpeg" ? "jpg" : type}`), Buffer.from(data, "base64"));
    }
    await writeFile(join(dir, "timing.js"), `window.TIMING = { words: [], envelope: { fps: 30, db: [] }, voiceEnd: 0 };\n`, "utf8");
    await writeFile(join(dir, "index.html"), starterHtml(meta), "utf8");
    let starter = false;
    if (options.format && this.recipes && /^[a-z0-9-]+$/.test(options.format)) {
      const recipe = join(this.recipes, options.format);
      if (await stat(recipe).then((s) => s.isDirectory(), () => false)) {
        await cp(recipe, dir, { recursive: true, force: true });
        starter = true;
      }
    }
    await writeFile(join(dir, "CUTROOM.md"), filmRules(meta, options.guide, starter), "utf8");
    return { ...meta, path: dir, starter, files: await this.files(id) };
  }

  async files(id: string, all = false) {
    const base = this.dir(id),
      out: string[] = [];
    const walk = async (dir: string) => {
      for (const e of await readdir(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name !== ".renders" && (all || e.name !== "fonts")) await walk(p);
        } else out.push(relative(base, p).replaceAll("\\", "/"));
      }
    };
    await walk(base);
    return out.sort();
  }

  async writeFile(id: string, path: string, content: string) {
    await this.meta(id);
    if (!TEXT_FILES.includes(extname(path).toLowerCase())) fail(`Só arquivos de texto: ${TEXT_FILES.join(", ")}. Mídia entra por film_voiceover e film_asset.`);
    if (content.length > MAX_FILE) fail("Arquivo grande demais (máx. 2 MB).");
    if (/^(film\.json|timing\.js)$/i.test(path.replace(/^\.\//, ""))) fail("film.json e timing.js são escritos pelo CutRoom.");
    const target = this.inside(id, path);
    await mkdir(resolve(target, ".."), { recursive: true });
    await writeFile(target, content, "utf8");
    return { path: relative(this.dir(id), target).replaceAll("\\", "/"), bytes: Buffer.byteLength(content) };
  }

  async readFile(id: string, path: string) {
    const target = this.inside(id, path);
    if (!TEXT_FILES.includes(extname(path).toLowerCase())) fail("Só arquivos de texto podem ser lidos.");
    const content = await readFile(target, "utf8");
    return { path, content: content.length > 200_000 ? content.slice(0, 200_000) + "\n/* … cortado */" : content };
  }

  /** Copies the narration into the film and writes timing.js (words in seconds + loudness per frame). */
  async setVoice(id: string, voice: { file: string; words?: AudioWord[]; duration: number; provider?: string; voice?: string }, signal?: AbortSignal) {
    const meta = await this.meta(id),
      dir = this.dir(id),
      name = "voice.wav";
    // Always assets/voice.wav (48 kHz mono), whatever the provider: recipe starters reference that name.
    await runProcess(ffmpegPath, ["-v", "error", "-y", "-i", voice.file, "-ac", "1", "-ar", "48000", "-c:a", "pcm_s16le", join(dir, "assets", name)], { signal });
    const db = await audioEnvelope(voice.file, meta.fps, signal);
    const words = (voice.words ?? []).map((w) => ({ text: w.text, start: +w.start.toFixed(3), end: +w.end.toFixed(3) }));
    const voiceEnd = words.length ? words[words.length - 1].end : voice.duration;
    await writeFile(join(dir, "timing.js"), `window.TIMING = ${JSON.stringify({ words, envelope: { fps: meta.fps, db }, voiceEnd, file: `assets/${name}`, duration: +voice.duration.toFixed(3) })};\n`, "utf8");
    meta.voice = { file: `assets/${name}`, duration: voice.duration, words: words.length, provider: voice.provider, voice: voice.voice };
    await this.save(meta);
    return { file: `assets/${name}`, duration: +voice.duration.toFixed(3), voiceEnd, words };
  }

  async addAsset(id: string, source: string, name: string, credit?: FilmMeta["credits"][number]) {
    const meta = await this.meta(id);
    const safe = slug(name.replace(/\.[a-z0-9]+$/i, "")) + (extname(source).toLowerCase() || ".mp3");
    await cp(source, join(this.dir(id), "assets", safe));
    if (credit) {
      meta.credits = [...meta.credits.filter((c) => c.file !== `assets/${safe}`), { ...credit, file: `assets/${safe}` }];
      await this.save(meta);
    }
    return { file: `assets/${safe}`, attribution: credit?.attribution };
  }

  /** Static checks before a render: remote URLs, missing local files, basic HyperFrames contract. */
  async check(id: string) {
    const meta = await this.meta(id),
      dir = this.dir(id),
      errors: string[] = [],
      warnings: string[] = [];
    let html = "";
    try {
      html = await readFile(join(dir, "index.html"), "utf8");
    } catch {
      errors.push("Falta o index.html.");
    }
    for (const file of await this.files(id))
      if (/\.(html|css|js|mjs)$/i.test(file) && !file.startsWith("kit/")) {
        const raw = await readFile(join(dir, file), "utf8"),
          text = /\.html$/i.test(file) ? raw.replace(/<!--[\s\S]*?-->/g, "") : raw; // comments are never loaded
        for (const url of remoteReferences(text)) errors.push(`${file}: referência externa ${url} — use arquivos da pasta do filme (o render não acessa a internet).`);
        for (const m of text.matchAll(/\b(?:src|href)\s*=\s*["']([^"'#?]+)["']/gi)) {
          const ref = m[1];
          if (/^(data:|blob:|#)/.test(ref) || /^[a-z]+:/i.test(ref)) continue;
          const target = resolve(dir, file, "..", ref);
          if (!target.startsWith(resolve(dir) + sep)) errors.push(`${file}: ${ref} aponta para fora da pasta do filme.`);
          else if (!(await stat(target).then(() => true, () => false))) errors.push(`${file}: arquivo não encontrado: ${ref}`);
        }
      }
    if (html) {
      if (!/data-composition-id=/.test(html)) errors.push('index.html precisa de um elemento raiz com data-composition-id, data-width e data-height.');
      if (!new RegExp(`data-width=["']${meta.width}["']`).test(html) || !new RegExp(`data-height=["']${meta.height}["']`).test(html))
        warnings.push(`Confira data-width="${meta.width}" e data-height="${meta.height}" no elemento raiz.`);
      if (!/window\.__timelines\[/.test(html)) errors.push('Registre a timeline: window.__timelines["<id da composição>"] = tl.');
      if (!/paused:\s*true/.test(html)) warnings.push("Crie a timeline com gsap.timeline({ paused: true }).");
      if (/Math\.random\(|Date\.now\(|requestAnimationFrame\(|setInterval\(|setTimeout\(/.test(html))
        warnings.push("Evite Math.random, Date.now, setTimeout e requestAnimationFrame: o render busca cada quadro pelo tempo; use sementes fixas e a timeline.");
      if (meta.voice && !/timing\.js/.test(html)) warnings.push("A narração existe, mas o index.html não carrega timing.js.");
      const declared = Number(/data-composition-id=[^>]*data-duration=["']([\d.]+)["']|data-duration=["']([\d.]+)["'][^>]*data-composition-id/.exec(html)?.slice(1).find(Boolean));
      if (meta.voice && declared && (declared < meta.voice.duration + 0.5 || declared > meta.voice.duration + 4))
        warnings.push(`data-duration="${declared}" não acompanha a narração (${meta.voice.duration.toFixed(1)} s): use ≈ ${(meta.voice.duration + 1.8).toFixed(1)}.`);
      if (meta.voice && !new RegExp(meta.voice.file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).test(html)) warnings.push(`Inclua a narração: <audio id="voz" data-start="0" data-track-index="20" src="${meta.voice.file}"></audio>.`);
    }
    return { ok: errors.length === 0, errors, warnings, credits: meta.credits.map((c) => c.attribution).filter(Boolean) };
  }
}

export interface FilmRunner {
  worker: string;
  browser: string;
  signal?: AbortSignal;
  onProgress?: (percent: number, label?: string) => void;
}
export interface FilmStills {
  duration: number;
  files: { t: number; file: string }[];
  errors: string[];
}

/** Content-Security-Policy for rendering: the page may only load files served from the film folder. */
export const FILM_CSP =
  "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob:; style-src 'self' 'unsafe-inline' data:; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' data: blob:; connect-src 'self' data: blob:; frame-src 'none'; object-src 'none'";
export const withCsp = (html: string) => {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${FILM_CSP}">`;
  return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + meta) : meta + html;
};

/**
 * A render copy of the film (hard links, so no extra disk) whose index.html carries FILM_CSP:
 * even code that builds URLs at runtime cannot reach the network while CutRoom renders it.
 */
async function stageFilm(films: Films, id: string) {
  const dir = films.dir(id),
    stage = join(dir, ".renders", `palco-${Date.now()}`);
  for (const file of await films.files(id, true)) {
    const target = join(stage, file);
    await mkdir(dirname(target), { recursive: true });
    if (file === "index.html") await writeFile(target, withCsp(await readFile(join(dir, file), "utf8")), "utf8");
    else await link(join(dir, file), target).catch(() => copyFile(join(dir, file), target));
  }
  return stage;
}

/** Runs the HyperFrames worker (Electron in Node mode) and returns its final JSON line. */
async function runFilmWorker(dir: string, spec: Record<string, unknown>, runner: FilmRunner, directory = dir) {
  const work = join(dir, ".renders");
  await mkdir(work, { recursive: true });
  const file = join(work, `request-${Date.now()}.json`);
  await writeFile(file, JSON.stringify({ browser: runner.browser, fps: 30, directory, ...spec }), "utf8");
  let result: Record<string, unknown> = {};
  try {
    await runProcess(process.execPath, [runner.worker, file], {
      signal: runner.signal,
      cwd: dir,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", HYPERFRAMES_FFMPEG_PATH: ffmpegPath, HYPERFRAMES_FFPROBE_PATH: ffprobePath },
      onLine: (line) => {
        try {
          const p = JSON.parse(line);
          if (p.complete) result = p;
          else if (typeof p.progress === "number") runner.onProgress?.(p.progress, typeof p.label === "string" ? p.label : undefined);
        } catch {
          /* SDK logs are not progress messages. */
        }
      },
    });
  } finally {
    await rm(file, { force: true });
  }
  return result;
}

export const filmWorkers = () => Math.min(3, Math.max(1, Math.floor(availableParallelism() / 4)));

/** Static checks + the HyperFrames linter, as one list the agent can act on. */
export async function checkFilm(films: Films, id: string, runner: FilmRunner) {
  const report = await films.check(id);
  try {
    const { findings = [] } = (await runFilmWorker(films.dir(id), { mode: "lint" }, runner)) as {
      findings?: { severity: string; message: string; selector?: string; fix?: string }[];
    };
    for (const f of findings) {
      const text = `${f.message}${f.selector ? ` (${f.selector})` : ""}${f.fix ? ` — ${f.fix}` : ""}`;
      (f.severity === "error" ? report.errors : report.warnings).push(`HyperFrames: ${text}`);
    }
  } catch (error) {
    report.warnings.push(`O verificador do HyperFrames não rodou: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
  }
  report.ok = report.errors.length === 0;
  return report;
}

/** Captures a public page (http/https) into assets/ — the input of the landing page fly-over. */
export async function capturePage(films: Films, id: string, url: string, runner: FilmRunner, name = "pagina") {
  const parsed = new URL(url);
  if (!/^https?:$/.test(parsed.protocol)) fail("Use um link http ou https.");
  const file = `assets/${slug(name)}.jpg`;
  const result = (await runFilmWorker(films.dir(id), { mode: "capture", url: parsed.href, output: join(films.dir(id), file), width: 1440, maxHeight: 9000 }, runner)) as {
    width?: number;
    height?: number;
    pageHeight?: number;
    title?: string;
  };
  if (!result.height) fail("Não consegui capturar a página.");
  return { file, width: result.width, height: result.height, pageHeight: result.pageHeight, title: result.title };
}

export async function filmStills(films: Films, id: string, times: number[], runner: FilmRunner): Promise<FilmStills> {
  const meta = await films.meta(id),
    dir = films.dir(id),
    output = join(dir, ".renders", `quadros-${Date.now()}`);
  const report = await films.check(id);
  if (report.errors.some((e) => /referência externa|fora da pasta/.test(e))) fail(report.errors.join("\n"));
  const stage = await stageFilm(films, id);
  try {
    const result = (await runFilmWorker(dir, { mode: "stills", output, times: times.slice(0, 12), width: meta.width, height: meta.height, scale: 0.5 }, runner, stage)) as Partial<FilmStills>;
    return { duration: result.duration ?? 0, files: result.files ?? [], errors: result.errors ?? [] };
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

/** Renders the film to MP4 and normalizes loudness for Reels (−14 LUFS, 48 kHz AAC). */
export async function renderFilm(films: Films, id: string, output: string, runner: FilmRunner) {
  const report = await films.check(id);
  if (!report.ok) fail(`Corrija antes de renderizar:\n${report.errors.join("\n")}`);
  const dir = films.dir(id),
    raw = join(dir, ".renders", `bruto-${Date.now()}.mp4`),
    stage = await stageFilm(films, id);
  try {
    await runFilmWorker(dir, { mode: "film", output: raw, workers: filmWorkers(), quality: "high" }, { ...runner, onProgress: (p, label) => runner.onProgress?.(p * 0.95, label) }, stage);
    runner.signal?.throwIfAborted();
    if (!(await stat(raw).then((s) => s.size > 0, () => false))) fail("O renderizador não gerou o vídeo.");
    runner.onProgress?.(96, "Normalizando o volume…");
    const staged = `${output}.partial.mp4`;
    // loudnorm resamples to 96 kHz internally; AAC at 96 kHz plays silent on many phones, so force 48 kHz.
    const common = ["-y", "-v", "error", "-i", raw, "-map", "0:v:0", "-c:v", "copy", "-movflags", "+faststart"];
    try {
      await runProcess(ffmpegPath, [...common, "-map", "0:a:0", "-af", "loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000", "-ar", "48000", "-c:a", "aac", "-b:a", "192k", staged], { signal: runner.signal });
    } catch (error) {
      runner.signal?.throwIfAborted();
      if (!/matches no streams|does not contain any stream|Stream map '0:a:0'/i.test(String(error))) throw error;
      await runProcess(ffmpegPath, [...common, staged], { signal: runner.signal }); // silent film
    }
    await rename(staged, output);
    runner.onProgress?.(100, "Filme pronto.");
    return { output, warnings: report.warnings, credits: report.credits };
  } finally {
    await rm(raw, { force: true });
    await rm(stage, { recursive: true, force: true });
  }
}

export function starterHtml(meta: FilmMeta) {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<style>
  @font-face { font-family: Anton; src: url(fonts/Anton-Regular.ttf); }
  @font-face { font-family: "Instrument Sans"; src: url(fonts/InstrumentSans.ttf); font-weight: 100 900; }
  @font-face { font-family: "Instrument Serif"; src: url(fonts/InstrumentSerif-Italic.ttf); font-style: italic; }
  @font-face { font-family: "JetBrains Mono"; src: url(fonts/JetBrainsMono.ttf); font-weight: 100 900; }
  * { box-sizing: border-box; margin: 0; }
  html, body { width: ${meta.width}px; height: ${meta.height}px; overflow: hidden; background: #EBE7E1; }
  #film { position: relative; width: ${meta.width}px; height: ${meta.height}px; overflow: hidden; background: #EBE7E1; }
  /* Everything that appears later starts hidden in CSS (never with a timeline set at 0). */
  .later { visibility: hidden; opacity: 0; }
  .cr-captions { position: absolute; left: 120px; top: 196px; width: ${meta.width - 220}px; font: 500 60px/1.18 "Instrument Sans"; }
  .cr-captions .key { font-family: "Instrument Serif"; font-style: italic; font-weight: 400; font-size: 1.16em; }
  .title { position: absolute; left: 110px; top: 520px; font: 170px/1 Anton; color: #1E1C1A; }
</style>
</head>
<body>
<div id="film" data-composition-id="film" data-start="0" data-duration="10" data-width="${meta.width}" data-height="${meta.height}">
  <div class="title later">Seu título</div>
  <div class="cr-captions"></div>
  <!-- Narração (film_voiceover grava assets/voice.* e timing.js): -->
  <!-- <audio id="voz" data-start="0" data-duration="D" data-track-index="20" src="assets/voice.mp3"></audio> -->
  <script src="kit/gsap.min.js"></script>
  <script src="brand.js"></script>
  <script src="timing.js"></script>
  <script src="kit/cutroom-kit.js"></script>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    // Exemplo: título entra junto com a primeira palavra; legenda palavra a palavra.
    CR.slam(tl, ".title", CR.timing.words.length ? CR.timing.words[0].start : 0.3);
    CR.captions(tl, { el: ".cr-captions", maxWords: 4 });
    tl.set({}, {}, 10); // a duração final: fim da narração + ~2 s (ajuste também data-duration)
    window.__timelines["film"] = tl;
  </script>
</div>
</body>
</html>
`;
}

const STARTER_NOTE = `
## Filme inicial deste formato

O \`index.html\` desta pasta é a versão do CutRoom deste formato, completa e funcionando (com o roteiro de exemplo em \`roteiro.txt\`). Reescreva o roteiro para a marca do usuário, grave a voz com \`film_voiceover\` e reancore cada cena nas palavras do novo roteiro: \`CR.at("palavra", n, segundosReserva)\` não quebra se a palavra sumir. Troque textos, cores e telas; mantenha a estrutura de cenas, o ritmo e os movimentos.
`;

export function filmRules(meta: FilmMeta, guide?: string, starter = false) {
  return `# Filme: ${meta.name}

Pasta de um filme do CutRoom (projeto HyperFrames). Você escreve \`index.html\` (e outros arquivos de texto); o CutRoom grava a narração (\`film_voiceover\` → \`assets/voice.*\` + \`timing.js\`), baixa música e efeitos (\`film_asset\`), checa (\`film_check\`), mostra quadros (\`film_stills\`) e renderiza (\`render_film\`).

## Contrato
- Raiz: \`<div id="film" data-composition-id="film" data-start="0" data-duration="D" data-width="${meta.width}" data-height="${meta.height}">\`. D = fim da narração + ~2 s; a timeline termina com \`tl.set({}, {}, D)\`.
- Uma timeline GSAP pausada registrada em \`window.__timelines["film"]\`. O render busca cada quadro pelo tempo: nada de \`Math.random\`, \`Date.now\`, \`setTimeout\` ou \`requestAnimationFrame\` (use sementes fixas).
- Elementos que aparecem depois começam ocultos **no CSS** (\`visibility:hidden;opacity:0\`) e entram com \`autoAlpha\`.
- Áudio com \`<audio id data-start data-duration data-track-index data-volume data-fade-out src>\`: **todo \`<audio>\` precisa de \`id\` único** (sem id sai mudo); cada efeito numa faixa própria (\`data-track-index\` diferente). Narração em volume 1, música ~0,14–0,16.
- **Sem internet:** só arquivos desta pasta ou \`data:\`. Referências externas fazem o render ser recusado.
- Fontes em \`fonts/\` (Anton, Instrument Sans/Serif, JetBrains Mono, Montserrat, Barlow, Caveat, Oswald). Marca em \`brand.js\` (\`window.BRAND\`); logo em \`assets/logo.*\` quando existir.

## Kit (\`kit/cutroom-kit.js\`, objeto \`CR\`)
- \`CR.word("texto", n)\` → início (s) da n-ésima palavra falada; \`CR.wordEnd\`.
- Movimentos: \`CR.pop / rise / exit / slam / stamp / spin / draw / show / hide (tl, seletor, t)\`, \`CR.count(tl, sel, de, até, t, duração)\`, \`CR.type(tl, sel, t)\`, \`CR.wipe(tl, t)\` (transição em meio-tom).
- Fala: \`CR.captions(tl, {el, maxWords, keys})\`, \`CR.mouth(tl, ".mo", n)\`, \`CR.blink\`, \`CR.sway\`, \`CR.nod\`, \`CR.gesture\`.
- Apresentador em pixel art: \`CR.pixelPresenter(tl, {x, y, scale, hoodie, skin, hair})\` cria o personagem, a boca pela narração, a piscada e o balanço; devolve \`{hand(t)}\` para o joinha.

## Qualidade (o que o review cobra)
- Gancho em momento nos 3 primeiros segundos; virada no meio; pergunta final que divide os comentários.
- Mostre em vez de listar: demonstração do que a voz diz, com o produto real (prints, cards, telas) quando houver.
- Novo plano a cada 1,5–3 s; nada parado mais de 1,5 s (câmera em deriva lenta e "socos" nas palavras-chave).
- Cada card entra até 0,15 s depois da palavra que ele mostra; contadores chegam ao número na palavra falada.
- Texto ≤ 6 palavras por card, legível no celular, longe da faixa inferior (interface do Reels).
${starter ? STARTER_NOTE : ""}${guide ? `\n## Guia do formato\n\n${guide}\n` : ""}`;
}

/** Picture-change metrics from film_review samples (diff 0–1 between frames `step` s apart). */
export function motionMetrics(samples: { t: number; diff: number }[], step: number) {
  const STILL = 0.0015, CUT = 0.1;
  let longest = 0, run = 0, runStart = 0, longestAt = 0;
  for (const s of samples) {
    if (s.diff < STILL) {
      if (!run) runStart = s.t - step;
      run += step;
      if (run > longest) [longest, longestAt] = [run, runStart];
    } else run = 0;
  }
  const duration = samples.length ? samples[samples.length - 1].t : 0;
  const cuts = samples.filter((s) => s.diff >= CUT).length;
  const firstMotion = samples.find((s) => s.diff >= STILL * 2)?.t ?? duration;
  return {
    longestStill: +longest.toFixed(2),
    longestStillAt: +Math.max(0, longestAt).toFixed(2),
    shotChangesPer10s: duration ? +((cuts / duration) * 10).toFixed(1) : 0,
    movingShare: samples.length ? +(samples.filter((s) => s.diff >= STILL).length / samples.length).toFixed(2) : 0,
    firstMotion: +firstMotion.toFixed(2),
  };
}

/** Narration pace from the word timings. */
export function speechMetrics(words: { text: string; start: number; end: number }[]) {
  if (!words.length) return { words: 0, wordsPerMinute: 0, longestPause: 0 };
  let pause = 0;
  for (let i = 1; i < words.length; i++) pause = Math.max(pause, words[i].start - words[i - 1].end);
  const span = words[words.length - 1].end - words[0].start;
  return { words: words.length, wordsPerMinute: Math.round((words.length / Math.max(span, 0.1)) * 60), longestPause: +pause.toFixed(2) };
}

export async function analyzeFilm(films: Films, id: string, runner: FilmRunner) {
  const meta = await films.meta(id),
    dir = films.dir(id);
  const stage = await stageFilm(films, id);
  try {
    const r = (await runFilmWorker(dir, { mode: "analyze", step: 0.25, width: meta.width, height: meta.height }, runner, stage)) as {
      duration?: number;
      step?: number;
      samples?: { t: number; diff: number }[];
    };
    let words: { text: string; start: number; end: number }[] = [];
    try {
      words = JSON.parse((await readFile(join(dir, "timing.js"), "utf8")).replace(/^window\.TIMING = /, "").replace(/;\s*$/, "")).words ?? [];
    } catch {
      /* No narration. */
    }
    return { duration: r.duration ?? 0, motion: motionMetrics(r.samples ?? [], r.step ?? 0.25), speech: speechMetrics(words) };
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

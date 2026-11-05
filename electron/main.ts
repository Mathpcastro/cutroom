import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  nativeTheme,
  protocol,
  safeStorage,
  shell,
} from "electron";
import { randomUUID } from "node:crypto";
import { createReadStream, mkdirSync } from "node:fs";
import {
  access,
  mkdir,
  readFile,
  realpath,
  stat,
  writeFile,
  rename,
} from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { z } from "zod";
import type {
  AppSnapshot,
  ChatMessage,
  EditCommand,
  Job,
  Project,
  AgentActivity,
} from "../src/shared/types";
import {
  createProject,
  validateProject,
  applyCommand,
  projectDuration,
} from "./core/project";
import {
  probeMedia,
  detectSilences,
  exportProject,
  ffmpegPath,
} from "./core/media";
import { PackageManager } from "./core/packages";
import { CodexClient, toolActivityLabel } from "./core/codex";
import type { AgentClient } from "./core/agent";
import { ApiAgentClient } from "./core/api-agent";
import { ClaudeAgentClient } from "./core/claude-agent";
import { DesktopMcpServer } from "./core/desktop-mcp";
import { AGENT_PROVIDERS } from "../src/shared/providers";
import { runProcess } from "./core/process";
import { motionCacheKey, motionDocument } from "./core/motion-document";
import { renderMotions } from "./core/motion-render";
import {
  chatCommandRequest,
  resolveChatCommand,
  applyNativeChatCommand,
} from "./core/chat-commands";
import { startWindowsAutoUpdate } from "./core/updater";
import { SecretStore } from "./core/secrets";
import {
  BrandStore,
  carrossellProfiles,
  importCarrossellBrand,
} from "./core/brand";
import { Studio, probeAudio } from "./core/studio";
import { localSpeech, localVoices } from "./core/local-voice";
import type { MotionAssets } from "./core/motion-document";

const here = dirname(fileURLToPath(import.meta.url));
if (process.env.CUTROOM_USER_DATA) {
  const profile = resolve(process.env.CUTROOM_USER_DATA);
  mkdirSync(profile, { recursive: true });
  app.setPath("userData", profile);
}
const resources = app.isPackaged
  ? join(process.resourcesPath, "resources")
  : resolve(here, "../resources");
protocol.registerSchemesAsPrivileged([
  {
    scheme: "cutroom-motion",
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
  {
    scheme: "cutroom",
    privileges: {
      standard: true,
      secure: true,
      stream: true,
      supportFetchAPI: true,
    },
  },
]);
let window: BrowserWindow | undefined;
let packages: PackageManager;
let codex: AgentClient | undefined;
let desktopMcp: DesktopMcpServer | undefined;
let connectionGeneration = 0;
let cacheDir: string;
const motionDocuments = new Map<string, string>();
let userDir: string;
let studio: Studio;
let brandStore: BrandStore;
/** Host images for scenes: the brand logo as data-asset="logo". */
async function motionAssets(): Promise<MotionAssets> {
  const brand = await brandStore?.get();
  return brand?.logo ? { logo: brand.logo } : {};
}
const CANVAS_SIZES = {
  "16:9": [1920, 1080],
  "9:16": [1080, 1920],
  "1:1": [1080, 1080],
  "4:5": [1080, 1350],
} as const;
const appearanceSchema = z
  .object({
    mode: z.enum(["light", "dark"]),
    background: z.string().regex(/^#[0-9a-f]{6}$/i),
    foreground: z.string().regex(/^#[0-9a-f]{6}$/i),
  })
  .strict();
let appearance: z.infer<typeof appearanceSchema> = {
  mode: "dark",
  background: "#202020",
  foreground: "#e8e8e8",
};
let appearanceSave: Promise<void> = Promise.resolve();
function applyWindowAppearance() {
  nativeTheme.themeSource = appearance.mode;
  if (!window || window.isDestroyed()) return;
  window.setBackgroundColor(appearance.background);
  if (process.platform === "win32")
    window.setTitleBarOverlay({
      color: appearance.background,
      symbolColor: appearance.foreground,
      height: 40,
    });
}
let chatBusy = false;
const allowedFiles = new Set<string>();
const controllers = new Map<string, AbortController>();
let past: Project[] = [];
let future: Project[] = [];
let state: AppSnapshot = {
  project: createProject(),
  messages: [],
  jobs: [],
  activities: [],
  onboarding: { dismissed: false, transcriptionReady: false },
  packages: [],
  connection: { status: "disconnected", models: [] },
  busy: false,
  canUndo: false,
  canRedo: false,
};

function emit() {
  if (state.onboarding)
    state.onboarding.transcriptionReady = state.packages.some(
      (item) => item.id === "faster-whisper-base" && item.installed,
    );
  state = {
    ...state,
    busy: chatBusy || controllers.size > 0,
    canUndo: past.length > 0,
    canRedo: future.length > 0,
  };
  if (window && !window.isDestroyed())
    window.webContents.send("editor:event", { type: "state", state });
  return structuredClone(state);
}
function activity(entry: AgentActivity) {
  state.activities = [
    ...(state.activities || []).filter((item) => item.id !== entry.id),
    entry,
  ].slice(-200);
  emit();
}
/** Blank canvases carry silent audio: there is nothing to transcribe in them. */
const isCanvas = (path: string) =>
  dirname(resolve(path)) === resolve(cacheDir) &&
  /^canvas-[\w-]+\.mp4$/i.test(path.split(/[\\/]/).pop() ?? "");
async function requireTranscription(signal?: AbortSignal) {
  // Narrated canvases caption the voice track, which already has word timings.
  if (
    (state.project.audio ?? []).some((t) => t.kind === "voice" && t.words?.length) &&
    state.project.media.every((media) => !media.hasAudio || isCanvas(media.path))
  )
    return;
  const missing = state.project.media.some(
    (media) =>
      media.hasAudio &&
      !state.project.words.some((word) => word.mediaId === media.id),
  );
  if (!missing && state.project.words.length) return;
  if (!state.project.media.some((media) => media.hasAudio))
    throw new Error("Este vídeo não tem áudio para transcrever.");
  state.packages = await packages.list();
  if (
    !state.packages.some(
      (item) => item.id === "faster-whisper-base" && item.installed,
    )
  ) {
    state.onboarding = {
      dismissed: !!state.onboarding?.dismissed,
      transcriptionReady: false,
    };
    emit();
    throw new Error(
      "Instale o pacote Transcrição local na aba Pacotes. Depois, a fala será transcrita no seu computador para remover muletas e criar legendas.",
    );
  }
  signal?.throwIfAborted();
  if (missing) await transcribe(false, signal);
  if (!state.project.words.length)
    throw new Error(
      "Não foi encontrada fala no vídeo. Você ainda pode cortar e remover pausas manualmente.",
    );
}
function message(role: ChatMessage["role"], text: string) {
  state.messages.push({
    id: randomUUID(),
    role,
    text,
    createdAt: new Date().toISOString(),
  });
  emit();
}
function replaceProject(project: Project, record = true) {
  if (record) {
    past.push(structuredClone(state.project));
    past = past.slice(-100);
    future = [];
  }
  state.project = project;
  state.project.updatedAt = new Date().toISOString();
  emit();
}
function idle() {
  if (chatBusy || controllers.size)
    throw new Error(
      "Aguarde a operação atual ou cancele antes de trocar o projeto.",
    );
}
async function allowProjectFiles() {
  const nextFiles = new Set<string>();
  for (const media of [
    ...state.project.media,
    ...(state.project.audio ?? []).map((track) => ({ path: track.path })),
  ] as { path: string; thumbnail?: string; proxy?: string }[])
    for (const path of [media.path, media.thumbnail, media.proxy])
      if (path) {
        try {
          nextFiles.add(await realpath(path));
        } catch {
          /* Missing source is shown on opening, never silently substituted. */
        }
      }
  // Replace the allowlist atomically so existing range requests never see an empty list.
  allowedFiles.clear();
  for (const path of nextFiles) allowedFiles.add(path);
}
async function job<T>(
  kind: string,
  label: string,
  run: (
    signal: AbortSignal,
    progress: (percent: number, label?: string) => void,
  ) => Promise<T>,
  parentSignal?: AbortSignal,
): Promise<T> {
  const entry: Job = {
    id: randomUUID(),
    startedAt: new Date().toISOString(),
    kind,
    label,
    status: "running",
    progress: 0,
  };
  state.jobs = [...state.jobs.slice(-19), entry];
  const controller = new AbortController();
  const abortFromParent = () => controller.abort();
  if (parentSignal?.aborted) controller.abort();
  parentSignal?.addEventListener("abort", abortFromParent, { once: true });
  controllers.set(entry.id, controller);
  emit();
  try {
    controller.signal.throwIfAborted();
    const result = await run(controller.signal, (percent, text) => {
      entry.progress = Math.min(100, Math.max(0, percent));
      if (text) entry.label = text;
      emit();
    });
    controller.signal.throwIfAborted();
    entry.status = "completed";
    entry.progress = 100;
    if (typeof result === "string") {
      entry.output = result;
      allowedFiles.add(await realpath(result));
    }
    return result;
  } catch (error) {
    entry.status = controller.signal.aborted ? "cancelled" : "failed";
    entry.error = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    parentSignal?.removeEventListener("abort", abortFromParent);
    entry.finishedAt = new Date().toISOString();
    controllers.delete(entry.id);
    emit();
  }
}

async function importPaths(value: unknown) {
  idle();
  const paths = z
    .object({ paths: z.array(z.string().min(1)).min(1).max(50) })
    .parse(value).paths;
  const imported = await job(
    "import",
    "Preparando mídia…",
    async (signal, progress) => {
      const items = [];
      for (let index = 0; index < paths.length; index++) {
        signal.throwIfAborted();
        if (
          ![".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v", ".mts"].includes(
            extname(paths[index]).toLowerCase(),
          )
        )
          throw new Error("Formato de vídeo não aceito.");
        const source = await realpath(paths[index]);
        items.push(await probeMedia(source, cacheDir, { signal }));
        signal.throwIfAborted();
        progress(((index + 1) / paths.length) * 100);
      }
      return items;
    },
  );
  const project = structuredClone(state.project);
  if (!project.media.length && imported[0]) {
    const scale = Math.min(
      1,
      7680 / Math.max(imported[0].width, imported[0].height),
    );
    project.settings.width = Math.max(
      64,
      Math.floor((imported[0].width * scale) / 2) * 2,
    );
    project.settings.height = Math.max(
      64,
      Math.floor((imported[0].height * scale) / 2) * 2,
    );
    project.settings.fps = Math.min(120, Math.max(1, imported[0].fps));
    project.name = imported[0].name.replace(/\.[^.]+$/, "");
  }
  for (const media of imported)
    if (!project.media.some((existing) => existing.id === media.id))
      project.media.push(media);
  project.clips.push(
    ...imported.map((media) => ({
      id: randomUUID(),
      mediaId: media.id,
      start: 0,
      end: media.duration,
      speed: 1,
      zoom: 1,
      muted: false,
    })),
  );
  // Register sources before notifying the renderer; otherwise its first video request can race into 403.
  for (const media of imported)
    for (const path of [media.path, media.thumbnail, media.proxy])
      if (path) allowedFiles.add(await realpath(path));
  replaceProject(project);
  return emit();
}
async function transcribe(force = false, parentSignal?: AbortSignal) {
  const sourceProjectId = state.project.id;
  const sources = state.project.media.filter(
    (media) =>
      media.hasAudio &&
      (force || !state.project.words.some((word) => word.mediaId === media.id)),
  );
  if (!sources.length) {
    if (state.project.words.length) return emit();
    throw new Error("Importe um vídeo com fala para transcrever.");
  }
  const words = await job(
    "transcription",
    "Transcrevendo localmente…",
    async (signal, progress) => {
      const results = [];
      for (let i = 0; i < sources.length; i++)
        results.push(
          ...(await packages.transcribe(
            sources[i],
            cacheDir,
            (value) => progress((i * 100 + value) / sources.length),
            signal,
            force,
          )),
        );
      return results;
    },
    parentSignal,
  );
  parentSignal?.throwIfAborted();
  if (state.project.id !== sourceProjectId)
    throw new Error("O projeto mudou durante a transcrição.");
  replaceProject({
    ...structuredClone(state.project),
    words: [
      ...state.project.words.filter(
        (word) => !sources.some((source) => source.id === word.mediaId),
      ),
      ...words,
    ],
  });
  message(
    "system",
    `Transcrição local concluída: ${words.length} palavras. Nenhum áudio foi enviado para uma API.`,
  );
  return emit();
}
async function executeCommand(value: unknown) {
  const command = z
    .object({
      name: z.enum([
        "remove_range",
        "trim",
        "split",
        "delete_clip",
        "zoom",
        "speed",
        "clip_style",
        "captions",
        "normalize",
        "overlay",
        "motion",
        "delete_motion",
        "audio",
        "delete_audio",
        "remove_silence",
        "remove_fillers",
        "preset",
        "hook",
        "reset",
        "rename",
      ]),
      args: z.record(z.string(), z.unknown()),
    })
    .parse(value) as EditCommand;
  if (!state.project.media.length && command.name !== "rename")
    throw new Error("Importe um vídeo primeiro.");
  try {
    await job(
      "edit",
      toolActivityLabel(
        "edit_project",
        command as unknown as Record<string, unknown>,
      ),
      async (signal, progress) => {
        if (
          command.name === "remove_fillers" ||
          command.name === "preset" ||
          (command.name === "captions" && command.args.enabled === true)
        )
          await requireTranscription(signal);
        const before = state.project;
        if (command.name === "remove_silence" || command.name === "preset") {
          const ranges = [];
          for (let i = 0; i < before.media.length; i++) {
            const media = before.media[i];
            if (media.hasAudio)
              ranges.push(
                ...(
                  await detectSilences(media, {
                    signal,
                    onProgress: (value) =>
                      progress(
                        ((i * 100 + value) / before.media.length) * 0.9,
                        `Analisando pausas: ${media.name}`,
                      ),
                  })
                ).map((range) => ({
                  ...range,
                  mediaId: media.id,
                })),
              );
            progress(((i + 1) / before.media.length) * 90);
          }
          command.args = { ...command.args, ranges };
        }
        signal.throwIfAborted();
        progress(95, "Aplicando edição à timeline…");
        const after = applyCommand(before, command);
        signal.throwIfAborted();
        if (state.project !== before)
          throw new Error("O projeto mudou durante a edição.");
        replaceProject(after);
        const removed = Math.max(
          0,
          projectDuration(before) - projectDuration(after),
        );
        const summaries: Partial<Record<EditCommand["name"], string>> = {
          remove_silence:
            removed > 0.001
              ? `Pausas removidas: ${removed.toFixed(2)} s. A timeline já foi atualizada.`
              : "Análise concluída: nenhuma pausa removível de pelo menos 0,32 s foi encontrada nos trechos atuais.",
          remove_fillers:
            removed > 0.001
              ? `Muletas removidas: ${removed.toFixed(2)} s. A timeline já foi atualizada.`
              : "Análise concluída: nenhuma muleta reconhecida foi encontrada nos trechos atuais da transcrição.",
          preset: `Edição limpa aplicada: ${removed.toFixed(2)} s removidos; zooms e normalização de áudio configurados.`,
          captions: command.args.enabled
            ? "Legendas atualizadas. O estilo aparece na prévia e será usado na exportação."
            : "Legendas desativadas.",
        };
        const summary =
          summaries[command.name] ||
          `${toolActivityLabel("edit_project", command as unknown as Record<string, unknown>)}: concluído.`;
        progress(100, summary);
        message("system", summary);
      },
    );
  } catch (error) {
    message("system", error instanceof Error ? error.message : String(error));
    throw error;
  }
  return emit();
}
async function runChatCommand(value: unknown) {
  idle();
  const input = chatCommandRequest.parse(value);
  const { definition, options } = resolveChatCommand(
    input.id,
    state.project,
    input.options,
    input.context,
  );
  const id = definition.id;
  if (!["desfazer", "refazer"].includes(id) && !state.project.media.length)
    throw new Error("Importe um vídeo antes de aplicar comandos.");
  const display = `/${id}${options.text ? ` ${options.text}` : options.items?.length ? ` ${options.items.join(" | ")}` : ""}${definition.range ? ` · ${options.start!.toFixed(2)}–${options.end!.toFixed(2)} s` : ""}`;
  if (id === "animar")
    return request("sendChat", {
      text: `Crie uma animação original no projeto usando a ferramenta motion. Pedido do usuário: ${options.text}. Intervalo EXATO na timeline editada: ${options.start} a ${options.end} segundos. Preserve vídeo, voz e demais ajustes; use HTML/CSS e GSAP declarativo se necessário. Leia o projeto antes. Não exporte automaticamente.`,
      displayText: display,
      model: input.model,
      reasoningEffort: input.reasoningEffort,
    });
  message("user", display);
  try {
    if (id === "desfazer" || id === "refazer") {
      if (!(id === "desfazer" ? past.length : future.length))
        throw new Error(`Não há alterações para ${id}.`);
      await request(id === "desfazer" ? "undo" : "redo");
      message(
        "system",
        id === "desfazer" ? "Última edição desfeita." : "Edição refeita.",
      );
      return emit();
    }
    if (id === "transcrever") return await transcribe(false);
    if (id === "exportar") return await exportVideo();
    const primitive: Record<string, EditCommand> = {
      "edicao-limpa": { name: "preset", args: {} },
      "remover-pausas": { name: "remove_silence", args: {} },
      "remover-muletas": { name: "remove_fillers", args: {} },
      normalizar: {
        name: "normalize",
        args: { enabled: true, targetLufs: -14 },
      },
      legendar: {
        name: "captions",
        args: { enabled: true, style: { presetId: "clean-phrase" } },
      },
      "legenda-karaoke": {
        name: "captions",
        args: { enabled: true, style: { presetId: "karaoke" } },
      },
      "legenda-palavra": {
        name: "captions",
        args: { enabled: true, style: { presetId: "word-pop" } },
      },
      "sem-legendas": { name: "captions", args: { enabled: false } },
    };
    if (primitive[id]) return await executeCommand(primitive[id]);
    await job(
      "command",
      `Aplicando ${definition.label}…`,
      async (signal, progress) => {
        if (!state.project.clips.length)
          throw new Error(
            "Adicione um clipe à timeline antes de aplicar este comando.",
          );
        const before = state.project;
        progress(20, `Preparando ${definition.label}…`);
        const after = applyNativeChatCommand(
          before,
          id,
          options,
          input.context,
        );
        signal.throwIfAborted();
        if (state.project !== before)
          throw new Error("O projeto mudou durante o comando.");
        replaceProject(after);
        const duration = projectDuration(after);
        progress(100, `${definition.label} aplicado à timeline.`);
        message(
          "system",
          `${definition.label} aplicado. ${definition.range ? `Intervalo original ${options.start!.toFixed(2)}–${options.end!.toFixed(2)} s. ` : ""}${["timelapse", "camera-lenta"].includes(id) ? `Nova duração: ${duration.toFixed(2)} s. ` : ""}Você pode ajustar ou desfazer. O vídeo ainda não foi exportado.`,
        );
      },
    );
    return emit();
  } catch (error) {
    // Primitive edit/transcription/export functions already report their own progress;
    // command validation/render failures must still be visible in conversation.
    const text = error instanceof Error ? error.message : String(error);
    if (state.messages.at(-1)?.text !== text) message("system", text);
    throw error;
  }
}
/** Scenes first (cached), then the FFmpeg export. Shared by the export dialog, agent exports and reviews. */
async function renderAndExport(
  snapshot: Project,
  output: string,
  signal: AbortSignal,
  onProgress: (value: number, label?: string) => void,
) {
  const motions = await renderMotions(snapshot, {
    cache: join(cacheDir, "motions"),
    packages: packages.root,
    resources,
    worker: join(here, "render-motion.js"),
    signal,
    assets: await motionAssets(),
    onProgress: (p, label) => onProgress(p * 0.35, label),
  });
  await exportProject(snapshot, output, {
    signal,
    onProgress: (p) => onProgress(motions.length ? 35 + p * 0.65 : p),
    motions,
    fontPath: join(resources, "fonts", "Barlow-Regular.ttf"),
  });
}
async function exportVideo(destination: "dialog" | "videos" = "dialog") {
  if (!state.project.clips.length) throw new Error("A timeline está vazia.");
  let output: string;
  if (destination === "videos") {
    // Agents finish unattended: a fresh name in Videos/CutRoom, never an existing file.
    const folder = join(app.getPath("videos"), "CutRoom");
    await mkdir(folder, { recursive: true });
    const safe =
      state.project.name
        .replace(/[^\p{L}\p{N} _-]+/gu, "")
        .trim()
        .slice(0, 80) || "video";
    output = join(
      folder,
      `${safe}-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-")}.mp4`,
    );
  } else {
    const result = await dialog.showSaveDialog(window!, {
      title: "Exportar vídeo",
      defaultPath: `${state.project.name}-editado.mp4`,
      filters: [{ name: "Vídeo MP4", extensions: ["mp4"] }],
    });
    if (result.canceled || !result.filePath) {
      emit();
      return undefined;
    }
    output = resolve(
      result.filePath.endsWith(".mp4")
        ? result.filePath
        : `${result.filePath}.mp4`,
    );
  }
  if (
    state.project.media.some(
      (media) => resolve(media.path).toLowerCase() === output.toLowerCase(),
    )
  )
    throw new Error(
      "Escolha outro nome: o arquivo original deve ser preservado.",
    );
  const snapshot = structuredClone(state.project);
  await job(
    "export",
    "Exportando no seu computador…",
    async (signal, onProgress) => {
      await renderAndExport(snapshot, output, signal, onProgress);
      return output;
    },
  );
  message("system", `Exportação concluída: ${output}`);
  emit();
  return output;
}
async function executeTool(
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  if (name === "get_project") return structuredClone(state.project);
  if (name === "edit_project") {
    await executeCommand(args);
    return { project: state.project, applied: true };
  }
  if (name === "transcribe") {
    await transcribe();
    return { words: state.project.words };
  }
  if (name === "job_status")
    return {
      jobs: state.jobs.slice(-6).map(({ kind, label, progress, status, error, output, finishedAt }) => ({
        kind,
        label,
        progress: Math.round(progress),
        status,
        ...(error ? { error } : {}),
        ...(output ? { output } : {}),
        ...(finishedAt ? { finishedAt } : {}),
      })),
    };
  if (name === "export_video" && args.destination === "videos") {
    // MCP clients cut tool calls at ~60 s; a long export keeps running and job_status reports it.
    const running = exportVideo("videos");
    running.catch(() => undefined);
    const output = await Promise.race([
      running,
      new Promise<null>((done) => setTimeout(() => done(null), 40_000)),
    ]);
    if (output === null)
      return {
        exported: false,
        status: "exporting",
        message:
          "A exportação continua no computador do usuário. Chame job_status em 30–60 s; quando o job de export estiver completed, output é o caminho do MP4.",
        jobs: state.jobs.filter((job) => job.kind === "export").slice(-1),
      };
    return { exported: !!output, path: output };
  }
  if (name === "export_video") {
    const destination = args.destination === "videos" ? "videos" : "dialog";
    const output = await exportVideo(destination);
    return {
      exported: !!output,
      ...(output
        ? { path: output }
        : { message: "Exportação cancelada pelo usuário." }),
      jobs: state.jobs.filter((job) => job.kind === "export").slice(-1),
    };
  }
  const studioTools: Record<
    string,
    (a: Record<string, unknown>) => Promise<unknown> | unknown
  > = {
    add_audio: (a) => studio.addAudio(a),
    list_voices: (a) => studio.listVoices(a.provider as never),
    add_voiceover: (a) => studio.addVoiceover(a),
    search_music: (a) => studio.searchMusic(a),
    add_music: (a) => studio.addMusic(a),
    get_brand: () => studio.getBrand(),
    list_formats: () => studio.listFormats(),
    get_format_guide: (a) => studio.getFormatGuide(a),
    render_frame: (a) => studio.renderFrame(a),
    review_video: (a) => studio.reviewVideo(a),
  };
  if (studioTools[name]) return studioTools[name](args);
  if (name === "inspect_frame") {
    const { mediaId, time } = z
      .object({ mediaId: z.string(), time: z.number().finite().min(0) })
      .parse(args);
    const media = state.project.media.find((source) => source.id === mediaId);
    if (!media || time >= media.duration)
      throw new Error("Quadro fora da fonte selecionada.");
    const frame = join(cacheDir, `inspect-${randomUUID()}.jpg`);
    await job(
      "inspection",
      "Inspecionando quadro do vídeo…",
      async (signal) => {
        await runProcess(
          ffmpegPath,
          [
            "-hide_banner",
            "-loglevel",
            "error",
            "-ss",
            String(time),
            "-i",
            media.path,
            "-frames:v",
            "1",
            "-vf",
            "scale=960:-2",
            "-y",
            frame,
          ],
          { signal },
        );
      },
    );
    return {
      imageUrl: `data:image/jpeg;base64,${(await readFile(frame)).toString("base64")}`,
      text: `Frame real de ${media.name}, tempo na fonte ${time}s.`,
    };
  }
  if (name === "create_blank_canvas") {
    const {
      duration = 15,
      color = "#151515",
      name: canvasName = "Canvas Motion",
      aspect,
    } = z
      .object({
        duration: z.number().min(1).max(600).default(15),
        color: z
          .string()
          .regex(/^#[0-9a-f]{6}$/i)
          .default("#151515"),
        name: z.string().max(100).default("Canvas Motion"),
        aspect: z.enum(["16:9", "9:16", "1:1", "4:5"]).optional(),
      })
      .parse(args);
    // The first media sets the export size, so a vertical canvas makes a vertical project.
    const [canvasW, canvasH] = state.project.media.length
      ? [state.project.settings.width, state.project.settings.height]
      : CANVAS_SIZES[aspect ?? "16:9"];
    const canvasColorHex = color.replace("#", "0x");
    const canvasFile = join(cacheDir, `canvas-${randomUUID()}.mp4`);
    await runProcess(
      ffmpegPath,
      [
        "-f",
        "lavfi",
        "-i",
        `color=c=${canvasColorHex}:s=${canvasW}x${canvasH}:r=30:d=${duration}`,
        "-f",
        "lavfi",
        "-i",
        "anullsrc=channel_layout=stereo:sample_rate=48000",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-shortest",
        "-y",
        canvasFile,
      ],
      { signal: new AbortController().signal },
    );
    await importPaths({ paths: [canvasFile] });
    if (
      state.project.name === "Novo projeto" ||
      state.project.name.startsWith("canvas-")
    ) {
      state.project.name = canvasName;
      emit();
    }
    return {
      success: true,
      duration,
      color,
      size: `${state.project.settings.width}x${state.project.settings.height}`,
      project: state.project,
      message: `Canvas de ${duration}s criado com sucesso. Agora você pode adicionar motions, títulos e efeitos no intervalo de 0 a ${duration}s!`,
    };
  }
  if (name === "import_media") {
    const { paths } = z
      .object({
        paths: z.array(z.string().min(1)).min(1).max(50),
      })
      .parse(args);
    await importPaths({ paths });
    return {
      success: true,
      imported: paths.length,
      project: state.project,
    };
  }
  throw new Error("Ferramenta não autorizada.");
}

async function connectCodex(value: unknown = {}) {
  const config = z
    .object({
      provider: z.enum(AGENT_PROVIDERS).default("codex"),
      apiKey: z.string().trim().max(1000).optional(),
      baseUrl: z.string().trim().max(2000).optional(),
      model: z.string().trim().min(1).max(200).optional(),
      cliPath: z.string().trim().max(2000).optional(),
    })
    .parse(value);
  if (chatBusy) throw new Error("Cancele a conversa antes de reconectar.");
  const generation = ++connectionGeneration;
  codex?.disconnect();
  state.connection = {
    status: "connecting",
    provider: config.provider,
    models: [],
  };
  emit();
  const instructions = await readFile(
    join(resources, "presets", "edicao-limpa.md"),
    "utf8",
  );
  if (generation !== connectionGeneration)
    throw new Error("Conexão substituída.");
  const options = {
    workspace: join(userDir, "agent-workspace"),
    instructions,
    onActivity: (entry: AgentActivity) => {
      if (generation === connectionGeneration) activity(entry);
    },
    onStatus: (info: import("./core/codex").CodexStatus) => {
      if (
        generation === connectionGeneration &&
        state.connection.status !== "disconnected"
      ) {
        state.connection = {
          status: "connected",
          provider: config.provider,
          ...info,
        };
        emit();
      }
    },
    onText: (text: string) => {
      if (generation !== connectionGeneration) return;
      const last = state.messages.at(-1);
      if (last?.role === "assistant") last.text += text;
      else message("assistant", text);
      emit();
    },
    onTool: async (name: string, args: Record<string, unknown>) => {
      if (generation !== connectionGeneration)
        throw new Error("Conexão encerrada.");
      return executeTool(name, args);
    },
  };
  let client: AgentClient | undefined;
  try {
    client =
      config.provider === "codex"
        ? new CodexClient(options)
        : config.provider === "claude-code"
          ? new ClaudeAgentClient(options, config)
          : new ApiAgentClient(options, config);
    codex = client;
    const info = await client.connect(config.apiKey);
    if (generation !== connectionGeneration) {
      client.disconnect();
      throw new Error("Conexão substituída.");
    }
    state.connection = {
      status: "connected",
      provider: config.provider,
      models: info.models,
      account: info.account,
      model: info.model,
      reasoningEffort: info.reasoningEffort,
    };
    return emit();
  } catch (error) {
    client?.disconnect();
    if (generation !== connectionGeneration) throw error;
    state.connection = {
      status: "error",
      provider: config.provider,
      models: [],
      error: error instanceof Error ? error.message : String(error),
    };
    emit();
    throw error;
  }
}

async function request(method: string, params?: unknown): Promise<unknown> {
  switch (method) {
    case "runChatCommand":
      return runChatCommand(params);
    case "setAppearance": {
      appearance = appearanceSchema.parse(params);
      applyWindowAppearance();
      const serialized = JSON.stringify(appearance);
      appearanceSave = appearanceSave
        .catch(() => {})
        .then(async () => {
          await writeFile(join(userDir, "appearance.json.partial"), serialized);
          await rename(
            join(userDir, "appearance.json.partial"),
            join(userDir, "appearance.json"),
          );
        });
      await appearanceSave;
      return { ...appearance };
    }
    case "getState":
      state.packages = await packages.list();
      return emit();
    case "getVoiceSettings":
      return studio.voiceSettings();
    case "setVoiceKey": {
      const { provider, key } = z
        .object({
          provider: z.enum(["elevenlabs", "openai"]),
          key: z.string().max(500).optional(),
        })
        .parse(params);
      return studio.setVoiceKey(provider, key);
    }
    case "setVoicePreferences":
      return studio.setVoicePreferences(params);
    case "listVoices":
      return studio.listVoices(
        z
          .object({ provider: z.enum(["elevenlabs", "openai", "local"]).optional() })
          .parse(params ?? {}).provider,
      );
    case "getBrand":
      return { brand: (await brandStore.get()) ?? null };
    case "saveBrand":
      return { brand: await brandStore.set(params) };
    case "carrossellProfiles":
      return carrossellProfiles();
    case "importCarrossellBrand": {
      const { profileId } = z
        .object({ profileId: z.string().max(100).optional() })
        .parse(params ?? {});
      return {
        brand: await brandStore.set(await importCarrossellBrand(profileId)),
      };
    }
    case "dismissOnboarding":
      state.onboarding = {
        dismissed: true,
        transcriptionReady: !!state.onboarding?.transcriptionReady,
      };
      await writeFile(
        join(userDir, "preferences.json.partial"),
        JSON.stringify({ onboardingDismissed: true }),
      );
      await rename(
        join(userDir, "preferences.json.partial"),
        join(userDir, "preferences.json"),
      );
      return emit();
    case "importMedia": {
      const result = await dialog.showOpenDialog(window!, {
        title: "Importar vídeo",
        properties: ["openFile", "multiSelections"],
        filters: [
          {
            name: "Vídeos",
            extensions: ["mp4", "mov", "mkv", "webm", "avi", "m4v", "mts"],
          },
        ],
      });
      return result.canceled
        ? emit()
        : importPaths({ paths: result.filePaths });
    }
    case "importPaths":
      return importPaths(params);
    case "newProject":
      idle();
      state.project = createProject();
      state.projectPath = undefined;
      state.messages = [];
      state.jobs = [];
      state.activities = [];
      past = [];
      future = [];
      ++connectionGeneration;
      codex?.disconnect();
      codex = undefined;
      state.connection = { status: "disconnected", models: [] };
      await allowProjectFiles();
      return emit();
    case "saveProject": {
      let path = state.projectPath;
      if (!path) {
        const result = await dialog.showSaveDialog(window!, {
          defaultPath: `${state.project.name}.cutroom.json`,
          filters: [{ name: "Projeto CutRoom", extensions: ["cutroom.json"] }],
        });
        if (result.canceled || !result.filePath) return emit();
        path = result.filePath;
      }
      await writeFile(
        `${path}.partial`,
        JSON.stringify({ ...state.project, chat: state.messages }, null, 2),
      );
      await rename(`${path}.partial`, path);
      state.projectPath = path;
      return emit();
    }
    case "openProject": {
      idle();
      const result = await dialog.showOpenDialog(window!, {
        filters: [{ name: "Projeto CutRoom", extensions: ["json"] }],
        properties: ["openFile"],
      });
      if (result.canceled) return emit();
      const info = await stat(result.filePaths[0]);
      if (info.size > 25_000_000)
        throw new Error("Arquivo de projeto muito grande.");
      const parsed = JSON.parse(await readFile(result.filePaths[0], "utf8"));
      const chat = z
        .array(
          z.object({
            id: z.string(),
            role: z.enum(["user", "assistant", "system"]),
            text: z.string().max(250_000),
            createdAt: z.string(),
          }),
        )
        .max(2000)
        .parse(parsed.chat || []);
      delete parsed.chat;
      const project = validateProject(parsed);
      for (const media of project.media) await access(media.path);
      ++connectionGeneration;
      codex?.disconnect();
      codex = undefined;
      state.connection = { status: "disconnected", models: [] };
      state.project = project;
      state.messages = chat;
      state.jobs = [];
      state.activities = [];
      state.projectPath = result.filePaths[0];
      past = [];
      future = [];
      await allowProjectFiles();
      return emit();
    }
    case "executeCommand":
      if (state.busy) throw new Error("Aguarde a operação atual.");
      return executeCommand(params);
    case "undo":
      if (state.busy) throw new Error("Aguarde a operação atual.");
      if (past.length) {
        future.push(structuredClone(state.project));
        state.project = past.pop()!;
      }
      return emit();
    case "redo":
      if (state.busy) throw new Error("Aguarde a operação atual.");
      if (future.length) {
        past.push(structuredClone(state.project));
        state.project = future.pop()!;
      }
      return emit();
    case "connectAgent":
    case "connectCodex":
      return connectCodex(params);
    case "disconnectAgent":
    case "disconnectCodex":
      ++connectionGeneration;
      await codex?.interrupt();
      codex?.disconnect();
      codex = undefined;
      state.connection = { status: "disconnected", models: [] };
      return emit();
    case "sendChat": {
      const { text, displayText, model, reasoningEffort } = z
        .object({
          text: z.string().trim().min(1).max(25_000),
          displayText: z.string().max(2000).optional(),
          model: z.string().max(200).optional(),
          reasoningEffort: z
            .enum(["none", "minimal", "low", "medium", "high", "xhigh", "max"])
            .optional(),
        })
        .parse(params);
      if (!codex || state.connection.status !== "connected")
        throw new Error("Conecte uma IA antes de enviar.");
      if (state.busy || chatBusy)
        throw new Error("Aguarde ou cancele a operação atual.");
      chatBusy = true;
      message("user", displayText || text);
      message("assistant", "");
      try {
        await codex.send(text, model, reasoningEffort);
        if (model) state.connection.model = model;
      } catch (error) {
        message(
          "system",
          error instanceof Error ? error.message : String(error),
        );
        throw error;
      } finally {
        chatBusy = false;
        emit();
      }
      return emit();
    }
    case "cancelChat":
      for (const controller of controllers.values()) controller.abort();
      await codex?.interrupt();
      return emit();
    case "transcribe":
      idle();
      return transcribe(true);
    case "exportVideo":
      idle();
      await exportVideo();
      return emit();
    case "installPackage": {
      idle();
      const { id } = z.object({ id: z.string() }).parse(params);
      state.packages = (await packages.list()).map((item) =>
        item.id === id ? { ...item, status: "installing" } : item,
      );
      emit();
      try {
        await job(
          "package",
          `Instalando ${state.packages.find((p) => p.id === id)?.name ?? "pacote"}…`,
          (signal, progress) => packages.install(id, progress, signal),
        );
      } catch (error) {
        state.packages = (await packages.list()).map((item) =>
          item.id === id
            ? {
                ...item,
                status: "error",
                error: error instanceof Error ? error.message : String(error),
              }
            : item,
        );
        emit();
        throw error;
      }
      state.packages = await packages.list();
      return emit();
    }
    case "getMotionPreview": {
      const { id } = z.object({ id: z.string() }).parse(params);
      const scene = state.project.motions?.find((s) => s.id === id);
      if (!scene) throw new Error("Animação não encontrada.");
      const assets = await motionAssets();
      const key = motionCacheKey(scene, state.project.settings, assets);
      if (!motionDocuments.has(key)) {
        const html = await motionDocument(
          scene,
          state.project.settings,
          resources,
          true,
          assets,
        );
        if (motionDocuments.size >= 100)
          motionDocuments.delete(motionDocuments.keys().next().value!);
        motionDocuments.set(key, html);
      }
      return { url: `cutroom-motion://scene/${key}` };
    }
    case "repairPreview": {
      const { id } = z.object({ id: z.string() }).parse(params);
      const original = state.project.media.find((m) => m.id === id);
      if (!original) throw new Error("Arquivo não encontrado.");
      await job(
        "preview",
        "Preparando uma prévia compatível…",
        async (signal) => {
          const prepared = await probeMedia(original.path, cacheDir, {
            signal,
            forceProxy: true,
          });
          state.project = {
            ...state.project,
            media: state.project.media.map((m) =>
              m.id === id ? { ...m, proxy: prepared.proxy } : m,
            ),
          };
          await allowProjectFiles();
          emit();
        },
      );
      return emit();
    }
    case "cancelJob": {
      const { id } = z.object({ id: z.string() }).parse(params);
      controllers.get(id)?.abort();
      return emit();
    }
    case "revealFile": {
      const { path } = z.object({ path: z.string() }).parse(params);
      const actual = await realpath(path);
      if (!allowedFiles.has(actual))
        throw new Error("Arquivo não pertence ao projeto.");
      shell.showItemInFolder(actual);
      return emit();
    }
    default:
      throw new Error("Operação desconhecida.");
  }
}

app.whenReady().then(async () => {
  userDir = process.env.CUTROOM_USER_DATA || app.getPath("userData");
  try {
    appearance = appearanceSchema.parse(
      JSON.parse(await readFile(join(userDir, "appearance.json"), "utf8")),
    );
  } catch {
    /* First launch uses graphite. */
  }
  nativeTheme.themeSource = appearance.mode;
  cacheDir = join(userDir, "cache");
  await mkdir(cacheDir, { recursive: true });
  await mkdir(join(userDir, "agent-workspace"), { recursive: true });
  packages = new PackageManager(join(userDir, "packages"), resources);
  brandStore = new BrandStore(userDir);
  studio = new Studio({
    project: () => state.project,
    command: async (command) => {
      await executeCommand(command);
    },
    job: (kind, label, run) => job(kind, label, run),
    allowFile: async (path) => {
      allowedFiles.add(await realpath(path));
    },
    cacheDir,
    userDir,
    secrets: new SecretStore(userDir, safeStorage),
    brand: brandStore,
    transcribeFile: (media, signal, progress) =>
      packages.transcribe(media, cacheDir, progress, signal),
    exportTo: (project, output, signal, progress) =>
      renderAndExport(project, output, signal, progress),
    ...(["win32", "darwin"].includes(process.platform)
      ? {
          localSpeech: async (text: string, voice: string | undefined, signal: AbortSignal) => {
            const dir = join(cacheDir, "voice");
            await mkdir(dir, { recursive: true });
            return localSpeech(text, voice, signal, dir, (path) => probeAudio(path, signal));
          },
          localVoices,
        }
      : {}),
  });
  state.packages = await packages.list();
  try {
    const preferences = JSON.parse(
      await readFile(join(userDir, "preferences.json"), "utf8"),
    );
    state.onboarding = {
      dismissed: preferences.onboardingDismissed === true,
      transcriptionReady: false,
    };
  } catch {
    /* A new installation shows the welcome guidance. */
  }
  protocol.handle("cutroom", async (req) => {
    try {
      const url = new URL(req.url);
      if (url.hostname !== "media")
        return new Response("Not found", { status: 404 });
      const path = await realpath(url.searchParams.get("path") || "");
      if (!allowedFiles.has(path))
        return new Response("Forbidden", { status: 403 });
      const size = (await stat(path)).size;
      const range = req.headers.get("range");
      const match = range?.match(/^bytes=(\d+)-(\d*)$/);
      const start = match ? Number(match[1]) : 0;
      const end = match?.[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
      if (start > end || start < 0 || end >= size)
        return new Response(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${size}` },
        });
      const mime =
        (
          {
            ".mp4": "video/mp4",
            ".mov": "video/quicktime",
            ".webm": "video/webm",
            ".jpg": "image/jpeg",
            ".png": "image/png",
            ".mp3": "audio/mpeg",
            ".wav": "audio/wav",
            ".m4a": "audio/mp4",
            ".aac": "audio/aac",
            ".ogg": "audio/ogg",
            ".opus": "audio/ogg",
            ".flac": "audio/flac",
          } as Record<string, string>
        )[extname(path).toLowerCase()] || "application/octet-stream";
      const headers: Record<string, string> = {
        "Content-Type": mime,
        "Content-Length": String(end - start + 1),
        "Accept-Ranges": "bytes",
      };
      if (match) headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
      return new Response(
        Readable.toWeb(
          createReadStream(path, { start, end }),
        ) as ReadableStream<Uint8Array>,
        { status: match ? 206 : 200, headers },
      );
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
  protocol.handle("cutroom-motion", (req) => {
    const url = new URL(req.url);
    const html =
      url.hostname === "scene"
        ? motionDocuments.get(url.pathname.slice(1))
        : undefined;
    return new Response(html ?? "Not found", {
      status: html ? 200 : 404,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  });
  window = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1050,
    minHeight: 700,
    backgroundColor: appearance.background,
    title: "CutRoom",
    icon: join(resources, "branding", "icon-256.png"),
    autoHideMenuBar: true,
    ...(process.platform === "win32"
      ? {
          titleBarStyle: "hidden" as const,
          titleBarOverlay: {
            color: appearance.background,
            symbolColor: appearance.foreground,
            height: 40,
          },
        }
      : {}),
    webPreferences: {
      preload: join(here, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    if (url !== window?.webContents.getURL()) event.preventDefault();
  });
  ipcMain.handle("editor:request", (event, method, params) => {
    if (
      event.sender !== window?.webContents ||
      event.senderFrame !== window.webContents.mainFrame
    )
      throw new Error("Origem não autorizada.");
    if (typeof method !== "string") throw new Error("Operação inválida.");
    return request(method, params);
  });
  if (process.env.ELECTRON_RENDERER_URL)
    await window.loadURL(process.env.ELECTRON_RENDERER_URL);
  else await window.loadFile(join(here, "../dist/index.html"));
  startWindowsAutoUpdate(window);

  desktopMcp = new DesktopMcpServer(executeTool, userDir);
  await desktopMcp.start().catch((err) => {
    console.error("Falha ao iniciar servidor Desktop MCP do CutRoom:", err);
  });
});
app.on("before-quit", () => {
  desktopMcp?.close();
  codex?.disconnect();
  for (const controller of controllers.values()) controller.abort();
});
app.on("window-all-closed", () => app.quit());

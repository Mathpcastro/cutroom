import { app, BrowserWindow, dialog, ipcMain, protocol, shell } from "electron";
import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
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
} from "../src/shared/types";
import { createProject, validateProject, applyCommand } from "./core/project";
import {
  probeMedia,
  detectSilences,
  exportProject,
  ffmpegPath,
} from "./core/media";
import { PackageManager } from "./core/packages";
import { CodexClient } from "./core/codex";
import { runProcess } from "./core/process";

const here = dirname(fileURLToPath(import.meta.url));
const resources = app.isPackaged
  ? join(process.resourcesPath, "resources")
  : resolve(here, "../resources");
protocol.registerSchemesAsPrivileged([
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
let codex: CodexClient | undefined;
let cacheDir: string;
let userDir: string;
let chatBusy = false;
const allowedFiles = new Set<string>();
const controllers = new Map<string, AbortController>();
let past: Project[] = [];
let future: Project[] = [];
let state: AppSnapshot = {
  project: createProject(),
  messages: [],
  jobs: [],
  packages: [],
  connection: { status: "disconnected", models: [] },
  busy: false,
  canUndo: false,
  canRedo: false,
};

function emit() {
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
  allowedFiles.clear();
  for (const media of state.project.media)
    for (const path of [media.path, media.thumbnail, media.proxy])
      if (path) {
        try {
          allowedFiles.add(await realpath(path));
        } catch {
          /* Missing source is shown on opening, never silently substituted. */
        }
      }
}
async function job<T>(
  kind: string,
  label: string,
  run: (
    signal: AbortSignal,
    progress: (percent: number, label?: string) => void,
  ) => Promise<T>,
): Promise<T> {
  const entry: Job = {
    id: randomUUID(),
    kind,
    label,
    status: "running",
    progress: 0,
  };
  state.jobs = [...state.jobs.slice(-19), entry];
  const controller = new AbortController();
  controllers.set(entry.id, controller);
  emit();
  try {
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
async function transcribe(force = false) {
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
  );
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
        "captions",
        "normalize",
        "overlay",
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
  if (command.name === "remove_fillers" && !state.project.words.length)
    throw new Error("Transcreva o vídeo antes de remover muletas.");
  if (command.name === "remove_silence" || command.name === "preset") {
    const ranges = await job(
      "analysis",
      "Analisando pausas…",
      async (signal, progress) => {
        const ranges = [];
        for (let i = 0; i < state.project.media.length; i++) {
          const media = state.project.media[i];
          if (media.hasAudio)
            ranges.push(
              ...(await detectSilences(media, { signal })).map((range) => ({
                ...range,
                mediaId: media.id,
              })),
            );
          progress(((i + 1) / state.project.media.length) * 100);
        }
        return ranges;
      },
    );
    command.args = { ...command.args, ranges };
  }
  replaceProject(applyCommand(state.project, command));
  if (command.name === "preset" && !state.project.words.length)
    message(
      "system",
      "Preset aplicado às pausas, zoom e áudio. Transcreva para identificar muletas pela fala.",
    );
  return emit();
}
async function exportVideo() {
  if (!state.project.clips.length) throw new Error("A timeline está vazia.");
  const result = await dialog.showSaveDialog(window!, {
    title: "Exportar vídeo",
    defaultPath: `${state.project.name}-editado.mp4`,
    filters: [{ name: "Vídeo MP4", extensions: ["mp4"] }],
  });
  if (result.canceled || !result.filePath) return emit();
  const output = resolve(
    result.filePath.endsWith(".mp4")
      ? result.filePath
      : `${result.filePath}.mp4`,
  );
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
      await exportProject(snapshot, output, {
        signal,
        onProgress,
        fontPath: join(resources, "fonts", "Barlow-Regular.ttf"),
      });
      return output;
    },
  );
  message("system", `Exportação concluída: ${output}`);
  return emit();
}
async function connectCodex(value: unknown = {}) {
  const { apiKey } = z
    .object({ apiKey: z.string().max(1000).optional() })
    .parse(value);
  if (chatBusy) throw new Error("Cancele a conversa antes de reconectar.");
  codex?.disconnect();
  state.connection = { status: "connecting", models: [] };
  emit();
  const instructions = await readFile(
    join(resources, "presets", "edicao-limpa.md"),
    "utf8",
  );
  codex = new CodexClient({
    workspace: join(userDir, "agent-workspace"),
    instructions,
    onText: (text) => {
      const last = state.messages.at(-1);
      if (last?.role === "assistant") last.text += text;
      else message("assistant", text);
      emit();
    },
    onTool: async (name, args) => {
      if (name === "get_project") return structuredClone(state.project);
      if (name === "edit_project") {
        await executeCommand(args);
        return { project: state.project, applied: true };
      }
      if (name === "transcribe") {
        await transcribe();
        return { words: state.project.words };
      }
      if (name === "export_video") {
        await exportVideo();
        return {
          jobs: state.jobs.filter((job) => job.kind === "export").slice(-1),
        };
      }
      if (name === "inspect_frame") {
        const { mediaId, time } = z
          .object({ mediaId: z.string(), time: z.number().finite().min(0) })
          .parse(args);
        const media = state.project.media.find(
          (source) => source.id === mediaId,
        );
        if (!media || time >= media.duration)
          throw new Error("Quadro fora da fonte selecionada.");
        const frame = join(cacheDir, `inspect-${randomUUID()}.jpg`);
        await runProcess(ffmpegPath, [
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
        ]);
        return {
          imageUrl: `data:image/jpeg;base64,${(await readFile(frame)).toString("base64")}`,
          text: `Frame real de ${media.name}, tempo na fonte ${time}s.`,
        };
      }
      throw new Error("Ferramenta não autorizada.");
    },
  });
  try {
    const info = await codex.connect(apiKey);
    state.connection = {
      status: "connected",
      models: info.models,
      account: info.account,
      model: info.model,
    };
    return emit();
  } catch (error) {
    codex.disconnect();
    state.connection = {
      status: "error",
      models: [],
      error: error instanceof Error ? error.message : String(error),
    };
    emit();
    throw error;
  }
}

async function request(method: string, params?: unknown): Promise<unknown> {
  switch (method) {
    case "getState":
      state.packages = await packages.list();
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
      past = [];
      future = [];
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
      codex?.disconnect();
      codex = undefined;
      state.connection = { status: "disconnected", models: [] };
      state.project = project;
      state.messages = chat;
      state.jobs = [];
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
    case "connectCodex":
      return connectCodex(params);
    case "disconnectCodex":
      await codex?.interrupt();
      codex?.disconnect();
      codex = undefined;
      state.connection = { status: "disconnected", models: [] };
      return emit();
    case "sendChat": {
      const { text, model } = z
        .object({
          text: z.string().trim().min(1).max(25_000),
          model: z.string().max(200).optional(),
        })
        .parse(params);
      if (!codex || state.connection.status !== "connected")
        throw new Error("Conecte o Codex antes de enviar.");
      if (state.busy) throw new Error("Aguarde ou cancele a operação atual.");
      chatBusy = true;
      message("user", text);
      message("assistant", "");
      try {
        await codex.send(text, model);
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
      return exportVideo();
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
          "Instalando transcrição local…",
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
  cacheDir = join(userDir, "cache");
  await mkdir(cacheDir, { recursive: true });
  await mkdir(join(userDir, "agent-workspace"), { recursive: true });
  packages = new PackageManager(join(userDir, "packages"), resources);
  state.packages = await packages.list();
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
  window = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1050,
    minHeight: 700,
    backgroundColor: "#161816",
    title: "CutRoom",
    autoHideMenuBar: true,
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
});
app.on("before-quit", () => {
  codex?.disconnect();
  for (const controller of controllers.values()) controller.abort();
});
app.on("window-all-closed", () => app.quit());

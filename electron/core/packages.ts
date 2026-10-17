import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { unzipSync } from "fflate";
import type { Media, PackageInfo, Word } from "../../src/shared/types";
import { runProcess } from "./process";
import manifest from "../../resources/packages/transcription-base.json";

const UV_VERSION = "0.11.21";
const UV_SHA256 =
  "ace861f360c6de2babedc1607d0f454b6b09a820dbc8182dc15af927e4df9589";
export const TRANSCRIPTION_PACKAGE = "faster-whisper-base";
/** Some ASR tokens have zero duration. Merge their text with a timed neighbor instead of inventing speech boundaries. */
export function normalizeTranscript(value: unknown, media: Media): Word[] {
  if (!Array.isArray(value))
    throw new Error("O transcritor retornou um resultado inválido.");
  const result: Word[] = [];
  let pending = "";
  for (const raw of value) {
    if (
      !raw ||
      typeof raw.text !== "string" ||
      !Number.isFinite(raw.start) ||
      !Number.isFinite(raw.end)
    )
      throw new Error("Tempos de transcrição inválidos.");
    const text = raw.text.trim();
    if (!text) continue;
    const start = Math.max(0, Math.min(media.duration, raw.start));
    const end = Math.max(0, Math.min(media.duration, raw.end));
    if (end <= start) {
      pending = `${pending} ${text}`.trim();
      continue;
    }
    result.push({
      text: `${pending} ${text}`.trim(),
      start,
      end,
      mediaId: media.id,
    });
    pending = "";
  }
  if (pending && result.length) result[result.length - 1].text += ` ${pending}`;
  return result;
}
export class PackageManager {
  constructor(
    readonly root: string,
    readonly resources: string,
  ) {}
  private python() {
    return join(this.root, "transcription", "Scripts", "python.exe");
  }
  private model() {
    return join(this.root, "models", "base", "model.bin");
  }
  async list(): Promise<PackageInfo[]> {
    const filesExist = await Promise.all(
      [this.python(), this.model()].map((path) =>
        access(path).then(
          () => true,
          () => false,
        ),
      ),
    ).then((items) => items.every(Boolean));
    const marker = await readFile(
      join(this.root, "transcription.ready.json"),
      "utf8",
    )
      .then(
        (text) => JSON.parse(text),
        () => null,
      )
      .catch(() => null);
    const installed = filesExist && marker?.version === manifest.version;
    return [
      {
        id: manifest.id,
        name: manifest.name,
        description:
          "Faster Whisper · modelo multilíngue base. Transcreve e marca cada palavra no seu PC, sem créditos de API.",
        version: manifest.version,
        size: "Centenas de MB · download único",
        installed,
        status: installed ? "installed" : "available",
        capabilities: manifest.capabilities,
      },
    ];
  }
  async install(
    id: string,
    onProgress: (progress: number, label: string) => void,
    signal?: AbortSignal,
  ) {
    if (id !== TRANSCRIPTION_PACKAGE) throw new Error("Pacote desconhecido.");
    if (process.platform !== "win32" || process.arch !== "x64")
      throw new Error("O pacote desta versão requer Windows x64.");
    await mkdir(this.root, { recursive: true });
    const uv = join(this.root, "bootstrap", `uv-${UV_VERSION}.exe`);
    await mkdir(join(this.root, "bootstrap"), { recursive: true });
    try {
      await access(uv);
    } catch {
      onProgress(2, "Baixando o instalador do runtime local…");
      const response = await fetch(
        `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/uv-x86_64-pc-windows-msvc.zip`,
        { signal },
      );
      if (!response.ok)
        throw new Error(`Falha ao baixar runtime: HTTP ${response.status}.`);
      const archive = new Uint8Array(await response.arrayBuffer());
      if (createHash("sha256").update(archive).digest("hex") !== UV_SHA256)
        throw new Error(
          "O download do runtime não passou na verificação de integridade.",
        );
      const entries = unzipSync(archive);
      const name = Object.keys(entries).find(
        (name) => name === "uv.exe" || name.endsWith("/uv.exe"),
      );
      if (!name) throw new Error("Runtime sem executável esperado.");
      await writeFile(`${uv}.partial`, entries[name]);
      await rename(`${uv}.partial`, uv);
    }
    const env = {
      ...process.env,
      UV_PYTHON_INSTALL_DIR: join(this.root, "python"),
      UV_PYTHON_BIN_DIR: join(this.root, "bin"),
      UV_CACHE_DIR: join(this.root, "cache"),
      UV_NO_MODIFY_PATH: "1",
      PYTHONUTF8: "1",
    };
    onProgress(12, "Instalando Python privado do CutRoom…");
    try {
      await access(this.python());
    } catch {
      await runProcess(
        uv,
        [
          "--no-config",
          "venv",
          "--python",
          "3.12",
          "--managed-python",
          join(this.root, "transcription"),
        ],
        { env, signal },
      );
    }
    onProgress(30, "Instalando o motor de transcrição…");
    try {
      await runProcess(
        uv,
        [
          "--no-config",
          "pip",
          "install",
          "--python",
          this.python(),
          "--link-mode",
          "copy",
          "--require-hashes",
          "-r",
          join(this.resources, "workers", "requirements.lock"),
        ],
        { env, signal },
      );
    } catch (error) {
      if (signal?.aborted) throw error;
      // Windows antivirus can retain extracted DLLs and prevent uv's atomic cache rename.
      // pip installs the exact same hash-locked wheels without that cache promotion step.
      onProgress(35, "Concluindo a instalação do runtime…");
      await runProcess(this.python(), ["-m", "ensurepip", "--upgrade"], {
        env,
        signal,
      });
      await runProcess(
        this.python(),
        [
          "-m",
          "pip",
          "install",
          "--disable-pip-version-check",
          "--no-warn-script-location",
          "--require-hashes",
          "-r",
          join(this.resources, "workers", "requirements.lock"),
        ],
        { env, signal },
      );
    }
    await runProcess(
      this.python(),
      [
        "-X",
        "utf8",
        join(this.resources, "workers", "transcribe.py"),
        "install",
        "--models",
        join(this.root, "models"),
      ],
      {
        env,
        signal,
        onLine: (line) => {
          try {
            const value = JSON.parse(line);
            if (value.error) throw new Error(value.error);
            if (value.progress) onProgress(value.progress, value.message);
          } catch {
            /* Worker failure is also reported by its exit code. */
          }
        },
      },
    );
    await writeFile(
      join(this.root, "transcription.ready.json"),
      JSON.stringify({
        version: manifest.version,
        installedAt: new Date().toISOString(),
      }),
    );
    onProgress(100, "Transcrição local pronta.");
  }
  async transcribe(
    media: Media,
    cacheDir: string,
    onProgress: (progress: number) => void,
    signal?: AbortSignal,
    force = false,
  ): Promise<Word[]> {
    if (!(await this.list())[0].installed)
      throw new Error("Instale o pacote Transcrição local na aba Pacotes.");
    await mkdir(cacheDir, { recursive: true });
    const cacheKey = createHash("sha256").update(media.id).digest("hex");
    const output = join(cacheDir, `${cacheKey}.transcript.json`);
    try {
      const cached = JSON.parse(await readFile(output, "utf8"));
      if (!force && Array.isArray(cached.words))
        return normalizeTranscript(cached.words, media);
    } catch {
      /* No cached transcript yet. */
    }
    await runProcess(
      this.python(),
      [
        "-X",
        "utf8",
        join(this.resources, "workers", "transcribe.py"),
        "transcribe",
        "--models",
        join(this.root, "models"),
        "--input",
        media.path,
        "--output",
        output,
        "--media-id",
        media.id,
      ],
      {
        signal,
        env: { ...process.env, HF_HUB_OFFLINE: "1", PYTHONUTF8: "1" },
        onLine: (line) => {
          try {
            const value = JSON.parse(line);
            if (typeof value.progress === "number") onProgress(value.progress);
          } catch {
            /* Ignore non-JSON library logs. */
          }
        },
      },
    );
    const result = JSON.parse(await readFile(output, "utf8"));
    if (!Array.isArray(result.words))
      throw new Error("O transcritor retornou um resultado inválido.");
    return normalizeTranscript(result.words, media);
  }
}

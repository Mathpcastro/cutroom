import { createHash } from "node:crypto";
import { access, chmod, mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { unzipSync } from "fflate";
import type { Media, PackageInfo, Word } from "../../src/shared/types";
import { runProcess } from "./process";
import manifest from "../../resources/packages/transcription-base.json";
import { MOTION_PACKAGE, motionPackageInfo, installMotionPackage } from "./motion-package";

const UV_VERSION = "0.11.21";

// Checksums e configuração por plataforma para o uv
const UV_PLATFORM_MAP: Partial<Record<string, Partial<Record<string, { sha256: string; asset: string; binary: string }>>>>  = {
  win32: {
    x64: {
      sha256: "ace861f360c6de2babedc1607d0f454b6b09a820dbc8182dc15af927e4df9589",
      asset: "uv-x86_64-pc-windows-msvc.zip",
      binary: "uv.exe",
    },
  },
  darwin: {
    x64: {
      sha256: "f3c8e5708a84b920c18b691214d54d2b0da6b984789caae95d47c95120cb7765",
      asset: "uv-x86_64-apple-darwin.tar.gz",
      binary: "uv",
    },
    arm64: {
      sha256: "", // será preenchido dinamicamente
      asset: "uv-aarch64-apple-darwin.tar.gz",
      binary: "uv",
    },
  },
};
export const TRANSCRIPTION_PACKAGE = "faster-whisper-base";

function getUvPlatformInfo() {
  const plat = process.platform;
  const arch = process.arch;
  return UV_PLATFORM_MAP[plat]?.[arch] ?? null;
}

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
    if (process.platform === "win32")
      return join(this.root, "transcription", "Scripts", "python.exe");
    // macOS/Linux: venv coloca o python em bin/
    return join(this.root, "transcription", "bin", "python3");
  }
  /** Retorna todos os possíveis caminhos do binário python (cross-platform). */
  private pythonCandidates(): string[] {
    return [
      join(this.root, "transcription", "Scripts", "python.exe"), // Windows
      join(this.root, "transcription", "bin", "python3"),         // macOS/Linux
    ];
  }
  private model() {
    return join(this.root, "models", "base", "model.bin");
  }
  async list(): Promise<PackageInfo[]> {
    // Considera instalado se QUALQUER binário python candidato + o modelo existirem
    const pythonExists = await Promise.any(
      this.pythonCandidates().map((p) => access(p)),
    ).then(
      () => true,
      () => false,
    );
    const modelExists = await access(this.model()).then(
      () => true,
      () => false,
    );
    const filesExist = pythonExists && modelExists;
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
      await motionPackageInfo(this.root),
    ];
  }
  async install(
    id: string,
    onProgress: (progress: number, label: string) => void,
    signal?: AbortSignal,
  ) {
    if (id === MOTION_PACKAGE) return installMotionPackage(this.root, onProgress, signal);
    if (id !== TRANSCRIPTION_PACKAGE) throw new Error("Pacote desconhecido.");
    const uvInfo = getUvPlatformInfo();
    if (!uvInfo)
      throw new Error("O pacote de transcrição não é suportado nesta plataforma.");
    await mkdir(this.root, { recursive: true });
    const uvBinName = process.platform === "win32" ? `uv-${UV_VERSION}.exe` : `uv-${UV_VERSION}`;
    const uv = join(this.root, "bootstrap", uvBinName);
    await mkdir(join(this.root, "bootstrap"), { recursive: true });
    try {
      await access(uv);
    } catch {
      onProgress(2, "Baixando o instalador do runtime local…");
      const response = await fetch(
        `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/${uvInfo.asset}`,
        { signal },
      );
      if (!response.ok)
        throw new Error(`Falha ao baixar runtime: HTTP ${response.status}.`);
      const archive = new Uint8Array(await response.arrayBuffer());
      if (createHash("sha256").update(archive).digest("hex") !== uvInfo.sha256)
        throw new Error(
          "O download do runtime não passou na verificação de integridade.",
        );
      if (uvInfo.asset.endsWith(".zip")) {
        // Windows: extrai zip
        const entries = unzipSync(archive);
        const name = Object.keys(entries).find(
          (name) => name === uvInfo.binary || name.endsWith(`/${uvInfo.binary}`),
        );
        if (!name) throw new Error("Runtime sem executável esperado.");
        await writeFile(`${uv}.partial`, entries[name]);
      } else {
        // macOS/Linux: extrai tar.gz em memória com fflate
        const { gunzipSync } = await import("fflate");
        // fflate não tem untar nativo; parseia o tar manualmente
        const tarData = gunzipSync(archive);
        // Parse do tar manualmente (formato POSIX)
        let offset = 0;
        let found = false;
        while (offset < tarData.length - 512) {
          const header = tarData.subarray(offset, offset + 512);
          const nameBytes = header.subarray(0, 100);
          const nameEnd = nameBytes.indexOf(0);
          const entryName = new TextDecoder().decode(nameBytes.subarray(0, nameEnd === -1 ? 100 : nameEnd));
          const sizeStr = new TextDecoder().decode(header.subarray(124, 136)).replace(/\0/g, "").trim();
          const size = parseInt(sizeStr, 8);
          offset += 512;
          if (!entryName || isNaN(size)) break;
          if (entryName === uvInfo.binary || entryName.endsWith(`/${uvInfo.binary}`) || entryName.endsWith(`/${uvInfo.binary}\0`)) {
            const bytes = tarData.subarray(offset, offset + size);
            await writeFile(`${uv}.partial`, bytes);
            found = true;
            break;
          }
          offset += Math.ceil(size / 512) * 512;
        }
        if (!found) throw new Error("Runtime sem executável esperado no arquivo tar.");
      }
      await rename(`${uv}.partial`, uv);
      if (process.platform !== "win32") await chmod(uv, 0o755);
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
    const reqFile =
      process.platform === "win32"
        ? join(this.resources, "workers", "requirements.lock")
        : join(this.resources, "workers", "requirements.in");
    try {
      const pipArgs = [
        "--no-config",
        "pip",
        "install",
        "--python",
        this.python(),
        "--link-mode",
        "copy",
        ...(process.platform === "win32" ? ["--require-hashes"] : []),
        "-r",
        reqFile,
      ];
      await runProcess(uv, pipArgs, { env, signal });
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
          ...(process.platform === "win32" ? ["--require-hashes"] : []),
          "-r",
          reqFile,
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

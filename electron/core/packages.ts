import { createHash } from "node:crypto";
import { access, chmod, mkdir, readFile, stat, writeFile, rename } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { join } from "node:path";
import { gunzipSync, unzipSync } from "fflate";
import type { Media, PackageInfo, Word } from "../../src/shared/types";
import { runProcess } from "./process";
import manifest from "../../resources/packages/transcription-base.json";
import { MOTION_PACKAGE, motionPackageInfo, installMotionPackage } from "./motion-package";
import { KOKORO_FILES, KOKORO_PACKAGE, KOKORO_VERSION, kokoroSpeech } from "./kokoro";

const UV_VERSION = "0.11.21";
export const TRANSCRIPTION_PACKAGE = "faster-whisper-base";

type UvRuntime = { sha256: string; asset: string; binary: string; lock: string };
/** uv release assets (SHA-256 from the official GitHub release digests) and the hash-locked requirements per target. */
export const UV_RUNTIMES: Record<string, UvRuntime> = {
  "win32-x64": {
    sha256: "ace861f360c6de2babedc1607d0f454b6b09a820dbc8182dc15af927e4df9589",
    asset: "uv-x86_64-pc-windows-msvc.zip",
    binary: "uv.exe",
    lock: "requirements.lock",
  },
  "darwin-x64": {
    sha256: "f3c8e5708a84b920c18b691214d54d2b0da6b984789caae95d47c95120cb7765",
    asset: "uv-x86_64-apple-darwin.tar.gz",
    binary: "uv",
    lock: "requirements.macos-x64.lock",
  },
  "darwin-arm64": {
    sha256: "1f921d491ba5ffeea774eb04d6681ecee379101341cbb1500394993b541bf3f4",
    asset: "uv-aarch64-apple-darwin.tar.gz",
    binary: "uv",
    lock: "requirements.macos-arm64.lock",
  },
};

/** Extracts one file from a .tar.gz (ustar/GNU headers) by its base name. */
export function extractFromTarGz(archive: Uint8Array, binary: string): Uint8Array {
  const tar = gunzipSync(archive);
  const decoder = new TextDecoder();
  for (let offset = 0; offset + 512 <= tar.length; ) {
    const header = tar.subarray(offset, offset + 512);
    const nameEnd = header.subarray(0, 100).indexOf(0);
    const name = decoder.decode(header.subarray(0, nameEnd === -1 ? 100 : nameEnd));
    const size = parseInt(decoder.decode(header.subarray(124, 136)).replace(/\0/g, "").trim() || "0", 8);
    if (!name || Number.isNaN(size)) break;
    offset += 512;
    const type = String.fromCharCode(header[156] || 48);
    if ((type === "0" || type === "7") && (name === binary || name.endsWith(`/${binary}`)))
      return tar.slice(offset, offset + size);
    offset += Math.ceil(size / 512) * 512;
  }
  throw new Error("Runtime sem executável esperado.");
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
      await this.kokoroInfo(installed),
    ];
  }

  // ---------- Voz Kokoro (offline narration) ----------
  private kokoroPython() {
    return process.platform === "win32" ? join(this.root, "voice", "Scripts", "python.exe") : join(this.root, "voice", "bin", "python3");
  }
  private kokoroModels() {
    return join(this.root, "models", "kokoro");
  }
  async kokoroInstalled() {
    const marker = await readFile(join(this.root, "kokoro.ready.json"), "utf8").then((t) => JSON.parse(t), () => null);
    if (marker?.version !== KOKORO_VERSION) return false;
    return access(this.kokoroPython()).then(
      () => true,
      () => false,
    );
  }
  private async kokoroInfo(transcription: boolean): Promise<PackageInfo> {
    const installed = (await this.kokoroInstalled()) && transcription;
    return {
      id: KOKORO_PACKAGE,
      name: "Voz Kokoro",
      description:
        "Narração natural no seu PC, sem internet e sem créditos: vozes em português (Alex, Dora, Santa), inglês e espanhol. Usa a Transcrição local para marcar o tempo de cada palavra.",
      version: KOKORO_VERSION,
      size: transcription ? "≈ 230 MB · download único" : "≈ 230 MB + Transcrição local",
      installed,
      status: installed ? "installed" : "available",
      capabilities: ["voice", "offline-tts"],
    };
  }
  private async downloadVerified(file: (typeof KOKORO_FILES)[number], dir: string, onProgress: (p: number) => void, signal?: AbortSignal) {
    const target = join(dir, file.name);
    const sha = (path: string) =>
      new Promise<string>((done, reject) => {
        const hash = createHash("sha256");
        createReadStream(path).on("data", (c) => hash.update(c)).on("error", reject).on("end", () => done(hash.digest("hex")));
      });
    if ((await stat(target).then((s) => s.size, () => 0)) === file.bytes && (await sha(target)) === file.sha256) return;
    const response = await fetch(file.url, { signal });
    if (!response.ok || !response.body) throw new Error(`Falha ao baixar o modelo de voz: HTTP ${response.status}.`);
    const partial = `${target}.partial`,
      chunks: Uint8Array[] = [];
    let got = 0;
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
      got += chunk.length;
      onProgress(Math.min(1, got / file.bytes));
    }
    const data = Buffer.concat(chunks);
    if (createHash("sha256").update(data).digest("hex") !== file.sha256) throw new Error("O modelo de voz baixado não passou na verificação de integridade.");
    await writeFile(partial, data);
    await rename(partial, target);
  }
  private async installKokoro(onProgress: (progress: number, label: string) => void, signal?: AbortSignal) {
    const runtime = UV_RUNTIMES[`${process.platform}-${process.arch}`];
    if (!runtime) throw new Error("A Voz Kokoro não é suportada nesta plataforma.");
    // Word timings come from the local transcription: install it first when missing.
    if (!(await this.list())[0].installed)
      await this.install(TRANSCRIPTION_PACKAGE, (p, label) => onProgress(p * 0.4, `Transcrição local: ${label}`), signal);
    const { uv, env } = await this.bootstrap((p, label) => onProgress(40 + p * 0.02, label), signal);
    onProgress(42, "Preparando o Python da voz…");
    try {
      await access(this.kokoroPython());
    } catch {
      await runProcess(uv, ["--no-config", "venv", "--python", "3.12", "--managed-python", join(this.root, "voice")], { env, signal });
    }
    onProgress(48, "Instalando o motor de voz…");
    await this.pipInstall(uv, this.kokoroPython(), join(this.resources, "workers", runtime.lock.replace("requirements", "requirements.kokoro")), env, (p, label) => onProgress(55, label), signal);
    await mkdir(this.kokoroModels(), { recursive: true });
    let done = 0;
    for (const file of KOKORO_FILES) {
      const share = file.bytes / KOKORO_FILES.reduce((s, f) => s + f.bytes, 0);
      await this.downloadVerified(file, this.kokoroModels(), (f) => onProgress(60 + (done + f * share) * 32, "Baixando as vozes…"), signal);
      done += share;
    }
    onProgress(94, "Testando a voz…");
    await runProcess(
      this.kokoroPython(),
      ["-X", "utf8", join(this.resources, "workers", "speak_kokoro.py"), "check", "--model", join(this.kokoroModels(), KOKORO_FILES[0].name), "--voices", join(this.kokoroModels(), KOKORO_FILES[1].name)],
      { env, signal },
    );
    await writeFile(join(this.root, "kokoro.ready.json"), JSON.stringify({ version: KOKORO_VERSION, installedAt: new Date().toISOString() }));
    onProgress(100, "Voz Kokoro pronta.");
  }
  /** Synthesizes with Kokoro (throws a friendly message when the package is missing). */
  async kokoroSpeak(text: string, voice: string | undefined, tempDir: string, signal?: AbortSignal) {
    if (!(await this.kokoroInstalled())) throw new Error("Instale a Voz Kokoro na aba Pacotes do CutRoom.");
    await mkdir(tempDir, { recursive: true });
    return kokoroSpeech({ python: this.kokoroPython(), worker: join(this.resources, "workers", "speak_kokoro.py"), models: this.kokoroModels(), text, voice, tempDir, signal });
  }
  /** Downloads uv (SHA-256 checked) once; it installs CutRoom's private Python and locked wheels. */
  private async bootstrap(onProgress: (progress: number, label: string) => void, signal?: AbortSignal) {
    const uvInfo = UV_RUNTIMES[`${process.platform}-${process.arch}`];
    if (!uvInfo)
      throw new Error("Este pacote não é suportado nesta plataforma.");
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
        const entries = unzipSync(archive);
        const name = Object.keys(entries).find(
          (name) => name === uvInfo.binary || name.endsWith(`/${uvInfo.binary}`),
        );
        if (!name) throw new Error("Runtime sem executável esperado.");
        await writeFile(`${uv}.partial`, entries[name]);
      } else await writeFile(`${uv}.partial`, extractFromTarGz(archive, uvInfo.binary));
      if (process.platform !== "win32") await chmod(`${uv}.partial`, 0o755);
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
    return { uv, env, uvInfo };
  }
  private async pipInstall(
    uv: string,
    python: string,
    reqFile: string,
    env: NodeJS.ProcessEnv,
    onProgress: (progress: number, label: string) => void,
    signal?: AbortSignal,
  ) {
    try {
      await runProcess(
        uv,
        [
          "--no-config",
          "pip",
          "install",
          "--python",
          python,
          "--link-mode",
          "copy",
          "--require-hashes",
          "-r",
          reqFile,
        ],
        { env, signal },
      );
    } catch (error) {
      if (signal?.aborted) throw error;
      // Windows antivirus can retain extracted DLLs and prevent uv's atomic cache rename.
      // pip installs the exact same hash-locked wheels without that cache promotion step.
      onProgress(35, "Concluindo a instalação do runtime…");
      await runProcess(python, ["-m", "ensurepip", "--upgrade"], {
        env,
        signal,
      });
      await runProcess(
        python,
        [
          "-m",
          "pip",
          "install",
          "--disable-pip-version-check",
          "--no-warn-script-location",
          "--require-hashes",
          "-r",
          reqFile,
        ],
        { env, signal },
      );
    }
  }
  async install(
    id: string,
    onProgress: (progress: number, label: string) => void,
    signal?: AbortSignal,
  ) {
    if (id === MOTION_PACKAGE) return installMotionPackage(this.root, onProgress, signal);
    if (id === KOKORO_PACKAGE) return this.installKokoro(onProgress, signal);
    if (id !== TRANSCRIPTION_PACKAGE) throw new Error("Pacote desconhecido.");
    const { uv, env, uvInfo } = await this.bootstrap(onProgress, signal);
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
    await this.pipInstall(uv, this.python(), join(this.resources, "workers", uvInfo.lock), env, onProgress, signal);
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

import { createHash } from "node:crypto";
import {
  access,
  chmod,
  mkdir,
  readFile,
  writeFile,
  rename,
  rm,
} from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { unzipSync } from "fflate";
import type { PackageInfo } from "../../src/shared/types";

export const MOTION_PACKAGE = "hyperframes-motion";
export const CHROME_VERSION = "155.0.8059.79";

// SHA256 hashes por plataforma/arch
const SHA256_MAP: Partial<Record<string, Partial<Record<string, string>>>> = {
  win32: {
    x64: "c4cc49fa7908cf018600b04c95918d336565d90f9c72241fd83dacd9ec41855c",
  },
  darwin: {
    x64: "36a1da728fc936770a0edc52989b74d8d3a194e8747f490e372a210853ad831c",
    arm64: "36a1da728fc936770a0edc52989b74d8d3a194e8747f490e372a210853ad831c",
  },
};

function getPlatformInfo() {
  const plat = process.platform;
  const arch = process.arch;
  if (plat === "win32" && arch === "x64") {
    return {
      chromeDir: "chrome-headless-shell-win64",
      chromeBin: "chrome-headless-shell.exe",
      chromeZipPlatform: "win64",
      sha256: SHA256_MAP.win32!.x64!,
    };
  }
  if (plat === "darwin" && arch === "x64") {
    return {
      chromeDir: "chrome-headless-shell-mac-x64",
      chromeBin: "chrome-headless-shell",
      chromeZipPlatform: "mac-x64",
      sha256: SHA256_MAP.darwin!.x64!,
    };
  }
  if (plat === "darwin" && arch === "arm64") {
    return {
      chromeDir: "chrome-headless-shell-mac-arm64",
      chromeBin: "chrome-headless-shell",
      chromeZipPlatform: "mac-arm64",
      sha256: SHA256_MAP.darwin!.arm64!,
    };
  }
  return null;
}

export const motionBrowser = (root: string) => {
  const info = getPlatformInfo();
  if (!info) return join(root, `hyperframes-${CHROME_VERSION}`, "chrome-headless-shell");
  return join(
    root,
    `hyperframes-${CHROME_VERSION}`,
    info.chromeDir,
    info.chromeBin,
  );
};

export async function motionPackageInfo(root: string): Promise<PackageInfo> {
  const info = getPlatformInfo();
  const sha256 = info?.sha256 ?? SHA256_MAP.win32!.x64!;
  const installed = await Promise.all([
    access(motionBrowser(root)),
    readFile(
      join(root, `hyperframes-${CHROME_VERSION}`, "ready.json"),
      "utf8",
    ).then((s) => {
      if (JSON.parse(s).sha256 !== sha256) throw new Error();
    }),
  ]).then(
    () => true,
    () => false,
  );
  return {
    id: MOTION_PACKAGE,
    name: "Efeitos e animações",
    version: "0.8.173",
    description:
      "HyperFrames · títulos, diagramas e cenas animadas. Renderiza no seu PC, preservando o áudio do vídeo.",
    size: "Cerca de 120 MB de download · 300 MB em disco",
    capabilities: ["motion", "animation"],
    installed,
    status: installed ? "installed" : "available",
  };
}
export async function installMotionPackage(
  root: string,
  progress: (n: number, label: string) => void,
  signal?: AbortSignal,
) {
  const platformInfo = getPlatformInfo();
  if (!platformInfo)
    throw new Error("Este pacote não é suportado nesta plataforma.");
  signal?.throwIfAborted();
  const { chromeDir, chromeBin, chromeZipPlatform, sha256 } = platformInfo;
  const target = join(root, `hyperframes-${CHROME_VERSION}`),
    staging = `${target}.partial`;
  await mkdir(root, { recursive: true });
  // This fixed, versioned directory is owned exclusively by this installer.
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });
  try {
    progress(1, "Baixando o renderizador local de animações…");
    const zipName = `chrome-headless-shell-${chromeZipPlatform}.zip`;
    const response = await fetch(
      `https://storage.googleapis.com/chrome-for-testing-public/${CHROME_VERSION}/${chromeZipPlatform}/${zipName}`,
      { signal },
    );
    if (!response.ok || !response.body)
      throw new Error(`Falha ao baixar renderizador: HTTP ${response.status}.`);
    const total = Number(response.headers.get("content-length")) || 130000000,
      reader = response.body.getReader(),
      chunks: Uint8Array[] = [];
    let received = 0,
      lastPercent = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      signal?.throwIfAborted();
      chunks.push(value);
      received += value.length;
      if (received > 250000000) throw new Error("Pacote maior que o esperado.");
      const percent = Math.floor(Math.min(80, (received / total) * 80));
      if (percent > lastPercent) {
        progress(percent, "Baixando o renderizador local de animações…");
        lastPercent = percent;
      }
    }
    const archive = Buffer.concat(chunks);
    if (createHash("sha256").update(archive).digest("hex") !== sha256)
      throw new Error(
        "O pacote de animações não passou na verificação de integridade.",
      );
    progress(82, "Verificando e instalando os arquivos…");
    const entries = Object.entries(unzipSync(archive));
    for (let i = 0; i < entries.length; i++) {
      signal?.throwIfAborted();
      const [name, bytes] = entries[i];
      const output = resolve(staging, name);
      if (!output.startsWith(resolve(staging) + sep))
        throw new Error("Caminho inválido no pacote.");
      if (name.endsWith("/")) await mkdir(output, { recursive: true });
      else {
        await mkdir(resolve(output, ".."), { recursive: true });
        await writeFile(output, bytes);
        // Tornar executável no macOS/Linux
        if (process.platform !== "win32" && name.endsWith(chromeBin))
          await chmod(output, 0o755);
      }
      progress(
        82 + (i / entries.length) * 16,
        "Instalando o renderizador local…",
      );
    }
    await access(join(staging, chromeDir, chromeBin));
    await writeFile(
      join(staging, "ready.json"),
      JSON.stringify({ sha256, installedAt: new Date().toISOString() }),
    );
    signal?.throwIfAborted();
    await rm(target, { recursive: true, force: true });
    await rename(staging, target);
    progress(100, "Efeitos e animações prontos.");
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

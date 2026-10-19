import { createHash } from "node:crypto";
import {
  access,
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
const SHA256 =
  "c4cc49fa7908cf018600b04c95918d336565d90f9c72241fd83dacd9ec41855c";
export const motionBrowser = (root: string) =>
  join(
    root,
    `hyperframes-${CHROME_VERSION}`,
    "chrome-headless-shell-win64",
    "chrome-headless-shell.exe",
  );
export async function motionPackageInfo(root: string): Promise<PackageInfo> {
  const installed = await Promise.all([
    access(motionBrowser(root)),
    readFile(
      join(root, `hyperframes-${CHROME_VERSION}`, "ready.json"),
      "utf8",
    ).then((s) => {
      if (JSON.parse(s).sha256 !== SHA256) throw new Error();
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
  if (process.platform !== "win32" || process.arch !== "x64")
    throw new Error("Este pacote requer Windows x64.");
  signal?.throwIfAborted();
  const target = join(root, `hyperframes-${CHROME_VERSION}`),
    staging = `${target}.partial`;
  await mkdir(root, { recursive: true });
  // This fixed, versioned directory is owned exclusively by this installer.
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });
  try {
    progress(1, "Baixando o renderizador local de animações…");
    const response = await fetch(
      `https://storage.googleapis.com/chrome-for-testing-public/${CHROME_VERSION}/win64/chrome-headless-shell-win64.zip`,
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
    if (createHash("sha256").update(archive).digest("hex") !== SHA256)
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
      }
      progress(
        82 + (i / entries.length) * 16,
        "Instalando o renderizador local…",
      );
    }
    await access(
      join(staging, "chrome-headless-shell-win64", "chrome-headless-shell.exe"),
    );
    await writeFile(
      join(staging, "ready.json"),
      JSON.stringify({ sha256: SHA256, installedAt: new Date().toISOString() }),
    );
    signal?.throwIfAborted();
    await rm(target, { recursive: true, force: true });
    await rename(staging, target);
    progress(100, "Efeitos e animações prontos.");
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

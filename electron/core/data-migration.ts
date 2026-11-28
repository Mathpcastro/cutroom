import { createHash } from "node:crypto";

export type MigrationStatus = "done" | "fresh" | "kept-new" | "in-place" | "failed";

export interface MigrationMarker {
  schema: 1;
  status: MigrationStatus;
  from: string;
  to: string;
  startedAt: string;
  finishedAt: string;
  appVersion: string;
  copied: { files: number; bytes: number };
  skipped: string[];
  moved: string[];
  secretsNeedReentry?: boolean;
  error?: string;
}

interface DirentLike {
  name: string;
  isDirectory(): boolean;
  isFile(): boolean;
  isSymbolicLink(): boolean;
}

interface StatsLike {
  size: number;
  mtime: Date;
  mode: number;
  isDirectory(): boolean;
  isFile(): boolean;
  isSymbolicLink(): boolean;
}

export interface MigrationFs {
  existsSync(path: string): boolean;
  mkdirSync(path: string, options?: { recursive?: boolean }): unknown;
  readdirSync(path: string, options: { withFileTypes: true }): DirentLike[];
  lstatSync(path: string): StatsLike;
  readFileSync(path: string, encoding?: string): string | Uint8Array;
  writeFileSync(path: string, data: string | Uint8Array, options?: { mode?: number; encoding?: string }): unknown;
  appendFileSync(path: string, data: string, encoding?: string): unknown;
  copyFileSync(source: string, destination: string): void;
  utimesSync(path: string, atime: Date | number, mtime: Date | number): void;
  renameSync(source: string, destination: string): void;
  rmSync(path: string, options?: { recursive?: boolean; force?: boolean }): void;
  statfsSync(path: string): { bavail: number | bigint; bsize: number | bigint };
}

export interface MigrationPath {
  basename(path: string): string;
  dirname(path: string): string;
  join(...paths: string[]): string;
  relative(from: string, to: string): string;
  resolve(...paths: string[]): string;
}

export interface MigrationOptions {
  fs: MigrationFs;
  path: MigrationPath;
  appDataDir: string;
  oldDir: string;
  newDir: string;
  appVersion: string;
  isPackaged: boolean;
  customUserData?: string;
  allowDev?: boolean;
  platform?: string;
  now?: () => Date;
  pid?: number;
  isPidAlive?: (pid: number) => boolean;
}

export interface MigrationResult {
  status: MigrationStatus | "skipped" | "same-path" | "lock-busy";
  userDataPath?: string;
  marker?: MigrationMarker;
  error?: string;
}

interface ManifestEntry {
  relativePath: string;
  kind: "directory" | "file";
  size: number;
  mtime: Date;
  mode: number;
  sha256?: string;
}

const TERMINAL = new Set<MigrationStatus>(["done", "fresh", "kept-new"]);
const CACHE_NAMES = new Set([
  "Cache",
  "Code Cache",
  "GPUCache",
  "DawnCache",
  "DawnGraphiteCache",
  "DawnWebGPUCache",
  "Crashpad",
  "lockfile",
]);
const CHROMIUM_NEW_DIR_NAMES = new Set([
  "SingletonCookie",
  "SingletonSocket",
  "SingletonLock",
  "lockfile",
  "Crashpad",
  "Local State",
  "Preferences",
  "Network",
  "Session Storage",
  "Local Storage",
  "GPUCache",
  "DawnCache",
  "DawnGraphiteCache",
  "DawnWebGPUCache",
  "Code Cache",
  "Cache",
  "Shared Dictionary",
  "blob_storage",
  "logs",
]);
const MIGRATION_README = `Os dados do CutRoom foram copiados para a pasta Videosell.\n\nEsta pasta antiga não é mais usada pelo Videosell. Confira seus projetos, marcas, integrações e agendamentos na nova versão antes de apagar esta pasta.\n\nPara desfazer a migração e preservar os dados atuais, feche o aplicativo e abra Videosell.exe com o argumento --desfazer-migracao. A pasta Videosell será renomeada para Videosell.rolled-back-<data>; nada será apagado. Depois, reinstale a versão CutRoom anterior ou abra Videosell para tentar a migração novamente.\n`;

const iso = (date: Date) => date.toISOString();
const timestamp = (date: Date) => date.toISOString().replace(/[:.]/g, "-");
const isCacheName = (name: string) => CACHE_NAMES.has(name) || name.startsWith("Singleton");
const isTerminalStatus = (value: unknown): value is MigrationStatus =>
  typeof value === "string" && TERMINAL.has(value as MigrationStatus);

function parseJson<T>(fs: MigrationFs, file: string): T | undefined {
  try {
    return JSON.parse(String(fs.readFileSync(file, "utf8"))) as T;
  } catch {
    return undefined;
  }
}

function pathKey(path: MigrationPath, value: string, platform: string) {
  const normalized = path.resolve(value).replace(/[\\/]+$/, "");
  return platform === "win32" || platform === "darwin" ? normalized.toLocaleLowerCase() : normalized;
}

function pidAlive(pid: number) {
  if (pid === process.pid) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function acquireLock(options: MigrationOptions, lockPath: string, now: Date) {
  const { fs } = options;
  fs.mkdirSync(options.appDataDir, { recursive: true });
  try {
    fs.mkdirSync(lockPath);
    fs.writeFileSync(
      options.path.join(lockPath, "owner.json"),
      JSON.stringify({ pid: options.pid ?? process.pid, startedAt: iso(now) }),
      { mode: 0o600 },
    );
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }

  const owner = parseJson<{ pid?: number; startedAt?: string }>(fs, options.path.join(lockPath, "owner.json"));
  const startedAt = owner?.startedAt ? new Date(owner.startedAt).getTime() : Number.NaN;
  const age = now.getTime() - startedAt;
  const alive = Number.isInteger(owner?.pid) && (options.isPidAlive ?? pidAlive)(owner!.pid!);
  if (alive && Number.isFinite(age) && age >= 0 && age < 30 * 60 * 1000) return false;

  fs.rmSync(lockPath, { recursive: true, force: true });
  try {
    fs.mkdirSync(lockPath);
    fs.writeFileSync(
      options.path.join(lockPath, "owner.json"),
      JSON.stringify({ pid: options.pid ?? process.pid, startedAt: iso(now) }),
      { mode: 0o600 },
    );
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
}

function releaseLock(fs: MigrationFs, lockPath: string) {
  try {
    fs.rmSync(lockPath, { recursive: true, force: true });
  } catch {
    // A stale lock is cleaned up on the next start.
  }
}

function appendLog(fs: MigrationFs, path: MigrationPath, directory: string, line: string) {
  try {
    const logs = path.join(directory, "logs");
    fs.mkdirSync(logs, { recursive: true });
    fs.appendFileSync(path.join(logs, "migration.log"), `${new Date().toISOString()} ${line}\n`, "utf8");
  } catch {
    // Migration logs are best effort and never include file contents or secrets.
  }
}

function baseMarker(options: MigrationOptions, status: MigrationStatus, startedAt: Date, values: Partial<MigrationMarker> = {}): MigrationMarker {
  const finishedAt = options.now?.() ?? new Date();
  return {
    schema: 1,
    status,
    from: options.oldDir,
    to: options.newDir,
    startedAt: iso(startedAt),
    finishedAt: iso(finishedAt),
    appVersion: options.appVersion,
    copied: { files: 0, bytes: 0 },
    skipped: [],
    moved: [],
    ...values,
  };
}

function writeMarker(fs: MigrationFs, path: MigrationPath, directory: string, marker: MigrationMarker) {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, ".videosell-migration.json"), JSON.stringify(marker, null, 2), { mode: 0o600 });
}

function listChromiumOnly(fs: MigrationFs, path: MigrationPath, directory: string) {
  let names: string[];
  try {
    names = fs.readdirSync(directory, { withFileTypes: true }).map((entry) => entry.name);
  } catch {
    return false;
  }
  for (const name of names) {
    if (name === ".videosell-migration.json") continue;
    const allowed = CHROMIUM_NEW_DIR_NAMES.has(name) || name.startsWith("Singleton");
    if (!allowed) return false;
    if (name === "Local Storage") {
      const localStorage = path.join(directory, name);
      try {
        if (fs.readdirSync(localStorage, { withFileTypes: true }).length !== 0) return false;
      } catch {
        return false;
      }
    }
  }
  return true;
}

function addManifest(fs: MigrationFs, path: MigrationPath, root: string, relativePath: string, entries: ManifestEntry[], skipped: string[]) {
  const absolutePath = relativePath ? path.join(root, relativePath) : root;
  const stat = fs.lstatSync(absolutePath);
  if (stat.isSymbolicLink()) {
    if (relativePath) skipped.push(`${relativePath} (atalho simbólico ignorado)`);
    return;
  }
  if (stat.isDirectory()) {
    entries.push({ relativePath, kind: "directory", size: 0, mtime: stat.mtime, mode: stat.mode });
    for (const entry of fs.readdirSync(absolutePath, { withFileTypes: true })) {
      const childPath = relativePath ? path.join(relativePath, entry.name) : entry.name;
      if (isCacheName(entry.name)) {
        skipped.push(childPath);
        continue;
      }
      addManifest(fs, path, root, childPath, entries, skipped);
    }
    return;
  }
  if (stat.isFile()) {
    entries.push({
      relativePath,
      kind: "file",
      size: stat.size,
      mtime: stat.mtime,
      mode: stat.mode,
      ...(relativePath.toLocaleLowerCase().endsWith(".json") && stat.size <= 5 * 1024 * 1024
        ? { sha256: hashFile(fs, absolutePath) }
        : {}),
    });
  } else if (relativePath) {
    skipped.push(`${relativePath} (tipo de arquivo não copiado)`);
  }
}

function manifest(fs: MigrationFs, path: MigrationPath, root: string, skipped: string[]) {
  const entries: ManifestEntry[] = [];
  addManifest(fs, path, root, "", entries, skipped);
  return entries;
}

function copyManifest(fs: MigrationFs, path: MigrationPath, source: string, destination: string, entries: ManifestEntry[], omitPackages: boolean) {
  const selected = entries.filter((entry) => !(omitPackages && (
    entry.relativePath === "packages" ||
    entry.relativePath.startsWith("packages/") ||
    entry.relativePath.startsWith("packages\\")
  )));
  const dirs = selected.filter((entry) => entry.kind === "directory").sort((a, b) => a.relativePath.length - b.relativePath.length);
  const files = selected.filter((entry) => entry.kind === "file");
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of dirs) {
    const target = entry.relativePath ? path.join(destination, entry.relativePath) : destination;
    fs.mkdirSync(target, { recursive: true });
  }
  for (const entry of files) {
    const from = path.join(source, entry.relativePath);
    const to = path.join(destination, entry.relativePath);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
    fs.utimesSync(to, entry.mtime, entry.mtime);
  }
  for (const entry of dirs.sort((a, b) => b.relativePath.length - a.relativePath.length)) {
    const target = entry.relativePath ? path.join(destination, entry.relativePath) : destination;
    fs.utimesSync(target, entry.mtime, entry.mtime);
  }
  return selected;
}

function hashFile(fs: MigrationFs, file: string) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function validateCopy(fs: MigrationFs, path: MigrationPath, destination: string, expected: ManifestEntry[]) {
  const actual = manifest(fs, path, destination, []);
  const expectedFiles = expected.filter((entry) => entry.kind === "file");
  const actualFiles = actual.filter((entry) => entry.kind === "file");
  if (actualFiles.length !== expectedFiles.length) throw new Error("A validação encontrou uma contagem diferente de arquivos.");
  const byPath = new Map(actualFiles.map((entry) => [entry.relativePath, entry]));
  for (const sourceFile of expectedFiles) {
    const targetFile = byPath.get(sourceFile.relativePath);
    if (!targetFile || targetFile.size !== sourceFile.size) throw new Error(`A validação encontrou tamanho diferente em ${sourceFile.relativePath}.`);
    if (sourceFile.sha256) {
      if (sourceFile.sha256 !== hashFile(fs, path.join(destination, sourceFile.relativePath)))
        throw new Error(`A validação encontrou conteúdo diferente em ${sourceFile.relativePath}.`);
    }
  }
}

function fileBytes(entries: ManifestEntry[]) {
  return entries.reduce((sum, entry) => sum + (entry.kind === "file" ? entry.size : 0), 0);
}

function availableBytes(fs: MigrationFs, directory: string) {
  const stats = fs.statfsSync(directory);
  return Number(stats.bavail) * Number(stats.bsize);
}

function uniqueSibling(fs: MigrationFs, path: MigrationPath, newDir: string, suffix: string, now: Date) {
  const initial = `${newDir}.${suffix}-${timestamp(now)}`;
  if (!fs.existsSync(initial)) return initial;
  for (let i = 1; ; i += 1) {
    const candidate = `${initial}-${i}`;
    if (!fs.existsSync(candidate)) return candidate;
  }
}

function restoreMovedPackages(fs: MigrationFs, path: MigrationPath, oldDir: string, migratingDir: string) {
  const stagedPackages = path.join(migratingDir, "packages");
  const oldPackages = path.join(oldDir, "packages");
  if (fs.existsSync(stagedPackages) && !fs.existsSync(oldPackages)) {
    fs.renameSync(stagedPackages, oldPackages);
    return true;
  }
  return false;
}

function markAndLog(options: MigrationOptions, marker: MigrationMarker, logLine: string) {
  try {
    writeMarker(options.fs, options.path, options.newDir, marker);
  } catch {
    // A marker must never prevent the fallback to the intact CutRoom data directory.
  }
  appendLog(options.fs, options.path, options.newDir, logLine);
}

/** Synchronous and Electron-free so it can run before Electron initializes Chromium/userData. */
export function migrateUserData(options: MigrationOptions): MigrationResult {
  const { fs, path } = options;
  const startedAt = options.now?.() ?? new Date();
  if (options.customUserData || (!options.isPackaged && !options.allowDev)) return { status: "skipped" };
  const platform = options.platform ?? process.platform;
  if (pathKey(path, options.oldDir, platform) === pathKey(path, options.newDir, platform)) return { status: "same-path" };

  const lockPath = path.join(options.appDataDir, "Videosell.migration.lock");
  let locked = false;
  try {
    locked = acquireLock(options, lockPath, startedAt);
    if (!locked) return { status: "lock-busy" };

    const markerPath = path.join(options.newDir, ".videosell-migration.json");
    const priorMarker = fs.existsSync(markerPath) ? parseJson<MigrationMarker>(fs, markerPath) : undefined;
    const migratingDir = `${options.newDir}.migrating`;
    if (fs.existsSync(migratingDir)) {
      restoreMovedPackages(fs, path, options.oldDir, migratingDir);
      fs.rmSync(migratingDir, { recursive: true, force: true });
      if (!isTerminalStatus(priorMarker?.status))
        appendLog(fs, path, options.newDir, "Pasta temporária incompleta removida; migração reiniciada.");
    }
    if (isTerminalStatus(priorMarker?.status)) return { status: priorMarker.status, marker: priorMarker };

    const oldExists = fs.existsSync(options.oldDir);
    const newExists = fs.existsSync(options.newDir);
    if (!oldExists) {
      const marker = baseMarker(options, "fresh", startedAt);
      markAndLog(options, marker, "Nenhuma pasta CutRoom anterior encontrada; instalação nova.");
      return { status: "fresh", marker };
    }
    if (newExists && !listChromiumOnly(fs, path, options.newDir)) {
      const marker = baseMarker(options, "kept-new", startedAt, {
        skipped: ["A pasta Videosell já continha dados do aplicativo; as duas pastas foram preservadas."],
      });
      try {
        writeMarker(fs, path, options.newDir, marker);
      } catch {
        // Preserve the user's Videosell data even if there is no room for its marker.
      }
      return { status: "kept-new", marker };
    }

    const skipForManifest: string[] = [];
    const allEntries = manifest(fs, path, options.oldDir, skipForManifest);
    const packageEntries = allEntries.filter((entry) =>
      entry.relativePath === "packages" || entry.relativePath.startsWith("packages/") || entry.relativePath.startsWith("packages\\"),
    );
    const entriesWithoutPackages = allEntries.filter((entry) => !packageEntries.includes(entry));
    const allBytes = fileBytes(allEntries);
    const packageBytes = fileBytes(packageEntries);
    const nonPackageBytes = allBytes - packageBytes;
    let free: number;
    try {
      free = availableBytes(fs, options.appDataDir);
    } catch (error) {
      const message = `Não foi possível verificar o espaço livre: ${(error as Error).message}`;
      const marker = baseMarker(options, "in-place", startedAt, { error: message, skipped: skipForManifest });
      markAndLog(options, marker, `Migração em-place: ${message}`);
      return { status: "in-place", userDataPath: options.oldDir, marker, error: message };
    }
    const requiredAll = Math.ceil(allBytes * 1.1);
    const requiredWithoutPackages = Math.ceil(nonPackageBytes * 1.1);
    const movePackages = packageBytes > 0 && free < requiredAll && free >= requiredWithoutPackages;
    if (free < requiredWithoutPackages) {
      const marker = baseMarker(options, "in-place", startedAt, {
        copied: { files: 0, bytes: 0 },
        skipped: skipForManifest,
        error: "Espaço livre insuficiente para copiar os dados; esta execução usará a pasta CutRoom.",
      });
      markAndLog(options, marker, "Espaço livre insuficiente; execução em-place na pasta CutRoom.");
      return { status: "in-place", userDataPath: options.oldDir, marker, error: marker.error };
    }

    const moved: string[] = [];
    let preMigrationPath: string | undefined;
    let packagesMoved = false;
    let committed = false;
    try {
      if (newExists) {
        preMigrationPath = uniqueSibling(fs, path, options.newDir, "pre-migration", startedAt);
        fs.renameSync(options.newDir, preMigrationPath);
        moved.push(preMigrationPath);
      }
      copyManifest(fs, path, options.oldDir, migratingDir, allEntries, movePackages);
      if (movePackages) {
        validateCopy(fs, path, migratingDir, entriesWithoutPackages);
        fs.renameSync(path.join(options.oldDir, "packages"), path.join(migratingDir, "packages"));
        packagesMoved = true;
        moved.push("packages (transferido por renomeação no mesmo volume)");
      }
      validateCopy(fs, path, migratingDir, allEntries);
      fs.renameSync(migratingDir, options.newDir);
      committed = true;

      const marker = baseMarker(options, "done", startedAt, {
        copied: { files: allEntries.filter((entry) => entry.kind === "file").length, bytes: allBytes },
        skipped: skipForManifest,
        moved,
      });
      fs.writeFileSync(path.join(options.oldDir, "LEIA-ME-VIDEOSELL.txt"), MIGRATION_README, { encoding: "utf8" });
      writeMarker(fs, path, options.newDir, marker);
      appendLog(fs, path, options.newDir, `Migração concluída: ${marker.copied.files} arquivos, ${marker.copied.bytes} bytes.`);
      if (movePackages) appendLog(fs, path, options.newDir, "A pasta packages foi transferida por renomeação para economizar espaço; a versão CutRoom anterior precisará baixar os pacotes novamente.");
      return { status: "done", marker };
    } catch (error) {
      const message = (error as Error).message || String(error);
      const code = (error as NodeJS.ErrnoException).code;
      if (packagesMoved) {
        const packageSource = path.join(committed ? options.newDir : migratingDir, "packages");
        const packageTarget = path.join(options.oldDir, "packages");
        try {
          if (fs.existsSync(packageSource) && !fs.existsSync(packageTarget)) fs.renameSync(packageSource, packageTarget);
        } catch {
          // The preserved staging/archive folder still contains the runtimes if the move-back fails.
        }
      } else if (fs.existsSync(migratingDir)) {
        restoreMovedPackages(fs, path, options.oldDir, migratingDir);
      }
      if (committed && fs.existsSync(options.newDir)) {
        const failedArchive = uniqueSibling(fs, path, options.newDir, "failed", options.now?.() ?? new Date());
        try {
          fs.renameSync(options.newDir, failedArchive);
        } catch {
          // Keep the full destination in place if it cannot be renamed; still use oldDir this run.
        }
      } else if (fs.existsSync(migratingDir)) {
        fs.rmSync(migratingDir, { recursive: true, force: true });
      }
      const status: MigrationStatus = code === "ENOSPC" || code === "EDQUOT" ? "in-place" : "failed";
      const marker = baseMarker(options, status, startedAt, {
        copied: { files: 0, bytes: 0 },
        skipped: skipForManifest,
        moved,
        error: message,
      });
      markAndLog(options, marker, `Migração ${status === "in-place" ? "em-place" : "falhou"}: ${message}`);
      return { status, userDataPath: options.oldDir, marker, error: message };
    }
  } catch (error) {
    const message = (error as Error).message || String(error);
    const marker = baseMarker(options, "failed", startedAt, { error: message });
    markAndLog(options, marker, `Falha ao iniciar a migração: ${message}`);
    return { status: "failed", userDataPath: fs.existsSync(options.oldDir) ? options.oldDir : undefined, marker, error: message };
  } finally {
    if (locked) releaseLock(fs, lockPath);
  }
}

/** Preserves both directories; the returned path is the retained rollback copy. */
export function rollbackMigration(options: Pick<MigrationOptions, "fs" | "path" | "oldDir" | "newDir" | "now">) {
  const { fs, path } = options;
  if (!fs.existsSync(options.newDir)) throw new Error("A pasta Videosell não existe; nada foi renomeado.");
  if (!fs.existsSync(options.oldDir)) throw new Error("A pasta CutRoom original não existe; rollback cancelado.");
  const destination = uniqueSibling(fs, path, options.newDir, "rolled-back", options.now?.() ?? new Date());
  fs.renameSync(options.newDir, destination);
  return destination;
}

/** Records a safeStorage decryption failure without storing or logging the secret. */
export function markSecretsNeedReentry(fs: MigrationFs, path: MigrationPath, userDir: string) {
  const markerPath = path.join(userDir, ".videosell-migration.json");
  const marker = parseJson<Record<string, unknown>>(fs, markerPath);
  if (!marker) return false;
  marker.secretsNeedReentry = true;
  const partial = `${markerPath}.partial`;
  fs.writeFileSync(partial, JSON.stringify(marker, null, 2), { mode: 0o600 });
  fs.renameSync(partial, markerPath);
  return true;
}

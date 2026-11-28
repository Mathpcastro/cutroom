import { promises as fs } from "node:fs";
import * as syncFs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { migrateUserData, rollbackMigration, type MigrationFs, type MigrationOptions } from "../electron/core/data-migration";

const fixedNow = new Date("2026-11-27T12:00:00.000Z");
const roots: string[] = [];

async function setup() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "videosell-migration-"));
  roots.push(root);
  const appDataDir = path.join(root, "Roaming");
  const oldDir = path.join(appDataDir, "CutRoom");
  const newDir = path.join(appDataDir, "Videosell");
  await fs.mkdir(appDataDir, { recursive: true });
  return { root, appDataDir, oldDir, newDir };
}

function options(dirs: Awaited<ReturnType<typeof setup>>, extra: Partial<MigrationOptions> = {}): MigrationOptions {
  return {
    fs: syncFs as unknown as MigrationFs,
    path,
    ...dirs,
    appVersion: "0.9.3",
    isPackaged: true,
    now: () => fixedNow,
    pid: 70707,
    isPidAlive: () => false,
    ...extra,
  };
}

async function marker(directory: string) {
  return JSON.parse(await fs.readFile(path.join(directory, ".videosell-migration.json"), "utf8"));
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("Videosell user-data migration", () => {
  it("copies the old tree, preserves the original, and writes a done marker and instructions", async () => {
    const dirs = await setup();
    await fs.mkdir(path.join(dirs.oldDir, "profiles", "acme"), { recursive: true });
    await fs.writeFile(path.join(dirs.oldDir, "brand.json"), JSON.stringify({ name: "Acme" }));
    await fs.writeFile(path.join(dirs.oldDir, "profiles", "acme", "profile.json"), JSON.stringify({ id: "acme" }));
    const bytes = Buffer.from([0, 3, 16, 255, 42, 0]);
    await fs.writeFile(path.join(dirs.oldDir, "profiles", "acme", "avatar.bin"), bytes);
    await fs.utimes(path.join(dirs.oldDir, "brand.json"), new Date("2001-01-01T00:00:00.000Z"), new Date("2001-01-01T00:00:00.000Z"));

    const result = migrateUserData(options(dirs));

    expect(result.status).toBe("done");
    expect(JSON.parse(await fs.readFile(path.join(dirs.newDir, "brand.json"), "utf8"))).toEqual({ name: "Acme" });
    expect(await fs.readFile(path.join(dirs.newDir, "profiles", "acme", "avatar.bin"))).toEqual(bytes);
    expect((await fs.stat(path.join(dirs.newDir, "brand.json"))).mtime.toISOString()).toBe("2001-01-01T00:00:00.000Z");
    expect(await fs.readFile(path.join(dirs.oldDir, "brand.json"), "utf8")).toBe(JSON.stringify({ name: "Acme" }));
    expect(await fs.readFile(path.join(dirs.oldDir, "LEIA-ME-VIDEOSELL.txt"), "utf8")).toContain("não é mais usada");
    expect(await marker(dirs.newDir)).toMatchObject({ schema: 1, status: "done", appVersion: "0.9.3", copied: { files: 3 } });
    expect(await fs.readFile(path.join(dirs.newDir, "logs", "migration.log"), "utf8")).toContain("Migração concluída");
  });

  it("marks a new-only user directory fresh without copying files", async () => {
    const dirs = await setup();
    await fs.mkdir(dirs.newDir, { recursive: true });
    await fs.writeFile(path.join(dirs.newDir, "preferences.json"), "{\"theme\":\"dark\"}");

    const result = migrateUserData(options(dirs));

    expect(result.status).toBe("fresh");
    expect(await fs.readFile(path.join(dirs.newDir, "preferences.json"), "utf8")).toBe('{"theme":"dark"}');
    expect(await marker(dirs.newDir)).toMatchObject({ status: "fresh", copied: { files: 0, bytes: 0 } });
  });

  it("keeps both directories when Videosell already has app data", async () => {
    const dirs = await setup();
    await fs.mkdir(dirs.oldDir, { recursive: true });
    await fs.mkdir(dirs.newDir, { recursive: true });
    await fs.writeFile(path.join(dirs.oldDir, "brand.json"), "old-brand");
    await fs.writeFile(path.join(dirs.newDir, "brand.json"), "new-brand");

    const result = migrateUserData(options(dirs));

    expect(result.status).toBe("kept-new");
    expect(await fs.readFile(path.join(dirs.oldDir, "brand.json"), "utf8")).toBe("old-brand");
    expect(await fs.readFile(path.join(dirs.newDir, "brand.json"), "utf8")).toBe("new-brand");
    expect(await fs.readdir(dirs.newDir)).toEqual(expect.arrayContaining(["brand.json", ".videosell-migration.json"]));
    expect(await marker(dirs.newDir)).toMatchObject({ status: "kept-new", copied: { files: 0, bytes: 0 } });
  });

  it("archives a Chromium-only new directory before copying old app data", async () => {
    const dirs = await setup();
    await fs.mkdir(dirs.oldDir, { recursive: true });
    await fs.writeFile(path.join(dirs.oldDir, "brand.json"), "from-cutroom");
    await fs.mkdir(path.join(dirs.newDir, "Local Storage"), { recursive: true });
    await fs.mkdir(path.join(dirs.newDir, "Cache"), { recursive: true });
    await fs.writeFile(path.join(dirs.newDir, "Local State"), "{}");
    await fs.writeFile(path.join(dirs.newDir, "Cache", "cache.bin"), "generated");

    const result = migrateUserData(options(dirs));

    expect(result.status).toBe("done");
    expect(await fs.readFile(path.join(dirs.newDir, "brand.json"), "utf8")).toBe("from-cutroom");
    const backup = (await fs.readdir(dirs.appDataDir)).find((name) => name.startsWith("Videosell.pre-migration-"));
    expect(backup).toBeTruthy();
    expect(await fs.readFile(path.join(dirs.appDataDir, backup!, "Local State"), "utf8")).toBe("{}");
  });

  it("discards an interrupted staging directory and restarts without changing the old files", async () => {
    const dirs = await setup();
    await fs.mkdir(dirs.oldDir, { recursive: true });
    await fs.writeFile(path.join(dirs.oldDir, "integrations.json"), JSON.stringify({ test: "ciphertext" }));
    await fs.mkdir(`${dirs.newDir}.migrating`, { recursive: true });
    await fs.writeFile(path.join(`${dirs.newDir}.migrating`, "partial.bin"), "partial");

    const result = migrateUserData(options(dirs));

    expect(result.status).toBe("done");
    expect(await fs.readFile(path.join(dirs.newDir, "integrations.json"), "utf8")).toBe('{"test":"ciphertext"}');
    expect(await fs.readFile(path.join(dirs.oldDir, "integrations.json"), "utf8")).toBe('{"test":"ciphertext"}');
    await expect(fs.access(`${dirs.newDir}.migrating`)).rejects.toThrow();
  });

  it("is idempotent after a completed migration", async () => {
    const dirs = await setup();
    await fs.mkdir(dirs.oldDir, { recursive: true });
    await fs.writeFile(path.join(dirs.oldDir, "preferences.json"), JSON.stringify({ volume: 4 }));
    expect(migrateUserData(options(dirs)).status).toBe("done");
    const before = await fs.readFile(path.join(dirs.newDir, "preferences.json"));

    const second = migrateUserData(options(dirs));

    expect(second.status).toBe("done");
    expect(await fs.readFile(path.join(dirs.newDir, "preferences.json"))).toEqual(before);
    expect((await fs.readdir(dirs.appDataDir)).filter((name) => name.startsWith("Videosell.pre-migration-"))).toHaveLength(0);
  });

  it("uses the old folder in-place when free space is insufficient", async () => {
    const dirs = await setup();
    await fs.mkdir(dirs.oldDir, { recursive: true });
    await fs.writeFile(path.join(dirs.oldDir, "brand.json"), "old-data");
    await fs.mkdir(path.join(dirs.newDir, "Cache"), { recursive: true });
    const fsWithNoSpace = { ...syncFs, statfsSync: () => ({ bavail: 1, bsize: 1 }) } as unknown as MigrationFs;

    const result = migrateUserData(options(dirs, { fs: fsWithNoSpace }));

    expect(result).toMatchObject({ status: "in-place", userDataPath: dirs.oldDir });
    expect(await fs.readFile(path.join(dirs.oldDir, "brand.json"), "utf8")).toBe("old-data");
    expect(await fs.readdir(path.join(dirs.newDir, "Cache"))).toEqual([]);
    await expect(fs.access(`${dirs.newDir}.migrating`)).rejects.toThrow();
    expect(await marker(dirs.newDir)).toMatchObject({ status: "in-place" });
  });

  it("does not migrate while a live process owns the migration lock", async () => {
    const dirs = await setup();
    await fs.mkdir(dirs.oldDir, { recursive: true });
    await fs.writeFile(path.join(dirs.oldDir, "brand.json"), "old-data");
    const lock = path.join(dirs.appDataDir, "Videosell.migration.lock");
    await fs.mkdir(lock, { recursive: true });
    await fs.writeFile(path.join(lock, "owner.json"), JSON.stringify({ pid: 8123, startedAt: fixedNow.toISOString() }));

    const result = migrateUserData(options(dirs, { isPidAlive: () => true }));

    expect(result.status).toBe("lock-busy");
    expect(await fs.readFile(path.join(dirs.oldDir, "brand.json"), "utf8")).toBe("old-data");
    await expect(fs.access(dirs.newDir)).rejects.toThrow();
  });

  it("removes a stale lock and proceeds with migration", async () => {
    const dirs = await setup();
    await fs.mkdir(dirs.oldDir, { recursive: true });
    await fs.writeFile(path.join(dirs.oldDir, "brand.json"), "old-data");
    const lock = path.join(dirs.appDataDir, "Videosell.migration.lock");
    await fs.mkdir(lock, { recursive: true });
    await fs.writeFile(path.join(lock, "owner.json"), JSON.stringify({ pid: 8123, startedAt: new Date(fixedNow.getTime() - 31 * 60_000).toISOString() }));

    const result = migrateUserData(options(dirs, { isPidAlive: () => false }));

    expect(result.status).toBe("done");
    expect(await fs.readFile(path.join(dirs.newDir, "brand.json"), "utf8")).toBe("old-data");
    await expect(fs.access(lock)).rejects.toThrow();
  });

  it("renames packages into the destination when they alone exceed available space", async () => {
    const dirs = await setup();
    await fs.mkdir(path.join(dirs.oldDir, "packages"), { recursive: true });
    await fs.writeFile(path.join(dirs.oldDir, "preferences.json"), "{}");
    await fs.writeFile(path.join(dirs.oldDir, "packages", "runtime.bin"), Buffer.alloc(1000, 5));
    const fsWithLimitedSpace = { ...syncFs, statfsSync: () => ({ bavail: 100, bsize: 1 }) } as unknown as MigrationFs;

    const result = migrateUserData(options(dirs, { fs: fsWithLimitedSpace }));

    expect(result.status).toBe("done");
    expect(await fs.readFile(path.join(dirs.newDir, "packages", "runtime.bin"))).toEqual(Buffer.alloc(1000, 5));
    await expect(fs.access(path.join(dirs.oldDir, "packages"))).rejects.toThrow();
    expect((await marker(dirs.newDir)).moved).toContain("packages (transferido por renomeação no mesmo volume)");
    expect(await fs.readFile(path.join(dirs.newDir, "logs", "migration.log"), "utf8")).toContain("precisará baixar os pacotes novamente");
  });

  it("supports rollback by renaming the new directory and preserving the old one", async () => {
    const dirs = await setup();
    await fs.mkdir(dirs.oldDir, { recursive: true });
    await fs.mkdir(dirs.newDir, { recursive: true });
    await fs.writeFile(path.join(dirs.oldDir, "brand.json"), "old-data");
    await fs.writeFile(path.join(dirs.newDir, "brand.json"), "new-data");

    const rolledBack = rollbackMigration({ fs: syncFs as unknown as MigrationFs, path, ...dirs, now: () => fixedNow });

    expect(path.basename(rolledBack)).toBe("Videosell.rolled-back-2026-11-27T12-00-00-000Z");
    expect(await fs.readFile(path.join(rolledBack, "brand.json"), "utf8")).toBe("new-data");
    expect(await fs.readFile(path.join(dirs.oldDir, "brand.json"), "utf8")).toBe("old-data");
    await expect(fs.access(dirs.newDir)).rejects.toThrow();
  });

  it("does not copy regenerable Chromium caches or follow source symlinks", async () => {
    const dirs = await setup();
    await fs.mkdir(path.join(dirs.oldDir, "Cache"), { recursive: true });
    await fs.mkdir(path.join(dirs.oldDir, "Code Cache"), { recursive: true });
    await fs.mkdir(path.join(dirs.oldDir, "GPUCache"), { recursive: true });
    await fs.mkdir(path.join(dirs.oldDir, "profiles"), { recursive: true });
    await fs.writeFile(path.join(dirs.oldDir, "Cache", "cache.bin"), "cache");
    await fs.writeFile(path.join(dirs.oldDir, "Code Cache", "code.bin"), "code");
    await fs.writeFile(path.join(dirs.oldDir, "GPUCache", "gpu.bin"), "gpu");
    const outside = path.join(dirs.root, "outside.json");
    await fs.writeFile(outside, "outside");
    await fs.symlink(outside, path.join(dirs.oldDir, "profiles", "outside.json"));
    await fs.writeFile(path.join(dirs.oldDir, "preferences.json"), "{}");

    const result = migrateUserData(options(dirs));

    expect(result.status).toBe("done");
    for (const cache of ["Cache", "Code Cache", "GPUCache"]) await expect(fs.access(path.join(dirs.newDir, cache))).rejects.toThrow();
    await expect(fs.access(path.join(dirs.newDir, "profiles", "outside.json"))).rejects.toThrow();
    expect((await marker(dirs.newDir)).skipped).toEqual(expect.arrayContaining(["Cache", "Code Cache", "GPUCache", `${path.join("profiles", "outside.json")} (atalho simbólico ignorado)`]));
  });
});

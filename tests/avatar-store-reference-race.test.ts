import {
  appendFile,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AVATAR_REFERENCE_MAX_BYTES,
  AvatarStore,
} from "../electron/core/avatar-store";
import { AvatarVision } from "../electron/core/avatar-vision";

const control = vi.hoisted(() => ({
  afterLstat: undefined as ((path: string) => Promise<void>) | undefined,
  beforeRead: undefined as (() => Promise<void>) | undefined,
  readError: undefined as Error | undefined,
  trackOpen: undefined as ((path: string) => boolean) | undefined,
  openRedirects: new Map<string, string>(),
  symlinkTargets: new Map<string, string>(),
  handles: [] as Array<{
    path: string;
    closed: boolean;
    reads: number;
    readFiles: number;
  }>,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    lstat: async (path: Parameters<typeof actual.lstat>[0]) => {
      const redirected = control.symlinkTargets.get(String(path));
      const info = await actual.lstat(redirected ?? path);
      if (redirected) {
        return Object.assign(Object.create(Object.getPrototypeOf(info)), info, {
          isFile: () => false,
          isSymbolicLink: () => true,
        }) as typeof info;
      }
      const hook = control.afterLstat;
      control.afterLstat = undefined;
      if (hook) await hook(String(path));
      return info;
    },
    open: async (
      path: Parameters<typeof actual.open>[0],
      flags: Parameters<typeof actual.open>[1],
      mode?: Parameters<typeof actual.open>[2],
    ) => {
      const handle = await actual.open(
        control.openRedirects.get(String(path)) ?? path,
        flags,
        mode,
      );
      if (!control.trackOpen?.(String(path))) return handle;
      const record = {
        path: String(path),
        closed: false,
        reads: 0,
        readFiles: 0,
      };
      control.handles.push(record);
      const beforeRead = async () => {
        const hook = control.beforeRead;
        control.beforeRead = undefined;
        if (hook) await hook();
        if (control.readError) throw control.readError;
      };
      return new Proxy(handle, {
        get(target, property) {
          if (property === "read") {
            return async (...args: unknown[]) => {
              record.reads += 1;
              await beforeRead();
              return (target.read as (...args: unknown[]) => unknown)(...args);
            };
          }
          if (property === "readFile") {
            return async (...args: unknown[]) => {
              record.readFiles += 1;
              await beforeRead();
              return (target.readFile as (...args: unknown[]) => unknown)(
                ...args,
              );
            };
          }
          if (property === "close") {
            return async () => {
              record.closed = true;
              await target.close();
            };
          }
          const value = Reflect.get(target, property, target) as unknown;
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    },
  };
});

const roots: string[] = [];
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

async function temporaryRoot() {
  const root = await mkdtemp(join(tmpdir(), "avatar-reference-race-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  control.afterLstat = undefined;
  control.beforeRead = undefined;
  control.readError = undefined;
  control.trackOpen = undefined;
  control.openRedirects.clear();
  control.symlinkTargets.clear();
  control.handles = [];
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("AvatarStore reference race containment", () => {
  it("rejects a source replaced by a symlink between lstat and open", async () => {
    const root = await temporaryRoot();
    const outside = await temporaryRoot();
    const source = join(root, "source.png");
    const external = join(outside, "external.png");
    await writeFile(source, PNG);
    await writeFile(external, PNG);
    control.trackOpen = (path) => path === source;
    control.afterLstat = async (path) => {
      if (path !== source) return;
      control.openRedirects.set(source, external);
      control.symlinkTargets.set(source, external);
    };
    const store = new AvatarStore(join(root, "avatars"));

    await expect(
      store.importReference({ avatarId: "videosell-presenter", path: source }),
    ).rejects.toThrow(/redire|alterad|diverg|inválid|ELOOP/i);
    expect(control.handles).toHaveLength(1);
    expect(control.handles[0].closed).toBe(true);
  });

  it("rejects an imported reference that grows during a bounded handle read", async () => {
    const root = await temporaryRoot();
    const source = join(root, "source.png");
    await writeFile(source, PNG);
    const store = new AvatarStore(join(root, "avatars"));
    const asset = await store.importReference({
      avatarId: "videosell-presenter",
      path: source,
    });
    control.trackOpen = (path) => path === asset.path;
    control.beforeRead = async () => {
      await appendFile(
        asset.path,
        Buffer.alloc(AVATAR_REFERENCE_MAX_BYTES + 1),
      );
    };

    await expect(
      store.readReference(asset.avatarId, asset.assetId),
    ).rejects.toThrow(/limite|alterad|diverg/i);
    expect(control.handles).toHaveLength(1);
    expect(control.handles[0].readFiles).toBe(0);
    expect(control.handles[0].closed).toBe(true);
  });

  it("rejects references above 10 MiB in import, read and analysis without calling vision", async () => {
    const root = await temporaryRoot();
    const source = join(root, "source.png");
    const oversized = Buffer.concat([
      PNG,
      Buffer.alloc(AVATAR_REFERENCE_MAX_BYTES + 1),
    ]);
    await writeFile(source, oversized);
    const store = new AvatarStore(join(root, "avatars"));
    await expect(
      store.importReference({ avatarId: "videosell-presenter", path: source }),
    ).rejects.toThrow(/limite/i);

    await writeFile(source, PNG);
    const asset = await store.importReference({
      avatarId: "videosell-presenter",
      path: source,
    });
    await writeFile(asset.path, oversized);
    await expect(
      store.readReference(asset.avatarId, asset.assetId),
    ).rejects.toThrow(/limite|inválid/i);
    const analyze = vi.fn(async () => ({
      identityAnchors: {},
      inferredFields: [],
    }));
    const vision = new AvatarVision({
      store,
      provider: () => ({ id: "vision", supportsVision: true, analyze }),
    });
    await expect(
      vision.analyzeReference({
        avatarId: asset.avatarId,
        assetId: asset.assetId,
        providerId: "vision",
        prompt: "Analise",
      }),
    ).rejects.toThrow(/limite|inválid/i);
    expect(analyze).not.toHaveBeenCalled();
  });

  it("rejects non-regular sources and closes the handle after a read failure", async () => {
    const root = await temporaryRoot();
    const directory = join(root, "directory.png");
    await mkdir(directory);
    const store = new AvatarStore(join(root, "avatars"));
    await expect(
      store.importReference({
        avatarId: "videosell-presenter",
        path: directory,
      }),
    ).rejects.toThrow(/regular|inválid/i);

    const source = join(root, "source.png");
    await writeFile(source, PNG);
    control.trackOpen = (path) => path === source;
    control.readError = new Error("Falha de leitura simulada.");
    await expect(
      store.importReference({ avatarId: "videosell-presenter", path: source }),
    ).rejects.toThrow("Falha de leitura simulada.");
    expect(control.handles).toHaveLength(1);
    expect(control.handles[0].closed).toBe(true);
    expect(await readdir(dirname(source))).not.toContain("assets");
  });
});

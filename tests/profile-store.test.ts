import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ProfileService } from "../electron/core/profile-service";
import { ProfileStore } from "../electron/core/profile-store";

const roots: string[] = [];

async function temporaryRoot() {
  const root = await mkdtemp(join(tmpdir(), "profile-store-"));
  roots.push(root);
  return root;
}

function setup(root: string) {
  const store = new ProfileStore(root);
  const service = new ProfileService({ store });
  return { store, service };
}

const SECRET_VALUE = "sk-test-recursive-profile-secret-123456";
const SECRET_ERROR = "Preferências contêm campos ou valores não permitidos.";
const SENSITIVE_KEYS = [
  "apiKey",
  "api-key",
  "api_key",
  "api key",
  "secret",
  "clientSecret",
  "client-secret",
  "client secret",
  "password",
  "passphrase",
  "pass-phrase",
  "passwd",
  "pwd",
  "token",
  "accessToken",
  "access_token",
  "accessKey",
  "access_key",
  "clientKey",
  "client-key",
  "client_key",
  "signingKey",
  "signing-key",
  "signing_key",
  "encryptionKey",
  "refreshToken",
  "refresh token",
  "credential",
  "credentials",
  "credential-id",
  "authorization",
  "auth",
  "cookie",
  "session",
  "privateKey",
  "private_key",
  "bearer",
  "bearer-token",
  "totallyUnknown",
];

async function expectSecretRejection(operation: Promise<unknown>) {
  let error: unknown;
  try {
    await operation;
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toBe(SECRET_ERROR);
  expect((error as Error).message).not.toContain(SECRET_VALUE);
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("ProfileStore and ProfileService", () => {
  it("keeps two profiles and their projects independent", async () => {
    const { service } = setup(await temporaryRoot());
    const a = await service.create({ name: "Orbit Labs", handle: "orbitlabs" });
    const b = await service.create({ name: "Matheus", handle: "matheus" });

    await service.update(a.id, {
      brand: { accent: "#7C5CFF" },
      voice: { provider: "local", voiceId: "atlas" },
    });
    await service.linkProject(a.id, "film-orbit");
    await service.linkProject(b.id, "film-matheus");

    expect((await service.get(a.id)).brand.accent).toBe("#7C5CFF");
    expect((await service.get(a.id)).voice).toEqual({ provider: "local", voiceId: "atlas" });
    expect((await service.get(b.id)).brand.accent).not.toBe("#7C5CFF");
    expect(await service.listProjects(a.id)).toEqual(["film-orbit"]);
    expect(await service.listProjects(b.id)).toEqual(["film-matheus"]);
  });

  it("persists strict versioned profiles and a small active-profile index", async () => {
    const root = await temporaryRoot();
    const { service } = setup(root);
    const created = await service.create({ name: "Orbit Labs", handle: "orbitlabs" });
    await service.setActive(created.id);

    const profilePath = join(root, "profiles", created.id, "profile.json");
    const persisted = JSON.parse(await readFile(profilePath, "utf8"));
    expect(persisted).toMatchObject({
      version: 1,
      id: "orbitlabs",
      name: "Orbit Labs",
      handle: "orbitlabs",
      createdAt: created.createdAt,
      updatedAt: created.updatedAt,
    });
    expect(Object.keys(persisted).sort()).toEqual(
      [
        "version",
        "id",
        "name",
        "handle",
        "voice",
        "personality",
        "brand",
        "instagram",
        "commercialGoal",
        "preferences",
        "createdAt",
        "updatedAt",
      ].sort(),
    );
    expect(JSON.parse(await readFile(join(root, "profiles", "index.json"), "utf8"))).toEqual({
      version: 1,
      activeProfileId: created.id,
      profileIds: [created.id],
    });
    await expect(access(`${profilePath}.partial`)).rejects.toThrow();
    await expect(access(join(root, "profiles", "index.json.partial"))).rejects.toThrow();

    const reopened = setup(root).service;
    await expect(reopened.get(created.id)).resolves.toEqual(created);
    await expect(reopened.getActive()).resolves.toEqual(created);
  });

  it("rejects invalid ids, handles, colors and avatar hashes without changing the profile", async () => {
    const { service } = setup(await temporaryRoot());
    const profile = await service.create({ name: "Orbit Labs", handle: "orbitlabs" });
    const before = await service.get(profile.id);

    await expect(service.create({ name: "Bad", handle: "bad handle" })).rejects.toThrow(/handle/i);
    await expect(service.get("../outside")).rejects.toThrow(/id/i);
    await expect(service.update(profile.id, { brand: { accent: "violet" } })).rejects.toThrow(/accent|cor/i);
    await expect(
      service.update(profile.id, {
        defaultAvatar: { avatarId: "avatar-orbit", revision: 1, hash: "not-a-sha256" },
      }),
    ).rejects.toThrow(/hash/i);
    await expect(
      service.update(profile.id, {
        defaultAvatar: { avatarId: "../avatar", revision: 1, hash: "a".repeat(64) },
      }),
    ).rejects.toThrow(/avatar|id/i);
    await expect(
      service.update(profile.id, {
        defaultAvatar: { avatarId: "avatar-orbit", revision: 0, hash: "a".repeat(64) },
      }),
    ).rejects.toThrow(/revision|revis/i);

    await expect(
      service.update(profile.id, {
        defaultAvatar: { avatarId: "avatar-orbit", revision: 2, hash: "a".repeat(64) },
      }),
    ).resolves.toMatchObject({
      defaultAvatar: { avatarId: "avatar-orbit", revision: 2, hash: "a".repeat(64) },
    });
    expect((await service.get(profile.id)).createdAt).toBe(before.createdAt);
  });

  it("rejects every unknown or sensitive key recursively during create without leaking values", async () => {
    const { service } = setup(await temporaryRoot());
    for (const [index, key] of SENSITIVE_KEYS.entries()) {
      await expectSecretRejection(
        service.create({
          name: `Creator ${index}`,
          handle: `creator-${index}`,
          instagram: {
            preferences: { accounts: [{ id: "connection-orbit", nested: [{ [key]: SECRET_VALUE }] }] },
          },
        }),
      );
    }
    expect(await service.list()).toEqual([]);
  });

  it("rejects every unknown or sensitive key recursively during update and preserves the profile", async () => {
    const { service } = setup(await temporaryRoot());
    const profile = await service.create({ name: "Orbit Labs", handle: "orbitlabs" });
    const before = await service.get(profile.id);
    for (const key of SENSITIVE_KEYS) {
      await expectSecretRejection(
        service.update(profile.id, {
          instagram: {
            preferences: { accounts: [{ id: "connection-orbit", nested: [{ [key]: SECRET_VALUE }] }] },
          },
        }),
      );
    }
    expect(await service.get(profile.id)).toEqual(before);
  });

  it("rejects unknown general preferences in create and update", async () => {
    const { service } = setup(await temporaryRoot());
    await expectSecretRejection(
      service.create({ name: "Orbit Labs", handle: "orbitlabs", preferences: { totallyUnknown: SECRET_VALUE } }),
    );
    const profile = await service.create({ name: "Orbit Labs", handle: "orbitlabs" });
    await expectSecretRejection(service.update(profile.id, { preferences: { totallyUnknown: SECRET_VALUE } }));
    expect((await service.get(profile.id)).preferences).toEqual({});
  });

  it("allows only documented Instagram preferences and credentialRef in typed voice", async () => {
    const { service } = setup(await temporaryRoot());
    const profile = await service.create({
      name: "Orbit Labs",
      handle: "orbitlabs",
      voice: { credentialRef: "elevenlabs" },
      instagram: {
        preferences: {
          shareToFeed: false,
          accounts: [{ id: "connection-orbit", userId: "", igUserId: 0, username: "", status: null }],
        },
      },
    });
    expect(profile.voice.credentialRef).toBe("elevenlabs");
    expect(profile.instagram.preferences).toEqual({
      shareToFeed: false,
      accounts: [{ id: "connection-orbit", userId: "", igUserId: 0, username: "", status: null }],
    });
    await expectSecretRejection(
      service.create({ name: "Other", handle: "other", preferences: { credentialRef: "openai" } }),
    );
    await expectSecretRejection(
      service.update(profile.id, { instagram: { preferences: { credentialRef: "connection-orbit" } } }),
    );
  });

  it("preserves Instagram preferences when updating only connectionId", async () => {
    const { service } = setup(await temporaryRoot());
    const preferences = {
      shareToFeed: false,
      accounts: [{ id: "connection-orbit", username: "orbit" }],
    };
    const profile = await service.create({
      name: "Orbit Labs",
      handle: "orbitlabs",
      instagram: { preferences },
    });

    const updated = await service.update(profile.id, { instagram: { connectionId: "ca_2" } });

    expect(updated.instagram).toEqual({ connectionId: "ca_2", preferences });
    expect((await service.get(profile.id)).instagram).toEqual({ connectionId: "ca_2", preferences });
  });

  it("rejects functions, bigint, non-finite numbers and cyclic structures", async () => {
    const { service } = setup(await temporaryRoot());
    const profile = await service.create({ name: "Orbit Labs", handle: "orbitlabs" });
    for (const value of [() => SECRET_VALUE, 1n, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expectSecretRejection(
        service.update(profile.id, {
          instagram: { preferences: { accounts: [{ id: "connection-orbit", username: value }] } },
        }),
      );
    }
    const cyclic: unknown[] = [{ id: "connection-orbit" }];
    cyclic.push(cyclic);
    await expectSecretRejection(
      service.update(profile.id, { instagram: { preferences: { accounts: cyclic } } }),
    );
  });

  it("rejects non-enumerable array toJSON without executing or persisting its secret", async () => {
    const root = await temporaryRoot();
    const { service } = setup(root);
    const accounts = [{ id: "connection-orbit" }];
    Object.defineProperty(accounts, "toJSON", {
      enumerable: false,
      value: () => ({ totallyUnknown: SECRET_VALUE }),
    });

    await expectSecretRejection(
      service.create({
        name: "Orbit Labs",
        handle: "orbitlabs",
        instagram: { preferences: { accounts } },
      }),
    );
    expect(await service.list()).toEqual([]);
    await expect(access(join(root, "profiles", "orbitlabs", "profile.json"))).rejects.toThrow();
  });

  it("rejects changing array getters during update without reading them", async () => {
    const { service } = setup(await temporaryRoot());
    const profile = await service.create({ name: "Orbit Labs", handle: "orbitlabs" });
    const before = await service.get(profile.id);
    let reads = 0;
    const accounts: unknown[] = [];
    Object.defineProperty(accounts, "0", {
      enumerable: true,
      get: () => {
        reads += 1;
        return reads === 1
          ? { id: "connection-orbit" }
          : { id: "connection-orbit", totallyUnknown: SECRET_VALUE };
      },
    });

    await expectSecretRejection(
      service.update(profile.id, { instagram: { preferences: { accounts } } }),
    );
    expect(reads).toBe(0);
    expect(await service.get(profile.id)).toEqual(before);
  });

  it("rejects array extra properties, symbols and altered prototypes", async () => {
    const { service } = setup(await temporaryRoot());
    const profile = await service.create({ name: "Orbit Labs", handle: "orbitlabs" });
    const extra = Object.assign([{ id: "connection-orbit" }], { totallyUnknown: SECRET_VALUE });
    const hidden = [{ id: "connection-orbit" }];
    Object.defineProperty(hidden, "hiddenMethod", { enumerable: false, value: () => SECRET_VALUE });
    const symbol = [{ id: "connection-orbit" }];
    (symbol as unknown as Record<symbol, unknown>)[Symbol("secret")] = SECRET_VALUE;
    const prototype = [{ id: "connection-orbit" }];
    Object.setPrototypeOf(prototype, {});

    for (const accounts of [extra, hidden, symbol, prototype])
      await expectSecretRejection(
        service.update(profile.id, { instagram: { preferences: { accounts } } }),
      );
  });

  it("persists and returns normalized copies isolated from later input mutations", async () => {
    const { service } = setup(await temporaryRoot());
    const createAccounts = [{ id: "connection-orbit", username: "created" }];
    const createAvatar = { avatarId: "avatar-orbit", revision: 1, hash: "a".repeat(64) };
    const created = await service.create({
      name: "Orbit Labs",
      handle: "orbitlabs",
      defaultAvatar: createAvatar,
      instagram: { preferences: { accounts: createAccounts } },
    });
    createAccounts[0].username = "mutated-after-create";
    createAvatar.revision = 99;
    expect(created.instagram.preferences.accounts).toEqual([{ id: "connection-orbit", username: "created" }]);
    expect(created.defaultAvatar?.revision).toBe(1);

    const updateAccounts = [{ id: "connection-orbit", username: "updated" }];
    const updateAvatar = { avatarId: "avatar-orbit", revision: 2, hash: "b".repeat(64) };
    const updated = await service.update(created.id, {
      defaultAvatar: updateAvatar,
      instagram: { preferences: { accounts: updateAccounts } },
    });
    updateAccounts[0].username = "mutated-after-update";
    updateAvatar.hash = "c".repeat(64);
    expect(updated.instagram.preferences.accounts).toEqual([{ id: "connection-orbit", username: "updated" }]);
    expect(updated.defaultAvatar?.hash).toBe("b".repeat(64));
    const reloaded = await service.get(created.id);
    expect(reloaded.instagram.preferences.accounts).toEqual([{ id: "connection-orbit", username: "updated" }]);
    expect(reloaded.defaultAvatar?.hash).toBe("b".repeat(64));
  });

  it("rejects duplicate, malformed and cross-profile project links atomically", async () => {
    const root = await temporaryRoot();
    const { service } = setup(root);
    const a = await service.create({ name: "Orbit Labs", handle: "orbitlabs" });
    const b = await service.create({ name: "Matheus", handle: "matheus" });

    await service.linkProject(a.id, "film-orbit");
    await expect(service.linkProject(a.id, "film-orbit")).rejects.toThrow(/duplic|already|já/i);
    await expect(service.linkProject(b.id, "film-orbit")).rejects.toThrow(/profile|perfil|duplic|already|já/i);
    for (const id of ["../outside", "nested/id", "nested\\id", "", ".", ".."])
      await expect(service.linkProject(a.id, id)).rejects.toThrow(/id/i);

    expect(await service.listProjects(a.id)).toEqual(["film-orbit"]);
    expect(await service.listProjects(b.id)).toEqual([]);
    const projectsPath = join(root, "profiles", a.id, "projects.json");
    expect(JSON.parse(await readFile(projectsPath, "utf8"))).toEqual({ version: 1, projectIds: ["film-orbit"] });
    await expect(access(`${projectsPath}.partial`)).rejects.toThrow();
  });

  it("serializes concurrent creates across instances without losing profiles", async () => {
    const root = await temporaryRoot();
    const first = new ProfileService({ store: new ProfileStore(root) });
    const second = new ProfileService({ store: new ProfileStore(join(root, ".")) });

    const [a, b] = await Promise.all([
      first.create({ name: "Orbit Labs", handle: "orbitlabs" }),
      second.create({ name: "Matheus", handle: "matheus" }),
    ]);

    expect((await first.list()).map((profile) => profile.id).sort()).toEqual([a.id, b.id].sort());
    expect([a.id, b.id]).toContain((await first.getActive())?.id);
    const profilesRoot = join(root, "profiles");
    const index = JSON.parse(await readFile(join(profilesRoot, "index.json"), "utf8"));
    expect(index.profileIds.sort()).toEqual([a.id, b.id].sort());
    expect(index.activeProfileId).toBe((await first.getActive())?.id);
    expect((await readdir(profilesRoot)).sort()).toEqual(["index.json", a.id, b.id].sort());
    const entries = await readdir(profilesRoot, { recursive: true });
    expect(entries.some((entry) => entry.endsWith(".partial"))).toBe(false);
  });

  it("preserves both changes during concurrent updates", async () => {
    const root = await temporaryRoot();
    const { service } = setup(root);
    const other = new ProfileService({ store: new ProfileStore(root) });
    const profile = await service.create({ name: "Orbit Labs", handle: "orbitlabs" });

    await Promise.all([
      service.update(profile.id, { brand: { accent: "#123456" } }),
      other.update(profile.id, { voice: { provider: "local", voiceId: "atlas" } }),
    ]);

    const persisted = await service.get(profile.id);
    expect(persisted.brand.accent).toBe("#123456");
    expect(persisted.voice).toEqual({ provider: "local", voiceId: "atlas" });
  });

  it("rejects the foreign owner during concurrent project links", async () => {
    const root = await temporaryRoot();
    const { service } = setup(root);
    const a = await service.create({ name: "Orbit Labs", handle: "orbitlabs" });
    const b = await service.create({ name: "Matheus", handle: "matheus" });

    let arrivals = 0;
    let release: () => void = () => undefined;
    const bothWriting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const coordinateWrites = async () => {
      arrivals += 1;
      if (arrivals === 2) release();
      await Promise.race([bothWriting, new Promise<void>((resolve) => setTimeout(resolve, 25))]);
    };
    class CoordinatedProfileStore extends ProfileStore {
      protected async writeAtomic(file: string, value: unknown): Promise<void> {
        if (file.endsWith("projects.json")) await coordinateWrites();
        await super.writeAtomic(file, value);
      }
    }
    const first = new ProfileService({ store: new CoordinatedProfileStore(root) });
    const second = new ProfileService({ store: new CoordinatedProfileStore(root) });

    const results = await Promise.allSettled([
      first.linkProject(a.id, "film-shared"),
      second.linkProject(b.id, "film-shared"),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected?.status).toBe("rejected");
    if (rejected?.status === "rejected") expect(String(rejected.reason)).toMatch(/outro perfil|another profile/i);
    const projects = await Promise.all([service.listProjects(a.id), service.listProjects(b.id)]);
    expect(projects.filter((ids) => ids.includes("film-shared"))).toEqual([["film-shared"]]);
    expect(JSON.parse(await readFile(join(root, "profiles", "index.json"), "utf8")).profileIds.sort()).toEqual(
      [a.id, b.id].sort(),
    );
    const entries = await readdir(join(root, "profiles"), { recursive: true });
    expect(entries.some((entry) => entry.endsWith(".partial"))).toBe(false);
  });

  it("keeps the index consistent during concurrent update, delete and select", async () => {
    const root = await temporaryRoot();
    const { service } = setup(root);
    const other = new ProfileService({ store: new ProfileStore(root) });
    const removed = await service.create({ name: "Orbit Labs", handle: "orbitlabs" });
    const selected = await service.create({ name: "Matheus", handle: "matheus" });

    const [update, deletion, selection] = await Promise.allSettled([
      other.update(removed.id, { commercialGoal: "Atualização concorrente" }),
      other.delete(removed.id, "DELETE"),
      service.setActive(selected.id),
    ]);

    if (update.status === "rejected") expect(String(update.reason)).toMatch(/encontr|not found/i);
    expect(deletion.status).toBe("fulfilled");
    expect(selection.status).toBe("fulfilled");
    expect((await service.list()).map((profile) => profile.id)).toEqual([selected.id]);
    expect((await service.getActive())?.id).toBe(selected.id);
    const index = JSON.parse(await readFile(join(root, "profiles", "index.json"), "utf8"));
    expect(index).toMatchObject({ activeProfileId: selected.id, profileIds: [selected.id] });
    expect((await readdir(join(root, "profiles"))).sort()).toEqual(["index.json", selected.id].sort());
  });

  it("removes temporary files when an atomic write fails", async () => {
    const root = await temporaryRoot();
    class ExposedProfileStore extends ProfileStore {
      writeAtomically(file: string, value: unknown) {
        return this.writeAtomic(file, value);
      }
    }
    const store = new ExposedProfileStore(root);
    const profilesRoot = join(root, "profiles");
    const target = join(profilesRoot, "index.json");
    await mkdir(target, { recursive: true });

    await expect(store.writeAtomically(target, { version: 1, profileIds: [] })).rejects.toThrow();

    expect(await readdir(profilesRoot)).toEqual(["index.json"]);
  });

  it("requires DELETE confirmation and removes only profile metadata", async () => {
    const root = await temporaryRoot();
    const { service } = setup(root);
    const profile = await service.create({ name: "Orbit Labs", handle: "orbitlabs" });
    const sharedMedia = join(root, "shared-media.mp4");
    await writeFile(sharedMedia, "shared media", "utf8");

    await expect(service.delete(profile.id, "REMOVE" as "DELETE")).rejects.toThrow(/DELETE|confir/i);
    await expect(service.get(profile.id)).resolves.toMatchObject({ id: profile.id });
    await service.delete(profile.id, "DELETE");

    await expect(service.get(profile.id)).rejects.toThrow(/encontr|not found|exist/i);
    await expect(readFile(sharedMedia, "utf8")).resolves.toBe("shared media");
  });
});

import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

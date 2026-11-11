import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AvatarService } from "../electron/core/avatar-service";
import { AvatarStore } from "../electron/core/avatar-store";
import { Films } from "../electron/core/film";
import {
  filmAvatarCacheKey,
  filmAvatarSnapshotPath,
  mouthsFromEnvelope,
} from "../electron/core/film-avatar";
import { FilmStudio, type FilmHost } from "../electron/core/film-studio";
import type { Studio } from "../electron/core/studio";
import { STUDIO_TOOLS } from "../electron/core/studio-tool-defs";
import { avatarFixture } from "./fixtures/avatar-fixture";

const roots: string[] = [];

async function temporaryRoot() {
  const root = await mkdtemp(join(tmpdir(), "film-avatar-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function approvedRevision(root: string) {
  const store = new AvatarStore(join(root, "avatars"));
  const service = new AvatarService({
    store,
    renderer: async () => {
      throw new Error("Render não usado neste teste.");
    },
  });
  const created = await service.createCandidate({
    description: "Avatar para filme",
    package: avatarFixture(),
  });
  const candidate = created.candidates[0];
  let selected = await service.selectCandidate(created.avatarId, candidate.candidateId);
  for (const hidden of [false, true]) {
    const next = avatarFixture();
    next.mouths.X.mouth = { hidden };
    selected = await service.revisePart({
      avatarId: created.avatarId,
      revision: selected.revision,
      allowedPartIds: ["mouth"],
      package: next,
    });
  }
  return { store, service, selected };
}

async function setup() {
  const root = await temporaryRoot();
  const avatar = await approvedRevision(root);
  const films = new Films(
    join(root, "films"),
    resolve("resources/film-kit"),
    createRequire(import.meta.url).resolve("gsap/dist/gsap.min.js"),
  );
  const host = {
    films,
    avatarStore: avatar.store,
    avatarEngineDir: resolve("resources/avatar-engine"),
    brand: { get: async () => null },
    runner: async () => ({ worker: "unused", browser: "unused" }),
    videosDir: join(root, "videos"),
    job: async <T>(_kind: string, _label: string, run: (signal: AbortSignal, progress: (value: number) => void) => Promise<T>) =>
      run(new AbortController().signal, () => undefined),
  } as unknown as FilmHost;
  return { ...avatar, root, films, studio: new FilmStudio(host, {} as Studio) };
}

describe("film avatar snapshots", { timeout: 60_000 }, () => {
  it("creates films with an optional immutable approved avatar snapshot", async () => {
    const { studio, films, service, selected } = await setup();
    const reference = { avatarId: selected.avatarId, revision: selected.revision, hash: selected.hash };
    expect(selected.revision).toBe(3);

    const withAvatar = await studio.create({ name: "Com avatar", avatar: reference });
    const withoutAvatar = await studio.create({ name: "Sem avatar" });
    expect(withAvatar.avatar).toEqual(reference);
    expect(withoutAvatar.avatar).toBeUndefined();
    expect((await films.meta(withAvatar.film)).avatar).toEqual(reference);
    expect((await films.meta(withoutAvatar.film)).avatar).toBeUndefined();

    const snapshotPath = filmAvatarSnapshotPath(films.dir(withAvatar.film), reference);
    const oldBytes = await readFile(snapshotPath, "utf8");
    expect(JSON.parse(oldBytes).id).toBe(selected.avatarId);
    expect(await readFile(join(dirname(snapshotPath), "engine", "avatar-engine.js"), "utf8")).toContain("renderAvatarPixels");
    expect(await readFile(join(films.dir(withAvatar.film), "index.html"), "utf8")).toContain("avatar/runtime.js");
    expect((await films.check(withAvatar.film)).errors).toEqual([]);

    const next = avatarFixture();
    next.mouths.X.mouth = { hidden: false };
    await service.revisePart({
      avatarId: selected.avatarId,
      revision: selected.revision,
      allowedPartIds: ["mouth"],
      package: next,
    });
    expect(await readFile(snapshotPath, "utf8")).toBe(oldBytes);
  });

  it("rejects a hash that does not match the approved revision", async () => {
    const { studio, selected } = await setup();
    await expect(
      studio.create({
        name: "Hash errado",
        avatar: { avatarId: selected.avatarId, revision: selected.revision, hash: "0".repeat(64) },
      }),
    ).rejects.toThrow(/hash|aprova/i);
  });

  it("updates only the target film and separates the avatar cache key", async () => {
    const { studio, films, service, selected } = await setup();
    const firstRef = { avatarId: selected.avatarId, revision: selected.revision, hash: selected.hash };
    const first = await studio.create({ name: "Primeiro", avatar: firstRef });
    const second = await studio.create({ name: "Segundo", avatar: firstRef });

    const nextPackage = avatarFixture();
    nextPackage.mouths.X.mouth = { hidden: false };
    const revised = await service.revisePart({
      avatarId: selected.avatarId,
      revision: selected.revision,
      allowedPartIds: ["mouth"],
      package: nextPackage,
    });
    const nextRef = { avatarId: revised.avatarId, revision: revised.revision, hash: revised.hash };
    const updated = await studio.updateFilmAvatar({ film: first.film, avatar: nextRef });

    expect(updated.avatar).toEqual(nextRef);
    expect((await films.meta(first.film)).avatar).toEqual(nextRef);
    expect((await films.meta(second.film)).avatar).toEqual(firstRef);
    expect(filmAvatarCacheKey(nextRef)).not.toBe(filmAvatarCacheKey(firstRef));
    expect(await readFile(filmAvatarSnapshotPath(films.dir(second.film), firstRef), "utf8")).toContain(selected.avatarId);
  });

  it("maps the existing 30 fps narration envelope to X and A–F without moving its baseline", () => {
    const db = [-80, -42, -39.67, -35.33, -31, -26.67, -22.33, -16, 0];
    const envelope = { fps: 30, db };
    const mouths = mouthsFromEnvelope(envelope);
    expect(mouths).toEqual(["X", "X", "A", "B", "C", "D", "E", "F", "F"]);
    expect(envelope).toEqual({ fps: 30, db: [-80, -42, -39.67, -35.33, -31, -26.67, -22.33, -16, 0] });
  });

  it("exposes avatar as optional on create_film and a dedicated update tool", () => {
    const create = STUDIO_TOOLS.find((tool) => tool.name === "create_film");
    const update = STUDIO_TOOLS.find((tool) => tool.name === "update_film_avatar");
    expect(create?.inputSchema.required).toEqual(["name"]);
    expect(create?.inputSchema.properties).toHaveProperty("avatar");
    expect(update?.inputSchema).toMatchObject({ additionalProperties: false, required: ["film", "avatar"] });
  });
});

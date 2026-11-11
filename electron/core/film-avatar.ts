import { createHash } from "node:crypto";
import { cp, mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AvatarStore } from "./avatar-store";
import type { FilmAvatarRef } from "./film";

const AVATAR_ID = /^[A-Za-z][A-Za-z0-9._-]{0,63}$/;
const SHA256 = /^[a-f0-9]{64}$/;

export type FilmAvatarStore = Pick<AvatarStore, "loadRevision">;

function parseReference(value: FilmAvatarRef): FilmAvatarRef {
  if (!AVATAR_ID.test(value.avatarId) || !Number.isSafeInteger(value.revision) || value.revision < 1 || !SHA256.test(value.hash)) {
    throw new Error("Referência de avatar inválida.");
  }
  return { avatarId: value.avatarId, revision: value.revision, hash: value.hash };
}

export function filmAvatarCacheKey(reference: FilmAvatarRef): string {
  const value = parseReference(reference);
  return `${value.avatarId}:${value.revision}:${value.hash}`;
}

function snapshotName(reference: FilmAvatarRef): string {
  return createHash("sha256").update(filmAvatarCacheKey(reference)).digest("hex").slice(0, 24);
}

export function filmAvatarSnapshotPath(filmDir: string, reference: FilmAvatarRef): string {
  return join(filmDir, "avatar", "snapshots", snapshotName(reference), "avatar.json");
}

async function writeRuntime(filmDir: string, reference: FilmAvatarRef, avatar: unknown) {
  const name = snapshotName(reference);
  const runtime = [
    `window.FILM_AVATAR = ${JSON.stringify(avatar)};`,
    `window.FILM_AVATAR_REF = ${JSON.stringify(reference)};`,
    `window.FILM_AVATAR_CACHE_KEY = ${JSON.stringify(filmAvatarCacheKey(reference))};`,
    `window.FILM_AVATAR_ENGINE = ${JSON.stringify(`./avatar/snapshots/${name}/engine/avatar-engine.js`)};`,
    "",
  ].join("\n");
  await writeFile(join(filmDir, "avatar", "runtime.js"), runtime, "utf8");
}

/** Validates the approved revision and freezes its package, evidence and engine inside one film. */
export async function snapshotFilmAvatar(input: {
  store: FilmAvatarStore;
  filmDir: string;
  engineDir: string;
  avatar: FilmAvatarRef;
}): Promise<FilmAvatarRef> {
  const reference = parseReference(input.avatar);
  const approved = await input.store.loadRevision(reference.avatarId, reference.revision);
  if (approved.hash !== reference.hash || approved.avatar.id !== reference.avatarId) {
    throw new Error("O hash não corresponde à revisão aprovada do avatar.");
  }

  const target = dirname(filmAvatarSnapshotPath(input.filmDir, reference));
  const partial = `${target}.partial`;
  await mkdir(dirname(target), { recursive: true });
  await rm(partial, { recursive: true, force: true });
  try {
    if (!(await stat(target).then(() => true, () => false))) {
      await cp(dirname(approved.path), partial, { recursive: true, errorOnExist: true, force: false });
      await cp(input.engineDir, join(partial, "engine"), { recursive: true, errorOnExist: true, force: false });
      await rename(partial, target);
    }
  } finally {
    await rm(partial, { recursive: true, force: true });
  }
  await writeRuntime(input.filmDir, reference, approved.avatar);
  const voice = join(input.filmDir, "avatar", "voice.js");
  if (!(await stat(voice).then(() => true, () => false))) {
    await writeFile(voice, `window.FILM_AVATAR_VOICE = ${JSON.stringify({ cacheKey: filmAvatarCacheKey(reference), fps: 30, mouths: [] })};\n`, "utf8");
  }
  return reference;
}

/** Maps TIMING.envelope at its existing 30 fps to avatar mouths; the dB baseline is never rewritten. */
export function mouthsFromEnvelope(envelope: { fps: number; db: number[] }): Array<"A" | "B" | "C" | "D" | "E" | "F" | "X"> {
  if (envelope.fps !== 30) throw new Error("O envelope de avatar deve permanecer em 30 fps.");
  return envelope.db.map((db) => {
    if (db <= -42) return "X";
    const level = Math.max(0, Math.min(1, (db + 42) / 26));
    return (["A", "B", "C", "D", "E", "F"] as const)[Math.min(5, Math.floor(level * 6))];
  });
}

export async function writeFilmAvatarVoice(
  filmDir: string,
  reference: FilmAvatarRef,
  envelope: { fps: number; db: number[] },
) {
  const value = { cacheKey: filmAvatarCacheKey(reference), fps: envelope.fps, mouths: mouthsFromEnvelope(envelope) };
  await writeFile(join(filmDir, "avatar", "voice.js"), `window.FILM_AVATAR_VOICE = ${JSON.stringify(value)};\n`, "utf8");
}

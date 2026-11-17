import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/** Writes JSON atomically: temporary file + rename. Retries a busy rename (Windows antivirus / open reader). */
export async function writeJsonAtomic(file: string, value: unknown) {
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.${randomUUID().slice(0, 8)}.partial`;
  await writeFile(tmp, JSON.stringify(value, null, 2), "utf8");
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(tmp, file);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (attempt >= 5 || (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES")) {
        await rm(tmp, { force: true });
        throw error;
      }
      await new Promise((r) => setTimeout(r, 40 * (attempt + 1)));
    }
  }
}

export async function readJson(file: string): Promise<unknown> {
  return JSON.parse((await readFile(file, "utf8")).replace(/^﻿/, ""));
}

export async function readJsonOr<T>(file: string, fallback: () => T): Promise<unknown | T> {
  try {
    return await readJson(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback();
    throw error;
  }
}

/** Serializes async work per key so two edits of the same file never interleave. */
export class KeyedQueue {
  private queues = new Map<string, Promise<unknown>>();
  run<T>(key: string, work: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(key) ?? Promise.resolve();
    const next = previous.then(work, work);
    const settled = next.catch(() => undefined);
    this.queues.set(key, settled);
    void settled.then(() => {
      if (this.queues.get(key) === settled) this.queues.delete(key);
    });
    return next;
  }
}

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";
/** Short random id: `ep_7k2m`. */
export function shortRandomId(prefix: string, length = 4) {
  const bytes = randomBytes(length);
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return `${prefix}_${out}`;
}

export function slugify(value: string, fallback = "canal") {
  return (
    value
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || fallback
  );
}

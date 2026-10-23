import { describe, expect, it } from "vitest";
import { normalizeTranscript } from "../electron/core/packages";
import type { Media } from "../src/shared/types";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PackageManager, UV_RUNTIMES, extractFromTarGz } from "../electron/core/packages";
import { SHA256_MAP } from "../electron/core/motion-package";
import { gzipSync } from "fflate";
const media: Media = {
  id: "test",
  path: "test.mp4",
  name: "test",
  duration: 3,
  width: 640,
  height: 360,
  fps: 30,
  hasAudio: true,
};
describe("local transcription boundaries", () => {
  it("preserves zero-duration token text by merging into a timed neighbor without inventing a time", () => {
    expect(
      normalizeTranscript(
        [
          { text: "em", start: 1, end: 1 },
          { text: "casa", start: 1, end: 2 },
        ],
        media,
      ),
    ).toEqual([{ text: "em casa", start: 1, end: 2, mediaId: "test" }]);
  });
  it("keeps final token and clamps ASR overshoot to the actual media duration", () => {
    expect(
      normalizeTranscript(
        [
          { text: "vídeo", start: 2.5, end: 3.2 },
          { text: ".", start: 3, end: 3 },
        ],
        media,
      ),
    ).toEqual([{ text: "vídeo .", start: 2.5, end: 3, mediaId: "test" }]);
  });
  it("rejects nonfinite ASR times rather than caching a corrupt project", () => {
    expect(() =>
      normalizeTranscript([{ text: "fala", start: NaN, end: 1 }], media),
    ).toThrow("Tempos de transcrição inválidos");
  });
  it("hashes untrusted media identifiers instead of resolving them as cache paths", async () => {
    const root = await mkdtemp(join(tmpdir(), "cutroom-cache-test-"));
    try {
      await mkdir(join(root, "transcription", "Scripts"), { recursive: true });
      await mkdir(join(root, "models", "base"), { recursive: true });
      await mkdir(join(root, "cache"), { recursive: true });
      await writeFile(
        join(root, "transcription", "Scripts", "python.exe"),
        "not executed",
      );
      await writeFile(join(root, "models", "base", "model.bin"), "not loaded");
      await writeFile(
        join(root, "transcription.ready.json"),
        JSON.stringify({ version: "1.2.1-base.2" }),
      );
      const malicious = { ...media, id: "../../../outside" };
      const cacheName =
        createHash("sha256").update(malicious.id).digest("hex") +
        ".transcript.json";
      await writeFile(
        join(root, "cache", cacheName),
        JSON.stringify({ words: [{ text: "safe", start: 0, end: 1 }] }),
      );
      const manager = new PackageManager(root, root);
      expect(
        await manager.transcribe(malicious, join(root, "cache"), () => {}),
      ).toEqual([{ text: "safe", start: 0, end: 1, mediaId: malicious.id }]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("macOS runtimes", () => {
  const tarEntry = (name: string, body: string, type = "0") => {
    const header = new Uint8Array(512);
    const enc = new TextEncoder();
    header.set(enc.encode(name), 0);
    header.set(enc.encode(body.length.toString(8).padStart(11, "0") + "\0"), 124);
    header[156] = type.charCodeAt(0);
    const data = new Uint8Array(Math.ceil(body.length / 512) * 512);
    data.set(enc.encode(body));
    return [header, data];
  };
  const targz = (...entries: Uint8Array[][]) => {
    const parts = [...entries.flat(), new Uint8Array(1024)];
    const tar = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let offset = 0;
    for (const part of parts) tar.set(part, (offset += part.length) - part.length);
    return gzipSync(tar);
  };

  it("extracts only the uv binary from the release tarball layout", () => {
    const archive = targz(
      tarEntry("uv-aarch64-apple-darwin/", "", "5"),
      tarEntry("uv-aarch64-apple-darwin/uvx", "UVX"),
      tarEntry("uv-aarch64-apple-darwin/uv", "UV-BINARY"),
    );
    expect(new TextDecoder().decode(extractFromTarGz(archive, "uv"))).toBe("UV-BINARY");
    expect(() => extractFromTarGz(targz(tarEntry("x/uvx", "UVX")), "uv")).toThrow();
  });

  it("pins a real SHA-256 and a hash-locked requirements file for every target", async () => {
    for (const runtime of Object.values(UV_RUNTIMES)) {
      expect(runtime.sha256).toMatch(/^[0-9a-f]{64}$/);
      const lock = await readFile(join("resources", "workers", runtime.lock), "utf8");
      expect(lock).toContain("--hash=sha256:");
    }
    const chrome = Object.values(SHA256_MAP).flatMap((archs) => Object.values(archs ?? {}));
    chrome.forEach((sha) => expect(sha).toMatch(/^[0-9a-f]{64}$/));
    expect(new Set(chrome).size).toBe(chrome.length);
  });
});

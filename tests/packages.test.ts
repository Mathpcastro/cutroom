import { describe, expect, it } from "vitest";
import { normalizeTranscript } from "../electron/core/packages";
import type { Media } from "../src/shared/types";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PackageManager } from "../electron/core/packages";
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

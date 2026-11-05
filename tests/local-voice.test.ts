import { describe, expect, it } from "vitest";
import os from "node:os";
import { promises as fs } from "node:fs";
import path from "node:path";
import { localSpeech, localVoices, sapiWords } from "../electron/core/local-voice";
import { probeAudio } from "../electron/core/studio";

describe("local voice", () => {
  it("ends each SAPI word where the next begins", () => {
    expect(
      sapiWords(
        [
          { t: "Olá", at: 0.1 },
          { t: ",", at: 0.4 },
          { t: "mundo", at: 0.5 },
        ],
        1.2,
      ),
    ).toEqual([
      { text: "Olá", start: 0.1, end: 0.48 },
      { text: "mundo", start: 0.5, end: 1.18 },
    ]);
  });
  it.runIf(process.platform === "win32")(
    "speaks Portuguese with the Windows voice and word timings",
    async () => {
      const voices = await localVoices();
      const pt = voices.find((v) => v.language?.startsWith("pt"));
      expect(pt).toBeTruthy();
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cutroom-voice-"));
      try {
        const result = await localSpeech(
          "O CutRoom edita vídeos conversando com a sua IA.",
          pt!.id,
          new AbortController().signal,
          dir,
          probeAudio,
        );
        expect(result.extension).toBe("wav");
        expect(result.words!.map((w) => w.text)).toEqual(["O", "CutRoom", "edita", "vídeos", "conversando", "com", "a", "sua", "IA"]);
        const file = path.join(dir, "check.wav");
        await fs.writeFile(file, result.audio);
        const duration = await probeAudio(file);
        expect(duration).toBeGreaterThan(1.5);
        for (let i = 1; i < result.words!.length; i++)
          expect(result.words![i].start).toBeGreaterThan(result.words![i - 1].start);
      } finally {
        await fs.rm(dir, { recursive: true, force: true });
      }
    },
    60000,
  );
});

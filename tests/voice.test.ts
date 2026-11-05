import { describe, expect, it } from "vitest";
import { alignScript, wordsFromCharacters } from "../electron/core/voice";
import { applyCommand, createProject } from "../electron/core/project";
import { captionTimelineWords } from "../src/shared/captions";

describe("voice timing", () => {
  it("groups ElevenLabs characters into words and drops punctuation-only tokens", () => {
    const chars = [..."Oi, tudo - bem"];
    const starts = chars.map((_, i) => i * 0.1),
      ends = chars.map((_, i) => i * 0.1 + 0.08);
    const words = wordsFromCharacters(chars, starts, ends);
    expect(words.map((w) => w.text)).toEqual(["Oi,", "tudo", "bem"]);
    expect(words.map((w) => [w.start, w.end].map((v) => +v.toFixed(2)))).toEqual([
      [0, 0.28],
      [0.4, 0.78],
      [1.1, 1.38],
    ]);
  });

  it("keeps the script spelling with recognizer timing and fills missed words", () => {
    const recognized = [
      { text: "o", start: 0, end: 0.1 },
      { text: "cutrum", start: 0.15, end: 0.6 },
      { text: "edita", start: 0.7, end: 1 },
      { text: "conversando", start: 1.6, end: 2.2 },
    ];
    const words = alignScript("O CutRoom edita vídeos conversando.", recognized);
    expect(words.map((w) => w.text)).toEqual([
      "O",
      "CutRoom",
      "edita",
      "vídeos",
      "conversando.",
    ]);
    expect(words[2]).toEqual({ text: "edita", start: 0.7, end: 1 });
    // "CutRoom" was misrecognized and "vídeos" missed: both land inside the right gaps.
    expect(words[1].start).toBeGreaterThanOrEqual(0.1);
    expect(words[1].end).toBeLessThanOrEqual(0.7);
    expect(words[3].start).toBeGreaterThanOrEqual(1);
    expect(words[3].end).toBeLessThanOrEqual(1.6);
    expect(words[4]).toEqual({ text: "conversando.", start: 1.6, end: 2.2 });
  });

  it("captions narration words at their timeline position", () => {
    let p = createProject();
    p.media = [
      { id: "m", name: "canvas", path: "c.mp4", duration: 5, width: 1080, height: 1920, fps: 30, hasAudio: true },
    ];
    p.clips = [{ id: "c", mediaId: "m", start: 0, end: 5, speed: 1, zoom: 1, muted: false }];
    p = applyCommand(p, {
      name: "audio",
      args: {
        kind: "voice",
        name: "Narração",
        path: "v.mp3",
        start: 2,
        offset: 0.5,
        fileDuration: 3,
        words: [
          { text: "antes", start: 0.1, end: 0.4 },
          { text: "agora", start: 0.6, end: 1 },
        ],
      },
    });
    expect(captionTimelineWords(p).map((w) => [w.text, w.start, w.end])).toEqual([
      ["agora", 2.1, 2.5],
    ]);
  });
});

import { describe, expect, it } from "vitest";
import { composeMusic, MUSIC_MOODS, wavBytes } from "../electron/core/compose-music";

describe("composed soundtrack", () => {
  it("composes every mood: right length, no clipping, audible, deterministic", () => {
    for (const mood of MUSIC_MOODS) {
      const a = composeMusic(mood, 8, 3, 8000);
      const frames = a.length / 2;
      expect(frames).toBeGreaterThanOrEqual(8 * 8000);
      let peak = 0, sum = 0, finite = true;
      for (const v of a) { if (!Number.isFinite(v)) finite = false; peak = Math.max(peak, Math.abs(v)); sum += v * v; }
      expect(finite).toBe(true);
      expect(peak).toBeLessThanOrEqual(0.5 + 1e-6);
      expect(Math.sqrt(sum / a.length)).toBeGreaterThan(0.02);
      expect(composeMusic(mood, 8, 3, 8000)).toEqual(a);
    }
    expect(composeMusic("alegre", 8, 4, 8000)).not.toEqual(composeMusic("alegre", 8, 3, 8000));
  });

  it("writes a valid 16-bit stereo WAV", () => {
    const wav = wavBytes(new Float32Array([0, 0.5, -0.5, 1]), 44100);
    expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
    expect(wav.toString("ascii", 8, 12)).toBe("WAVE");
    expect(wav.readUInt16LE(22)).toBe(2);
    expect(wav.readUInt32LE(40)).toBe(8);
    expect(wav.readInt16LE(46)).toBe(16384);
  });
});

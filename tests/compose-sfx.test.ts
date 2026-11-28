import { describe, expect, it } from "vitest";
import { AMBIENCES, SFX_KINDS } from "../src/shared/shots";
import { mixSoundtrack, synthAmbience, synthEffect } from "../electron/core/compose-sfx";

const stats = (a: Float32Array) => { let peak = 0, sum = 0, finite = true; for (const v of a) { if (!Number.isFinite(v)) finite = false; peak = Math.max(peak, Math.abs(v)); sum += v * v; } return { peak, rms: Math.sqrt(sum / a.length), finite }; };

// Pure CPU synthesis: the Intel Mac runner needs well over the 5 s default.
describe("synthesised sound design", { timeout: 60_000 }, () => {
  it("every effect is audible, finite, short and deterministic", () => {
    for (const kind of SFX_KINDS) {
      const a = synthEffect(kind, 3), s = stats(a);
      expect(s.finite).toBe(true);
      expect(s.peak).toBeGreaterThan(0.02);
      expect(a.length / 44100).toBeLessThan(1.5);
      expect(synthEffect(kind, 3)).toEqual(a);
    }
  });

  it("every ambience is a quiet, continuous bed", () => {
    for (const kind of AMBIENCES.filter((k) => k !== "nenhum")) {
      const s = stats(synthAmbience(kind, 2, 1));
      expect(s.finite).toBe(true);
      expect(s.rms).toBeGreaterThan(0.001);
    }
  });

  it("mixes cues and beds without clipping", () => {
    const mix = mixSoundtrack([{ t: 0.2, kind: "impact", gain: 1 }, { t: 0.25, kind: "whoosh", gain: 1 }, { t: 1, kind: "ding", gain: 1 }], [{ from: 0, to: 2, kind: "cafe" }], 2.5);
    const s = stats(mix);
    expect(s.peak).toBeLessThanOrEqual(0.5 + 1e-6);
    expect(mix.length).toBe(Math.ceil(3 * 44100) * 2);
  });
});

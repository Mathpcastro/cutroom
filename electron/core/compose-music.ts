import { writeFile } from "node:fs/promises";

/**
 * A soundtrack composed for each film, on this computer: chord progression, pad, bass, an arpeggio
 * and (for some moods) light drums, from a mood, a length and a seed. Deterministic and license-free.
 */

import { MUSIC_MOODS, type MusicMood } from "../../src/shared/shots";
export { MUSIC_MOODS, type MusicMood };

interface Style {
  bpm: number;
  minor: boolean;
  /** Scale degrees (0-6) of the chords, one per bar. */
  chords: number[];
  arp: 0 | 1 | 2; // none, quarters, eighths
  drums: "none" | "soft" | "pop" | "toms";
  bass: "long" | "pulse" | "eighths";
  bright: number;
}
const STYLES: Record<MusicMood, Style> = {
  alegre: { bpm: 112, minor: false, chords: [0, 4, 5, 3], arp: 2, drums: "pop", bass: "pulse", bright: 1 },
  calmo: { bpm: 76, minor: false, chords: [0, 5, 3, 4], arp: 1, drums: "none", bass: "long", bright: 0.6 },
  lofi: { bpm: 82, minor: true, chords: [0, 5, 2, 6], arp: 1, drums: "soft", bass: "pulse", bright: 0.5 },
  tenso: { bpm: 96, minor: true, chords: [0, 0, 5, 4], arp: 0, drums: "soft", bass: "eighths", bright: 0.45 },
  epico: { bpm: 88, minor: true, chords: [0, 5, 2, 6], arp: 2, drums: "toms", bass: "pulse", bright: 0.85 },
  misterio: { bpm: 70, minor: true, chords: [0, 1, 0, 6], arp: 1, drums: "none", bass: "long", bright: 0.4 },
};
const MAJOR = [0, 2, 4, 5, 7, 9, 11], MINOR = [0, 2, 3, 5, 7, 8, 10];

function rng(seed: number) {
  let s = (Math.abs(Math.floor(seed)) % 2147483646) + 1;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}
const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

/** Stereo interleaved samples in [-1, 1]. */
export function composeMusic(mood: MusicMood, seconds: number, seed = 1, rate = 44100): Float32Array {
  const st = STYLES[mood] ?? STYLES.calmo;
  const r = rng(seed * 97 + 13);
  const root = 50 + Math.floor(r() * 7); // D3..G#3
  const scale = st.minor ? MINOR : MAJOR;
  const beat = 60 / st.bpm, bar = beat * 4;
  const total = Math.max(2, seconds) + 1.5;
  const n = Math.ceil(total * rate);
  const L = new Float32Array(n), R = new Float32Array(n);
  const degree = (d: number, octave = 0) => root + scale[((d % 7) + 7) % 7] + 12 * (Math.floor(d / 7) + octave);
  const chordAt = (b: number) => st.chords[b % st.chords.length];
  const bars = Math.ceil(total / bar);

  const add = (start: number, dur: number, fn: (t: number) => number, pan = 0, gain = 1) => {
    const a = Math.max(0, Math.floor(start * rate)), b = Math.min(n, Math.floor((start + dur) * rate));
    const gl = gain * Math.cos((pan + 1) * Math.PI / 4), gr = gain * Math.sin((pan + 1) * Math.PI / 4);
    for (let i = a; i < b; i++) { const v = fn((i - a) / rate); L[i] += v * gl; R[i] += v * gr; }
  };
  const tone = (f: number, harmonics: number[], detune = 0) => (t: number) => {
    let v = 0;
    for (let h = 0; h < harmonics.length; h++) v += harmonics[h] * Math.sin(2 * Math.PI * f * (h + 1) * (1 + detune) * t);
    return v;
  };
  const env = (t: number, dur: number, attack: number, release: number) => Math.min(1, t / attack) * Math.min(1, Math.max(0, (dur - t) / release));

  for (let b = 0; b < bars; b++) {
    const t0 = b * bar, d = chordAt(b);
    const intro = b < 2;
    // Pad: the triad, two slightly detuned voices per note, soft attack.
    for (const [k, off] of [[0, 0], [2, 0], [4, 0]] as const) {
      const f = hz(degree(d + k, 1 + off));
      const harm = [1, 0.35 * st.bright, 0.15 * st.bright, 0.06 * st.bright];
      const dur = bar + 0.25;
      const a = tone(f, harm, 0.0018), c = tone(f, harm, -0.0018);
      add(t0, dur, (t) => (a(t) + c(t)) * 0.5 * env(t, dur, 0.35, 0.4) * (0.8 + 0.2 * Math.sin(t * 3.1)), k === 0 ? -0.25 : k === 2 ? 0.25 : 0, 0.055);
    }
    if (intro && b === 0) continue;
    // Bass.
    const bf = hz(degree(d, -1));
    const hits = st.bass === "long" ? [0] : st.bass === "pulse" ? [0, 2, 2.5] : [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5];
    for (const h of hits) {
      const dur = st.bass === "long" ? bar : beat * (st.bass === "eighths" ? 0.45 : 0.9);
      add(t0 + h * beat, dur, (t) => tone(bf, [1, 0.45, 0.12])(t) * Math.exp(-t * (st.bass === "long" ? 0.6 : 3.2)) * env(t, dur, 0.01, 0.06), 0, 0.16);
    }
    // Arpeggio / plucks.
    if (st.arp && !intro) {
      const step = st.arp === 2 ? 0.5 : 1, pattern = [0, 2, 4, 7, 4, 2, 0, 4];
      for (let i = 0; i < 4 / step; i++) {
        const f = hz(degree(d + pattern[i % pattern.length], 2));
        add(t0 + i * step * beat, beat * 1.2, (t) => tone(f, [1, 0.3 * st.bright, 0.1])(t) * Math.exp(-t * 5.5), i % 2 ? 0.35 : -0.35, 0.05);
      }
    }
    // Drums.
    if (st.drums !== "none" && !intro) {
      for (let q = 0; q < 4; q++) {
        const at = t0 + q * beat;
        if (st.drums === "toms") {
          if (q === 0 || q === 2) add(at, 0.5, (t) => Math.sin(2 * Math.PI * (90 - 40 * t) * t) * Math.exp(-t * 7), 0, 0.3);
          if (q === 3) add(at + beat * 0.5, 0.35, (t) => Math.sin(2 * Math.PI * (140 - 60 * t) * t) * Math.exp(-t * 9), 0.2, 0.18);
          continue;
        }
        const soft = st.drums === "soft";
        if (q === 0 || q === 2) add(at, 0.35, (t) => Math.sin(2 * Math.PI * (55 + 70 * Math.exp(-t * 30)) * t) * Math.exp(-t * 9), 0, soft ? 0.22 : 0.32);
        if (q === 1 || q === 3) add(at, 0.25, (t) => ((r() * 2 - 1) * 0.7 + Math.sin(2 * Math.PI * 190 * t) * 0.3) * Math.exp(-t * (soft ? 22 : 16)), 0.05, soft ? 0.07 : 0.11);
        for (const e of soft ? [0] : [0, 0.5]) add(at + e * beat, 0.06, () => (r() * 2 - 1), 0.3, soft ? 0.025 : 0.035);
      }
    }
  }
  // Fade in/out and peak normalisation to -6 dBFS (the film mixes it under the voice).
  let peak = 1e-9;
  for (let i = 0; i < n; i++) {
    const t = i / rate, g = Math.min(1, t / 0.8) * Math.min(1, Math.max(0, (total - t) / 2));
    L[i] *= g; R[i] *= g;
    peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  }
  const k = 0.5 / peak, out = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) { out[i * 2] = L[i] * k; out[i * 2 + 1] = R[i] * k; }
  return out;
}

/** 16-bit PCM WAV. */
export function wavBytes(samples: Float32Array, rate = 44100, channels = 2) {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), i * 2);
  const head = Buffer.alloc(44);
  head.write("RIFF", 0); head.writeUInt32LE(36 + data.length, 4); head.write("WAVE", 8);
  head.write("fmt ", 12); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(channels, 22);
  head.writeUInt32LE(rate, 24); head.writeUInt32LE(rate * channels * 2, 28); head.writeUInt16LE(channels * 2, 32); head.writeUInt16LE(16, 34);
  head.write("data", 36); head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

export async function writeComposedMusic(file: string, mood: MusicMood, seconds: number, seed = 1) {
  await writeFile(file, wavBytes(composeMusic(mood, seconds, seed)));
  return { file, mood, seconds };
}

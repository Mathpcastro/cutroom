import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { soundCues, type AmbienceSpan, type ShotPlan, type SfxKind, type SoundCue, type Word } from "../../src/shared/shots";
import { wavBytes } from "./compose-music";

/**
 * Sound design synthesised on this computer (no downloads, nothing to credit): effects where something
 * happens on screen and a quiet ambience bed for each place, mixed into one stereo track.
 */

const RATE = 44100;

function rng(seed: number) {
  let s = (Math.abs(Math.floor(seed)) % 2147483646) + 1;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

/** One effect as mono samples. Deterministic for a seed. */
export function synthEffect(kind: SfxKind, seed = 1): Float32Array {
  const r = rng(seed * 31 + kind.length);
  const len = { whoosh: 0.55, swish: 0.3, pop: 0.12, tick: 0.03, ding: 0.9, chime: 1.3, impact: 0.9, thud: 0.35, boing: 0.45, riser: 1.2, burst: 0.6, click: 0.05 }[kind];
  const n = Math.round(len * RATE), out = new Float32Array(n);
  let lp = 0, lp2 = 0;
  for (let i = 0; i < n; i++) {
    const t = i / RATE, p = t / len;
    let v = 0;
    switch (kind) {
      case "whoosh":
      case "swish": {
        // Noise through a sweeping low-pass: air moving past.
        const cutoff = kind === "whoosh" ? 0.02 + 0.25 * Math.sin(Math.PI * p) : 0.05 + 0.4 * Math.sin(Math.PI * p);
        lp += cutoff * ((r() * 2 - 1) - lp); lp2 += cutoff * (lp - lp2);
        v = lp2 * Math.sin(Math.PI * p) ** 1.5 * (kind === "whoosh" ? 3.2 : 2.6);
        break;
      }
      case "pop": v = Math.sin(2 * Math.PI * (700 - 2600 * t) * t) * Math.exp(-t * 38) + (i < 40 ? (r() * 2 - 1) * 0.3 : 0); break;
      case "tick": v = (r() * 2 - 1) * Math.exp(-t * 400) * 0.7 + Math.sin(2 * Math.PI * 2400 * t) * Math.exp(-t * 300) * 0.5; break;
      case "click": v = Math.sin(2 * Math.PI * 1500 * t) * Math.exp(-t * 180) + (r() * 2 - 1) * Math.exp(-t * 600) * 0.4; break;
      case "ding": v = (Math.sin(2 * Math.PI * 1318.5 * t) + 0.45 * Math.sin(2 * Math.PI * 1975.5 * t) + 0.2 * Math.sin(2 * Math.PI * 2637 * t)) * Math.exp(-t * 4.5) * 0.55; break;
      case "chime": {
        const notes = [1046.5, 1318.5, 1568];
        notes.forEach((f, k) => { const tk = t - k * 0.09; if (tk > 0) v += Math.sin(2 * Math.PI * f * tk) * Math.exp(-tk * 3.2) * 0.35; });
        break;
      }
      case "impact": {
        lp += 0.08 * ((r() * 2 - 1) - lp);
        v = Math.sin(2 * Math.PI * (70 - 30 * p) * t) * Math.exp(-t * 4) * 0.9 + lp * Math.exp(-t * 9) * 2.2;
        break;
      }
      case "thud": v = Math.sin(2 * Math.PI * (95 - 50 * p) * t) * Math.exp(-t * 14); break;
      case "boing": v = Math.sin(2 * Math.PI * (260 + 120 * Math.sin(t * 38) * Math.exp(-t * 6)) * t) * Math.exp(-t * 6) * 0.7; break;
      case "riser": {
        lp += (0.01 + 0.3 * p) * ((r() * 2 - 1) - lp);
        v = (lp * 1.5 + Math.sin(2 * Math.PI * (200 + 600 * p * p) * t) * 0.25) * p * p;
        break;
      }
      case "burst": {
        // A handful of pops scattered in time (confetti).
        for (let k = 0; k < 7; k++) { const tk = t - k * 0.07; if (tk > 0 && tk < 0.1) v += Math.sin(2 * Math.PI * (900 + k * 140 - 3000 * tk) * tk) * Math.exp(-tk * 45) * 0.6; }
        break;
      }
    }
    // Short fades so nothing clicks at the edges.
    out[i] = v * Math.min(1, i / 60) * Math.min(1, (n - i) / 200);
  }
  return out;
}

/** A loopable ambience bed (stereo interleaved), quiet. */
export function synthAmbience(kind: AmbienceSpan["kind"], seconds: number, seed = 1): Float32Array {
  const r = rng(seed * 17 + kind.length * 7), n = Math.max(1, Math.round(seconds * RATE)), out = new Float32Array(n * 2);
  let b1 = 0, b2 = 0, b3 = 0, lpL = 0, lpR = 0;
  const events: { at: number; kind: string; f: number }[] = [];
  const every = (min: number, max: number, k: string, f: () => number) => { for (let at = min * r(); at < seconds; at += min + (max - min) * r()) events.push({ at, kind: k, f: f() }); };
  if (kind === "natureza") every(0.6, 2.2, "bird", () => 2200 + r() * 2600);
  if (kind === "noite") every(0.35, 0.9, "cricket", () => 4300 + r() * 600);
  if (kind === "escritorio") every(0.08, 0.6, "key", () => 1800 + r() * 900);
  if (kind === "cafe") every(1.5, 4, "clink", () => 2800 + r() * 1400);
  if (kind === "rua") every(2.5, 6, "car", () => 0);
  if (kind === "chuva") every(0.02, 0.09, "drop", () => 1500 + r() * 3000);
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const white = r() * 2 - 1;
    // Brown and pink-ish noise as the "air" of the place.
    b1 = 0.997 * b1 + white * 0.03; b2 = 0.92 * b2 + white * 0.25; b3 = 0.6 * b3 + white * 0.4;
    let L = 0, R = 0;
    switch (kind) {
      case "quarto": L = R = b1 * 0.5; break;
      case "escritorio": L = R = b1 * 0.5 + b2 * 0.03; break;
      case "cafe": { const murmur = b2 * (0.35 + 0.2 * Math.sin(t * 1.3) + 0.15 * Math.sin(t * 3.7)); L = murmur + b1 * 0.3; R = murmur * 0.9 + b1 * 0.3; break; }
      case "multidao": { const murmur = b2 * (0.55 + 0.25 * Math.sin(t * 0.9) + 0.2 * Math.sin(t * 2.3)); L = murmur; R = murmur * 0.92; break; }
      case "rua": L = R = b1 * 0.9 + b2 * 0.05; break;
      case "natureza":
      case "vento": { const gust = 0.5 + 0.5 * Math.sin(t * 0.35) * Math.sin(t * 0.13 + 1); lpL += 0.02 * (white - lpL); lpR += 0.021 * ((r() * 2 - 1) - lpR); L = lpL * gust * (kind === "vento" ? 5 : 2.5); R = lpR * gust * (kind === "vento" ? 5 : 2.5); break; }
      case "praia": { const swell = Math.max(0, Math.sin((t / 7) * Math.PI * 2)) ** 2; lpL += (0.03 + 0.2 * swell) * (white - lpL); L = R = lpL * (0.4 + 2.6 * swell); R *= 0.95; break; }
      case "chuva": L = R = (white - b3) * 0.18 + b1 * 0.3; break;
      case "noite": lpL += 0.015 * (white - lpL); L = R = lpL * 1.2; break;
      default: break;
    }
    out[i * 2] = L; out[i * 2 + 1] = R;
  }
  for (const e of events) {
    const at = Math.round(e.at * RATE);
    const dur = e.kind === "car" ? 3 : e.kind === "bird" ? 0.35 : e.kind === "cricket" ? 0.18 : e.kind === "clink" ? 0.5 : e.kind === "key" ? 0.03 : 0.015;
    const m = Math.round(dur * RATE), pan = r() * 2 - 1;
    let lp = 0;
    for (let k = 0; k < m && at + k < n; k++) {
      const t = k / RATE, p = t / dur;
      let v = 0;
      if (e.kind === "bird") v = Math.sin(2 * Math.PI * (e.f + 900 * Math.sin(p * Math.PI * 3)) * t) * Math.sin(Math.PI * p) * 0.12;
      else if (e.kind === "cricket") v = Math.sin(2 * Math.PI * e.f * t) * (Math.sin(t * 2 * Math.PI * 45) > 0 ? 1 : 0) * Math.sin(Math.PI * p) * 0.05;
      else if (e.kind === "clink") v = Math.sin(2 * Math.PI * e.f * t) * Math.exp(-t * 12) * 0.08;
      else if (e.kind === "key") v = (r() * 2 - 1) * Math.exp(-t * 300) * 0.12;
      else if (e.kind === "drop") v = Math.sin(2 * Math.PI * e.f * t) * Math.exp(-t * 400) * 0.08;
      else if (e.kind === "car") { lp += (0.01 + 0.05 * Math.sin(Math.PI * p)) * ((r() * 2 - 1) - lp); v = lp * Math.sin(Math.PI * p) * 1.2; }
      out[(at + k) * 2] += v * (1 - pan) * 0.5 * 2;
      out[(at + k) * 2 + 1] += v * (1 + pan) * 0.5 * 2;
    }
  }
  return out;
}

const AMBIENCE_GAIN: Partial<Record<AmbienceSpan["kind"], number>> = { quarto: 0.05, escritorio: 0.06, cafe: 0.07, multidao: 0.09, rua: 0.08, natureza: 0.07, vento: 0.06, praia: 0.08, chuva: 0.08, noite: 0.07 };

/** Mixes the cues and the ambience into one stereo track (−6 dBFS peak at most). */
export function mixSoundtrack(cues: SoundCue[], ambience: AmbienceSpan[], duration: number): Float32Array {
  const n = Math.ceil((duration + 0.5) * RATE), mix = new Float32Array(n * 2);
  ambience.forEach((span, i) => {
    const seconds = span.to - span.from + 0.6, bed = synthAmbience(span.kind, seconds, i + 1), g = AMBIENCE_GAIN[span.kind] ?? 0.06;
    const start = Math.round(Math.max(0, span.from - 0.3) * RATE), frames = bed.length / 2, fade = Math.round(0.3 * RATE);
    for (let k = 0; k < frames && start + k < n; k++) {
      const env = Math.min(1, k / fade, (frames - k) / fade);
      mix[(start + k) * 2] += bed[k * 2] * g * env; mix[(start + k) * 2 + 1] += bed[k * 2 + 1] * g * env;
    }
  });
  cues.forEach((cue, i) => {
    const fx = synthEffect(cue.kind, i + 1), at = Math.round(cue.t * RATE), g = 0.32 * cue.gain, pan = ((i * 37) % 7) / 7 - 0.5;
    const offset = cue.kind === "riser" ? -fx.length : 0;
    for (let k = 0; k < fx.length; k++) {
      const j = at + offset + k;
      if (j < 0 || j >= n) continue;
      mix[j * 2] += fx[k] * g * (1 - pan * 0.4); mix[j * 2 + 1] += fx[k] * g * (1 + pan * 0.4);
    }
  });
  let peak = 1e-9;
  for (const v of mix) peak = Math.max(peak, Math.abs(v));
  if (peak > 0.5) for (let i = 0; i < mix.length; i++) mix[i] *= 0.5 / peak;
  return mix;
}

/** Reads the film's plan and timing, writes assets/sfx.wav. */
export async function writeFilmSoundtrack(dir: string, duration: number) {
  const plan = JSON.parse(await readFile(join(dir, "plano.json"), "utf8")) as ShotPlan;
  const timing = await readFile(join(dir, "timing.js"), "utf8").catch(() => "");
  const words = ((): Word[] => {
    try { return (JSON.parse(timing.replace(/^[^=]*=\s*/, "").replace(/;\s*$/, "")) as { words?: Word[] }).words ?? []; } catch { return []; }
  })();
  const { cues, ambience } = soundCues(plan, words, duration);
  await writeFile(join(dir, "assets", "sfx.wav"), wavBytes(mixSoundtrack(cues, ambience, duration), RATE));
  return { file: "assets/sfx.wav", cues: cues.length, ambience: ambience.map((a) => a.kind) };
}

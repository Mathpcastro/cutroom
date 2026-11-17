import { createHash } from "node:crypto";
import { copyFile, link, mkdir, readdir, readFile, rm, stat as statFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { z } from "zod";
import { COMPILED_SCENES, type Beat, type Channel, type Fact, type MediaItem } from "../../../src/shared/channel";
import type { SfxKind } from "../../../src/shared/shots";
import { withCsp } from "../film";
import { normToken } from "./aligner";
import type { ChannelStore } from "./channel-store";
import { readJsonOr, writeJsonAtomic } from "./fs-json";
import { integerToWords } from "./pt-numbers";

/**
 * Scene compiler (spec "Cenas e motion"): each beat + scene becomes a HyperFrames/GSAP
 * document in `scenes/<beat>/index.html` with its assets, fonts and timing. No Remotion.
 * - Word triggers: `at` = spoken-word prefix (no accents, lowercase) with alternatives
 *   (`quinze|15`) and a fallback in seconds; the first element shows within 10 frames.
 * - Whip-in inside the scene (first 7 frames), so concatenation never re-renders neighbours.
 * - Every visible label comes from the beat's data — never fixed text in a component.
 * - Glyphs the font lacks are replaced (≠ → "NÃO É") and emoji removed.
 */

export const FPS = 30;
export const SCENE_KIT_VERSION = "canal-3";
export const FIRST_ELEMENT_MAX = 10 / FPS;
export const ENDSCREEN_EXTRA = 12;

export type Size = { w: number; h: number; vertical: boolean };
export const sizeOf = (aspect: "16:9" | "9:16"): Size => (aspect === "16:9" ? { w: 1920, h: 1080, vertical: false } : { w: 1080, h: 1920, vertical: true });

// ---------- data schemas per scene type ----------

const at = z.string().max(120).optional();
export const SCENE_DATA = {
  photo: z.object({ move: z.enum(["in", "out", "l", "r"]).default("in"), tag: z.string().max(40).optional(), caption: z.string().max(120).optional() }),
  video: z.object({ clips: z.array(z.object({ media: z.string(), at, tag: z.string().max(40).optional() })).max(8).optional(), caption: z.string().max(120).optional(), big: z.string().max(60).optional() }),
  stat: z.object({ value: z.number(), prefix: z.string().max(8).default(""), suffix: z.string().max(12).default(""), decimals: z.number().int().min(0).max(2).default(0), label: z.string().max(120).default(""), source: z.string().max(120).optional(), at }),
  title: z.object({ lines: z.array(z.object({ text: z.string().min(1).max(80), color: z.enum(["accent", "ink", "red", "green"]).default("ink"), strike: z.boolean().default(false), at })).min(1).max(4), stamp: z.string().max(30).optional() }),
  list: z.object({ title: z.string().max(80).optional(), tone: z.enum(["green", "red"]).default("green"), items: z.array(z.object({ text: z.string().min(1).max(90), mark: z.enum(["ok", "no"]).default("ok"), at })).min(1).max(6) }),
  cta: z.object({ kind: z.enum(["comment", "subscribe", "like", "endscreen"]), text: z.string().max(140).optional(), examples: z.array(z.string().max(40)).max(8).default([]) }),
} as const;
export type CompiledType = keyof typeof SCENE_DATA;

// ---------- text safety ----------

const ALLOWED = /[ -~ -ſ–—‘’“”…€²³ºª]/u;
const GLYPH_SWAP: Record<string, string> = { "≠": "NÃO É", "≤": "ATÉ", "≥": "NO MÍNIMO", "→": "-", "←": "-", "×": "x", "•": "-", "✓": "", "✕": "", "✔": "", "❌": "" };
/** Replaces characters the title fonts do not have and removes emoji (spec "Fontes e glifos"). */
export function safeText(text: string) {
  const replaced: string[] = [];
  let out = "";
  for (const ch of text.normalize("NFC")) {
    if (ALLOWED.test(ch)) out += ch;
    else if (ch in GLYPH_SWAP) {
      out += GLYPH_SWAP[ch];
      replaced.push(ch);
    } else replaced.push(ch);
  }
  return { text: out.replace(/\s{2,}/g, " ").trim(), replaced };
}
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// ---------- word triggers ----------

export type RelWord = { t: string; s: number; e: number };
/** Seconds (relative to the scene) of the first word matching any alternative of `spec`; else `fallback`. */
export function cueTime(spec: string | undefined, words: RelWord[], fallback: number) {
  if (!spec) return fallback;
  const alts = spec
    .split("|")
    .map((a) => a.trim())
    .filter(Boolean)
    .map((a) => (/^\d+$/.test(a) ? normToken(integerToWords(Number(a)).split(" ")[0]) : normToken(a.split(/\s+/)[0])));
  const hit = words.find((w) => alts.some((a) => a && w.t.startsWith(a)));
  return hit ? Math.max(0, hit.s) : fallback;
}

// ---------- fonts & identity ----------

const FONT_FILES: Record<string, string> = {
  Anton: "Anton-Regular.ttf", Oswald: "Oswald.ttf", Montserrat: "Montserrat-ExtraBold.ttf", Barlow: "Barlow-Bold.ttf", "Barlow Regular": "Barlow-Regular.ttf",
  "Instrument Sans": "InstrumentSans.ttf", "Instrument Serif": "InstrumentSerif-Italic.ttf", Fredoka: "Fredoka.ttf", Caveat: "Caveat.ttf", "JetBrains Mono": "JetBrainsMono.ttf",
};
export function fontFile(family: string, fallback: string) {
  return FONT_FILES[family] ? { family, file: FONT_FILES[family] } : { family: fallback, file: FONT_FILES[fallback] };
}

export type Look = { bg: string; ink: string; accent: string; red: string; green: string; yellow: string; display: { family: string; file: string }; body: { family: string; file: string }; name: string; handle: string };
export function lookOf(channel: Pick<Channel, "identity" | "name" | "handle">): Look {
  const p = channel.identity.palette;
  return {
    bg: p[0] ?? "#0E0F12",
    ink: p[1] ?? "#F5F2EA",
    accent: p[2] ?? "#FFD23F",
    red: p[3] ?? "#FF4D4D",
    green: p[4] ?? "#3DDC84",
    yellow: "#FFD23F",
    display: fontFile(channel.identity.fonts.display, "Anton"),
    body: fontFile(channel.identity.fonts.body, "Instrument Sans"),
    name: safeText(channel.name).text.slice(0, 28),
    handle: channel.handle,
  };
}

// ---------- compile ----------

export type SceneMedia = MediaItem & { abs: string };
export type SfxCue = { t: number; kind: SfxKind; gain: number };
export type CompileInput = {
  beat: Pick<Beat, "id" | "text" | "scene" | "facts" | "cta">;
  index: number;
  /** Scene start in the episode and length, in frames. */
  startFrame: number;
  frames: number;
  /** Beat words relative to the scene start. */
  words: RelWord[];
  look: Look;
  aspect: "16:9" | "9:16";
  media: Map<string, SceneMedia>;
  facts: Map<string, Fact>;
};
export type CompiledScene = {
  beatId: string;
  html: string;
  /** Files to place next to index.html: `assets/x` ← absolute source. */
  assets: { to: string; from: string }[];
  fonts: string[];
  duration: number;
  sfx: SfxCue[];
  /** Every text the scene shows (QA compares with the DOM: nothing from another episode). */
  texts: string[];
  warnings: string[];
  hash: string;
};

export class SceneError extends Error {
  code = "SCENE_COMPILE";
  constructor(
    message: string,
    readonly beatId: string,
  ) {
    super(message);
  }
}

/** Hash of everything that changes the rendered frames (spec: text + scene + media + time + kit version). */
export function sceneHash(input: CompileInput) {
  const media = [...input.beat.scene.media, ...(input.beat.scene.bgVideo ? [input.beat.scene.bgVideo] : [])].map((id) => {
    const m = input.media.get(id);
    return m ? `${m.id}:${m.file}:${m.place ?? ""}` : id;
  });
  return createHash("sha1")
    .update(JSON.stringify([SCENE_KIT_VERSION, input.aspect, input.beat.text, input.beat.scene, media, input.frames, input.index % 2, input.words.map((w) => [w.t, Math.round(w.s * FPS)]), input.look]))
    .digest("hex")
    .slice(0, 20);
}

export function compileScene(input: CompileInput): CompiledScene {
  const { beat, look } = input;
  const type = beat.scene.type as CompiledType;
  if (!(COMPILED_SCENES as readonly string[]).includes(type)) throw new SceneError(`A cena "${beat.scene.type}" ainda não é compilada.`, beat.id);
  const parsed = SCENE_DATA[type].safeParse(beat.scene.data ?? {});
  if (!parsed.success) throw new SceneError(`Dados da cena ${type} inválidos: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`, beat.id);
  const data = parsed.data as Record<string, unknown>;
  const size = sizeOf(input.aspect);
  const D = input.frames / FPS;
  const ctx = new Ctx(input, size, D);

  // Background video (any scene): veil of 68% behind text and numbers.
  if (beat.scene.bgVideo) {
    const m = ctx.media(beat.scene.bgVideo, "video");
    ctx.videoLoop(m, 0, D, "bgvid");
    ctx.layers.push(`<div class="veil"></div>`);
  }

  switch (type) {
    case "photo":
      photo(ctx, data as z.infer<typeof SCENE_DATA.photo>);
      break;
    case "video":
      video(ctx, data as z.infer<typeof SCENE_DATA.video>);
      break;
    case "stat":
      stat(ctx, data as z.infer<typeof SCENE_DATA.stat>);
      break;
    case "title":
      title(ctx, data as z.infer<typeof SCENE_DATA.title>);
      break;
    case "list":
      list(ctx, data as z.infer<typeof SCENE_DATA.list>);
      break;
    case "cta":
      cta(ctx, data as z.infer<typeof SCENE_DATA.cta>);
      break;
  }
  return ctx.finish();
}

class Ctx {
  layers: string[] = [];
  /** Video clips are composition children (frame-synced by HyperFrames), outside the zoom wrapper. */
  clips: string[] = [];
  js: string[] = [];
  css: string[] = [];
  assets = new Map<string, string>();
  sfx: SfxCue[] = [];
  texts: string[] = [];
  warnings: string[] = [];
  firstAt = Infinity;
  private uid = 0;
  constructor(
    readonly input: CompileInput,
    readonly size: Size,
    readonly D: number,
  ) {}
  id(prefix: string) {
    return `${prefix}${++this.uid}`;
  }
  /** Text shown on screen: glyph-safe, escaped and recorded for QA. */
  text(raw: string) {
    const { text, replaced } = safeText(raw);
    if (replaced.length) this.warnings.push(`Caracteres trocados ou removidos: ${[...new Set(replaced)].join(" ")}`);
    if (text) this.texts.push(text);
    return esc(text);
  }
  cue(spec: string | undefined, fallback: number) {
    return Math.min(Math.max(0, this.D - 0.2), cueTime(spec, this.input.words, fallback));
  }
  /** Marks an element appearance; the first one is pulled to ≤ 10 frames. */
  appear(t: number) {
    const first = this.firstAt === Infinity;
    const at = first ? Math.min(t, FIRST_ELEMENT_MAX) : t;
    this.firstAt = Math.min(this.firstAt, at);
    return at;
  }
  media(id: string | undefined, kind: "photo" | "video") {
    const m = id ? this.input.media.get(id) : undefined;
    if (!m) throw new SceneError(`Mídia ${id ?? "(nenhuma)"} não está no registro de licenças.`, this.input.beat.id);
    if (kind === "photo" && m.kind !== "photo" && m.kind !== "icon") throw new SceneError(`A mídia ${m.id} não é foto.`, this.input.beat.id);
    if (kind === "video" && m.kind !== "video") throw new SceneError(`A mídia ${m.id} não é vídeo.`, this.input.beat.id);
    const to = `assets/${basename(m.abs)}`;
    this.assets.set(to, m.abs);
    return { ...m, src: to };
  }
  sound(t: number, kind: SfxKind, gain: number) {
    if (t >= 0 && t < this.D) this.sfx.push({ t: round(t), kind, gain });
  }
  /** Place tag: only on media that is from that place (the tag is sacred). */
  placeTag(tag: string | undefined, m: { place?: string } | undefined, t: number, until = this.D) {
    if (!tag) return;
    if (!m?.place || !this.input.beat.scene.place) {
      this.warnings.push(`Etiqueta "${tag}" removida: a mídia não é daquele lugar.`);
      return;
    }
    const id = this.id("tag");
    this.layers.push(`<div id="${id}" class="tag later">${this.text(tag.toUpperCase())}</div>`);
    this.js.push(`tl.fromTo("#${id}", {autoAlpha:0, x:-80}, {autoAlpha:1, x:0, duration:0.45, ease:"back.out(1.6)"}, ${round(t)});`);
    if (until < this.D) this.js.push(`tl.to("#${id}", {autoAlpha:0, duration:0.2}, ${round(until - 0.2)});`);
  }
  caption(text: string | undefined, t: number) {
    if (!text) return;
    const id = this.id("cap");
    this.layers.push(`<div id="${id}" class="cap later">${this.text(text)}</div>`);
    const at = this.appear(t);
    this.js.push(`tl.fromTo("#${id}", {autoAlpha:0, scale:0.3, rotation:-8}, {autoAlpha:1, scale:1, rotation:-2, duration:0.5, ease:"back.out(2)"}, ${round(at)});`);
  }
  credit(m: { author: string; license: string; source: string }) {
    if (m.license === "user" || m.license === "generated") return;
    const who = m.author && m.author !== "autor desconhecido" ? m.author : m.source;
    this.layers.push(`<div class="credit">${this.text(`${who.slice(0, 40)} · ${m.license}`)}</div>`);
  }
  /** A clip repeated in blocks without seams until `end` (never a looping <video>, which stalls the render). */
  videoLoop(m: { src: string; durationSec?: number }, start: number, end: number, cls: string) {
    const len = Math.max(0.5, m.durationSec ?? end - start);
    for (let s = start; s < end - 1 / FPS; s += len) {
      const d = Math.min(len, end - s);
      this.clips.push(`<video class="clip ${cls}" data-start="${round(s)}" data-duration="${round(d)}" data-track-index="0" src="${m.src}" muted playsinline></video>`);
    }
  }
  finish(): CompiledScene {
    const { input, size, D } = this;
    const look = input.look;
    const side = input.index % 2 === 0 ? 1 : -1;
    const fonts = [look.display, look.body];
    const vertical = size.vertical;
    const html = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<style>
  @font-face { font-family: "D"; src: url(fonts/${look.display.file}); }
  @font-face { font-family: "B"; src: url(fonts/${look.body.file}); font-weight: 100 900; }
  * { box-sizing: border-box; margin: 0; }
  html, body { width: ${size.w}px; height: ${size.h}px; overflow: hidden; background: ${look.bg}; }
  #film { position: relative; width: ${size.w}px; height: ${size.h}px; overflow: hidden; background: ${look.bg}; isolation: isolate; color: ${look.ink}; font-family: "B", sans-serif; }
  #stage, #zoom { position: absolute; inset: 0; }
  .later { visibility: hidden; opacity: 0; }
  .clip { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  .veil { position: absolute; inset: 0; background: rgba(0,0,0,0.68); }
  .photo { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  .seal { position: absolute; top: ${vertical ? 200 : 36}px; right: ${vertical ? 40 : 48}px; opacity: 0.92; text-align: right; font: 700 ${vertical ? 30 : 26}px/1.1 "B"; letter-spacing: 0.02em; text-shadow: 0 2px 8px rgba(0,0,0,.6); }
  .seal small { display: block; font-weight: 500; font-size: 0.72em; opacity: 0.8; }
  .tag { position: absolute; left: ${vertical ? 48 : 72}px; bottom: ${vertical ? 360 : 96}px; padding: 10px 22px; background: ${look.accent}; color: #111; font: ${vertical ? 52 : 46}px/1 "D"; letter-spacing: 0.04em; border-radius: 6px; }
  .cap { position: absolute; left: 50%; bottom: ${vertical ? 520 : 170}px; transform: translateX(-50%) rotate(-2deg); max-width: ${size.w - 160}px; padding: 12px 26px; background: ${look.yellow}; color: #111; font: ${vertical ? 58 : 54}px/1.08 "D"; text-align: center; box-shadow: 8px 8px 0 #111; }
  .credit { position: absolute; right: 18px; bottom: ${vertical ? 300 : 12}px; font: 500 18px/1 "B"; opacity: 0.7; text-shadow: 0 1px 3px #000; }
  .big { position: absolute; left: 0; right: 0; top: 40%; text-align: center; font: ${vertical ? 120 : 150}px/0.95 "D"; text-shadow: 0 6px 24px rgba(0,0,0,.7); }
  .statv { position: absolute; left: 0; right: 0; top: ${vertical ? 34 : 26}%; text-align: center; font: ${vertical ? 200 : 230}px/1 "D"; color: ${look.accent}; }
  .statl { position: absolute; left: 8%; right: 8%; top: ${vertical ? 50 : 56}%; text-align: center; font: 600 ${vertical ? 56 : 52}px/1.15 "B"; }
  .src { position: absolute; left: 0; right: 0; bottom: ${vertical ? 330 : 64}px; text-align: center; font: 500 ${vertical ? 30 : 26}px/1 "B"; opacity: 0.75; }
  .tline { display: table; font: var(--fs)/1.02 "D"; text-transform: uppercase; position: relative; }
  .tline.strike::after { content: ""; position: absolute; left: -2%; right: -2%; top: 52%; height: 0.09em; background: ${look.red}; transform: scaleX(var(--sx, 0)); transform-origin: left; }
  .tbox { position: absolute; left: ${vertical ? 64 : 140}px; right: ${vertical ? 64 : 140}px; top: 50%; transform: translateY(-50%); }
  .stamp { position: absolute; right: ${vertical ? 60 : 160}px; bottom: ${vertical ? 420 : 140}px; padding: 10px 26px; border: 8px solid ${look.red}; color: ${look.red}; font: ${vertical ? 64 : 72}px/1 "D"; transform: rotate(-12deg); }
  .lbox { position: absolute; left: ${vertical ? 64 : 200}px; right: ${vertical ? 64 : 200}px; top: ${vertical ? 22 : 16}%; }
  .lt { font: ${vertical ? 70 : 74}px/1 "D"; margin-bottom: 36px; text-transform: uppercase; }
  .li { display: flex; align-items: center; gap: 28px; margin: 22px 0; font: 600 ${vertical ? 50 : 52}px/1.12 "B"; }
  .mk { flex: 0 0 auto; width: ${vertical ? 72 : 76}px; height: ${vertical ? 72 : 76}px; border-radius: 50%; display: grid; place-items: center; }
  .mk svg { width: 60%; height: 60%; }
  .ctabox { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: ${vertical ? 920 : 1180}px; }
  .cmt { display: flex; gap: 28px; align-items: center; padding: 34px 40px; background: #fff; color: #111; border-radius: 26px; box-shadow: 0 20px 60px rgba(0,0,0,.45); font: 600 ${vertical ? 46 : 48}px/1.2 "B"; }
  .cmt .av { width: 96px; height: 96px; border-radius: 50%; background: ${look.accent}; flex: 0 0 auto; }
  .caret { display: inline-block; width: 4px; height: 1em; background: #111; vertical-align: -0.12em; margin-left: 4px; }
  .sub { position: relative; display: flex; align-items: center; justify-content: center; gap: 36px; }
  .subbtn { padding: 30px 60px; border-radius: 60px; background: #FF0033; color: #fff; font: 800 ${vertical ? 52 : 56}px/1 "B"; letter-spacing: 0.02em; }
  .subbtn.done { background: #3a3a3a; }
  .bell, .thumb { width: ${vertical ? 130 : 140}px; height: ${vertical ? 130 : 140}px; }
  .cursor { position: absolute; left: 50%; top: 50%; width: 90px; height: 90px; }
  .ctat { margin-top: 48px; text-align: center; font: 700 ${vertical ? 54 : 56}px/1.15 "B"; }
  .end { position: absolute; border: 4px dashed rgba(255,255,255,.35); border-radius: 18px; }
  .spark { position: absolute; width: 22px; height: 22px; border-radius: 50%; background: ${look.accent}; }
${this.css.join("\n")}
</style>
</head>
<body>
<div id="film" data-composition-id="scene" data-start="0" data-duration="${frameDuration(input.frames)}" data-width="${size.w}" data-height="${size.h}">
  ${this.clips.join("\n  ")}
  <div id="stage"><div id="zoom">
    ${this.layers.join("\n    ")}
  </div></div>
  <div class="seal">${esc(look.name)}${look.handle ? `<small>${esc(look.handle)}</small>` : ""}</div>
  <script src="kit/gsap.min.js"></script>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    // Whip-in: 7 frames, 160 px from alternating sides, motion blur 14 → 0, scale 1.06 → 1.
    tl.fromTo("#stage", { x: ${160 * side}, scale: 1.06, filter: "blur(14px)" }, { x: 0, scale: 1, filter: "blur(0px)", duration: ${round(7 / FPS)}, ease: "power3.out" }, 0);
    // Slow continuous zoom of 2.5% per scene.
    tl.fromTo("#zoom", { scale: 1 }, { scale: 1.025, duration: ${round(D)}, ease: "none" }, 0);
    ${this.js.join("\n    ")}
    tl.set({}, {}, ${frameDuration(input.frames)});
    window.__timelines["scene"] = tl;
  </script>
</div>
</body>
</html>
`;
    if (this.firstAt === Infinity && !this.clips.length) this.warnings.push("Cena sem elemento animado: só fundo.");
    return {
      beatId: input.beat.id,
      html,
      assets: [...this.assets].map(([to, from]) => ({ to, from })),
      fonts: [...new Set(fonts.map((f) => f.file))],
      duration: round(D),
      sfx: this.sfx.sort((a, b) => a.t - b.t),
      texts: [...new Set(this.texts)],
      warnings: [...new Set(this.warnings)],
      hash: sceneHash(input),
    };
  }
}

const round = (n: number) => Math.round(n * 1000) / 1000;
/**
 * Duration written into the composition so HyperFrames renders exactly `frames` frames: it
 * renders ceil(duration × fps), so 170 frames written as 5.667 s became 171. Truncating to the
 * millisecond keeps duration × fps in (frames − 0.03, frames].
 */
export const frameDuration = (frames: number) => Math.floor((frames / FPS) * 1000) / 1000;

// ---------- scene types ----------

function photo(ctx: Ctx, d: z.infer<typeof SCENE_DATA.photo>) {
  const m = ctx.media(ctx.input.beat.scene.media[0], "photo");
  const id = ctx.id("ph");
  ctx.layers.push(`<img id="${id}" class="photo" src="${m.src}" alt="">`);
  const D = ctx.D;
  const from = d.move === "out" ? "{scale:1.12}" : d.move === "l" ? "{scale:1.1, xPercent:3}" : d.move === "r" ? "{scale:1.1, xPercent:-3}" : "{scale:1}";
  const to = d.move === "out" ? "{scale:1" : d.move === "l" ? "{scale:1.1, xPercent:-3" : d.move === "r" ? "{scale:1.1, xPercent:3" : "{scale:1.12";
  // Ken Burns over the whole scene; the photo is there from frame 0.
  ctx.js.push(`tl.fromTo("#${id}", ${from}, ${to}, duration:${round(D)}, ease:"none"}, 0);`);
  ctx.appear(0);
  ctx.sound(0, "whoosh", 0.18);
  ctx.placeTag(d.tag, m, 0.25);
  ctx.caption(d.caption, 0.4);
  ctx.credit(m);
}

function video(ctx: Ctx, d: z.infer<typeof SCENE_DATA.video>) {
  const clips = d.clips?.length ? d.clips : ctx.input.beat.scene.media.map((media) => ({ media, at: undefined, tag: undefined }));
  if (!clips.length) throw new SceneError("Cena de vídeo sem clipe.", ctx.input.beat.id);
  const D = ctx.D;
  const starts = clips.map((c, i) => (i === 0 ? 0 : ctx.cue(c.at, (D * i) / clips.length)));
  for (let i = 1; i < starts.length; i++) starts[i] = Math.max(starts[i], starts[i - 1] + 0.5);
  clips.forEach((c, i) => {
    const m = ctx.media(c.media, "video");
    const end = i + 1 < clips.length ? starts[i + 1] : D;
    ctx.videoLoop(m, starts[i], end, `v${i}`);
    ctx.sound(starts[i], "whoosh", 0.16);
    ctx.placeTag(c.tag, m, starts[i] + 0.2, end);
    if (i === 0) ctx.credit(m);
  });
  ctx.appear(0);
  // B-roll zoom of 2%.
  ctx.js.push(`tl.fromTo(".clip", {scale:1}, {scale:1.02, duration:${round(D)}, ease:"none"}, 0);`);
  if (d.big) {
    const id = ctx.id("big");
    ctx.layers.push(`<div id="${id}" class="big later">${ctx.text(d.big.toUpperCase())}</div>`);
    ctx.js.push(`tl.fromTo("#${id}", {autoAlpha:0, scale:0.2}, {autoAlpha:1, scale:1, duration:0.5, ease:"back.out(1.8)"}, ${round(ctx.appear(0.2))});`);
    ctx.sound(0.2, "pop", 0.25);
  }
  ctx.caption(d.caption, 0.5);
}

const fmtNumber = (v: number, decimals: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

function stat(ctx: Ctx, d: z.infer<typeof SCENE_DATA.stat>) {
  // A number on screen needs a source: data.source or the beat's first fact (spec "Número sem fonte na tela").
  const fact = ctx.input.beat.facts.map((f) => ctx.input.facts.get(f)).find(Boolean);
  const source = d.source ?? (fact ? `${fact.source.publisher}${fact.dataDate ? `, ${fact.dataDate}` : fact.source.publishedAt ? `, ${fact.source.publishedAt.slice(0, 10)}` : ""}` : undefined);
  if (!source) throw new SceneError("Número na tela sem fonte: ligue um fato à fala ou passe data.source.", ctx.input.beat.id);
  const t = ctx.appear(ctx.cue(d.at, 0.2));
  const v = ctx.id("v");
  const final = `${d.prefix}${fmtNumber(d.value, d.decimals)}${d.suffix}`;
  ctx.texts.push(safeText(final).text);
  ctx.layers.push(`<div id="${v}" class="statv later">${esc(safeText(`${d.prefix}0${d.suffix}`).text)}</div>`);
  if (d.label) ctx.layers.push(`<div id="${v}l" class="statl later">${ctx.text(d.label)}</div>`);
  ctx.layers.push(`<div id="${v}s" class="src later">Fonte: ${ctx.text(source)}</div>`);
  const count = Math.min(1.4, Math.max(0.6, ctx.D - t - 0.5));
  ctx.js.push(
    `tl.fromTo("#${v}", {autoAlpha:0, scale:0.2}, {autoAlpha:1, scale:1, duration:0.45, ease:"back.out(1.7)"}, ${round(t)});`,
    `(function(){ const o={n:0}; const el=document.getElementById("${v}"); tl.to(o, {n:${d.value}, duration:${round(count)}, ease:"power2.out", onUpdate(){ el.textContent=${JSON.stringify(d.prefix)}+o.n.toLocaleString("pt-BR",{minimumFractionDigits:${d.decimals},maximumFractionDigits:${d.decimals}})+${JSON.stringify(d.suffix)}; }}, ${round(t)}); })();`,
    d.label ? `tl.fromTo("#${v}l", {autoAlpha:0, y:30}, {autoAlpha:1, y:0, duration:0.4, ease:"power2.out"}, ${round(t + 0.25)});` : "",
    `tl.fromTo("#${v}s", {autoAlpha:0}, {autoAlpha:0.75, duration:0.3}, ${round(t + 0.3)});`,
  );
  ctx.sound(t, "pop", 0.3);
  ctx.sound(t + count, "ding", 0.2);
}

function title(ctx: Ctx, d: z.infer<typeof SCENE_DATA.title>) {
  const box = ctx.id("tb");
  const longest = Math.max(...d.lines.map((l) => safeText(l.text).text.length));
  const width = ctx.size.w - (ctx.size.vertical ? 128 : 280);
  // Anton is ~0.46 em per uppercase char: fit the longest line, cap by line count.
  const fs = Math.round(Math.min(ctx.size.vertical ? 170 : 190, (width / Math.max(1, longest)) / 0.5, (ctx.size.h * 0.62) / d.lines.length / 1.05));
  const lines = d.lines.map((l, i) => {
    const id = `${box}_${i}`;
    const color = l.color === "accent" ? ctx.input.look.accent : l.color === "red" ? ctx.input.look.red : l.color === "green" ? ctx.input.look.green : ctx.input.look.ink;
    return { id, html: `<span id="${id}" class="tline later${l.strike ? " strike" : ""}" style="color:${color}">${ctx.text(l.text)}</span>`, at: l.at, strike: l.strike, i };
  });
  ctx.layers.push(`<div id="${box}" class="tbox" style="--fs:${fs}px">${lines.map((l) => l.html).join("")}</div>`);
  let prev = 0;
  for (const l of lines) {
    const t = ctx.appear(Math.max(prev, ctx.cue(l.at, l.i * 0.35 + 0.1)));
    prev = t + 0.12;
    ctx.js.push(`tl.fromTo("#${l.id}", {autoAlpha:0, y:60, scale:0.6}, {autoAlpha:1, y:0, scale:1, duration:0.42, ease:"back.out(1.9)"}, ${round(t)});`);
    ctx.sound(t, l.i === 0 ? "swish" : "tick", l.i === 0 ? 0.2 : 0.14);
    if (l.strike) {
      ctx.js.push(`tl.fromTo("#${l.id}", {"--sx":0}, {"--sx":1, duration:0.3, ease:"power2.inOut"}, ${round(t + 0.5)});`);
      ctx.sound(t + 0.5, "swish", 0.18);
    }
  }
  if (d.stamp) {
    const id = ctx.id("st");
    ctx.layers.push(`<div id="${id}" class="stamp later">${ctx.text(d.stamp.toUpperCase())}</div>`);
    const t = Math.min(ctx.D - 0.4, prev + 0.4);
    ctx.js.push(`tl.fromTo("#${id}", {autoAlpha:0, scale:2.4, rotation:-4}, {autoAlpha:1, scale:1, rotation:-12, duration:0.22, ease:"power4.in"}, ${round(t)});`);
    ctx.sound(t + 0.2, "impact", 0.3);
  }
}

const CHECK = '<svg viewBox="0 0 24 24"><path d="M4 12.5l5 5L20 6.5" fill="none" stroke="#111" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const CROSS = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round"/></svg>';

function list(ctx: Ctx, d: z.infer<typeof SCENE_DATA.list>) {
  const box = ctx.id("lb");
  const parts: string[] = [];
  if (d.title) parts.push(`<div id="${box}t" class="lt later">${ctx.text(d.title)}</div>`);
  d.items.forEach((it, i) => {
    const bg = it.mark === "ok" ? ctx.input.look.green : ctx.input.look.red;
    parts.push(`<div id="${box}_${i}" class="li later"><span class="mk" style="background:${bg}">${it.mark === "ok" ? CHECK : CROSS}</span><span>${ctx.text(it.text)}</span></div>`);
  });
  ctx.layers.push(`<div id="${box}" class="lbox" style="--tone:${d.tone === "green" ? ctx.input.look.green : ctx.input.look.red}">${parts.join("")}</div>`);
  if (d.title) ctx.js.push(`tl.fromTo("#${box}t", {autoAlpha:0, x:-60}, {autoAlpha:1, x:0, duration:0.4, ease:"back.out(1.6)"}, ${round(ctx.appear(0.1))});`);
  let prev = 0;
  d.items.forEach((it, i) => {
    const t = ctx.appear(Math.max(prev, ctx.cue(it.at, 0.3 + (i * Math.max(0.6, ctx.D - 1)) / d.items.length)));
    prev = t + 0.25;
    ctx.js.push(`tl.fromTo("#${box}_${i}", {autoAlpha:0, x:80, scale:0.85}, {autoAlpha:1, x:0, scale:1, duration:0.4, ease:"back.out(1.7)"}, ${round(t)});`);
    // Older items dim when the next one arrives.
    if (i > 0) ctx.js.push(`tl.to("#${box}_${i - 1}", {opacity:0.45, duration:0.25}, ${round(t)});`);
    ctx.sound(t, "pop", 0.22);
  });
}

const BELL = (c: string) => `<svg viewBox="0 0 24 24"><path d="M12 3a6 6 0 00-6 6v4l-2 3h16l-2-3V9a6 6 0 00-6-6z" fill="${c}"/><circle cx="12" cy="19.5" r="2" fill="${c}"/></svg>`;
const THUMB = (c: string) => `<svg viewBox="0 0 24 24"><path d="M2 10h4v11H2zM8 21h9.5a2 2 0 002-1.6l1.4-7A2 2 0 0019 10h-5.2l.8-4.3A1.8 1.8 0 0011.3 5L8 10z" fill="${c}"/></svg>`;
const CURSOR = '<svg viewBox="0 0 24 24"><path d="M4 2l15 9-7 1.5L15 21l-3 1.2-3.2-8.4L4 18z" fill="#fff" stroke="#111" stroke-width="1.2"/></svg>';

function cta(ctx: Ctx, d: z.infer<typeof SCENE_DATA.cta>) {
  const box = ctx.id("cta");
  const text = d.text ?? ctx.input.beat.text;
  const D = ctx.D;
  if (d.kind === "comment") {
    const examples = d.examples.length ? d.examples : [];
    ctx.layers.push(`<div id="${box}" class="ctabox later"><div class="cmt"><div class="av"></div><div><span id="${box}w"></span><span class="caret"></span></div></div><div class="ctat">${ctx.text(text)}</div></div>`);
    for (const e of examples) ctx.texts.push(safeText(e).text);
    ctx.js.push(`tl.fromTo("#${box}", {autoAlpha:0, y:80, scale:0.8}, {autoAlpha:1, y:0, scale:1, duration:0.5, ease:"back.out(1.7)"}, ${round(ctx.appear(0.1))});`);
    // Types the examples one after the other (data of the beat, never fixed cities).
    const per = examples.length ? Math.max(0.9, (D - 0.8) / examples.length) : 0;
    examples.forEach((raw, i) => {
      const e = safeText(raw).text;
      const t0 = 0.6 + i * per;
      for (let k = 1; k <= e.length; k++) ctx.js.push(`tl.set("#${box}w", {textContent:${JSON.stringify(e.slice(0, k))}}, ${round(t0 + k * 0.06)});`);
      ctx.sound(t0, "click", 0.12);
    });
  } else if (d.kind === "subscribe") {
    ctx.layers.push(`<div id="${box}" class="ctabox later"><div class="sub"><div id="${box}b" class="subbtn">INSCREVER-SE</div><div id="${box}bell" class="bell">${BELL("#fff")}</div><div id="${box}c" class="cursor">${CURSOR}</div></div><div class="ctat">${ctx.text(text)}</div></div>`);
    const click = Math.min(D - 0.6, 1.2);
    ctx.js.push(
      `tl.fromTo("#${box}", {autoAlpha:0, scale:0.7}, {autoAlpha:1, scale:1, duration:0.45, ease:"back.out(1.7)"}, ${round(ctx.appear(0.1))});`,
      `tl.fromTo("#${box}c", {x:460, y:280}, {x:-110, y:-10, duration:0.7, ease:"power2.inOut"}, 0.4);`,
      `tl.to("#${box}b", {scale:0.92, duration:0.08, yoyo:true, repeat:1}, ${round(click)});`,
      `tl.set("#${box}b", {className:"subbtn done", textContent:"INSCRITO"}, ${round(click + 0.08)});`,
      `tl.fromTo("#${box}bell", {rotation:0}, {rotation:18, duration:0.08, yoyo:true, repeat:7, transformOrigin:"50% 10%"}, ${round(click + 0.35)});`,
    );
    ctx.sound(click, "click", 0.35);
    ctx.sound(click + 0.35, "ding", 0.3);
  } else if (d.kind === "like") {
    const sparks = Array.from({ length: 10 }, (_, i) => `<div id="${box}s${i}" class="spark later" style="left:50%;top:40%"></div>`).join("");
    ctx.layers.push(`<div id="${box}" class="ctabox later" style="text-align:center"><div id="${box}h" class="thumb" style="margin:0 auto">${THUMB(ctx.input.look.accent)}</div>${sparks}<div class="ctat">${ctx.text(text)}</div></div>`);
    const t = ctx.appear(0.15);
    ctx.js.push(`tl.fromTo("#${box}", {autoAlpha:0}, {autoAlpha:1, duration:0.2}, ${round(t)});`, `tl.fromTo("#${box}h", {scale:0.2, rotation:-25}, {scale:1, rotation:0, duration:0.55, ease:"elastic.out(1,0.5)"}, ${round(t)});`);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      ctx.js.push(`tl.fromTo("#${box}s${i}", {autoAlpha:1, x:0, y:0, scale:1}, {autoAlpha:0, x:${Math.round(Math.cos(a) * 220)}, y:${Math.round(Math.sin(a) * 220)}, scale:0.3, duration:0.6, ease:"power2.out"}, ${round(t + 0.25)});`);
    }
    ctx.sound(t, "pop", 0.35);
    ctx.sound(t + 0.25, "burst", 0.3);
  } else {
    // End screen: the speech plus empty areas where YouTube places 2 videos + subscribe.
    const v = ctx.size.vertical;
    const areas = v
      ? [{ l: 90, t: 620, w: 900, h: 506 }, { l: 90, t: 1180, w: 900, h: 506 }]
      : [{ l: 140, t: 300, w: 760, h: 428 }, { l: 1020, t: 300, w: 760, h: 428 }];
    areas.forEach((a, i) => ctx.layers.push(`<div id="${box}a${i}" class="end later" style="left:${a.l}px;top:${a.t}px;width:${a.w}px;height:${a.h}px"></div>`));
    ctx.layers.push(`<div id="${box}t" class="ctat later" style="position:absolute;left:0;right:0;top:${v ? 380 : 140}px">${ctx.text(text)}</div>`);
    const t = ctx.appear(0.1);
    ctx.js.push(`tl.fromTo("#${box}t", {autoAlpha:0, y:-30}, {autoAlpha:1, y:0, duration:0.4}, ${round(t)});`, `tl.fromTo("#${box}a0, #${box}a1", {autoAlpha:0, scale:0.9}, {autoAlpha:1, scale:1, duration:0.5, stagger:0.15, ease:"back.out(1.5)"}, ${round(t + 0.3)});`);
    ctx.sound(t, "chime", 0.25);
  }
}

// ---------- episode-level compile & write ----------

type Ids = { profileId: string; channelId: string; episodeId: string };
export type Kit = { gsap: string; fontsDir: string };

export type ScenePlan = { beatId: string; startFrame: number; frames: number; isLast: boolean };
/**
 * Frame-quantized scene boundaries: scene i runs from beat i's start to beat i+1's start, so
 * the scenes add up exactly to the narration (the last one runs to the end, + 12 s on the end
 * screen). The first scene starts at frame 0.
 */
export function planScenes(beats: Pick<Beat, "id" | "timing" | "cta">[], audioDuration: number): ScenePlan[] {
  if (beats.some((b) => !b.timing)) throw Object.assign(new Error("Há falas sem tempo: rode o alinhamento antes de compilar as cenas."), { code: "NO_TIMING" });
  const starts = beats.map((b, i) => (i === 0 ? 0 : Math.round(b.timing!.start * FPS)));
  const endFrame = Math.round(audioDuration * FPS);
  return beats.map((b, i) => {
    const isLast = i === beats.length - 1;
    const next = isLast ? endFrame + (b.cta === "endscreen" ? ENDSCREEN_EXTRA * FPS : 0) : starts[i + 1];
    return { beatId: b.id, startFrame: starts[i], frames: Math.max(1, next - starts[i]), isLast };
  });
}

export const sceneMetaSchema = z.object({ beatId: z.string(), hash: z.string(), duration: z.number(), startFrame: z.number(), frames: z.number(), sfx: z.array(z.object({ t: z.number(), kind: z.string(), gain: z.number() })), texts: z.array(z.string()), warnings: z.array(z.string()) });
export type SceneMeta = z.infer<typeof sceneMetaSchema>;

async function linkOrCopy(from: string, to: string) {
  await rm(to, { force: true });
  await link(from, to).catch(() => copyFile(from, to));
}

export async function writeScene(dir: string, scene: CompiledScene, plan: ScenePlan, kit: Kit) {
  await rm(dir, { recursive: true, force: true });
  await mkdir(join(dir, "assets"), { recursive: true });
  await mkdir(join(dir, "fonts"), { recursive: true });
  await mkdir(join(dir, "kit"), { recursive: true });
  // Rendered under a strict CSP (same as films): scene HTML cannot reach the internet.
  await writeFile(join(dir, "index.html"), withCsp(scene.html), "utf8");
  await writeFile(join(dir, "kit", "gsap.min.js"), await readFile(kit.gsap));
  for (const f of scene.fonts) await linkOrCopy(join(kit.fontsDir, f), join(dir, "fonts", f));
  for (const a of scene.assets) await linkOrCopy(a.from, join(dir, a.to));
  const meta: SceneMeta = { beatId: scene.beatId, hash: scene.hash, duration: scene.duration, startFrame: plan.startFrame, frames: plan.frames, sfx: scene.sfx, texts: scene.texts, warnings: scene.warnings };
  await writeJsonAtomic(join(dir, "scene.json"), meta);
  return meta;
}

/**
 * `scenes_compile`: compiles every beat; folders whose hash did not change are left as they are.
 * Returns per-beat results; errors do not stop the other scenes.
 */
export async function compileEpisodeScenes(store: ChannelStore, ids: Ids, kit: Kit, options: { audioDuration: number }) {
  const episodeDir = store.episodeDir(ids.profileId, ids.channelId, ids.episodeId);
  const [channel, episode, script, licenses, research] = await Promise.all([
    store.getChannel(ids.profileId, ids.channelId),
    store.getEpisode(ids.profileId, ids.channelId, ids.episodeId),
    store.readEpisodeFile(ids.profileId, ids.channelId, ids.episodeId, "script"),
    store.readEpisodeFile(ids.profileId, ids.channelId, ids.episodeId, "licenses"),
    store.readEpisodeFile(ids.profileId, ids.channelId, ids.episodeId, "research"),
  ]);
  if (!script?.beats.length) throw Object.assign(new Error("O episódio ainda não tem roteiro."), { code: "NO_SCRIPT" });
  const plans = planScenes(script.beats, options.audioDuration);
  const look = lookOf(channel);
  const media = new Map((licenses?.items ?? []).map((m) => [m.id, { ...m, abs: join(episodeDir, m.file) }]));
  const facts = new Map((research?.facts ?? []).map((f) => [f.id, f]));
  const results: { beatId: string; hash?: string; changed: boolean; error?: string; warnings: string[] }[] = [];
  const keep = new Set<string>();
  for (const [i, beat] of script.beats.entries()) {
    const plan = plans[i];
    keep.add(beat.id);
    const start = plan.startFrame / FPS;
    const words = (beat.timing?.words ?? []).map((w) => ({ t: w.t, s: w.s - start, e: w.e - start }));
    const dir = join(episodeDir, "scenes", beat.id);
    try {
      const input: CompileInput = { beat, index: i, startFrame: plan.startFrame, frames: plan.frames, words, look, aspect: episode.aspect, media, facts };
      const hash = sceneHash(input);
      const old = sceneMetaSchema.safeParse(await readJsonOr(join(dir, "scene.json"), () => ({})));
      if (old.success && old.data.hash === hash && (await statFile(join(dir, "index.html")).then(() => true, () => false))) {
        results.push({ beatId: beat.id, hash, changed: false, warnings: old.data.warnings });
        continue;
      }
      const scene = compileScene(input);
      await writeScene(dir, scene, plan, kit);
      results.push({ beatId: beat.id, hash: scene.hash, changed: true, warnings: scene.warnings });
    } catch (error) {
      // A stale scene must never be rendered in place of one that no longer compiles.
      await rm(join(dir, "scene.json"), { force: true });
      results.push({ beatId: beat.id, changed: false, error: (error as Error).message, warnings: [] });
    }
  }
  // Scenes of deleted beats go away.
  for (const name of await readdir(join(episodeDir, "scenes")).catch(() => [] as string[])) if (!keep.has(name)) await rm(join(episodeDir, "scenes", name), { recursive: true, force: true });
  const errors = results.filter((r) => r.error);
  await store.setStage(ids.profileId, ids.channelId, ids.episodeId, "scenes", errors.length ? { status: "erro", error: `${errors.length} cena(s) com erro: ${errors[0].beatId} ${errors[0].error}` } : { status: "ok", inputHash: createHash("sha1").update(results.map((r) => r.hash).join("|")).digest("hex").slice(0, 16) });
  return { scenes: results, compiled: results.filter((r) => r.changed).length, errors: errors.length, totalFrames: plans.reduce((s, p) => s + p.frames, 0) };
}

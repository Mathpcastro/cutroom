import { link, copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { z } from "zod";
import type { Channel, Fact } from "../../../src/shared/channel";
import { formatOf } from "../../../src/shared/channel-formats";
import { withCsp } from "../film";
import type { ChannelStore } from "./channel-store";
import { readSceneMetas, sectionSpans } from "./episode-render";
import { ffmpeg } from "./ffmpeg";
import { writeJsonAtomic } from "./fs-json";
import { creditSections } from "./media-hub";
import type { BenchRunner, TextBox } from "./qa";
import { sourceLine, usableFact } from "./research";
import { lookOf, safeText } from "./scene-compiler";

/**
 * Pacote de publicação (spec "Pacote de publicação"): 3 thumbs, 3 titles, the full description
 * (hook, question, chapters with the real times, FONTES, credits from the license record,
 * synthetic-voice notice, 3 hashtags), tags and the other fields. The recommended
 * title + thumb pair comes marked. Agent first: the agent writes the words; the app assembles,
 * checks the limits and renders the thumbs.
 */

export const DESCRIPTION_LIMIT = 5000;
export const NOTICE = "Narração com voz sintética. Opiniões do canal; dados com fonte acima.";

export const packageInputSchema = z.object({
  titles: z.array(z.string().trim().min(5).max(100)).length(3),
  thumbs: z
    .array(z.object({ lines: z.array(z.string().trim().min(1).max(40)).min(2).max(3), media: z.string().optional(), chip: z.string().max(30).optional() }))
    .length(3),
  intro: z.string().trim().min(20).max(600),
  question: z.string().trim().max(200).optional(),
  hashtags: z.array(z.string().trim().max(40)).min(1).max(3),
  tags: z.array(z.string().trim().min(1).max(100)).min(10).max(15),
  recommended: z.number().int().min(0).max(2).default(0),
  category: z.string().max(40).default("Viagens e eventos"),
});
export type PackageInput = z.input<typeof packageInputSchema>;

export type Chapter = { t: number; title: string };
export const fmtTime = (s: number) => {
  const total = Math.floor(s);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
};

/** Chapters from the sections' real start times: first at 00:00, each ≥ 10 s, at least 3. */
export function chaptersFrom(spans: { section: string; from: number; to: number }[], titles: Record<string, string>): Chapter[] {
  const out: Chapter[] = [];
  for (const s of spans) {
    const title = titles[s.section] ?? s.section;
    const last = out.at(-1);
    if (last && s.from - last.t < 10) continue; // the previous chapter would be < 10 s: merge into it
    if (last && last.title === title) continue;
    out.push({ t: out.length ? s.from : 0, title });
  }
  // The last chapter must also last ≥ 10 s.
  const end = spans.at(-1)?.to ?? 0;
  if (out.length > 1 && end - out.at(-1)!.t < 10) out.pop();
  return out;
}

export function validateChapters(chapters: Chapter[]) {
  const problems: string[] = [];
  if (chapters[0]?.t !== 0) problems.push("O primeiro capítulo tem de começar em 00:00.");
  if (chapters.length < 3) problems.push("São necessários pelo menos 3 capítulos.");
  for (let i = 1; i < chapters.length; i++) if (chapters[i].t - chapters[i - 1].t < 10) problems.push(`O capítulo "${chapters[i - 1].title}" tem menos de 10 s.`);
  return problems;
}

/** FONTES: one line per used fact (deduped by link). */
export function sourcesSection(facts: Fact[], usedBeatIds: Set<string>) {
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const f of facts) {
    if (!usableFact(f) || !f.usedIn.some((b) => usedBeatIds.has(b)) || seen.has(f.source.url)) continue;
    seen.add(f.source.url);
    lines.push(sourceLine(f));
  }
  return lines;
}

export function buildDescription(o: { intro: string; question?: string; chapters: Chapter[]; sources: string[]; credits: ReturnType<typeof creditSections>; hashtags: string[]; sensitiveNotice?: string }) {
  const tags = o.hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`).replace(/\s+/g, ""));
  const creditBlocks = Object.entries(o.credits)
    .filter(([, lines]) => lines.length)
    .map(([title, lines]) => `${title}\n${lines.join("\n")}`);
  const head = [o.intro.trim(), o.question?.trim(), `CAPÍTULOS\n${o.chapters.map((c) => `${fmtTime(c.t)} ${c.title}`).join("\n")}`, o.sources.length ? `FONTES\n${o.sources.join("\n")}` : undefined].filter(Boolean) as string[];
  const tail = [o.sensitiveNotice, NOTICE, tags.join(" ")].filter(Boolean) as string[];
  const full = [...head, ...creditBlocks, ...tail].join("\n\n");
  if (full.length <= DESCRIPTION_LIMIT) return { description: full, creditsInComment: false, pinnedExtra: "" };
  // Over 5,000 characters: the credits go to the pinned comment.
  const short = [...head, "CRÉDITOS de fotos, vídeos e música no comentário fixado.", ...tail].join("\n\n");
  if (short.length > DESCRIPTION_LIMIT) throw Object.assign(new Error(`A descrição passa de ${DESCRIPTION_LIMIT} caracteres mesmo sem os créditos (${short.length}). Encurte a abertura ou as fontes.`), { code: "DESCRIPTION_TOO_LONG" });
  return { description: short, creditsInComment: true, pinnedExtra: creditBlocks.join("\n\n") };
}

export function checkTitles(titles: string[], channel: Pick<Channel, "niche">) {
  return titles.flatMap((t, i) => {
    const issues: string[] = [];
    if (t.length > 70) issues.push(`Título ${i + 1} com ${t.length} caracteres (máximo 70, para caber no celular).`);
    if (/imagem ilustrativa/i.test(t)) issues.push(`Título ${i + 1} com termo proibido.`);
    void channel;
    return issues;
  });
}

export function checkTags(tags: string[]) {
  const issues: string[] = [];
  const total = tags.join(",").length;
  if (tags.length < 10 || tags.length > 15) issues.push(`São ${tags.length} tags; use de 10 a 15.`);
  if (total > 500) issues.push(`Tags somam ${total} caracteres (máximo 500).`);
  return issues;
}

// ---------- thumbs ----------

export const THUMB = { w: 1280, h: 720, maxBytes: 2_000_000, maxWords: 6, minFontPx: 88 };

/** Thumb HTML: real photo + short strong phrase (last line in the accent color), dark gradient on the text side, place chip on the opposite corner. */
export function thumbHtml(o: { photo?: string; soft?: boolean; character?: string; lines: string[]; chip?: string; look: ReturnType<typeof lookOf> }) {
  const lines = o.lines.map((l) => safeText(l).text.toUpperCase());
  const longest = Math.max(...lines.map((l) => l.length));
  const fs = Math.round(Math.max(THUMB.minFontPx, Math.min(170, 640 / Math.max(1, longest) / 0.48, 560 / lines.length / 1.02)));
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return {
    fontSize: fs,
    texts: [...lines, ...(o.chip ? [safeText(o.chip).text.toUpperCase()] : [])],
    html: `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: "D"; src: url(fonts/${o.look.display.file}); }
* { margin: 0; box-sizing: border-box; }
html, body { width: ${THUMB.w}px; height: ${THUMB.h}px; overflow: hidden; background: ${o.look.bg}; }
#film { position: relative; width: ${THUMB.w}px; height: ${THUMB.h}px; overflow: hidden; }
.photo { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.photo.soft { filter: blur(22px) brightness(.5) saturate(1.2); transform: scale(1.15); }
.grad { position: absolute; inset: 0; background: linear-gradient(90deg, rgba(0,0,0,.88) 0%, rgba(0,0,0,.6) 45%, rgba(0,0,0,0) 72%); }
.txt { position: absolute; left: 48px; top: 50%; transform: translateY(-50%); width: 760px; }
.l { display: table; font: ${fs}px/0.98 "D"; color: #fff; -webkit-text-stroke: 6px #000; paint-order: stroke fill; text-shadow: 0 6px 0 #000; }
.l.last { color: ${o.look.accent}; }
.char { position: absolute; right: -20px; bottom: 0; height: 100%; max-width: 620px; object-fit: contain; object-position: bottom right; filter: drop-shadow(0 12px 28px rgba(0,0,0,.65)); }
.chip { position: absolute; right: 34px; top: 34px; padding: 10px 22px; background: ${o.look.accent}; color: #111; font: 44px/1 "D"; border-radius: 8px; }
</style></head><body>
<div id="film" data-composition-id="thumb" data-start="0" data-duration="1" data-width="${THUMB.w}" data-height="${THUMB.h}">
${o.photo ? `<img class="photo${o.soft ? " soft" : ""}" src="${o.photo}" alt="">` : ""}<div class="grad"></div>${o.character ? `<img class="char" src="${o.character}" alt="">` : ""}
<div class="txt">${lines.map((l, i) => `<span class="l${i === lines.length - 1 ? " last" : ""}">${esc(l)}</span>`).join("")}</div>
${o.chip ? `<div class="chip">${esc(safeText(o.chip).text.toUpperCase())}</div>` : ""}
<script src="kit/gsap.min.js"></script>
<script>window.__timelines = window.__timelines || {}; const tl = gsap.timeline({ paused: true }); tl.set({}, {}, 1); window.__timelines["thumb"] = tl;</script>
</div></body></html>`,
  };
}

/** Elements may not cover the text (bug: the flag covered the "?"). */
export function thumbOverlap(boxes: TextBox[]) {
  const lines = boxes.filter((b) => !/chip/.test(b.cls));
  const others = boxes.filter((b) => /chip/.test(b.cls));
  const hit = (a: TextBox, b: TextBox) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  return lines.some((l) => others.some((o) => hit(l, o)));
}

async function linkOrCopy(from: string, to: string) {
  await rm(to, { force: true });
  await link(from, to).catch(() => copyFile(from, to));
}

// ---------- store-backed ----------

type Ids = { profileId: string; channelId: string; episodeId: string };

export type PackageResult = {
  titles: string[];
  thumbs: { file: string; lines: string[]; fontSize: number; bytes: number; overlap: boolean }[];
  recommended: { title: number; thumb: number };
  description: string;
  pinnedComment: string;
  chapters: Chapter[];
  tags: string[];
  hashtags: string[];
  fields: { language: string; category: string; madeForKids: false; syntheticContent: boolean; syntheticRule: string };
  short: { title: string; description: string; hashtags: string[] };
  issues: string[];
};

/**
 * `package_generate`: assembles and checks the package, renders the 3 thumbs (1280×720 JPEG
 * < 2 MB) and writes `package.json` in the episode folder.
 */
export async function generatePackage(store: ChannelStore, ids: Ids, rawInput: PackageInput, options: { bench?: BenchRunner; kit: { gsap: string; fontsDir: string }; signal?: AbortSignal }): Promise<PackageResult> {
  const input = packageInputSchema.parse(rawInput);
  const epDir = store.episodeDir(ids.profileId, ids.channelId, ids.episodeId);
  const [channel, episode, script, research, licenses] = await Promise.all([
    store.getChannel(ids.profileId, ids.channelId),
    store.getEpisode(ids.profileId, ids.channelId, ids.episodeId),
    store.readEpisodeFile(ids.profileId, ids.channelId, ids.episodeId, "script"),
    store.readEpisodeFile(ids.profileId, ids.channelId, ids.episodeId, "research"),
    store.readEpisodeFile(ids.profileId, ids.channelId, ids.episodeId, "licenses"),
  ]);
  if (!script?.beats.length) throw Object.assign(new Error("O episódio ainda não tem roteiro."), { code: "NO_SCRIPT" });
  const issues: string[] = [...checkTitles(input.titles, channel), ...checkTags(input.tags)];
  for (const [i, t] of input.thumbs.entries()) {
    const words = t.lines.join(" ").split(/\s+/).filter(Boolean).length;
    if (words > THUMB.maxWords) issues.push(`Thumb ${i + 1} com ${words} palavras (máximo ${THUMB.maxWords}).`);
  }

  // Chapters from the real section times of the final cut.
  const metas = await readSceneMetas(epDir, script.beats.map((b) => b.id));
  const spans = sectionSpans(script.beats, metas);
  const sectionTitles = Object.fromEntries(script.sections.map((s) => [s.id, s.title]));
  const chapters = chaptersFrom(spans, sectionTitles);
  issues.push(...validateChapters(chapters));

  const used = new Set(script.beats.map((b) => b.id));
  const sources = sourcesSection(research?.facts ?? [], used);
  const credits = creditSections(licenses ?? { schemaVersion: 1, items: [] }, used);
  const commentBeat = script.beats.find((b) => b.cta === "comment");
  const question = input.question ?? commentBeat?.text;
  const sensitive = /\b(saúde|doença|remédio|investimento|finanças|crime|tragédia)\b/i.test(`${channel.niche} ${episode.title}`) ? "Conteúdo informativo; não substitui orientação profissional. Dados de fontes oficiais listadas acima." : undefined;
  const desc = buildDescription({ intro: input.intro, question, chapters, sources, credits, hashtags: input.hashtags, sensitiveNotice: sensitive });
  const pinnedComment = [question, desc.pinnedExtra].filter(Boolean).join("\n\n");
  const generated = (licenses?.items ?? []).some((m) => m.license === "generated" && (m.kind === "photo" || m.kind === "video"));

  // Thumbs.
  const look = lookOf(channel);
  const fmt = formatOf(channel);
  const characterFile = fmt.character?.image ? join(store.channelDir(ids.profileId, ids.channelId), fmt.character.image) : undefined;
  const thumbs: PackageResult["thumbs"] = [];
  const outDir = join(epDir, "out", "thumbs");
  await mkdir(outDir, { recursive: true });
  const items = new Map((licenses?.items ?? []).map((m) => [m.id, m]));
  const work: { directory: string; times: number[]; output: string }[] = [];
  const built: { dir: string; fontSize: number; lines: string[] }[] = [];
  for (const [i, t] of input.thumbs.entries()) {
    const dir = join(epDir, "out", "thumbs", `t${i + 1}`);
    await rm(dir, { recursive: true, force: true });
    await mkdir(join(dir, "fonts"), { recursive: true });
    await mkdir(join(dir, "kit"), { recursive: true });
    // Image: the chosen media, else a photo of a place, else any photo of the episode.
    // Images used only to draw the character are not backgrounds (the character goes on the thumb by itself).
    const photos = script.beats.filter((b) => b.scene.type !== "character" && b.scene.type !== "counter").flatMap((b) => b.scene.media).map((id) => items.get(id)).filter((m) => m?.kind === "photo");
    const media = t.media ? items.get(t.media) : (photos.find((m) => m?.place) ?? photos[0]);
    // Formats with a fixed character (or "rosto+frase" thumbs) put the character on the thumb.
    let character: string | undefined;
    if (characterFile && (fmt.character || channel.bible.thumbStyle.layout === "rosto+frase")) {
      character = `assets/${basename(characterFile)}`;
      await mkdir(join(dir, "assets"), { recursive: true });
      await linkOrCopy(characterFile, join(dir, character));
    }
    let photo: string | undefined;
    // A frame of the episode carries its own text: it goes in blurred, as mood, never competing with the phrase.
    let soft = false;
    if (media) {
      photo = `assets/${basename(media.file)}`;
      await mkdir(join(dir, "assets"), { recursive: true });
      await linkOrCopy(join(epDir, media.file), join(dir, photo));
    } else if (!character) {
      // No photo and no character (custom or text-only formats): a frame of the episode itself,
      // from the middle of the first non-call scene, so the thumb is never an empty background.
      const beat = script.beats.find((b) => !b.cta && b.timing);
      const video = join(epDir, "out", "video.mp4");
      if (beat?.timing && (await stat(video).then(() => true, () => false))) {
        photo = "assets/quadro.jpg";
        soft = true;
        await mkdir(join(dir, "assets"), { recursive: true });
        const at = (beat.timing.start + beat.timing.cut) / 2;
        await ffmpeg(["-y", "-ss", at.toFixed(3), "-i", video, "-frames:v", "1", "-q:v", "3", join(dir, photo)], { signal: options.signal }).catch(() => (photo = undefined));
      }
    }
    const chip = t.chip ?? media?.place;
    const h = thumbHtml({ photo, soft, character, lines: t.lines, chip, look });
    await writeFile(join(dir, "index.html"), withCsp(h.html), "utf8");
    await writeFile(join(dir, "kit", "gsap.min.js"), await readFile(options.kit.gsap));
    await linkOrCopy(join(options.kit.fontsDir, look.display.file), join(dir, "fonts", look.display.file));
    work.push({ directory: dir, times: [0.1], output: join(dir, "shot") });
    built.push({ dir, fontSize: h.fontSize, lines: t.lines });
  }
  if (options.bench) {
    const results = await options.bench(work, { width: THUMB.w, height: THUMB.h, scale: 1, signal: options.signal });
    for (const [i, b] of built.entries()) {
      const frame = results[i]?.frames[0];
      const file = join(outDir, `thumb_${i + 1}.jpg`);
      if (!frame?.file) {
        issues.push(`Thumb ${i + 1} não renderizou: ${results[i]?.errors.join("; ") ?? "sem quadro"}`);
        continue;
      }
      let q = 3;
      await ffmpeg(["-y", "-i", frame.file, "-q:v", String(q), file], { signal: options.signal });
      while ((await stat(file)).size > THUMB.maxBytes && q < 12) await ffmpeg(["-y", "-i", frame.file, "-q:v", String((q += 2)), file], { signal: options.signal });
      const overlap = thumbOverlap(frame.boxes);
      if (overlap) issues.push(`Thumb ${i + 1}: um elemento cobre o texto.`);
      if (b.fontSize < THUMB.minFontPx) issues.push(`Thumb ${i + 1}: letra pequena demais para ler no celular (168×94).`);
      thumbs.push({ file: `out/thumbs/thumb_${i + 1}.jpg`, lines: b.lines, fontSize: b.fontSize, bytes: (await stat(file)).size, overlap });
    }
  }
  const tags = input.tags.map((t) => t.trim());
  const result: PackageResult = {
    titles: input.titles,
    thumbs,
    recommended: { title: input.recommended, thumb: input.recommended },
    description: desc.description,
    pinnedComment,
    chapters,
    tags,
    hashtags: input.hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)),
    fields: {
      language: channel.language,
      category: input.category,
      madeForKids: false,
      syntheticContent: generated,
      syntheticRule: "YouTube (regra conferida em 17/11/2026): marque \"conteúdo alterado ou sintético\" quando houver imagem gerada por IA que pareça real; voz sintética sozinha não exige a marcação.",
    },
    short: shortPackage(input.titles[input.recommended], input.hashtags),
    issues,
  };
  await writeJsonAtomic(join(epDir, "package.json"), result);
  await store.mutateEpisode(ids.profileId, ids.channelId, ids.episodeId, (ep) => {
    ep.outputs.thumbs = thumbs.map((t) => t.file);
  });
  await store.setStage(ids.profileId, ids.channelId, ids.episodeId, "package", issues.length ? { status: "erro", error: issues.slice(0, 3).join(" ") } : { status: "ok", inputHash: String(desc.description.length) });
  return result;
}

/** Short package: short title, one line with the long video's link (filled at publish), same hashtags. */
export function shortPackage(longTitle: string, hashtags: string[]) {
  const title = longTitle.length > 60 ? `${longTitle.slice(0, 57).replace(/\s+\S*$/, "")}…` : longTitle;
  return { title, description: "Vídeo completo no canal: {link_do_longo}", hashtags: hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)) };
}


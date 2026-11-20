import { createHash } from "node:crypto";
import { copyFile, mkdir, rename, stat, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { z } from "zod";
import { mediaItemSchema, type Licenses, type MediaItem } from "../../../src/shared/channel";
import { ALLOWED_LICENSES as OPENVERSE_AUDIO, toMusicResult } from "../music";
import type { ChannelStore } from "./channel-store";
import { readJsonOr, shortRandomId, writeJsonAtomic } from "./fs-json";
import { ffmpeg, ffprobeJson } from "./ffmpeg";
import { applyBeatEdits } from "./script-writer";

/**
 * Media hub (spec "Mídia: fotos, vídeos, música e efeitos"): searches several sources,
 * accepts only licenses that allow commercial use, downloads at the right size and records
 * the license at download time. Credits come from this record, never by hand.
 * Never NC or ND. The license of a pick is re-read from the provider's answer saved at
 * search time — never from the model's arguments.
 */

export type MediaKind = MediaItem["kind"];
export type ProviderId = "commons" | "openverse" | "pexels" | "pixabay" | "incompetech" | "freesound" | "jamendo";
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export const candidateSchema = z.object({
  provider: z.enum(["commons", "openverse", "pexels", "pixabay", "incompetech", "freesound", "jamendo"]),
  kind: z.enum(["photo", "video", "music", "sfx", "icon"]),
  providerId: z.string().max(200),
  title: z.string().max(300),
  author: z.string().max(200),
  license: z.enum(["CC0", "PD", "CC BY", "CC BY-SA", "Pexels", "Pixabay"]),
  licenseVersion: z.string().max(10).optional(),
  licenseUrl: z.string().max(400),
  sourceUrl: z.string().max(1000),
  downloadUrl: z.string().max(2000),
  thumbUrl: z.string().max(2000).optional(),
  width: z.number().int().optional(),
  height: z.number().int().optional(),
  durationSec: z.number().optional(),
});
export type Candidate = z.infer<typeof candidateSchema>;

// ---------- licenses ----------

/** Normalizes a provider license string; undefined = not allowed (NC, ND, GFDL-only, unknown). */
export function normalizeLicense(raw: string | undefined): { license: Candidate["license"]; version?: string } | undefined {
  if (!raw) return;
  const s = raw.trim().toLowerCase().replace(/[_]+/g, " ");
  if (/\bnc\b|non-?commercial|\bnd\b|no-?deriv|noncommercial/.test(s)) return;
  if (/^(cc0|cc-zero|cc zero)|public domain dedication|^cc0 1\.0/.test(s)) return { license: "CC0" };
  if (/public domain|^pd\b|^pdm$|pd-|domínio público/.test(s)) return { license: "PD" };
  const v = s.match(/(\d\.\d)/)?.[1];
  if (/^(cc[- ])?by[- ]sa\b|cc-by-sa/.test(s)) return { license: "CC BY-SA", version: v };
  if (/^(cc[- ])?by\b|cc-by(?!-)/.test(s)) return { license: "CC BY", version: v };
  return;
}

const LICENSE_URL: Record<string, string> = {
  CC0: "https://creativecommons.org/publicdomain/zero/1.0/",
  PD: "https://creativecommons.org/publicdomain/mark/1.0/",
  "CC BY": "https://creativecommons.org/licenses/by/{v}/",
  "CC BY-SA": "https://creativecommons.org/licenses/by-sa/{v}/",
  Pexels: "https://www.pexels.com/license/",
  Pixabay: "https://pixabay.com/service/license-summary/",
};
export function licenseUrlFor(license: Candidate["license"], version = "4.0") {
  return LICENSE_URL[license].replace("{v}", version);
}

const SOURCE_NAME: Record<ProviderId | "user" | "generated", string> = {
  commons: "Wikimedia Commons", openverse: "Openverse", pexels: "Pexels", pixabay: "Pixabay", incompetech: "incompetech.com",
  freesound: "Freesound", jamendo: "Jamendo", user: "acervo do canal", generated: "gerada por IA",
};

/** Ready line for the description. CC BY-SA carries the license notice; incompetech uses its required text. */
export function attributionLine(c: Pick<Candidate, "provider" | "title" | "author" | "license" | "licenseVersion" | "licenseUrl" | "sourceUrl">) {
  if (c.provider === "incompetech")
    return `"${c.title}" Kevin MacLeod (incompetech.com). Licensed under Creative Commons: By Attribution 4.0 License. http://creativecommons.org/licenses/by/4.0/`;
  const who = c.author || "autor desconhecido";
  if (c.license === "Pexels") return `${c.title ? `"${c.title}" — ` : ""}${who} no Pexels (${c.sourceUrl})`;
  if (c.license === "Pixabay") return `${c.title ? `"${c.title}" — ` : ""}${who} no Pixabay (${c.sourceUrl})`;
  const lic = c.license === "CC0" ? "CC0 1.0" : c.license === "PD" ? "domínio público" : `${c.license} ${c.licenseVersion ?? "4.0"}`;
  const notice = c.license === "CC BY-SA" ? `, licenciada sob ${lic} (${c.licenseUrl})` : ` (${lic})`;
  return `"${c.title || "Sem título"}" por ${who}${notice}, via ${SOURCE_NAME[c.provider]}: ${c.sourceUrl}`;
}

// ---------- quality filters ----------

export type Usage = { aspect: "16:9" | "9:16"; place?: string };
/** Spec filters: place photo ≥ 1600 px (landscape in 16:9, portrait ok in 9:16); generic ≥ 1920; video ≥ 1080p; music ≥ 90 s; sfx ≤ 3 s. */
export function passesQuality(c: Candidate, usage: Usage): boolean {
  const w = c.width ?? 0;
  const h = c.height ?? 0;
  if (c.kind === "photo") {
    if (usage.aspect === "16:9" && h > w) return false;
    const long = Math.max(w, h);
    return usage.place ? long >= 1600 : long >= 1920;
  }
  if (c.kind === "video") return Math.min(w, h) >= 1080;
  if (c.kind === "music") return (c.durationSec ?? 0) >= 90;
  if (c.kind === "sfx") return (c.durationSec ?? 99) <= 3;
  return true;
}

// ---------- HTTP with backoff ----------

export type HttpOptions = { fetch?: FetchLike; sleep?: (ms: number) => Promise<void>; maxAttempts?: number; onWait?: (seconds: number, host: string) => void; signal?: AbortSignal };
const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const UA = "Videosell/0.9 (channel studio; https://github.com/Mathpcastro/videosell-release)";

/** Spec: Wikimedia answers 429 after a few requests → pause 2–10 s, backoff up to 6 attempts. */
export async function fetchWithBackoff(url: string, init: RequestInit = {}, options: HttpOptions = {}): Promise<Response> {
  const doFetch = options.fetch ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const max = options.maxAttempts ?? 6;
  for (let attempt = 1; ; attempt++) {
    const res = await doFetch(url, { ...init, signal: options.signal, headers: { "user-agent": UA, ...(init.headers as Record<string, string> | undefined) } });
    if (res.status !== 429 && res.status !== 503) return res;
    if (attempt >= max)
      throw Object.assign(new Error(`${new URL(url).hostname} limitou os downloads. Tente de novo em alguns minutos.`), { code: "MEDIA_RATE_LIMIT" });
    const retryAfter = Number(res.headers.get("retry-after"));
    const seconds = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 60) : Math.min(10, 2 * 2 ** (attempt - 1));
    options.onWait?.(seconds, new URL(url).hostname);
    await sleep(seconds * 1000);
  }
}

async function getJson(url: string, init: RequestInit, options: HttpOptions) {
  const res = await fetchWithBackoff(url, init, options);
  if (res.status === 401 || res.status === 403) throw Object.assign(new Error(`A chave de ${new URL(url).hostname} foi recusada. Confira em Configurações.`), { code: "MEDIA_AUTH" });
  if (!res.ok) throw Object.assign(new Error(`${new URL(url).hostname} respondeu ${res.status}.`), { code: "MEDIA_FAILED" });
  return (await res.json()) as Record<string, unknown>;
}

const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : undefined);
const stripHtml = (s: string) => s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();

// ---------- providers ----------

export async function searchCommons(query: string, kind: "photo" | "video", options: HttpOptions & { limit?: number } = {}): Promise<Candidate[]> {
  const params = new URLSearchParams({
    action: "query", format: "json", formatversion: "2", origin: "*",
    generator: "search", gsrnamespace: "6", gsrlimit: String(options.limit ?? 12),
    gsrsearch: `${query} filetype:${kind === "photo" ? "bitmap" : "video"}`,
    prop: "imageinfo", iiprop: "url|extmetadata|size|mime", iiurlwidth: "1920",
    iiextmetadatafilter: "LicenseShortName|Artist|LicenseUrl|ObjectName|UsageTerms",
  });
  const data = await getJson(`https://commons.wikimedia.org/w/api.php?${params}`, {}, options);
  const pages = ((data.query as { pages?: Record<string, unknown>[] } | undefined)?.pages ?? []).sort((a, b) => (num(a.index) ?? 0) - (num(b.index) ?? 0));
  const out: Candidate[] = [];
  for (const p of pages) {
    const info = (p.imageinfo as Record<string, unknown>[] | undefined)?.[0];
    if (!info) continue;
    const meta = (info.extmetadata ?? {}) as Record<string, { value?: string }>;
    const lic = normalizeLicense(meta.LicenseShortName?.value ?? meta.UsageTerms?.value);
    if (!lic) continue;
    const pageid = num(p.pageid);
    const title = stripHtml(meta.ObjectName?.value ?? str(p.title).replace(/^File:/, "").replace(/\.[a-z0-9]+$/i, ""));
    out.push({
      provider: "commons",
      kind,
      // Spec: the exact title can differ from what search shows (truncated) → pageid.
      providerId: String(pageid ?? str(p.title)),
      title,
      author: stripHtml(meta.Artist?.value ?? "").slice(0, 200) || "autor desconhecido",
      license: lic.license,
      licenseVersion: lic.version,
      licenseUrl: meta.LicenseUrl?.value || licenseUrlFor(lic.license, lic.version),
      sourceUrl: pageid ? `https://commons.wikimedia.org/?curid=${pageid}` : str(info.descriptionurl),
      // Thumbnails through the API for photos (never the 20 MB original); videos need the file.
      downloadUrl: kind === "photo" ? str(info.thumburl) || str(info.url) : str(info.url),
      thumbUrl: str(info.thumburl) || undefined,
      width: kind === "photo" ? (num(info.thumbwidth) ?? num(info.width)) : num(info.width),
      height: kind === "photo" ? (num(info.thumbheight) ?? num(info.height)) : num(info.height),
    });
  }
  return out;
}

export async function searchOpenverseImages(query: string, options: HttpOptions & { limit?: number } = {}): Promise<Candidate[]> {
  const params = new URLSearchParams({ q: query.slice(0, 200), license: "cc0,pdm,by,by-sa", license_type: "commercial", page_size: String(options.limit ?? 12) });
  const data = await getJson(`https://api.openverse.org/v1/images/?${params}`, {}, options);
  const out: Candidate[] = [];
  for (const r of (data.results as Record<string, unknown>[]) ?? []) {
    const lic = normalizeLicense(`${str(r.license)} ${str(r.license_version)}`.trim());
    if (!lic || !/^https:\/\//.test(str(r.url))) continue;
    out.push({
      provider: "openverse", kind: "photo", providerId: str(r.id), title: str(r.title) || "Sem título", author: str(r.creator) || "autor desconhecido",
      license: lic.license, licenseVersion: str(r.license_version) || lic.version, licenseUrl: str(r.license_url) || licenseUrlFor(lic.license, lic.version),
      sourceUrl: str(r.foreign_landing_url) || str(r.url), downloadUrl: str(r.url), thumbUrl: str(r.thumbnail) || undefined, width: num(r.width), height: num(r.height),
    });
  }
  return out;
}

/** Pexels: the HD link is not the first one → pick the largest width ≤ 3840. */
export function pickPexelsFile(files: { width?: number; height?: number; link?: string; file_type?: string }[]) {
  return files
    .filter((f) => f.link && (f.file_type ?? "video/mp4") === "video/mp4" && (f.width ?? 0) <= 3840)
    .sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0];
}

export async function searchPexels(query: string, kind: "photo" | "video", apiKey: string, options: HttpOptions & { limit?: number; aspect?: "16:9" | "9:16" } = {}): Promise<Candidate[]> {
  const orientation = options.aspect === "9:16" ? "portrait" : "landscape";
  const params = new URLSearchParams({ query, per_page: String(options.limit ?? 12), orientation });
  const base = kind === "photo" ? "https://api.pexels.com/v1/search" : "https://api.pexels.com/videos/search";
  const data = await getJson(`${base}?${params}`, { headers: { authorization: apiKey } }, options);
  if (kind === "photo")
    return ((data.photos as Record<string, unknown>[]) ?? []).map((p) => {
      const src = (p.src ?? {}) as Record<string, string>;
      const w = num(p.width) ?? 0;
      const h = num(p.height) ?? 0;
      // `large2x` is ~1880 wide; ask the image CDN for 1920 on the long side.
      const download = src.original ? `${src.original}?auto=compress&cs=tinysrgb&${w >= h ? "w" : "h"}=1920` : src.large2x;
      const scale = Math.min(1, 1920 / Math.max(w, h, 1));
      return { provider: "pexels" as const, kind: "photo" as const, providerId: String(p.id), title: str(p.alt), author: str(p.photographer) || "autor desconhecido", license: "Pexels" as const, licenseUrl: licenseUrlFor("Pexels"), sourceUrl: str(p.url), downloadUrl: download, thumbUrl: src.medium, width: Math.round(w * scale), height: Math.round(h * scale) };
    });
  const out: Candidate[] = [];
  for (const v of (data.videos as Record<string, unknown>[]) ?? []) {
    const file = pickPexelsFile((v.video_files as { width?: number; height?: number; link?: string; file_type?: string }[]) ?? []);
    if (!file?.link) continue;
    out.push({ provider: "pexels", kind: "video", providerId: String(v.id), title: "", author: str((v.user as Record<string, unknown> | undefined)?.name) || "autor desconhecido", license: "Pexels", licenseUrl: licenseUrlFor("Pexels"), sourceUrl: str(v.url), downloadUrl: file.link, thumbUrl: str(v.image) || undefined, width: file.width, height: file.height, durationSec: num(v.duration) });
  }
  return out;
}

export async function searchPixabay(query: string, kind: "photo" | "video", apiKey: string, options: HttpOptions & { limit?: number; aspect?: "16:9" | "9:16" } = {}): Promise<Candidate[]> {
  const params = new URLSearchParams({ key: apiKey, q: query.slice(0, 100), per_page: String(Math.max(3, options.limit ?? 12)), safesearch: "true" });
  if (kind === "photo") {
    params.set("image_type", "photo");
    params.set("orientation", options.aspect === "9:16" ? "vertical" : "horizontal");
  }
  const data = await getJson(`https://pixabay.com/api/${kind === "video" ? "videos/" : ""}?${params}`, {}, options);
  const out: Candidate[] = [];
  for (const h of (data.hits as Record<string, unknown>[]) ?? []) {
    if (kind === "photo") {
      const full = str(h.fullHDURL);
      const iw = num(h.imageWidth) ?? 0;
      const ih = num(h.imageHeight) ?? 0;
      const scale = full ? Math.min(1, 1920 / Math.max(iw, ih, 1)) : Math.min(1, 1280 / Math.max(iw, ih, 1));
      out.push({ provider: "pixabay", kind, providerId: String(h.id), title: str(h.tags), author: str(h.user) || "autor desconhecido", license: "Pixabay", licenseUrl: licenseUrlFor("Pixabay"), sourceUrl: str(h.pageURL), downloadUrl: full || str(h.largeImageURL), thumbUrl: str(h.previewURL) || undefined, width: Math.round(iw * scale), height: Math.round(ih * scale) });
    } else {
      const videos = (h.videos ?? {}) as Record<string, { url?: string; width?: number; height?: number }>;
      const best = [videos.large, videos.medium].find((v) => v?.url);
      if (!best?.url) continue;
      out.push({ provider: "pixabay", kind, providerId: String(h.id), title: str(h.tags), author: str(h.user) || "autor desconhecido", license: "Pixabay", licenseUrl: licenseUrlFor("Pixabay"), sourceUrl: str(h.pageURL), downloadUrl: best.url, width: best.width, height: best.height, durationSec: num(h.duration) });
    }
  }
  return out;
}

const INCOMPETECH = "https://incompetech.com/music/royalty-free/";
export function parseLength(s: string) {
  const parts = s.split(":").map(Number);
  if (parts.some((n) => !Number.isFinite(n))) return undefined;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}
let incompetechCache: { at: number; pieces: Record<string, unknown>[] } | undefined;
/** incompetech (Kevin MacLeod, CC BY 4.0): catalog of ~1,400 pieces filtered by feel, genre and instruments. */
export async function searchIncompetech(query: string, options: HttpOptions & { limit?: number; minSeconds?: number } = {}): Promise<Candidate[]> {
  if (!incompetechCache || Date.now() - incompetechCache.at > 24 * 3600_000) {
    const res = await fetchWithBackoff(`${INCOMPETECH}pieces.json`, {}, options);
    if (!res.ok) throw Object.assign(new Error(`incompetech respondeu ${res.status}.`), { code: "MEDIA_FAILED" });
    incompetechCache = { at: Date.now(), pieces: (await res.json()) as Record<string, unknown>[] };
  }
  const words = query.toLowerCase().split(/[^\p{L}\d]+/u).filter((w) => w.length > 2);
  return incompetechCache.pieces
    .map((p) => ({ p, hay: `${str(p.title)} ${str(p.feel)} ${str(p.instruments)} ${str(p.description)}`.toLowerCase() }))
    .map(({ p, hay }) => ({ p, score: words.filter((w) => hay.includes(w)).length }))
    .filter((x) => x.score > 0 || !words.length)
    .sort((a, b) => b.score - a.score)
    .map(({ p }) => ({
      provider: "incompetech" as const, kind: "music" as const, providerId: str(p.filename), title: str(p.title), author: "Kevin MacLeod",
      license: "CC BY" as const, licenseVersion: "4.0", licenseUrl: "http://creativecommons.org/licenses/by/4.0/",
      sourceUrl: `https://incompetech.com/music/royalty-free/index.html?isrc=${encodeURIComponent(str(p.isrc))}`,
      downloadUrl: `${INCOMPETECH}mp3-royaltyfree/${encodeURIComponent(str(p.filename))}`, durationSec: parseLength(str(p.length)),
    }))
    .filter((c) => (c.durationSec ?? 0) >= (options.minSeconds ?? 90))
    .slice(0, options.limit ?? 12);
}

/** Openverse audio (Jamendo music, Freesound effects) through the existing `music.ts` mapping. */
export async function searchOpenverseAudio(query: string, kind: "music" | "sfx", options: HttpOptions & { limit?: number } = {}): Promise<Candidate[]> {
  const params = new URLSearchParams({ q: query.slice(0, 200), license: kind === "sfx" ? "cc0" : OPENVERSE_AUDIO.join(","), page_size: String(options.limit ?? 12) });
  if (kind === "sfx") params.set("source", "freesound");
  else params.set("category", "music");
  const data = await getJson(`https://api.openverse.org/v1/audio/?${params}`, {}, options);
  const out: Candidate[] = [];
  for (const raw of (data.results as Parameters<typeof toMusicResult>[0][]) ?? []) {
    const r = toMusicResult(raw);
    const lic = normalizeLicense(`${raw.license} ${raw.license_version ?? ""}`.trim());
    if (!r || !lic) continue;
    out.push({ provider: kind === "sfx" ? "freesound" : "jamendo", kind, providerId: r.id, title: r.title, author: r.creator, license: lic.license, licenseVersion: raw.license_version, licenseUrl: r.licenseUrl || licenseUrlFor(lic.license, lic.version), sourceUrl: r.page ?? r.url, downloadUrl: r.url, durationSec: r.duration });
  }
  return out;
}

// ---------- search orchestration ----------

export type Keys = { pexels?: string; pixabay?: string };
/**
 * Spec order: place photo → Commons, Openverse; generic photo → Pexels, Pixabay (keys), then
 * Commons/Openverse; video → Pexels, Pixabay, Commons; music → incompetech, Jamendo; sfx → Freesound.
 * Returns 4 to 8 candidates that pass the quality filter.
 */
export async function searchMedia(query: string, kind: MediaKind, usage: Usage, keys: Keys = {}, options: HttpOptions & { want?: number } = {}) {
  const want = options.want ?? 8;
  const tries: Array<() => Promise<Candidate[]>> = [];
  if (kind === "photo") {
    if (usage.place) tries.push(() => searchCommons(query, "photo", options), () => searchOpenverseImages(query, options));
    if (keys.pexels) tries.push(() => searchPexels(query, "photo", keys.pexels!, { ...options, aspect: usage.aspect }));
    if (keys.pixabay) tries.push(() => searchPixabay(query, "photo", keys.pixabay!, { ...options, aspect: usage.aspect }));
    if (!usage.place) tries.push(() => searchCommons(query, "photo", options), () => searchOpenverseImages(query, options));
  } else if (kind === "video") {
    if (keys.pexels) tries.push(() => searchPexels(query, "video", keys.pexels!, { ...options, aspect: usage.aspect }));
    if (keys.pixabay) tries.push(() => searchPixabay(query, "video", keys.pixabay!, options));
    tries.push(() => searchCommons(query, "video", options));
  } else if (kind === "music") tries.push(() => searchIncompetech(query, options), () => searchOpenverseAudio(query, "music", options));
  else if (kind === "sfx") tries.push(() => searchOpenverseAudio(query, "sfx", options));
  const out: Candidate[] = [];
  const errors: string[] = [];
  for (const t of tries) {
    if (out.length >= want) break;
    try {
      for (const c of await t()) if (passesQuality(c, usage) && !out.some((o) => o.downloadUrl === c.downloadUrl)) out.push(c);
    } catch (error) {
      if ((error as { code?: string }).code === "MEDIA_RATE_LIMIT" && !out.length && t === tries.at(-1)) throw error;
      errors.push((error as Error).message);
    }
  }
  return { candidates: out.slice(0, want), errors };
}

// ---------- download & prepare ----------

/** Global cache by URL: the same clip in two episodes is downloaded once. */
export async function downloadCached(url: string, cacheDir: string, options: HttpOptions = {}) {
  const ext = (extname(new URL(url).pathname).toLowerCase().match(/^\.[a-z0-9]{2,5}$/)?.[0]) ?? ".bin";
  const file = join(cacheDir, `${createHash("sha1").update(url).digest("hex")}${ext}`);
  try {
    if ((await stat(file)).size > 0) return { file, cached: true };
  } catch {
    /* not cached yet */
  }
  await mkdir(cacheDir, { recursive: true });
  const res = await fetchWithBackoff(url, {}, options);
  if (!res.ok) throw Object.assign(new Error(`Download falhou (${new URL(url).hostname} ${res.status}).`), { code: "MEDIA_DOWNLOAD" });
  const bytes = new Uint8Array(await res.arrayBuffer());
  const tmp = `${file}.${Date.now()}.partial`;
  await writeFile(tmp, bytes);
  await rename(tmp, file);
  return { file, cached: false };
}

/** Video: up to 14 s, no audio, 1920×1080 or 1080×1920 (crop to fill), 30 fps, H.264 CRF 22. */
export async function prepareVideo(input: string, output: string, aspect: "16:9" | "9:16", options: { maxSeconds?: number; signal?: AbortSignal } = {}) {
  const [w, h] = aspect === "16:9" ? [1920, 1080] : [1080, 1920];
  await ffmpeg(["-y", "-i", input, "-t", String(options.maxSeconds ?? 14), "-an", "-vf", `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},fps=30,format=yuv420p`, "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-movflags", "+faststart", output], options);
  return output;
}

/** Music: the original MP3 plus a seamless loop (the end crossfades into the start). */
export async function prepareMusicLoop(input: string, output: string, options: { fadeSeconds?: number; signal?: AbortSignal } = {}) {
  const d = options.fadeSeconds ?? 2;
  // Two reads of the same file: `asplit` + `acrossfade` stalls (the fade waits for the whole first input).
  await ffmpeg(["-y", "-i", input, "-i", input, "-filter_complex", `[1:a]atrim=0:${d},asetpts=PTS-STARTPTS[head];[0:a][head]acrossfade=d=${d}:c1=tri:c2=tri,atrim=start=${d},asetpts=PTS-STARTPTS[out]`, "-map", "[out]", "-c:a", "libmp3lame", "-q:a", "2", output], options);
  return output;
}

export async function probeDims(file: string) {
  const info = await ffprobeJson(file);
  const v = info.streams.find((s) => s.codec_type === "video");
  return { width: v?.width, height: v?.height, durationSec: info.format?.duration ? Number(info.format.duration) : undefined };
}

/** Contact sheet of candidates (spec: 4 to 8 per beat), 4 per row, 480×270 each, in candidate order. */
export async function contactSheet(images: string[], output: string, options: { signal?: AbortSignal } = {}) {
  if (!images.length) throw new Error("Sem candidatas para a folha de contato.");
  const cols = Math.min(4, images.length);
  const rows = Math.ceil(images.length / cols);
  const inputs = images.flatMap((f) => ["-i", f]);
  const scaled = images.map((_, i) => `[${i}:v]scale=480:270:force_original_aspect_ratio=decrease,pad=480:270:(ow-iw)/2:(oh-ih)/2:color=0x111111,setsar=1[v${i}]`);
  const pads = Array.from({ length: cols * rows - images.length }, (_, i) => `color=c=0x111111:s=480x270:d=1[p${i}]`);
  const labels = [...images.map((_, i) => `[v${i}]`), ...pads.map((_, i) => `[p${i}]`)];
  const layout = labels.map((_, i) => `${(i % cols) * 480}_${Math.floor(i / cols) * 270}`).join("|");
  const graph = [...scaled, ...pads, `${labels.join("")}xstack=inputs=${labels.length}:layout=${layout}[out]`].join(";");
  await ffmpeg(["-y", ...inputs, "-filter_complex", graph, "-map", "[out]", "-frames:v", "1", output], options);
  return output;
}

// ---------- store-backed ----------

type Ids = { profileId: string; channelId: string; episodeId: string };
const candidatesFile = (store: ChannelStore, ids: Ids) => join(store.episodeDir(ids.profileId, ids.channelId, ids.episodeId), "media", "candidates.json");
const candidatesSchema = z.record(z.string(), z.object({ query: z.string(), kind: z.string(), at: z.string(), candidates: z.array(candidateSchema), sheet: z.string().optional() }));

export function emptyLicenses(): Licenses {
  return { schemaVersion: 1, items: [] };
}

/** `media_search` for one beat: candidates are saved so the pick re-reads the license from here. */
export async function searchForBeat(store: ChannelStore, ids: Ids, beatId: string, options: { kind?: MediaKind; query?: string; keys?: Keys; http?: HttpOptions; sheet?: boolean } = {}) {
  const script = await store.readEpisodeFile(ids.profileId, ids.channelId, ids.episodeId, "script");
  const beat = script?.beats.find((b) => b.id === beatId);
  if (!beat) throw Object.assign(new Error(`A fala ${beatId} não existe.`), { code: "BEAT_NOT_FOUND" });
  const episode = await store.getEpisode(ids.profileId, ids.channelId, ids.episodeId);
  const query = (options.query ?? beat.scene.query ?? beat.text).slice(0, 200);
  const kind = options.kind ?? (beat.scene.type === "video" ? "video" : "photo");
  const { candidates, errors } = await searchMedia(query, kind, { aspect: episode.aspect, place: beat.scene.place }, options.keys, options.http);
  let sheet: string | undefined;
  if (options.sheet && candidates.length && (kind === "photo" || kind === "video")) {
    try {
      const thumbs = [];
      for (const c of candidates) thumbs.push((await downloadCached(c.thumbUrl ?? c.downloadUrl, join(store.userDir, "media-cache", "thumbs"), options.http)).file);
      sheet = await contactSheet(thumbs, join(store.episodeDir(ids.profileId, ids.channelId, ids.episodeId), "media", `sheet_${beatId}.jpg`));
    } catch (error) {
      errors.push(`Folha de contato: ${(error as Error).message}`);
    }
  }
  const file = candidatesFile(store, ids);
  const all = candidatesSchema.catch({}).parse(await readJsonOr(file, () => ({})));
  all[beatId] = { query, kind, at: new Date().toISOString(), candidates, sheet };
  await writeJsonAtomic(file, all);
  return { beatId, query, kind, candidates: candidates.map((c, i) => ({ index: i, provider: c.provider, title: c.title, author: c.author, license: c.license, width: c.width, height: c.height, durationSec: c.durationSec, thumbUrl: c.thumbUrl })), sheet, errors };
}

/**
 * `media_pick`: downloads candidate `index` saved for the beat, prepares it, registers the
 * license (`licenses.json`) and puts the media on the beat's scene. `place` is set only when
 * the agent confirms the image really is from that place (the place tag is sacred).
 */
export async function pickForBeat(store: ChannelStore, ids: Ids, beatId: string, index: number, options: { place?: string; role?: "main" | "bgVideo" | "sticker"; http?: HttpOptions; prepare?: boolean; signal?: AbortSignal } = {}) {
  const all = candidatesSchema.catch({}).parse(await readJsonOr(candidatesFile(store, ids), () => ({})));
  const c = all[beatId]?.candidates[index];
  if (!c) throw Object.assign(new Error(`Não há candidata ${index} para a fala ${beatId}. Rode media_search antes.`), { code: "MEDIA_NOT_FOUND" });
  const episode = await store.getEpisode(ids.profileId, ids.channelId, ids.episodeId);
  const item = await registerCandidate(store, ids, c, { usedIn: [beatId], place: options.place, aspect: episode.aspect, http: options.http, prepare: options.prepare, signal: options.signal });
  const script = await store.readEpisodeFile(ids.profileId, ids.channelId, ids.episodeId, "script");
  const beat = script?.beats.find((b) => b.id === beatId);
  if (script && beat) {
    const role = options.role ?? "main";
    const scene = role === "bgVideo" ? { ...beat.scene, bgVideo: item.id } : role === "sticker" ? { ...beat.scene, stickers: [...(beat.scene.stickers ?? []), item.id].slice(-6) } : { ...beat.scene, media: [...beat.scene.media.filter((m) => m !== item.id), item.id].slice(-12), place: options.place ?? beat.scene.place };
    const { script: next } = applyBeatEdits(script, [{ op: "update", id: beatId, patch: { scene } }]);
    await store.writeEpisodeFile(ids.profileId, ids.channelId, ids.episodeId, "script", next);
  }
  return item;
}

/** Downloads and registers one candidate (also used for music and sfx, which belong to no beat). */
export async function registerCandidate(store: ChannelStore, ids: Ids, c: Candidate, options: { usedIn?: string[]; place?: string; aspect: "16:9" | "9:16"; http?: HttpOptions; prepare?: boolean; signal?: AbortSignal }) {
  const parsed = candidateSchema.parse(c);
  if (!normalizeLicense(parsed.license) && parsed.license !== "Pexels" && parsed.license !== "Pixabay") throw Object.assign(new Error("Licença sem uso comercial."), { code: "MEDIA_LICENSE" });
  const existing = (await store.readEpisodeFile(ids.profileId, ids.channelId, ids.episodeId, "licenses"))?.items.find((i) => i.source === parsed.provider && i.sourceUrl === parsed.sourceUrl);
  if (existing) {
    return store
      .mutateEpisodeFile(ids.profileId, ids.channelId, ids.episodeId, "licenses", emptyLicenses, (l) => {
        const it = l.items.find((i) => i.id === existing.id)!;
        it.usedIn = [...new Set([...it.usedIn, ...(options.usedIn ?? [])])];
        if (options.place) it.place = options.place;
      })
      .then((l) => l.items.find((i) => i.id === existing.id)!);
  }
  const { file: cached } = await downloadCached(parsed.downloadUrl, join(store.userDir, "media-cache"), { ...options.http, signal: options.signal });
  const dir = join(store.episodeDir(ids.profileId, ids.channelId, ids.episodeId), "media");
  await mkdir(dir, { recursive: true });
  const id = shortRandomId("m", 6);
  let file = join(dir, `${id}${extname(cached) || ".bin"}`);
  let dims: { width?: number; height?: number; durationSec?: number } = { width: parsed.width, height: parsed.height, durationSec: parsed.durationSec };
  if (parsed.kind === "video" && options.prepare !== false) {
    file = join(dir, `${id}.mp4`);
    await prepareVideo(cached, file, options.aspect, { signal: options.signal });
    dims = await probeDims(file);
  } else {
    await copyFile(cached, file);
    if (parsed.kind === "music" && options.prepare !== false) await prepareMusicLoop(file, join(dir, `${id}.loop.mp3`), { signal: options.signal });
  }
  const item = mediaItemSchema.parse({
    id,
    kind: parsed.kind,
    file: `media/${basename(file)}`,
    source: parsed.provider,
    sourceUrl: parsed.sourceUrl,
    author: parsed.author,
    license: parsed.license,
    licenseUrl: parsed.licenseUrl,
    attribution: attributionLine(parsed),
    width: dims.width,
    height: dims.height,
    durationSec: dims.durationSec,
    place: options.place,
    title: parsed.title,
    usedIn: options.usedIn ?? [],
  });
  await store.mutateEpisodeFile(ids.profileId, ids.channelId, ids.episodeId, "licenses", emptyLicenses, (l) => {
    l.items.push(item);
  });
  return item;
}

/** A file the user brings (their own photo or video): license "user", credited to the channel. */
export async function registerUserMedia(store: ChannelStore, ids: Ids, input: { file: string; kind: MediaKind; author?: string; place?: string; usedIn?: string[] }) {
  const dir = join(store.episodeDir(ids.profileId, ids.channelId, ids.episodeId), "media");
  await mkdir(dir, { recursive: true });
  const id = shortRandomId("m", 6);
  const target = join(dir, `${id}${extname(input.file).toLowerCase()}`);
  await copyFile(input.file, target);
  const item = mediaItemSchema.parse({ id, kind: input.kind, file: `media/${id}${extname(input.file).toLowerCase()}`, source: "user", sourceUrl: "", author: input.author ?? "", license: "user", licenseUrl: "", attribution: "", place: input.place, usedIn: input.usedIn ?? [] });
  await store.mutateEpisodeFile(ids.profileId, ids.channelId, ids.episodeId, "licenses", emptyLicenses, (l) => {
    l.items.push(item);
  });
  return item;
}

/** Credits for the description, grouped; only media that is actually used (by a beat or as music/sfx). */
export function creditSections(licenses: Licenses, usedBeatIds?: Set<string>) {
  const used = licenses.items.filter((i) => i.attribution && (i.kind === "music" || i.kind === "sfx" || !usedBeatIds || i.usedIn.some((b) => usedBeatIds.has(b))));
  const uniq = (xs: string[]) => [...new Set(xs)];
  return {
    FOTOS: uniq(used.filter((i) => i.kind === "photo" || i.kind === "icon").map((i) => i.attribution)),
    "VÍDEOS": uniq(used.filter((i) => i.kind === "video").map((i) => i.attribution)),
    "MÚSICA": uniq(used.filter((i) => i.kind === "music").map((i) => i.attribution)),
    EFEITOS: uniq(used.filter((i) => i.kind === "sfx" && i.license !== "CC0").map((i) => i.attribution)),
  };
}

/** Every media item a beat uses must exist in the license record (QA and packager use this). */
export function missingLicenses(script: { beats: { id: string; scene: { media: string[]; bgVideo?: string; stickers?: string[] } }[] }, licenses: Licenses) {
  const known = new Set(licenses.items.map((i) => i.id));
  return script.beats.flatMap((b) => [...b.scene.media, ...(b.scene.bgVideo ? [b.scene.bgVideo] : []), ...(b.scene.stickers ?? [])].filter((m) => !known.has(m)).map((m) => ({ beatId: b.id, mediaId: m })));
}

export async function readCandidates(store: ChannelStore, ids: Ids) {
  return candidatesSchema.catch({}).parse(await readJsonOr(candidatesFile(store, ids), () => ({})));
}

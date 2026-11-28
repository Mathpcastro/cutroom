import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ChannelStore } from "../electron/core/channel/channel-store";
import { ffmpeg, ffprobeJson } from "../electron/core/channel/ffmpeg";

async function probeDims(file: string) {
  const info = await ffprobeJson(file);
  const v = info.streams.find((s) => s.codec_type === "video");
  const [n, d] = (v?.r_frame_rate ?? "0/1").split("/").map(Number);
  return { width: v?.width, height: v?.height, audio: info.streams.some((s) => s.codec_type === "audio"), fps: v ? Math.round(n / d) : undefined, durationSec: Number(info.format?.duration ?? 0) };
}
import {
  attributionLine,
  contactSheet,
  creditSections,
  downloadCached,
  fetchWithBackoff,
  missingLicenses,
  normalizeLicense,
  passesQuality,
  pickForBeat,
  pickPexelsFile,
  prepareMusicLoop,
  prepareVideo,
  registerCandidate,
  searchCommons,
  searchForBeat,
  searchIncompetech,
  searchMedia,
  searchOpenverseImages,
  searchPexels,
  searchPixabay,
  type Candidate,
} from "../electron/core/channel/media-hub";
import { saveScript } from "../electron/core/channel/script-writer";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});
async function tmp() {
  const d = await mkdtemp(join(tmpdir(), "channel-media-"));
  roots.push(d);
  return d;
}
const noSleep = async () => undefined;

const commonsAnswer = {
  query: {
    pages: [
      { pageid: 6742838, index: 1, title: "File:Boa Viagem Niterói.JPG", imageinfo: [{ width: 3648, height: 2736, thumburl: "https://upload.wikimedia.org/thumb/1920px-a.jpg", thumbwidth: 1920, thumbheight: 1440, url: "https://upload.wikimedia.org/a.JPG", descriptionurl: "https://commons.wikimedia.org/wiki/File:a", extmetadata: { LicenseShortName: { value: "CC BY-SA 4.0" }, Artist: { value: '<a href="x">Halley Pacheco</a>' }, LicenseUrl: { value: "https://creativecommons.org/licenses/by-sa/4.0" }, ObjectName: { value: "Boa Viagem Niterói" } } }] },
      { pageid: 2, index: 2, title: "File:b.jpg", imageinfo: [{ width: 4000, height: 3000, thumburl: "https://upload.wikimedia.org/b.jpg", thumbwidth: 1920, thumbheight: 1440, url: "https://upload.wikimedia.org/b.jpg", extmetadata: { LicenseShortName: { value: "CC BY-NC 2.0" } } }] },
      { pageid: 3, index: 3, title: "File:c.jpg", imageinfo: [{ width: 800, height: 600, thumburl: "https://upload.wikimedia.org/c.jpg", thumbwidth: 800, thumbheight: 600, url: "https://upload.wikimedia.org/c.jpg", extmetadata: { LicenseShortName: { value: "Public domain" } } }] },
    ],
  },
};

describe("licenses", () => {
  it("accepts only commercial licenses and never NC or ND", () => {
    expect(normalizeLicense("CC BY-SA 4.0")).toEqual({ license: "CC BY-SA", version: "4.0" });
    expect(normalizeLicense("cc-by-2.0")).toEqual({ license: "CC BY", version: "2.0" });
    expect(normalizeLicense("by 3.0")).toEqual({ license: "CC BY", version: "3.0" });
    expect(normalizeLicense("CC0")).toEqual({ license: "CC0" });
    expect(normalizeLicense("Public domain")).toEqual({ license: "PD" });
    expect(normalizeLicense("pdm")).toEqual({ license: "PD" });
    for (const bad of ["CC BY-NC 2.0", "CC BY-ND 4.0", "CC BY-NC-SA 3.0", "by-nc", "GFDL", "All rights reserved", undefined]) expect(normalizeLicense(bad)).toBeUndefined();
  });

  it("writes the attribution each license requires", () => {
    const base = { title: "Boa Viagem", author: "Halley", sourceUrl: "https://commons.wikimedia.org/?curid=1" };
    expect(attributionLine({ ...base, provider: "commons", license: "CC BY-SA", licenseVersion: "4.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0" })).toBe('"Boa Viagem" por Halley, licenciada sob CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0), via Wikimedia Commons: https://commons.wikimedia.org/?curid=1');
    expect(attributionLine({ ...base, provider: "incompetech", license: "CC BY", licenseUrl: "" })).toContain("Kevin MacLeod (incompetech.com). Licensed under Creative Commons: By Attribution 4.0 License");
    expect(attributionLine({ ...base, provider: "pexels", license: "Pexels", licenseUrl: "", title: "" })).toBe("Halley no Pexels (https://commons.wikimedia.org/?curid=1)");
  });
});

describe("providers", () => {
  it("Commons: uses pageid, thumbnails at 1920 and drops NC", async () => {
    const urls: string[] = [];
    const out = await searchCommons("Niterói", "photo", { fetch: async (u) => (urls.push(u), Response.json(commonsAnswer)) });
    expect(urls[0]).toContain("iiurlwidth=1920");
    expect(out.map((c) => c.providerId)).toEqual(["6742838", "3"]);
    expect(out[0]).toMatchObject({ author: "Halley Pacheco", license: "CC BY-SA", downloadUrl: "https://upload.wikimedia.org/thumb/1920px-a.jpg", sourceUrl: "https://commons.wikimedia.org/?curid=6742838", width: 1920 });
  });

  it("Openverse images: commercial filter and license mapping", async () => {
    const out = await searchOpenverseImages("ponte", { fetch: async (u) => {
      expect(u).toContain("license_type=commercial");
      return Response.json({ results: [{ id: "x", title: "Ponte", creator: "Ana", license: "by", license_version: "2.0", url: "https://live.staticflickr.com/a.jpg", foreign_landing_url: "https://flickr.com/a", width: 2048, height: 1365 }, { id: "y", license: "by-nc", url: "https://a.jpg" }] });
    } });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ license: "CC BY", licenseVersion: "2.0", sourceUrl: "https://flickr.com/a" });
  });

  it("Pexels: picks the largest file ≤ 3840, not the first", async () => {
    expect(pickPexelsFile([{ width: 640, height: 360, link: "sd" }, { width: 3840, height: 2160, link: "uhd" }, { width: 5120, height: 2880, link: "5k" }, { width: 1920, height: 1080, link: "hd" }])?.link).toBe("uhd");
    const out = await searchPexels("trânsito", "video", "k", { fetch: async (_u, init) => {
      expect((init?.headers as Record<string, string>).authorization).toBe("k");
      return Response.json({ videos: [{ id: 1, url: "https://pexels.com/v/1", user: { name: "João" }, duration: 20, video_files: [{ width: 640, height: 360, link: "https://v/sd.mp4", file_type: "video/mp4" }, { width: 1920, height: 1080, link: "https://v/hd.mp4", file_type: "video/mp4" }] }] });
    } });
    expect(out[0]).toMatchObject({ downloadUrl: "https://v/hd.mp4", width: 1920, author: "João", license: "Pexels" });
  });

  it("Pixabay: full HD when available, otherwise 1280 (dropped by the quality filter)", async () => {
    const out = await searchPixabay("praia", "photo", "k", { fetch: async () => Response.json({ hits: [{ id: 1, pageURL: "https://pixabay.com/p/1", user: "u", tags: "praia", imageWidth: 6000, imageHeight: 4000, largeImageURL: "https://p/l.jpg" }] }) });
    expect(out[0]).toMatchObject({ width: 1280, downloadUrl: "https://p/l.jpg" });
    expect(passesQuality(out[0], { aspect: "16:9" })).toBe(false);
  });

  it("incompetech: searches feel/instruments and keeps pieces ≥ 90 s", async () => {
    const pieces = [
      { title: "Tense Song", filename: "Tense Song.mp3", length: "00:03:10", feel: "Tense, Suspenseful", instruments: "Piano", description: "", isrc: "US1" },
      { title: "Short Jingle", filename: "Short.mp3", length: "00:00:40", feel: "Tense", instruments: "Piano", description: "", isrc: "US2" },
      { title: "Happy", filename: "Happy.mp3", length: "00:02:00", feel: "Bright", instruments: "Ukulele", description: "", isrc: "US3" },
    ];
    const out = await searchIncompetech("tense piano", { fetch: async () => Response.json(pieces) });
    expect(out.map((c) => c.title)).toEqual(["Tense Song"]);
    expect(out[0]).toMatchObject({ license: "CC BY", durationSec: 190, downloadUrl: "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Tense%20Song.mp3" });
  });

  it("quality filters follow the spec", () => {
    const photo = (w: number, h: number): Candidate => ({ provider: "commons", kind: "photo", providerId: "1", title: "", author: "", license: "CC0", licenseUrl: "", sourceUrl: "", downloadUrl: "", width: w, height: h });
    expect(passesQuality(photo(1600, 1067), { aspect: "16:9", place: "Niterói" })).toBe(true);
    expect(passesQuality(photo(1600, 1067), { aspect: "16:9" })).toBe(false);
    expect(passesQuality(photo(1080, 1620), { aspect: "16:9", place: "x" })).toBe(false);
    expect(passesQuality(photo(1080, 1620), { aspect: "9:16", place: "x" })).toBe(true);
    expect(passesQuality({ ...photo(640, 360), kind: "video" }, { aspect: "16:9" })).toBe(false);
    expect(passesQuality({ ...photo(0, 0), kind: "music", durationSec: 60 }, { aspect: "16:9" })).toBe(false);
    expect(passesQuality({ ...photo(0, 0), kind: "sfx", durationSec: 2 }, { aspect: "16:9" })).toBe(true);
  });

  it("orders sources: place photos start at Commons; generic photos at Pexels", async () => {
    const calls: string[] = [];
    const fake = async (u: string) => {
      calls.push(new URL(u).hostname);
      if (u.includes("pexels")) return Response.json({ photos: [] });
      if (u.includes("openverse")) return Response.json({ results: [] });
      return Response.json(commonsAnswer);
    };
    await searchMedia("Niterói", "photo", { aspect: "16:9", place: "Niterói" }, { pexels: "k" }, { fetch: fake, want: 8 });
    expect(calls[0]).toBe("commons.wikimedia.org");
    calls.length = 0;
    await searchMedia("chaves", "photo", { aspect: "16:9" }, { pexels: "k" }, { fetch: fake, want: 8 });
    expect(calls[0]).toBe("api.pexels.com");
  });
});

describe("HTTP backoff and cache", () => {
  it("retries 429 up to 6 times then gives a clear error", async () => {
    let n = 0;
    const waits: number[] = [];
    const ok = await fetchWithBackoff("https://upload.wikimedia.org/x", {}, { sleep: noSleep, onWait: (s) => waits.push(s), fetch: async () => (++n < 3 ? new Response("", { status: 429 }) : new Response("ok")) });
    expect(await ok.text()).toBe("ok");
    expect(waits).toEqual([2, 4]);
    await expect(fetchWithBackoff("https://upload.wikimedia.org/x", {}, { sleep: noSleep, fetch: async () => new Response("", { status: 429 }) })).rejects.toMatchObject({ code: "MEDIA_RATE_LIMIT" });
  });

  it("downloads the same URL once (global cache)", async () => {
    const dir = await tmp();
    let calls = 0;
    const fetch = async () => (calls++, new Response(new Uint8Array([1, 2, 3])));
    const a = await downloadCached("https://x.com/a/photo.JPG?x=1", dir, { fetch });
    const b = await downloadCached("https://x.com/a/photo.JPG?x=1", dir, { fetch });
    expect(a.file).toBe(b.file);
    expect(a.file.endsWith(".jpg")).toBe(true);
    expect(b.cached).toBe(true);
    expect(calls).toBe(1);
  });
});

describe("prepare with FFmpeg", () => {
  it("cuts a video to ≤ 14 s, 1920×1080, 30 fps, no audio", async () => {
    const dir = await tmp();
    const src = join(dir, "src.mp4");
    await ffmpeg(["-y", "-f", "lavfi", "-i", "testsrc=size=1280x720:rate=25:duration=16", "-f", "lavfi", "-i", "sine=duration=16", "-shortest", "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", src]);
    const out = await prepareVideo(src, join(dir, "out.mp4"), "16:9");
    const info = await probeDims(out);
    expect(info).toMatchObject({ width: 1920, height: 1080, audio: false, fps: 30 });
    expect(info.durationSec).toBeLessThanOrEqual(14.05);
    const vert = await prepareVideo(src, join(dir, "v.mp4"), "9:16", { maxSeconds: 2 });
    expect(await probeDims(vert)).toMatchObject({ width: 1080, height: 1920 });
  }, 60_000);

  it("makes a music loop shorter by the crossfade, and a contact sheet", async () => {
    const dir = await tmp();
    const src = join(dir, "m.mp3");
    await ffmpeg(["-y", "-f", "lavfi", "-i", "sine=frequency=220:duration=10", "-c:a", "libmp3lame", src]);
    const loop = await prepareMusicLoop(src, join(dir, "m.loop.mp3"));
    const d = (await probeDims(loop)).durationSec ?? 0;
    expect(d).toBeGreaterThan(7.5);
    expect(d).toBeLessThan(8.5);
    const imgs = [];
    for (let i = 0; i < 5; i++) {
      const f = join(dir, `t${i}.jpg`);
      await ffmpeg(["-y", "-f", "lavfi", "-i", `color=c=0x${(i * 40).toString(16).padStart(2, "0")}8844:s=640x${i % 2 ? 480 : 360}`, "-frames:v", "1", f]);
      imgs.push(f);
    }
    const sheet = await contactSheet(imgs, join(dir, "sheet.jpg"));
    expect(await probeDims(sheet)).toMatchObject({ width: 1920, height: 540 });
  }, 60_000);
});

describe("store-backed media", () => {
  async function episode() {
    const dir = await tmp();
    const store = new ChannelStore(dir);
    const c = await store.createChannel("default", { name: "Canal" });
    const ep = await store.createEpisode("default", c.id, { title: "Niterói" });
    const ids = { profileId: "default", channelId: c.id, episodeId: ep.id };
    await saveScript(store, ids, { beats: [
      { section: "gancho", text: "Niterói vista do alto.", scene: { type: "photo", data: {}, media: [], query: "Niterói vista aérea", place: "Niterói" } },
      { section: "contexto", text: "Chaves na mão.", scene: { type: "photo", data: {}, media: [], query: "chaves" } },
    ] });
    return { store, ids };
  }

  it("searches for a beat, picks by index (license re-read from the saved answer) and records credits", async () => {
    const { store, ids } = await episode();
    const fetch = async (u: string) => (u.includes("commons.wikimedia.org/w/api.php") ? Response.json(commonsAnswer) : u.includes("openverse") ? Response.json({ results: [] }) : new Response(new Uint8Array([255, 216, 255, 0])));
    const found = await searchForBeat(store, ids, "b_001", { http: { fetch } });
    expect(found.candidates.map((c) => c.license)).toEqual(["CC BY-SA"]);
    const item = await pickForBeat(store, ids, "b_001", 0, { place: "Niterói", http: { fetch } });
    expect(item).toMatchObject({ source: "commons", license: "CC BY-SA", place: "Niterói", usedIn: ["b_001"] });
    expect((await stat(join(store.episodeDir(ids.profileId, ids.channelId, ids.episodeId), item.file))).size).toBe(4);
    const script = await store.readEpisodeFile(ids.profileId, ids.channelId, ids.episodeId, "script");
    expect(script?.beats[0].scene.media).toEqual([item.id]);
    // Picking the same file for another beat reuses the record.
    const again = await registerCandidate(store, ids, JSON.parse(await readFile(join(store.episodeDir(ids.profileId, ids.channelId, ids.episodeId), "media", "candidates.json"), "utf8")).b_001.candidates[0], { usedIn: ["b_002"], aspect: "16:9", http: { fetch } });
    expect(again.id).toBe(item.id);
    expect(again.usedIn).toEqual(["b_001", "b_002"]);
    const licenses = (await store.readEpisodeFile(ids.profileId, ids.channelId, ids.episodeId, "licenses"))!;
    expect(creditSections(licenses).FOTOS).toEqual([item.attribution]);
    expect(missingLicenses(script!, licenses)).toEqual([]);
    expect(missingLicenses({ beats: [{ id: "b_009", scene: { media: ["m_zzzzzz"] } }] }, licenses)).toEqual([{ beatId: "b_009", mediaId: "m_zzzzzz" }]);
    await expect(pickForBeat(store, ids, "b_002", 3)).rejects.toMatchObject({ code: "MEDIA_NOT_FOUND" });
  });
});

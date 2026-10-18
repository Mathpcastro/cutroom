import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import {
  applyCommand,
  createProject,
  timelineWords,
  validateProject,
} from "../electron/core/project";
import { createAss, ffmpegPath } from "../electron/core/media";
import {
  CAPTION_PRESETS,
  captionAssParts,
  captionTimelineWords,
  createCaptionAss,
  groupCaptionWords,
  resolveCaptionSettings,
} from "../src/shared/captions";
import type { CaptionSettings } from "../src/shared/captions";

const exec = promisify(execFile);
function fixture() {
  const p = createProject();
  p.media = [
    {
      id: "source",
      name: "Source",
      path: "C:/source.mp4",
      duration: 8,
      width: 960,
      height: 540,
      fps: 30,
      hasAudio: true,
    },
  ];
  p.clips = [
    {
      id: "clip",
      mediaId: "source",
      start: 0,
      end: 8,
      speed: 1,
      zoom: 1,
      muted: false,
    },
  ];
  p.words = ["Sua", "voz", "em", "foco.", "Legendas", "com", "intenção."].map(
    (text, i) => ({
      text,
      mediaId: "source",
      start: 0.1 + i * 0.32,
      end: 0.38 + i * 0.32,
    }),
  );
  p.settings.width = 960;
  p.settings.height = 540;
  p.settings.captions = true;
  return p;
}
describe("shared ASS caption engine", () => {
  it("loads old projects and applies validated immutable full or partial styles", () => {
    const old = fixture();
    expect(validateProject(old).settings.captionStyle).toBeUndefined();
    expect(resolveCaptionSettings().maxWords).toBe(5);
    const selected = applyCommand(old, {
      name: "captions",
      args: { enabled: true, style: { presetId: "word-bounce" } },
    });
    expect(selected.settings.captionStyle).toMatchObject({
      mode: "word",
      fontFamily: "Anton",
      position: "center",
      animation: "bounce",
    });
    const custom = applyCommand(selected, {
      name: "captions",
      args: { enabled: true, style: { fontSize: 126, color: "#AADDCC" } },
    });
    expect(custom.settings.captionStyle).toMatchObject({
      fontSize: 126,
      color: "#AADDCC",
      position: "center",
    });
    expect(selected.settings.captionStyle?.fontSize).toBe(118);
    expect(old.settings.captionStyle).toBeUndefined();
    expect(
      validateProject(JSON.parse(JSON.stringify(custom))).settings.captionStyle,
    ).toEqual(custom.settings.captionStyle);
  });
  it("rejects malformed, injected and out-of-range styles before persistence", () => {
    for (const style of [
      { presetId: "fake" },
      { fontFamily: "Bad,Font" },
      { fontSize: NaN },
      { fontSize: 1000 },
      { maxWords: 2.5 },
      { backgroundOpacity: -1 },
      { animation: "invalid" },
      { color: "red" },
      { backgroundColor: "{\\p1}" },
      { bold: "yes" },
      { unknown: true },
      null,
    ])
      expect(() =>
        applyCommand(fixture(), {
          name: "captions",
          args: { enabled: true, style },
        }),
      ).toThrow();
  });
  it("maps speed, cropped words, repeated hooks and mute consistently and never joins cut boundaries", () => {
    const p = fixture();
    p.clips = [
      { ...p.clips[0], id: "hook", start: 0.2, end: 0.8 },
      { ...p.clips[0], id: "main", start: 0.1, end: 1, speed: 2 },
      { ...p.clips[0], id: "muted", start: 1, end: 2, muted: true },
    ];
    const mapped = captionTimelineWords(p);
    expect(mapped[0].start).toBe(0);
    expect(mapped.filter((w) => w.text === "Sua")).toHaveLength(2);
    expect(mapped.find((w) => w.clipId === "main")!.start).toBeCloseTo(0.6);
    expect(mapped.some((w) => w.clipId === "muted")).toBe(false);
    expect(timelineWords(p)).toEqual(mapped);
    const groups = groupCaptionWords(
      mapped,
      resolveCaptionSettings({ maxWords: 16 }),
    );
    expect(
      groups.every(
        (group) => new Set(group.map((word) => word.clipId)).size === 1,
      ),
    ).toBe(true);
  });
  it("has 24 distinct styles, meaningful modes, timed transforms, real karaoke and escaped text", () => {
    const p = fixture();
    expect(CAPTION_PRESETS.length).toBeGreaterThanOrEqual(24);
    expect(new Set(CAPTION_PRESETS.map((p) => p.id)).size).toBe(
      CAPTION_PRESETS.length,
    );
    expect(new Set(CAPTION_PRESETS.map((p) => p.settings.mode)).size).toBe(7);
    const scripts = CAPTION_PRESETS.map((preset) => {
      p.settings.captionStyle = preset.settings;
      return createCaptionAss(p);
    });
    expect(new Set(scripts).size).toBe(CAPTION_PRESETS.length);
    p.settings.captionStyle = resolveCaptionSettings({ presetId: "karaoke" });
    expect(createCaptionAss(p)).toContain("\\kf28");
    p.settings.captionStyle = resolveCaptionSettings({
      presetId: "word-bounce",
    });
    expect(createCaptionAss(p)).toContain("\\move(");
    expect(createCaptionAss(p)).not.toMatch(/\\pos\([^}]+\\move/);
    p.settings.captionStyle = resolveCaptionSettings({
      presetId: "build-up-top",
    });
    const cumulative = captionAssParts(p).events;
    expect(cumulative[0]).toContain("\\fad(");
    expect(cumulative[1]).not.toContain("\\fad(");
    expect(cumulative[2]).not.toContain("\\move(");
    p.settings.captionStyle = resolveCaptionSettings({
      presetId: "word-bounce",
    });
    p.words[0].text = "{\\pos(0,0)}\\N";
    const ass = createCaptionAss(p);
    expect(ass).toContain("｛＼POS(0,0)｝＼N");
    expect(ass).not.toContain("{\\pos(0,0)}");
  });
  it("uses the exact caption style/events in preview and mixed-overlay export ASS", () => {
    const p = fixture(),
      words = captionTimelineWords(p);
    for (const preset of CAPTION_PRESETS) {
      p.settings.captionStyle = preset.settings;
      const { style, events } = captionAssParts(p, words),
        preview = createCaptionAss(p, words),
        exported = createAss(p, words);
      expect(exported).toContain("Style: Default,Barlow,");
      expect(exported).toContain(style);
      expect(preview).toContain(style);
      for (const event of events) {
        expect(exported).toContain(event);
        expect(preview).toContain(event);
      }
    }
    p.settings.captions = false;
    expect(captionAssParts(p).events).toEqual([]);
  });
  it("rasterizes every preset through real FFmpeg/libass with offline bundled fonts", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "cutroom-caption-test-"));
    const p = fixture(),
      hashes = new Set<string>();
    const fonts = path.resolve("resources/fonts").replace(/\\/g, "/");
    // Use a relative trusted copy to avoid drive-colon FFmpeg filter escaping.
    const { cp } = await import("node:fs/promises");
    await cp(fonts, path.join(dir, "fonts"), { recursive: true });
    try {
      for (const preset of CAPTION_PRESETS) {
        p.settings.captionStyle = preset.settings;
        await writeFile(path.join(dir, "caption.ass"), createCaptionAss(p));
        // .90 is within the third word, beyond intentional entrance fades at .74.
        const { stdout, stderr } = await exec(
          ffmpegPath,
          [
            "-hide_banner",
            "-loglevel",
            "info",
            "-f",
            "lavfi",
            "-i",
            "color=c=black:s=960x540:r=30:d=2",
            "-vf",
            "ass=filename=caption.ass:fontsdir=fonts",
            "-ss",
            "0.90",
            "-frames:v",
            "1",
            "-f",
            "rawvideo",
            "-pix_fmt",
            "rgb24",
            "pipe:1",
          ],
          { cwd: dir, encoding: "buffer", maxBuffer: 5_000_000 },
        );
        expect(stderr.toString(), preset.id).not.toMatch(
          /failed to find|Error initializing|fontselect: failed/i,
        );
        let colored = 0;
        for (let i = 0; i < stdout.length; i += 3)
          if (Math.max(stdout[i], stdout[i + 1], stdout[i + 2]) > 60) colored++;
        expect(colored, preset.id).toBeGreaterThan(180);
        hashes.add(createHash("sha256").update(stdout).digest("hex"));
      }
      expect(hashes.size).toBe(CAPTION_PRESETS.length);
      // Genuine timed behavior: same ASS track yields visibly different frames as speech advances.
      for (const id of [
        "studio-highlight",
        "karaoke",
        "typewriter",
        "build-up",
        "word-bounce",
      ]) {
        p.settings.captionStyle = resolveCaptionSettings({ presetId: id });
        await writeFile(path.join(dir, "caption.ass"), createCaptionAss(p));
        const frames: Buffer[] = [];
        for (const time of ["0.30", "0.90"]) {
          const { stdout } = await exec(
            ffmpegPath,
            [
              "-hide_banner",
              "-loglevel",
              "error",
              "-f",
              "lavfi",
              "-i",
              "color=c=black:s=960x540:r=30:d=2",
              "-vf",
              "ass=filename=caption.ass:fontsdir=fonts",
              "-ss",
              time,
              "-frames:v",
              "1",
              "-f",
              "rawvideo",
              "-pix_fmt",
              "rgb24",
              "pipe:1",
            ],
            { cwd: dir, encoding: "buffer", maxBuffer: 5_000_000 },
          );
          frames.push(stdout);
        }
        expect(frames[0].equals(frames[1]), id).toBe(false);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60000);
});

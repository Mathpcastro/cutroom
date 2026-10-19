import { describe, it, expect } from "vitest";
import {
  applyCommand,
  createProject,
  validateProject,
} from "../electron/core/project";
import { motionCacheKey } from "../electron/core/motion-document";
import { motionLocalTime, motionExportSegments } from "../src/shared/motions";

function fixture() {
  const p = createProject();
  p.media = [
    {
      id: "m",
      name: "fixture.mp4",
      path: "C:/fixture.mp4",
      duration: 12,
      width: 1920,
      height: 1080,
      fps: 30,
      hasAudio: true,
    },
  ];
  p.clips = [
    {
      id: "c",
      mediaId: "m",
      start: 0,
      end: 12,
      speed: 1,
      zoom: 1,
      muted: false,
    },
  ];
  return p;
}
const scene = () =>
  applyCommand(fixture(), {
    name: "motion",
    args: { start: 1, end: 7, presetId: "title", text: "Uma ideia" },
  });
describe("portable HyperFrames scenes", () => {
  it("opens projects created before animation support", () => {
    const p = fixture();
    delete p.motions;
    expect(validateProject(p).motions).toEqual([]);
  });
  it("adds, changes and removes scenes without modifying original footage", () => {
    const p = scene(),
      first = p.motions![0];
    const changed = applyCommand(p, {
      name: "motion",
      args: { id: first.id, text: "Outra ideia" },
    });
    expect(changed.motions![0].html).toContain("Outra ideia");
    expect(p.motions![0].text).toBe("Uma ideia");
    expect(changed.media).toEqual(p.media);
    expect(
      applyCommand(changed, { name: "delete_motion", args: { id: first.id } })
        .motions,
    ).toEqual([]);
  });
  it("preserves animation phase and rate across cuts and speed changes", () => {
    const p = applyCommand(scene(), {
      name: "remove_range",
      args: { mediaId: "m", start: 3, end: 5 },
    });
    expect(p.motions).toHaveLength(2);
    expect(motionLocalTime(p.motions![1], 3)).toBeCloseTo(4);
    const faster = applyCommand(p, { name: "speed", args: { factor: 2 } });
    expect(motionLocalTime(faster.motions![1], 1.5)).toBeCloseTo(4);
    expect(faster.motions![1].playbackRate).toBe(2);
  });
  it.each([
    "<script>alert(1)</script>",
    '<div onclick="alert(1)">X</div>',
    '<iframe src="file:///C:/test"></iframe>',
    "<style>div{background:url(https://example.com)}</style><div>x</div>",
    '<style>@import "x";</style><div>x</div>',
    '<svg><use href="#x"/></svg>',
  ])("rejects executable/external scene content: %s", (html) => {
    expect(() =>
      applyCommand(fixture(), {
        name: "motion",
        args: { start: 0, end: 2, html, animations: [] },
      }),
    ).toThrow();
  });
  it("rejects executable tween properties and out of bounds timing", () => {
    expect(() =>
      applyCommand(fixture(), {
        name: "motion",
        args: {
          start: 0,
          end: 2,
          html: '<div class="box">X</div>',
          animations: [
            {
              selector: ".box",
              start: 0,
              duration: 1,
              to: { onComplete: "evil" },
            },
          ],
        },
      }),
    ).toThrow();
    expect(() =>
      applyCommand(fixture(), {
        name: "motion",
        args: { start: 0, end: 13, presetId: "title", text: "X" },
      }),
    ).toThrow();
  });
  it("caches authored content but invalidates changes in output dimensions, timing or color", () => {
    const p = scene(),
      s = p.motions![0],
      key = motionCacheKey(s, p.settings);
    expect(
      motionCacheKey({ ...s, id: "new-id", start: 4, end: 10 }, p.settings),
    ).toBe(key);
    expect(motionCacheKey({ ...s, duration: 7 }, p.settings)).not.toBe(key);
    expect(motionCacheKey(s, { ...p.settings, width: 1280 })).not.toBe(key);
    expect(motionCacheKey(s, { ...p.settings, fps: 60 })).not.toBe(key);
  });
  it("aligns animation phase with frame-rounded clips at export", () => {
    const p = scene();
    p.clips = Array.from({ length: 20 }, (_, i) => ({
      ...p.clips[0],
      id: String(i),
      start: i * 0.501,
      end: (i + 1) * 0.501,
    }));
    const s = { ...p.motions![0], start: 2.1, end: 7.1, duration: 5 };
    const segments = motionExportSegments(s, p);
    expect(segments[0].start).toBeCloseTo((2.1 * 0.5) / 0.501);
    const last = segments.at(-1)!;
    expect(last.end).toBeCloseTo((7.1 * 0.5) / 0.501);
    expect(
      last.sourceOffset + (last.end - last.start) * last.playbackRate,
    ).toBeCloseTo(5);
  });
  it("converts preset to custom without inheriting the old layout", () => {
    const p = scene();
    const edited = applyCommand(p, {
      name: "motion",
      args: {
        id: p.motions![0].id,
        html: '<div class="custom">Custom</div>',
        animations: [],
      },
    });
    expect(edited.motions![0].presetId).toBeUndefined();
    expect(edited.motions![0].html).toContain("Custom");
  });
  it("edits a cut custom scene without restarting or truncating its authored clock", () => {
    let p = applyCommand(fixture(), {
      name: "motion",
      args: {
        start: 1,
        end: 7,
        html: '<div class="box">Uma ideia</div>',
        animations: [
          { selector: ".box", start: 5, duration: 1, to: { opacity: 0 } },
        ],
      },
    });
    p = applyCommand(p, {
      name: "remove_range",
      args: { mediaId: "m", start: 3, end: 5 },
    });
    const segment = p.motions![1];
    p = applyCommand(p, {
      name: "motion",
      args: { id: segment.id, name: "Nome ajustado", start: 5, end: 8 },
    });
    const edited = p.motions!.find((s) => s.id === segment.id)!;
    expect(edited.duration).toBe(6);
    expect(motionLocalTime(edited, 5)).toBe(4);
    expect(motionLocalTime(edited, 8)).toBe(6);
  });
});

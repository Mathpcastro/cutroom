import { describe, expect, it } from "vitest";
import {
  applyCommand,
  createProject,
  projectDuration,
  timelineWords,
  validateProject,
} from "../electron/core/project";
import type { Project } from "../src/shared/types";

function fixture(): Project {
  const p = createProject();
  p.media = [
    {
      id: "source",
      name: "Aula.mp4",
      path: "C:/Aula.mp4",
      duration: 10,
      width: 1920,
      height: 1080,
      fps: 30,
      hasAudio: true,
    },
  ];
  p.clips = [
    {
      id: "clip",
      mediaId: "source",
      start: 0,
      end: 10,
      speed: 1,
      zoom: 1,
      muted: false,
    },
  ];
  p.words = [
    { mediaId: "source", text: "Isso", start: 0.1, end: 0.4 },
    { mediaId: "source", text: "é", start: 0.5, end: 0.8 },
    { mediaId: "source", text: "bom", start: 0.9, end: 1.2 },
    { mediaId: "source", text: "né", start: 2, end: 2.3 },
    { mediaId: "source", text: "ééé", start: 3, end: 3.4 },
  ];
  return p;
}

describe("project domain", () => {
  it("validates source bounds and rejects malformed project settings", () => {
    const p = fixture();
    p.clips[0].end = 11;
    expect(() => validateProject(p)).toThrow(/Fim/);
    expect(() => validateProject(null)).toThrow(/inválido/);
    expect(() =>
      validateProject({
        ...fixture(),
        settings: { ...fixture().settings, width: 1919 },
      }),
    ).toThrow(/par/);
    expect(() =>
      validateProject({
        ...fixture(),
        media: [fixture().media[0], fixture().media[0]],
      }),
    ).toThrow(/duplicados/);
  });
  it("removes a middle source range immutably with unique clip IDs and exact edges", () => {
    const p = fixture(),
      result = applyCommand(p, {
        name: "remove_range",
        args: { clipId: "clip", start: 2, end: 4 },
      });
    expect(result.clips.map((c) => [c.start, c.end])).toEqual([
      [0, 2],
      [4, 10],
    ]);
    expect(new Set(result.clips.map((c) => c.id)).size).toBe(2);
    expect(p.clips[0].end).toBe(10);
    expect(projectDuration(result)).toBe(8);
    expect(
      applyCommand(p, { name: "remove_range", args: { start: 0, end: 10 } })
        .clips,
    ).toEqual([]);
  });
  it("rejects invalid cuts, empty trims, invalid speed and edge splits", () => {
    for (const args of [
      { start: -1, end: 4 },
      { start: 4, end: 2 },
      { start: 1, end: 11 },
    ])
      expect(() =>
        applyCommand(fixture(), { name: "remove_range", args }),
      ).toThrow();
    expect(() =>
      applyCommand(fixture(), {
        name: "trim",
        args: { clipId: "clip", start: 2, end: 2 },
      }),
    ).toThrow();
    expect(() =>
      applyCommand(fixture(), { name: "speed", args: { factor: 0 } }),
    ).toThrow();
    expect(() =>
      applyCommand(fixture(), {
        name: "split",
        args: { clipId: "clip", time: 10 },
      }),
    ).toThrow();
  });
  it("maps word times through cut/speed and repeated hook source ranges", () => {
    let p = applyCommand(fixture(), { name: "speed", args: { factor: 2 } });
    p = applyCommand(p, {
      name: "hook",
      args: { mediaId: "source", start: 0, end: 1.3 },
    });
    expect(projectDuration(p)).toBeCloseTo(6.3);
    const isso = timelineWords(p).filter((w) => w.text === "Isso");
    expect(isso.map((w) => w.start)).toEqual([0.1, 1.35]);
    expect(isso[1].end).toBeCloseTo(1.5);
    p = applyCommand(p, {
      name: "speed",
      args: { clipId: p.clips[0].id, factor: 4, muted: true },
    });
    expect(timelineWords(p).filter((w) => w.text === "Isso")).toHaveLength(1);
  });
  it("moves a hook without duplicating its source range and shifts overlays", () => {
    let p = applyCommand(fixture(), {
      name: "overlay",
      args: { kind: "title", text: "Exemplo", start: 0, end: 1 },
    });
    p = applyCommand(p, {
      name: "hook",
      args: { mediaId: "source", start: 2, end: 4, move: true },
    });
    expect(p.clips.map((c) => [c.start, c.end])).toEqual([
      [2, 4],
      [0, 2],
      [4, 10],
    ]);
    expect(projectDuration(p)).toBe(10);
    expect(p.overlays[0].start).toBe(2);
  });
  it("preserves grammatical é and tipo de while removing clear fillers", () => {
    const p = fixture();
    p.words.push(
      { mediaId: "source", text: "tipo", start: 5, end: 5.2 },
      { mediaId: "source", text: "de", start: 5.3, end: 5.5 },
    );
    const result = applyCommand(p, { name: "remove_fillers", args: {} });
    const kept = timelineWords(result).map((w) => w.text);
    expect(kept).toContain("é");
    expect(kept).toContain("tipo");
    expect(kept).not.toContain("né");
    expect(kept).not.toContain("ééé");
  });
  it("retains 160ms of breath on detected pauses, with bounded output motions", () => {
    let p = applyCommand(fixture(), {
      name: "remove_silence",
      args: { ranges: [{ mediaId: "source", start: 4, end: 5 }] },
    });
    expect(projectDuration(p)).toBeCloseTo(9.16);
    p = applyCommand(p, {
      name: "overlay",
      args: { kind: "callout", text: "Pronto", start: 8, end: 9 },
    });
    p = applyCommand(p, { name: "speed", args: { factor: 16 } });
    expect(p.overlays[0].start).toBeCloseTo(0.5);
    expect(p.overlays[0].end).toBeCloseTo(9 / 16);
  });
  it("keeps motions anchored to source content through preceding cuts, split and speed", () => {
    let p = applyCommand(fixture(), {
      name: "overlay",
      args: { kind: "statement", text: "Conteúdo", start: 5, end: 8 },
    });
    p = applyCommand(p, { name: "remove_range", args: { start: 1, end: 3 } });
    expect([p.overlays[0].start, p.overlays[0].end]).toEqual([3, 6]);
    p = applyCommand(p, {
      name: "split",
      args: { clipId: p.clips[1].id, time: 6 },
    });
    expect([p.overlays[0].start, p.overlays[0].end]).toEqual([3, 6]);
    p = applyCommand(p, {
      name: "speed",
      args: { clipId: p.clips[1].id, factor: 2 },
    });
    expect([p.overlays[0].start, p.overlays[0].end]).toEqual([2, 4.5]);
    p = applyCommand(p, { name: "remove_range", args: { start: 5, end: 8 } });
    expect(p.overlays).toEqual([]);
  });
  it("restores portrait orientation and source FPS on reset", () => {
    const p = fixture();
    p.media[0].width = 1080;
    p.media[0].height = 1920;
    p.media[0].fps = 60;
    const result = applyCommand(p, { name: "reset", args: {} });
    expect(result.settings.width).toBe(1080);
    expect(result.settings.height).toBe(1920);
    expect(result.settings.fps).toBe(60);
  });
});

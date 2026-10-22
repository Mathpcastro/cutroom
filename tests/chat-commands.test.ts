import { describe, expect, it } from "vitest";
import {
  CHAT_COMMANDS,
  parseSlashCommand,
  commandDefaults,
  findChatCommand,
  filterChatCommands,
} from "../src/shared/chat-commands";
import {
  createProject,
  applyCommand,
  projectDuration,
  validateProject,
} from "../electron/core/project";
import {
  applyNativeChatCommand,
  resolveChatCommand,
  chatCommandRequest,
} from "../electron/core/chat-commands";
import { motionLocalTime } from "../src/shared/motions";

function fixture() {
  const p = createProject();
  p.media = [
    {
      id: "media",
      name: "fixture.mp4",
      path: "C:/fixture.mp4",
      duration: 12,
      width: 640,
      height: 360,
      fps: 30,
      hasAudio: true,
    },
  ];
  p.clips = [
    {
      id: "clip",
      mediaId: "media",
      start: 0,
      end: 12,
      speed: 1,
      zoom: 1,
      muted: false,
    },
  ];
  p.words = [{ mediaId: "media", text: "Ideia", start: 1, end: 1.5 }];
  return p;
}
describe("editing chat commands", () => {
  it("uses one searchable catalog with unique IDs and real execution kinds", () => {
    expect(CHAT_COMMANDS).toHaveLength(38);
    expect(new Set(CHAT_COMMANDS.map((c) => c.id)).size).toBe(38);
    expect(
      filterChatCommands("cinema").some((c) => c.id === "modo-cinema"),
    ).toBe(true);
    expect(filterChatCommands("transcricao").length).toBeGreaterThan(0);
    expect(findChatCommand("/cinema")?.id).toBe("modo-cinema");
  });
  it("ranks actual slash IDs above matches in explanatory prose", () => {
    expect(filterChatCommands("/zo")[0].id).toBe("zoom");
    expect(filterChatCommands("/cinema")[0].id).toBe("modo-cinema");
    expect(filterChatCommands("/transcricao")[0].id).toBe("transcrever");
  });
  it("parses slash arguments, quoted labels, accents, aliases, comma decimals and ranges", () => {
    expect(parseSlashCommand('/titulo "Uma ideia" --inicio 2 --fim=5')).toEqual(
      { id: "titulo", options: { text: "Uma ideia", start: 2, end: 5 } },
    );
    expect(parseSlashCommand("/zoom 1,4 --de 2 --até 5")).toEqual({
      id: "zoom",
      options: { amount: 1.4, start: 2, end: 5 },
    });
    expect(
      parseSlashCommand("/lista-check Planejar | Gravar | Publicar")?.options
        .items,
    ).toEqual(["Planejar", "Gravar", "Publicar"]);
    expect(parseSlashCommand("/dividir 3")?.options.start).toBe(3);
    expect(parseSlashCommand("edite este vídeo")).toBeNull();
    expect(parseSlashCommand("/titulo Gota d'água")?.options.text).toBe(
      "Gota d'água",
    );
  });
  it.each([
    "/comando-inexistente",
    "/zoom --inicio",
    "/zoom --valor NaN",
    "/zoom --foo 2",
    '/titulo "sem fechar',
    "/zoom 2 --valor 3",
    "/normalizar --inicio 2",
    "/pb texto",
    "/titulo X --itens Y",
  ])("rejects malformed or ambiguous command %s", (s) =>
    expect(() => parseSlashCommand(s)).toThrow(),
  );
  it("defaults to playhead or selected clip in output seconds", () => {
    const p = applyCommand(fixture(), {
      name: "split",
      args: { clipId: "clip", time: 6 },
    });
    p.clips[0].speed = 2;
    expect(
      commandDefaults(findChatCommand("zoom")!, p, { time: 4 }),
    ).toMatchObject({ start: 4, end: 8, amount: 1.25 });
    expect(
      commandDefaults(findChatCommand("zoom")!, p, {
        time: 4,
        selectedId: p.clips[0].id,
      }),
    ).toMatchObject({ start: 0, end: 3 });
    expect(
      commandDefaults(findChatCommand("timelapse")!, p, { time: 4 }),
    ).toMatchObject({ start: 3, end: 9 });
  });
  it("rejects invalid IPC options and intervals before changing the project", () => {
    const p = fixture();
    expect(() =>
      chatCommandRequest.parse({ id: "zoom", options: { script: "x" } }),
    ).toThrow();
    expect(() =>
      resolveChatCommand("zoom", p, { start: 1, end: 20 }),
    ).toThrow();
    expect(() => resolveChatCommand("zoom", p, { amount: 9 })).toThrow();
    expect(() => resolveChatCommand("normalizar", p, { amount: 3 })).toThrow();
    expect(() => resolveChatCommand("titulo", p, { text: "" })).toThrow();
    expect(() => resolveChatCommand("lista-check", p, { items: [] })).toThrow();
    expect(p.clips).toHaveLength(1);
  });
  it("shares strict text/list/numeric limits with the composer, accepting decimal frame intervals", () => {
    const p = fixture();
    expect(() =>
      resolveChatCommand("prompt-digitando", p, { text: "x".repeat(141) }),
    ).toThrow(/140/);
    expect(() =>
      resolveChatCommand("soco-pb", p, { text: "Uma frase com quatro" }),
    ).toThrow(/três/);
    expect(() =>
      resolveChatCommand("lista-check", p, { items: ["x".repeat(301)] }),
    ).toThrow();
    expect(() => resolveChatCommand("zoom", p, { amount: NaN })).toThrow();
    expect(() =>
      resolveChatCommand("zoom", p, { start: 1.1, end: 1.2 }),
    ).not.toThrow();
  });
  const executable = CHAT_COMMANDS.filter(
    (c) => c.kind === "motion" || (c.range && c.kind !== "ai"),
  );
  it.each(executable.map((c) => [c.id]))(
    "builds a valid real project for /%s",
    (id) => {
      const p = fixture();
      const after = applyNativeChatCommand(p, id as string, {
        start: 2,
        end: 5,
      });
      expect(() => validateProject(after)).not.toThrow();
      expect(after).not.toEqual(p);
      expect(p.clips).toHaveLength(1);
      if (!["timelapse", "camera-lenta"].includes(id as string))
        expect(projectDuration(after)).toBe(12);
    },
  );
  it("applies impact image+motion atomically and only within the requested interval", () => {
    const p = fixture(),
      after = applyNativeChatCommand(p, "soco-pb", {
        start: 2,
        end: 5,
        text: "PARE AGORA",
      });
    expect(after.clips.map((c) => [c.start, c.end, c.look, c.zoom])).toEqual([
      [0, 2, undefined, 1],
      [2, 5, "monochrome", 1.2],
      [5, 12, undefined, 1],
    ]);
    expect(after.motions).toHaveLength(1);
    expect(after.motions![0].animations).toHaveLength(4);
    expect(after.media).toEqual(p.media);
  });
  it("retimes existing motions when speeding an interval, preserving source phase", () => {
    let p = applyNativeChatCommand(fixture(), "titulo", {
      start: 0,
      end: 8,
      text: "Uma ideia",
    });
    p = applyNativeChatCommand(p, "timelapse", { start: 2, end: 6, amount: 4 });
    expect(projectDuration(p)).toBe(9);
    expect(p.motions).toHaveLength(3);
    expect(motionLocalTime(p.motions![1], 2.5)).toBeCloseTo(4);
    expect(p.clips.find((c) => c.start === 2)?.muted).toBe(true);
  });
  it("keeps color wipe phase continuous when crossing source clips", () => {
    let p = applyCommand(fixture(), {
      name: "split",
      args: { clipId: "clip", time: 4 },
    });
    p = applyNativeChatCommand(p, "cortina-cor", { start: 2, end: 6 });
    const selected = p.clips.filter((c) => c.look === "color-wipe");
    expect(selected).toHaveLength(2);
    expect(selected.map((c) => [c.lookStart, c.lookEnd])).toEqual([
      [2, 6],
      [2, 6],
    ]);
  });
});

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { analyzeReference, blueprintSummary, detectCuts, dominantColors, referenceStyle, sentencesFrom, suggestFormat } from "../electron/core/reference";

const dirs: string[] = [];
afterAll(() => Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }))));

describe("vídeo de referência", () => {
  it("acha cortes secos e ignora movimento contínuo", () => {
    const diffs = [0, 0.02, 0.03, 0.02, 0.4, 0.03, 0.02, 0.05, 0.06, 0.05, 0.05, 0.5, 0.04];
    expect(detectCuts(diffs, 6)).toEqual([0.67, 1.83]);
  });

  it("extrai as cores dominantes do escuro para o claro", () => {
    const rgb = new Uint8Array([...Array(30)].flatMap((_, i) => (i < 20 ? [20, 20, 30] : [240, 90, 40])));
    expect(dominantColors(rgb, 2)).toEqual(["#14141e", "#f05a28"]);
  });

  it("sugere o formato mais parecido com a referência", () => {
    const pace = (secondsPerShot: number, energy: number) => ({ cuts: 0, secondsPerShot, wordsPerSecond: 2.5, energy, hook: "" });
    const said = [{ text: "oi", start: 0, end: 0.2 }];
    expect(suggestFormat({ palette: ["#0b1c32", "#142947"], pace: pace(7.5, 0.14), words: said }).id).toBe("kurzgesagt");
    expect(suggestFormat({ palette: ["#f4f4f4", "#ffffff"], pace: pace(2, 0.3), words: said }).id).toBe("ui-motion");
    expect(suggestFormat({ palette: ["#1b1530", "#3b26a8"], pace: pace(2.5, 0.4), words: said }).id).toBe("avatar");
  });

  it("monta frases pela pontuação e pelas pausas", () => {
    const words = [
      { text: "Você", start: 0, end: 0.2 }, { text: "sabia?", start: 0.2, end: 0.6 },
      { text: "Ninguém", start: 0.7, end: 1 }, { text: "conta", start: 1, end: 1.3 },
      { text: "isso", start: 2.4, end: 2.7 },
    ];
    expect(sentencesFrom(words).map((s) => s.text)).toEqual(["Você sabia?", "Ninguém conta", "isso"]);
  });

  it("transforma um Reels real em molde: cortes, ritmo, cores, fala e quadros", async () => {
    const root = await mkdtemp(join(tmpdir(), "videosell-ref-"));
    dirs.push(root);
    const words = [
      { text: "Você", start: 0.1, end: 0.4, mediaId: "r" }, { text: "criou", start: 0.4, end: 0.7, mediaId: "r" },
      { text: "um", start: 0.7, end: 0.8, mediaId: "r" }, { text: "SaaS.", start: 0.8, end: 1.2, mediaId: "r" },
    ];
    const blueprint = await analyzeReference(resolve("site/upsell/videos/avatar.mp4"), { root, transcribe: async () => words }, new AbortController().signal, () => {});
    expect(blueprint.duration).toBeGreaterThan(20);
    expect(blueprint.shots.length).toBeGreaterThanOrEqual(4);
    expect(blueprint.shots[0].start).toBe(0);
    expect(blueprint.shots.at(-1)!.end).toBeCloseTo(blueprint.duration, 1);
    expect(blueprint.palette.length).toBeGreaterThan(0);
    expect(blueprint.pace.hook).toBe("Você criou um SaaS.");
    expect(blueprint.shots.every((s) => s.end - s.start >= 0.35)).toBe(true);
    expect(blueprint.shots.map((s) => s.text).filter(Boolean).join(" ")).toBe("Você criou um SaaS.");
    const summary = blueprintSummary(blueprint);
    expect(summary.cenas).toHaveLength(blueprint.shots.length);
    expect(JSON.stringify(summary)).not.toContain(root);
    const style = referenceStyle(blueprint);
    expect(style.shots[0].start).toBe(0);
    expect(style.shots.every((s) => s.start >= 0 && s.start < 1)).toBe(true);
    // Cached: a second analysis returns the same mold without running ffmpeg again.
    const again = await analyzeReference(resolve("site/upsell/videos/avatar.mp4"), { root, transcribe: async () => { throw new Error("não deveria transcrever"); } }, new AbortController().signal, () => {});
    expect(again.shots).toEqual(blueprint.shots);
  }, 120_000);
});

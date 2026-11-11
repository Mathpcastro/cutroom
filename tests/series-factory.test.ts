import { describe, expect, it } from "vitest";
import { DEFAULT_CHOICES, fitScript, seriesPrompt } from "../src/components/studio/seriesFactory";
import { validateScript } from "../src/shared/story";
import type { StudioProfile } from "../src/shared/profile";

const profile = { name: "T", brand: { name: "Videosell" }, personality: { description: "App de Reels com IA", presentation: "Direto" }, commercialGoal: "R$ 147" } as unknown as StudioProfile;

describe("Série pronta com IA", () => {
  it("builds the request from the brand and a few choices, with or without an idea", () => {
    const p = seriesPrompt(profile, { ...DEFAULT_CHOICES, episodes: 7, cast: 3 });
    expect(p).toContain("exatamente 3 personagens");
    expect(p).toContain("exatamente 7 ideias");
    expect(p).toContain("A pessoa não deu ideia");
    expect(p).toContain("App de Reels com IA");
    expect(seriesPrompt(profile, { ...DEFAULT_CHOICES, idea: "dois sócios" })).toContain("Ideia da pessoa: dois sócios");
  });
  it("fits an AI script to what the engine can do", () => {
    const fitted = fitScript({ title: "x", scenes: [{ place: "praia", time: "dia", lines: [
      { who: "léo", mood: "feliz", text: "um dois três quatro cinco seis sete oito nove dez onze doze treze" },
      { who: "Zé", text: "oi" }, { who: "Bia", text: "a" }, { who: "Ana", text: "b" }, { who: "Rui", text: "c" },
    ] }] }, ["Léo", "Bia", "Ana", "Rui"]);
    expect(validateScript(fitted, ["Léo", "Bia", "Ana", "Rui"]).filter((i) => i.line !== undefined || !/dura/.test(i.message))).toEqual([]);
    expect(fitted.scenes[0].place).toBe("quarto");
    expect(fitted.scenes[0].lines[0].who).toBe("Léo");
  });
});

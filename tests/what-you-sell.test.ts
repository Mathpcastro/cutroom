import { describe, expect, it } from "vitest";
import { INTERVIEW, interviewToBrand, parseBrandAnswer } from "../src/components/studio/WhatYouSell";

describe("O que você vende (onboarding como no Carrossell)", () => {
  it("turns the interview into brand fields without AI", () => {
    expect(INTERVIEW).toHaveLength(6);
    const brand = interviewToBrand("", { what: "App de Reels", who: "donos de SaaS", offer: "R$ 147, link na bio", tone: "direto" });
    expect(brand.name).toBe("Minha marca");
    expect(brand.context).toBe("Produto: App de Reels\nComprador: donos de SaaS");
    expect(brand.goal).toBe("R$ 147, link na bio");
  });
  it("reads the pasted AI answer even with fences or text around it", () => {
    const answer = 'Claro! ```json\n{"name":"Videosell","context":"Reels com IA","goal":"Testar","tone":"Direto","accent":"#6445D8"}\n```';
    expect(parseBrandAnswer(answer)).toMatchObject({ name: "Videosell", accent: "#6445D8" });
    expect(() => parseBrandAnswer("sem json")).toThrow(/JSON/);
  });
});

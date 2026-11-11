import { describe, expect, it } from "vitest";
import { REEL_FORMATS, radarPrompt } from "../src/components/studio/Radar";
import type { StudioProfile } from "../src/shared/profile";

const profile = { name: "Teste", brand: { name: "Videosell", website: "https://x.com" }, personality: { description: "Reels com IA", presentation: "Direto" }, commercialGoal: "R$ 147" } as unknown as StudioProfile;

describe("Radar de pautas (modelo do Carrossell)", () => {
  it("asks for 30 ideas with the 10 strongest marked, with or without a theme", () => {
    const free = radarPrompt(profile, "radar", {});
    expect(free).toContain("30 pautas");
    expect(free).toContain("top=true nas 10 mais fortes");
    expect(free).toContain("Sem foco: explore territórios diferentes");
    expect(radarPrompt(profile, "radar", { focus: "objeções de preço" })).toContain("Foco pedido pelo usuário: objeções de preço.");
    for (const f of REEL_FORMATS) expect(free).toContain(f);
  });
  it("models a reference without copying and varies the winners", () => {
    expect(radarPrompt(profile, "modelador", { reference: "post X" })).toMatch(/sem copiar[\s\S]*10 pautas/);
    expect(radarPrompt(profile, "vencedores", { winners: "[]" })).toContain("mudando uma variável por vez");
  });
});

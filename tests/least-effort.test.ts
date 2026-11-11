import { describe, expect, it } from "vitest";
import { choicesSummary } from "../src/components/studio/QuickCreate";
import { FLOW_STAGES, stageOf } from "../src/components/studio/ReelFlow";
import { reelRows } from "../src/components/studio/MyReels";
import { firstSuggestion, handleFrom } from "../src/components/studio/FirstRun";
import type { StudioProfile } from "../src/shared/profile";

const profile = {
  id: "p", name: "Matheus", handle: "matheus", voice: { provider: "local", voiceId: "local" },
  brand: { name: "Videosell" }, personality: { description: "", presentation: "" },
} as unknown as StudioProfile;

describe("Caminho de menor esforço (Spec 4)", () => {
  it("summarises the defaults in one line", () => {
    expect(choicesSummary(profile, { avatar: false, story: false, style: "", language: "pt-BR" })).toBe("Sem avatar · voz local · estilo automático · português");
    expect(choicesSummary(profile, { avatar: true, story: true, style: "", language: "en" })).toBe("Com o avatar de Matheus · voz local · história · estilo automático · inglês");
  });

  it("maps progress messages to four plain steps", () => {
    expect(FLOW_STAGES).toEqual(["Roteiro", "Voz", "Cenas", "Vídeo"]);
    expect(stageOf("Planejando o roteiro e as cenas…")).toBe(0);
    expect(stageOf("Gerando a narração…")).toBe(1);
    expect(stageOf("Animando e conferindo as cenas…")).toBe(2);
  });

  it("lists every Reel once with its state, including MP4s made by agents", () => {
    const rows = reelRows("p", [{ id: "film-1", name: "Rascunho A", createdAt: "2026-11-10" }],
      [{ path: "C:/v/agente-2026-11-11-10-00.mp4", name: "agente.mp4", modifiedAt: "2026-11-11" }, { path: "C:/v/postado.mp4", name: "postado.mp4", modifiedAt: "2026-11-09" }],
      { history: [{ video: "C:/v/postado.mp4", permalink: "https://instagram.com/reel/x", publishedAt: "2026-11-09" }], scheduled: [] });
    expect(rows.map((r) => [r.title, r.state])).toEqual([["Agente", "Pronto"], ["Rascunho A", "Rascunho"], ["Postado", "Publicado"]]);
  });

  it("writes the first idea from what the user sells", () => {
    expect(firstSuggestion("Videosell", "Cria Reels com IA. E posta sozinho.")).toMatch(/^Mostre em 30 segundos como Videosell ajuda: Cria Reels com IA\./);
    expect(handleFrom("Café da Ana")).toBe("cafe-da-ana");
  });
});

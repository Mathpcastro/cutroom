import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { parseHTML } from "linkedom";
import { describe, expect, it } from "vitest";
import { AutoPilot, pilotSentence, queueDaysLeft, timesProblem, titleFromFile } from "../src/components/studio/AutoPilot";

const soon = (hours: number) => new Date(Date.now() + hours * 3600e3).toISOString();

async function render(settings: unknown) {
  const { window } = parseHTML("<html><body><div id='root'></div></body></html>");
  Object.assign(globalThis, { window, document: window.document, IS_REACT_ACT_ENVIRONMENT: true, localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} } });
  (window as unknown as { cutroom: unknown }).cutroom = {
    request: async (method: string) => (method === "getPublishSettings" ? settings : method === "listVideos" ? { videos: [] } : { url: "" }),
  };
  const container = window.document.getElementById("root")!;
  const root = createRoot(container as unknown as HTMLElement);
  await act(async () => { root.render(<AutoPilot profile={null} onConnect={() => {}} onReview={() => {}} onCreate={() => {}} onRadar={() => {}} />); });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  const text = container.textContent ?? "";
  await act(async () => root.unmount());
  return text;
}

const base = { hasKey: true, accounts: [{ id: "a", username: "marca" }], defaultAccount: "a", history: [] };

describe("Piloto automático (Spec 3)", () => {
  it("validates the daily times", () => {
    expect(timesProblem(["18:00"])).toBe("");
    expect(timesProblem(["12:00", "12:40"])).toMatch(/1 hora/);
    expect(timesProblem(["08:00", "10:00", "12:00", "14:00", "16:00", "18:00"])).toMatch(/1 a 5/);
  });

  it("says the state in one sentence", () => {
    expect(pilotSentence({ enabled: false, hasAccount: false, queued: 0 }).fix).toBe("connect");
    expect(pilotSentence({ enabled: true, hasAccount: true, queued: 0 }).text).toMatch(/fila está vazia/);
    const on = pilotSentence({ enabled: true, hasAccount: true, queued: 1, account: "marca", next: { id: "1", video: "v.mp4", at: soon(30), status: "scheduled" } });
    expect(on.text).toMatch(/^Ligado · próximo Reels .* em @marca\.$/);
  });

  it("never shows only the file name", () => {
    expect(titleFromFile("C:/v/da-nota-ao-post-2026-11-10-15-09-13.mp4")).toBe("Da nota ao post");
  });

  it("counts the days left in the queue", () => {
    expect(queueDaysLeft([])).toBe(0);
    expect(queueDaysLeft([{ id: "1", video: "", at: soon(1), status: "scheduled" }])).toBeGreaterThanOrEqual(1);
  });

  it("renders off, on, no connection, empty, late and failed", async () => {
    expect(await render({ ...base, accounts: [] })).toContain("Conecte o Instagram para postar");
    expect(await render({ ...base, pilot: { enabled: false, times: ["18:00"], days: "daily" }, scheduled: [] })).toContain("Desligado.");
    expect(await render({ ...base, pilot: { enabled: true, times: ["18:00"], days: "daily" }, scheduled: [] })).toContain("a fila está vazia");
    const on = await render({ ...base, pilot: { enabled: true, times: ["12:00", "18:00"], days: "daily" }, scheduled: [{ id: "1", video: "C:/v/um.mp4", at: soon(30), status: "scheduled", title: "Reels um" }] });
    expect(on).toContain("Ligado · próximo Reels");
    expect(on).toContain("Reels um");
    expect(on).toContain("Arraste os vídeos entre os dias");
    expect(on).toContain("0/2"); // per-day counter (limit = Reels per day); today has no Reel
    const late = await render({ ...base, pilot: { enabled: true, times: ["18:00"], days: "daily" }, scheduled: [{ id: "2", video: "C:/v/dois.mp4", at: soon(-8), status: "late", title: "Atrasado um" }] });
    expect(late).toContain("Um Reels precisa de atenção");
    const failed = await render({ ...base, pilot: { enabled: true, times: ["18:00"], days: "daily" }, scheduled: [{ id: "3", video: "C:/v/tres.mp4", at: soon(-1), status: "failed", error: "rate limit", title: "Falhou um" }] });
    expect(failed).toContain("Falhou");
    expect(on + late + failed).not.toMatch(/um\.mp4|dois\.mp4|tres\.mp4/);
  });
});

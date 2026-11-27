import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { parseHTML } from "linkedom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChannelStudio } from "../src/components/studio/ChannelStudio";
import { QuickCreate } from "../src/components/studio/QuickCreate";
import type { StudioProfile } from "../src/shared/profile";
import type { CutroomAPI } from "../src/shared/types";

const now = new Date().toISOString();
const profile: StudioProfile = {
  version: 1, id: "teste", name: "Teste", handle: "teste",
  voice: { provider: "local", voiceId: "local" },
  personality: { description: "", presentation: "" },
  brand: { name: "Teste", accent: "#000000", ink: "#000000", paper: "#ffffff" },
  instagram: { preferences: {} }, commercialGoal: "", preferences: {}, createdAt: now, updatedAt: now,
};

const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => {
  while (roots.length) {
    const root = roots.pop()!;
    await act(async () => root.unmount());
  }
  vi.restoreAllMocks();
  Reflect.deleteProperty(globalThis, "window");
  Reflect.deleteProperty(globalThis, "document");
  Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
});

async function mount(node: React.ReactNode, request: (method: string, params?: unknown) => Promise<unknown>) {
  const { window } = parseHTML("<html><body><div id=root></div></body></html>");
  Object.assign(globalThis, { window, document: window.document, IS_REACT_ACT_ENVIRONMENT: true });
  window.cutroom = { request: vi.fn(request) } as unknown as CutroomAPI;
  const root = createRoot(window.document.getElementById("root")!);
  roots.push(root);
  await act(async () => root.render(node));
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return { window, request: window.cutroom!.request as ReturnType<typeof vi.fn> };
}

describe("Canais dark screen", () => {
  it("opens on the template picker when the profile has no channel, reading through channelTool", async () => {
    let created: Record<string, unknown> | undefined;
    const { window, request } = await mount(<ChannelStudio profile={profile} />, async (method, params) => {
      const { name, args } = (params ?? {}) as { name?: string; args?: Record<string, unknown> };
      if (method !== "channelTool") throw new Error(method);
      if (name === "channel_list") return created ? [{ id: "top-cosmico", name: "Top Cósmico", handle: "@topcosmico", niche: "espaço", language: "pt-BR", updatedAt: now }] : [];
      if (name === "channel_create") { created = args; return { id: "top-cosmico" }; }
      if (name === "channel_get") return { id: "top-cosmico", name: "Top Cósmico", handle: "@topcosmico", niche: "espaço", defaults: { voiceId: "" }, format: undefined };
      if (name === "channel_episode_list") return [];
      throw new Error(String(name));
    });
    const text = window.document.body.textContent ?? "";
    expect(text).toContain("Escolha o formato do canal");
    expect(text).toContain("Outro nicho");
    expect(request).toHaveBeenCalledWith("channelTool", { name: "channel_list", args: { profileId: "teste" } });
  });

  it("asks the agent for a custom niche instead of creating a channel", async () => {
    const { window } = await mount(<ChannelStudio profile={profile} startNew />, async (_method, params) => {
      const { name } = (params ?? {}) as { name?: string };
      if (name === "channel_list") return [];
      throw new Error(String(name));
    });
    const custom = [...window.document.querySelectorAll("button")].find((b) => b.textContent?.includes("Outro nicho"))!;
    await act(async () => custom.dispatchEvent(new window.Event("click", { bubbles: true })));
    const text = window.document.body.textContent ?? "";
    expect(text).toContain("Copiar pedido");
    expect(text).toContain("com um formato próprio para esse nicho");
    expect([...window.document.querySelectorAll("button")].some((b) => b.textContent?.trim().endsWith("Criar canal"))).toBe(false);
  });

  it("puts a Criar canal dark shortcut on the home", async () => {
    const onChannel = vi.fn();
    const { window } = await mount(
      <QuickCreate profile={profile} ideas={[]} pending={[]} onCreate={() => undefined} onReference={() => undefined} onStory={() => undefined} onRadar={() => undefined} onChannel={onChannel} />,
      async () => ({}),
    );
    const shortcut = [...window.document.querySelectorAll("button")].find((b) => b.textContent?.includes("Criar canal dark"))!;
    expect(shortcut).toBeTruthy();
    await act(async () => shortcut.dispatchEvent(new window.Event("click", { bubbles: true })));
    expect(onChannel).toHaveBeenCalledTimes(1);
  });
});

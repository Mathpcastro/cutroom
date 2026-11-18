import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { parseHTML } from "linkedom";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { McpButton, McpDialog } from "../src/components/studio/McpConnect";
import { ChannelStore } from "../electron/core/channel/channel-store";
import { createChannelToolDispatcher } from "../electron/core/channel/channel-tools";
import { JobRunner } from "../electron/core/channel/jobs";
import { STUDIO_TOOLS } from "../electron/core/studio-tool-defs";
import { baseInstructions } from "../electron/core/codex";
import type { EditorEvent } from "../src/shared/types";

const roots: string[] = [];
afterAll(async () => {
  await Promise.all(roots.map((d) => rm(d, { recursive: true, force: true })));
});

describe("Usar pelo seu agente (MCP)", () => {
  it("has its own sidebar button and opens with the search notice when the agent asks", async () => {
    const { window } = parseHTML("<html><body><div id='root'></div></body></html>");
    Object.assign(globalThis, { window, document: window.document, IS_REACT_ACT_ENVIRONMENT: true });
    let emit: ((e: EditorEvent) => void) | undefined;
    (window as unknown as { cutroom: unknown }).cutroom = {
      request: async (method: string) => (method === "mcpSetup" ? { claude: "{}", codex: "[mcp_servers.videosell]", claudeCode: "claude mcp add videosell" } : {}),
      onEvent: (cb: (e: EditorEvent) => void) => {
        emit = cb;
        return () => undefined;
      },
    };
    const root = createRoot(window.document.getElementById("root") as unknown as HTMLElement);
    await act(async () => {
      root.render(<><McpButton /><McpDialog /></>);
    });
    const text = () => window.document.getElementById("root")!.textContent ?? "";
    expect(text()).toContain("Usar pelo seu agente");
    expect(text()).toContain("Tudo pelo chat, sem mexer no app");
    expect(text()).not.toContain("precisa de busca");
    await act(async () => emit?.({ type: "mcp", reason: "search" }));
    await act(async () => { await Promise.resolve(); });
    expect(text()).toContain("Isto precisa de busca na internet.");
    expect(text()).toContain("O Videosell não pesquisa sozinho");
    expect(text()).toContain("Não precisa ficar mexendo no Videosell");
    expect(text()).toContain("Claude Code (terminal)");
    expect(text()).toContain("Ensinar o meu agente a usar o Videosell");
    await act(async () => root.unmount());
  });

  it("the in-app agent knows it has no web search and how to send the user to MCP", () => {
    expect(STUDIO_TOOLS.some((t) => t.name === "open_mcp_setup")).toBe(true);
    expect(baseInstructions).toContain("open_mcp_setup");
    expect(baseInstructions).toMatch(/no web search/);
  });

  it("script_generate without facts points to research by the agent (or to MCP)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mcp-hint-"));
    roots.push(dir);
    const store = new ChannelStore(dir);
    const tool = createChannelToolDispatcher({ store, jobs: new JobRunner(join(dir, "jobs")), secret: async () => undefined, kit: { gsap: "", fontsDir: "" }, runner: async () => ({ worker: "", browser: "" }), transcriber: async () => async () => [], speaker: async () => async () => ({ audio: new Uint8Array(), extension: "wav" }) });
    const c = (await tool("channel_create", { profileId: "default", name: "Canal" })) as { id: string };
    const ep = (await tool("channel_episode_create", { profileId: "default", channelId: c.id, title: "x" })) as { id: string };
    const r = (await tool("script_generate", { profileId: "default", channelId: c.id, episodeId: ep.id })) as { needsResearch?: boolean; next: string };
    expect(r.needsResearch).toBe(true);
    expect(r.next).toContain("open_mcp_setup");
  });
});

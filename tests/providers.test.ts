import { createServer, type Server, type RequestListener } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiAgentClient,
  apiBaseUrl,
  mapApiModels,
  sse,
} from "../electron/core/api-agent";
import { AgentTools } from "../electron/core/agent";
import { ClaudeBridge } from "../electron/core/claude-bridge";
import type { AgentActivity } from "../src/shared/types";

const resources: (() => void)[] = [];
afterEach(() => {
  resources.splice(0).forEach((close) => close());
  vi.unstubAllGlobals();
});
const stream = (events: unknown[]) =>
  new Response(
    events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
    { headers: { "content-type": "text/event-stream" } },
  );
const delta = (value: unknown, finish: string | null = null) => ({
  choices: [{ delta: value, finish_reason: finish }],
});
async function local(handler: RequestListener) {
  const server: Server = createServer(handler);
  resources.push(() => {
    server.closeAllConnections();
    server.close();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;
}
const options = (
  onTool: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<unknown> = vi.fn(async () => ({ clips: [] })),
) => ({ workspace: ".", onText: vi.fn(), onTool, onActivity: vi.fn() });

describe("provider transport and editing", () => {
  it("restricts remote credentials to HTTPS and refuses URL credentials", () => {
    for (const baseUrl of [
      "http://example.com/v1",
      "https://key:secret@example.com",
      "https://example.com?key=x",
      "file:///tmp",
    ])
      expect(() =>
        apiBaseUrl({ provider: "openai-compatible", baseUrl }),
      ).toThrow();
    expect(
      apiBaseUrl({
        provider: "openai-compatible",
        baseUrl: "http://127.0.0.1:1234/v1/",
      }),
    ).toBe("http://127.0.0.1:1234/v1");
    expect(
      apiBaseUrl({ provider: "deepseek", baseUrl: "http://evil.example" }),
    ).toBe("https://api.deepseek.com");
  });
  it("uses discovered capabilities rather than inventing model names or effort", () => {
    expect(
      mapApiModels("openrouter", [
        { id: "text-only", supported_parameters: [] },
      ]),
    ).toEqual([]);
    const [model] = mapApiModels("deepseek", [
      {
        id: "available-model",
        name: "Real model",
        input_modalities: ["text"],
        effort: {
          supported_levels: ["low", "high", "max"],
          default_level: "high",
        },
      },
    ]);
    expect(model.reasoningEfforts).toEqual(["low", "high", "max"]);
    expect(model.supportsVision).toBe(false);
    expect(
      mapApiModels("anthropic", [
        {
          id: "claude",
          capabilities: {
            image_input: { supported: true },
            effort: { medium: { supported: true } },
          },
        },
      ])[0],
    ).toMatchObject({ supportsVision: true, reasoningEfforts: ["medium"] });
  });
  it("decodes split UTF-8 SSE frames and reports upstream errors", async () => {
    const bytes = new TextEncoder().encode(
      'data: {"text":"ação"}\r\n\r\ndata: [DONE]\n\n',
    );
    const response = new Response(
      new ReadableStream({
        start(c) {
          for (const byte of bytes) c.enqueue(new Uint8Array([byte]));
          c.close();
        },
      }),
    );
    const values = [];
    for await (const value of sse(response)) values.push(value);
    expect(values).toEqual([{ text: "ação" }]);
    await expect(async () => {
      for await (const _ of sse(stream([{ error: { message: "secret" } }]))) {
      }
    }).rejects.toThrow("interrompeu");
  });
  it("edits through actual local HTTP streaming, preserving complete tool results and history", async () => {
    const requests: any[] = [];
    let round = 0;
    const baseUrl = await local(async (req, res) => {
      if (req.url === "/v1/models") {
        res.end(JSON.stringify({ data: [{ id: "local-editor" }] }));
        return;
      }
      let body = "";
      for await (const chunk of req) body += chunk;
      requests.push(JSON.parse(body));
      const events =
        round++ === 0
          ? [
              delta(
                {
                  tool_calls: [
                    {
                      index: 0,
                      id: "read",
                      function: { name: "get_project", arguments: "{}" },
                    },
                  ],
                },
                "tool_calls",
              ),
            ]
          : round === 2
            ? [
                delta(
                  {
                    tool_calls: [
                      {
                        index: 0,
                        id: "edit",
                        function: {
                          name: "edit_project",
                          arguments:
                            '{"name":"rename","args":{"name":"Novo título"}}',
                        },
                      },
                    ],
                  },
                  "tool_calls",
                ),
              ]
            : [delta({ content: "Pronto." }), delta({}, "stop")];
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(""));
    });
    let project = { name: "Original" };
    const onTool = vi.fn(async (name: string, args: any) => {
      if (name === "edit_project") project.name = args.args.name;
      return structuredClone(project);
    });
    const callbacks = options(onTool);
    const client = new ApiAgentClient(callbacks, {
      provider: "openai-compatible",
      baseUrl,
      model: "local-editor",
    });
    await client.connect();
    await client.send("Renomeie meu projeto");
    expect(project.name).toBe("Novo título");
    expect(callbacks.onText).toHaveBeenCalledWith("Pronto.");
    expect(
      requests[2].messages.filter((m: any) => m.role === "tool"),
    ).toHaveLength(2);
    const events = callbacks.onActivity.mock.calls.map(
      (c) => c[0],
    ) as AgentActivity[];
    for (const event of events.filter((e) => e.status === "running"))
      expect(events.filter((e) => e.id === event.id)).toHaveLength(2);
    client.disconnect();
  });
  it("blocks edits before reading the project, and rejects unknown tools", async () => {
    const callbacks = options();
    const tools = new AgentTools(callbacks);
    const signal = new AbortController().signal;
    await expect(
      tools.call("edit_project", { name: "reset", args: {} }, signal),
    ).rejects.toThrow("get_project");
    await expect(
      tools.call("shell", { command: "anything" }, signal),
    ).rejects.toThrow("desconhecida");
    expect(callbacks.onTool).not.toHaveBeenCalled();
  });
  it("validates OpenRouter keys before using its public catalog, without leaking errors", async () => {
    const fetcher = vi.fn(
      async (_url: string) =>
        new Response(JSON.stringify({ error: "sk-private-secret" }), {
          status: 401,
        }),
    );
    vi.stubGlobal("fetch", fetcher);
    const client = new ApiAgentClient(options(), { provider: "openrouter" });
    await expect(client.connect("sk-private-secret")).rejects.toThrow(
      "HTTP 401",
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      "https://openrouter.ai/api/v1/auth/key",
    );
  });
  it("preserves DeepSeek reasoning content across tool rounds and subsequent turns", async () => {
    const bodies: any[] = [];
    let n = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        if (url.endsWith("/models"))
          return new Response(
            JSON.stringify({
              data: [
                { id: "deepseek-test", effort: { supported_levels: ["high"] } },
              ],
            }),
          );
        bodies.push(JSON.parse(String(init.body)));
        return n++ === 0
          ? stream([
              delta(
                {
                  reasoning_content: "private-reasoning",
                  tool_calls: [
                    {
                      index: 0,
                      id: "a",
                      function: { name: "get_project", arguments: "{}" },
                    },
                  ],
                },
                "tool_calls",
              ),
            ])
          : stream([delta({ content: "Feito" }, "stop")]);
      }),
    );
    const callbacks = options();
    const client = new ApiAgentClient(callbacks, { provider: "deepseek" });
    await client.connect("test-key");
    await client.send("Leia o projeto", "deepseek-test", "high");
    await client.send("Tudo bem?");
    expect(
      bodies[1].messages.find((m: any) => m.tool_calls).reasoning_content,
    ).toBe("private-reasoning");
    expect(
      bodies[2].messages.find((m: any) => m.tool_calls).reasoning_content,
    ).toBe("private-reasoning");
    expect(callbacks.onText.mock.calls.flat().join("")).not.toContain(
      "private-reasoning",
    );
    client.disconnect();
  });
  it("supports Anthropic Messages streaming and validated tool use", async () => {
    let n = 0;
    const bodies: any[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        if (url.includes("/models"))
          return new Response(
            JSON.stringify({ data: [{ id: "claude-sonnet-test" }] }),
          );
        bodies.push(JSON.parse(String(init.body)));
        return stream(
          n++ === 0
            ? [
                {
                  type: "content_block_start",
                  index: 0,
                  content_block: {
                    type: "tool_use",
                    id: "read",
                    name: "get_project",
                    input: {},
                  },
                },
                {
                  type: "content_block_delta",
                  index: 0,
                  delta: { type: "input_json_delta", partial_json: "{}" },
                },
                { type: "message_delta", delta: { stop_reason: "tool_use" } },
                { type: "message_stop" },
              ]
            : [
                {
                  type: "content_block_start",
                  index: 0,
                  content_block: { type: "text", text: "" },
                },
                {
                  type: "content_block_delta",
                  index: 0,
                  delta: { type: "text_delta", text: "Projeto lido" },
                },
                { type: "message_delta", delta: { stop_reason: "end_turn" } },
                { type: "message_stop" },
              ],
        );
      }),
    );
    const callbacks = options();
    const client = new ApiAgentClient(callbacks, { provider: "anthropic" });
    await client.connect("test-key");
    await client.send("Leia o projeto");
    expect(callbacks.onTool).toHaveBeenCalledWith("get_project", {});
    expect(bodies[1].messages.at(-1).content[0]).toMatchObject({
      type: "tool_result",
      tool_use_id: "read",
    });
    expect(callbacks.onText).toHaveBeenCalledWith("Projeto lido");
    client.disconnect();
  });
  it("aborts a real open HTTP stream and completes the same activity as cancelled", async () => {
    let started!: () => void;
    const ready = new Promise<void>((resolve) => (started = resolve));
    const baseUrl = await local((req, res) => {
      if (req.url?.endsWith("/models"))
        return res.end(JSON.stringify({ data: [{ id: "local" }] }));
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(": waiting\n\n");
      started();
    });
    const callbacks = options();
    const client = new ApiAgentClient(callbacks, {
      provider: "openai-compatible",
      baseUrl,
    });
    await client.connect();
    const request = client.send("Editar");
    await ready;
    await client.interrupt();
    await expect(request).rejects.toThrow("cancelada");
    expect(callbacks.onActivity.mock.calls.at(-1)?.[0].status).toBe(
      "cancelled",
    );
    client.disconnect();
  });
  it("does not claim success for truncated streams or replay incomplete tool histories", async () => {
    let n = 0;
    const bodies: any[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        if (url.endsWith("/models"))
          return new Response(JSON.stringify({ data: [{ id: "m" }] }));
        bodies.push(JSON.parse(String(init.body)));
        return stream(
          n++ === 0
            ? [delta({ content: "partial" })]
            : [delta({ content: "ok" }, "stop")],
        );
      }),
    );
    const client = new ApiAgentClient(options(), { provider: "deepseek" });
    await client.connect("key");
    await expect(client.send("first")).rejects.toThrow("interrompida");
    await client.send("second");
    expect(bodies[1].messages).toHaveLength(2);
    expect(JSON.stringify(bodies[1])).not.toContain("partial");
    client.disconnect();
  });
});

describe("Claude loopback bridge", () => {
  it("requires a private bearer, exposes only editor tools, serializes calls and rejects tool injection", async () => {
    const callbacks = options();
    const controller = new AbortController();
    const bridge = new ClaudeBridge(
      new AgentTools(callbacks),
      controller.signal,
    );
    const url = await bridge.start();
    resources.push(() => bridge.close());
    const rpc = (method: string, params?: unknown, authenticated = true) =>
      fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(authenticated ? { authorization: `Bearer ${bridge.token}` } : {}),
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
    expect((await rpc("tools/list", {}, false)).status).toBe(401);
    const list = await (await rpc("tools/list")).json();
    expect(list.result.tools.map((t: any) => t.name)).toEqual([
      "get_project",
      "edit_project",
      "transcribe",
      "export_video",
      "inspect_frame",
      "create_blank_canvas",
      "import_media",
    ]);
    expect(
      (await (await rpc("tools/call", { name: "shell", arguments: {} })).json())
        .result.isError,
    ).toBe(true);
    expect(
      (
        await (
          await rpc("tools/call", {
            name: "edit_project",
            arguments: { name: "reset", args: {} },
          })
        ).json()
      ).result.isError,
    ).toBe(true);
    await rpc("tools/call", { name: "get_project", arguments: {} });
    expect(callbacks.onTool).toHaveBeenCalledTimes(1);
    controller.abort();
    await rpc("tools/call", { name: "get_project", arguments: {} });
    expect(callbacks.onTool).toHaveBeenCalledTimes(1);
  });
});

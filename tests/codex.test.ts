import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentActivity } from "../src/shared/types";

const mocks = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: mocks.spawn }));
import {
  CodexClient,
  EDITOR_TOOLS,
  toolResultContent,
  validateToolArguments,
} from "../electron/core/codex";

type Message = {
  id?: number | string;
  method?: string;
  params?: any;
  result?: any;
  error?: any;
};
class FakeServer extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  exitCode: number | null = null;
  messages: Message[] = [];
  stdin = new Writable({
    write: (chunk, _encoding, callback) => {
      const message = JSON.parse(chunk.toString()) as Message;
      this.messages.push(message);
      queueMicrotask(() => this.handle(message));
      callback();
    },
  });
  autoComplete = true;
  authenticated = true;
  efforts = false;
  kill = vi.fn(() => {
    this.exitCode = 0;
    this.emit("exit", 0);
    return true;
  });
  constructor() {
    super();
    this.stdin.on("finish", () => this.kill());
  }
  emitMessage(message: Message) {
    this.stdout.write(`${JSON.stringify(message)}\n`);
  }
  handle(message: Message) {
    if (!message.method || message.id === undefined) return;
    let result: unknown = {};
    switch (message.method) {
      case "account/read":
        result = {
          account: this.authenticated
            ? { type: "chatgpt", email: "private@example.com" }
            : null,
        };
        break;
      case "model/list":
        result = {
          data: [
            {
              id: "gpt-editor",
              model: "gpt-editor",
              displayName: "Editor",
              isDefault: true,
              ...(this.efforts
                ? {
                    supportedReasoningEfforts: [
                      { reasoningEffort: "low", description: "Fast" },
                      { reasoningEffort: "high", description: "Careful" },
                    ],
                    defaultReasoningEffort: "low",
                  }
                : {}),
            },
          ],
          nextCursor: null,
        };
        break;
      case "config/read":
        result = {
          config: {
            mcp_servers: {
              "odd.name": {
                enabled: true,
                env: { TOKEN: "never-forward-this" },
              },
            },
          },
        };
        break;
      case "skills/list":
        result = {
          data: [
            {
              skills: [
                { path: "/private/skills/example/SKILL.md", enabled: true },
              ],
            },
          ],
        };
        break;
      case "thread/start":
        result = { thread: { id: "thread-1" } };
        break;
      case "turn/start":
        result = { turn: { id: "turn-1" } };
        break;
    }
    this.emitMessage({ id: message.id, result });
    if (message.method === "turn/start" && this.autoComplete) {
      this.emitMessage({
        method: "item/agentMessage/delta",
        params: { threadId: "thread-1", delta: "Pronto." },
      });
      this.emitMessage({
        method: "turn/completed",
        params: {
          threadId: "thread-1",
          turn: { id: "turn-1", status: "completed" },
        },
      });
    }
    if (message.method === "turn/interrupt")
      this.emitMessage({
        method: "turn/completed",
        params: {
          threadId: "thread-1",
          turn: { id: "turn-1", status: "interrupted" },
        },
      });
  }
}

let servers: FakeServer[] = [];
let clients: CodexClient[] = [];
const client = (
  onTool: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<unknown> = vi.fn(async () => ({ ok: true })),
  onText = vi.fn(),
  onActivity?: (activity: AgentActivity) => void,
) => {
  const result = new CodexClient({
    workspace: join(tmpdir(), "cutroom-codex-unit"),
    onTool,
    onText,
    onActivity,
  });
  clients.push(result);
  return result;
};
beforeEach(() => {
  servers = [];
  clients = [];
  mocks.spawn.mockReset();
  mocks.spawn.mockImplementation(() => {
    const server = new FakeServer();
    servers.push(server);
    return server;
  });
});
afterEach(() => {
  clients.forEach((item) => item.disconnect());
});

describe("local Codex transport", () => {
  it("refuses queued tool calls as soon as interruption starts", async () => {
    const onTool = vi.fn(async () => ({ applied: true }));
    const c = client(onTool);
    await c.connect();
    const server = servers[1];
    server.autoComplete = false;
    const done = c.send("Edite");
    const stopped = expect(done).rejects.toThrow("cancelada");
    await vi.waitFor(() =>
      expect(
        server.messages.some((message) => message.method === "turn/start"),
      ).toBe(true),
    );
    const handle = server.handle.bind(server);
    server.handle = (message) =>
      message.method === "turn/interrupt"
        ? server.emitMessage({ id: message.id, result: {} })
        : handle(message);
    await c.interrupt();
    server.emitMessage({
      id: 400,
      method: "item/tool/call",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        callId: "late",
        tool: "edit_project",
        arguments: { name: "remove_silence", args: {} },
      },
    });
    await vi.waitFor(() =>
      expect(
        server.messages.find((message) => message.id === 400)?.result.success,
      ).toBe(false),
    );
    expect(onTool).not.toHaveBeenCalled();
    server.emitMessage({
      method: "turn/completed",
      params: {
        threadId: "thread-1",
        turn: { id: "turn-1", status: "interrupted" },
      },
    });
    await stopped;
  });
  it("does not leave progress running when thread startup fails", async () => {
    const activities: AgentActivity[] = [];
    const c = client(undefined, undefined, (entry) =>
      activities.push(structuredClone(entry)),
    );
    await c.connect();
    const server = servers[1];
    const handle = server.handle.bind(server);
    server.handle = (message) =>
      message.method === "thread/start"
        ? server.emitMessage({
            id: message.id,
            error: { code: -1, message: "startup failed" },
          })
        : handle(message);
    await expect(c.send("Edite")).rejects.toThrow("startup failed");
    const latest = new Map(activities.map((entry) => [entry.id, entry]));
    expect([...latest.values()].map((entry) => entry.status)).toEqual([
      "failed",
    ]);
  });
  it("maps supported reasoning efforts and sends the selected effort", async () => {
    mocks.spawn.mockImplementation(() => {
      const server = new FakeServer();
      server.efforts = true;
      servers.push(server);
      return server;
    });
    const c = client();
    const status = await c.connect();
    expect(status.models[0].reasoningEfforts).toEqual(["low", "high"]);
    expect(status.models[0].defaultReasoningEffort).toBe("low");
    await c.send("Edite", "gpt-editor", "high");
    expect(
      servers[1].messages.find((message) => message.method === "turn/start")
        ?.params.effort,
    ).toBe("high");
    await expect(c.send("Edite", "gpt-editor", "xhigh")).rejects.toThrow(
      "não é suportado",
    );
  });

  it("publishes tool start before work completes and terminal progress on cancellation", async () => {
    const activities: AgentActivity[] = [];
    let resolveTool!: (result: unknown) => void;
    const c = client(
      () =>
        new Promise((resolve) => {
          resolveTool = resolve;
        }),
      undefined,
      (entry) => activities.push(structuredClone(entry)),
    );
    await c.connect();
    servers[1].autoComplete = false;
    const turn = c.send("Edite");
    const stopped = expect(turn).rejects.toThrow("cancelada");
    await vi.waitFor(() =>
      expect(
        servers[1].messages.some((message) => message.method === "turn/start"),
      ).toBe(true),
    );
    servers[1].emitMessage({
      id: 300,
      method: "item/tool/call",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        callId: "cut",
        tool: "edit_project",
        arguments: { name: "remove_silence", args: {} },
      },
    });
    await vi.waitFor(() =>
      expect(
        activities.some(
          (entry) => entry.id === "tool:cut" && entry.status === "running",
        ),
      ).toBe(true),
    );
    expect(servers[1].messages.some((message) => message.id === 300)).toBe(
      false,
    );
    resolveTool({ applied: true });
    await vi.waitFor(() =>
      expect(
        activities.some(
          (entry) => entry.id === "tool:cut" && entry.status === "completed",
        ),
      ).toBe(true),
    );
    servers[1].emitMessage({
      method: "item/reasoning/summaryTextDelta",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        itemId: "summary",
        delta: "Vou verificar os trechos.",
      },
    });
    servers[1].emitMessage({
      method: "turn/plan/updated",
      params: {
        turnId: "turn-1",
        plan: [{ step: "Revisar a timeline", status: "inProgress" }],
      },
    });
    expect(
      activities.some((entry) => entry.detail === "Vou verificar os trechos."),
    ).toBe(true);
    expect(
      activities.some(
        (entry) =>
          entry.label === "Revisar a timeline" && entry.status === "running",
      ),
    ).toBe(true);
    await c.interrupt();
    await stopped;
    const latest = new Map(activities.map((entry) => [entry.id, entry]));
    expect(
      [...latest.values()].some((entry) => entry.status === "running"),
    ).toBe(false);
    expect(
      [...latest.values()].some(
        (entry) => entry.kind === "turn" && entry.status === "cancelled",
      ),
    ).toBe(true);
  });
  it("reuses local auth, strips private account/config data, and explicitly disables inherited servers", async () => {
    const c = client();
    const status = await c.connect();
    expect(status).toEqual({
      account: "Codex local · ChatGPT",
      models: [{ id: "gpt-editor", name: "Editor" }],
      model: "gpt-editor",
    });
    expect(JSON.stringify(status)).not.toContain("private@example.com");
    expect(
      servers
        .flatMap((server) => server.messages)
        .some((message) => message.method?.startsWith("account/login")),
    ).toBe(false);
    expect(mocks.spawn).toHaveBeenCalledTimes(2);
    const [, args, options] = mocks.spawn.mock.calls[1];
    expect(args).toContain('mcp_servers={"odd.name"={enabled=false}}');
    expect(args).toContain("features.shell_tool=false");
    expect(args).toContain("features.plugins=false");
    expect(options.shell).toBe(false);
    expect(options.windowsHide).toBe(true);
  });

  it("registers editor-only tools, disables skills, and waits for completed turn events", async () => {
    const onText = vi.fn();
    const c = client(undefined, onText);
    await c.connect();
    await c.send("Edite o vídeo");
    const thread = servers[1].messages.find(
      (message) => message.method === "thread/start",
    )!;
    expect(thread.params.sandbox).toBe("read-only");
    expect(thread.params.approvalPolicy).toBe("never");
    expect(thread.params.ephemeral).toBe(true);
    expect(thread.params.config.skills.config).toEqual([
      { path: "/private/skills/example/SKILL.md", enabled: false },
    ]);
    expect(thread.params.dynamicTools.map((tool: any) => tool.name)).toEqual(
      EDITOR_TOOLS.map((tool) => tool.name),
    );
    expect(
      servers[1].messages.find((message) => message.method === "turn/start")
        ?.params.input[0].text_elements,
    ).toEqual([]);
    expect(onText).toHaveBeenCalledWith("Pronto.");
  });

  it("answers dynamic tools using inputText and declines built-in shell approval", async () => {
    const onTool = vi.fn(async () => ({ clips: 3 }));
    const c = client(onTool);
    await c.connect();
    const server = servers[1];
    server.autoComplete = false;
    const done = c.send("Leia o projeto");
    await vi.waitFor(() =>
      expect(
        server.messages.some((message) => message.method === "turn/start"),
      ).toBe(true),
    );
    server.emitMessage({
      id: "tool-call",
      method: "item/tool/call",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        callId: "call-1",
        tool: "get_project",
        arguments: {},
      },
    });
    server.emitMessage({
      id: "approval",
      method: "item/commandExecution/requestApproval",
      params: { threadId: "thread-1" },
    });
    await vi.waitFor(() =>
      expect(
        server.messages.find((message) => message.id === "tool-call"),
      ).toEqual({
        id: "tool-call",
        result: {
          success: true,
          contentItems: [{ type: "inputText", text: '{"clips":3}' }],
        },
      }),
    );
    expect(onTool).toHaveBeenCalledWith("get_project", {});
    expect(
      server.messages.find((message) => message.id === "approval")?.result,
    ).toEqual({ decision: "decline" });
    server.emitMessage({
      method: "turn/completed",
      params: { threadId: "thread-1", turn: { status: "completed" } },
    });
    await done;
  });

  it("interrupts the correct active turn and rejects simultaneous sends", async () => {
    const c = client();
    await c.connect();
    const server = servers[1];
    server.autoComplete = false;
    const done = c.send("Faça uma edição");
    const rejection = expect(done).rejects.toThrow("cancelada");
    await vi.waitFor(() =>
      expect(
        server.messages.some((message) => message.method === "turn/start"),
      ).toBe(true),
    );
    await expect(c.send("Outra edição")).rejects.toThrow("Aguarde");
    await c.interrupt();
    await rejection;
    expect(
      server.messages.find((message) => message.method === "turn/interrupt")
        ?.params,
    ).toEqual({ threadId: "thread-1", turnId: "turn-1" });
  });

  it("rejects pending work on subprocess exit and requires reconnection", async () => {
    const c = client();
    await c.connect();
    const server = servers[1];
    server.autoComplete = false;
    const done = c.send("Edite");
    const rejection = expect(done).rejects.toThrow("encerrou");
    await vi.waitFor(() =>
      expect(
        server.messages.some((message) => message.method === "turn/start"),
      ).toBe(true),
    );
    server.emit("exit", 1);
    await rejection;
    await expect(c.send("Continue")).rejects.toThrow("Conecte");
  });

  it("keeps an optional API key only in the child environment without account/login", async () => {
    const c = client();
    await c.connect("sk-test-temporary");
    for (const [, args, options] of mocks.spawn.mock.calls) {
      expect(args.join(" ")).not.toContain("sk-test-temporary");
      expect(options.env.CUTROOM_OPENAI_API_KEY).toBe("sk-test-temporary");
    }
    expect(process.env.CUTROOM_OPENAI_API_KEY).toBeUndefined();
    expect(
      servers
        .flatMap((server) => server.messages)
        .some((message) => message.method?.startsWith("account/login")),
    ).toBe(false);
  });
});

describe("editor tool boundary", () => {
  it("rejects unknown tools, invalid timings, and unregistered edit commands", () => {
    expect(() =>
      validateToolArguments("exec_command", { cmd: "whoami" }),
    ).toThrow();
    expect(() =>
      validateToolArguments("inspect_frame", { mediaId: "m1", time: -1 }),
    ).toThrow();
    expect(() =>
      validateToolArguments("edit_project", { name: "shell", args: {} }),
    ).toThrow();
    expect(() =>
      validateToolArguments("transcribe", { path: "/arbitrary" }),
    ).toThrow();
    expect(
      validateToolArguments("edit_project", {
        name: "zoom",
        args: { factor: 1.2 },
      }),
    ).toEqual({ name: "zoom", args: { factor: 1.2 } });
  });

  it("returns host-owned image data without reading arbitrary paths", () => {
    expect(
      toolResultContent({
        mediaId: "m1",
        imageUrl: "data:image/png;base64,YQ==",
      }),
    ).toEqual([
      { type: "inputText", text: '{"mediaId":"m1"}' },
      { type: "inputImage", imageUrl: "data:image/png;base64,YQ==" },
    ]);
    expect(toolResultContent({ path: "/private/image.png" })).toEqual([
      { type: "inputText", text: '{"path":"/private/image.png"}' },
    ]);
  });
});

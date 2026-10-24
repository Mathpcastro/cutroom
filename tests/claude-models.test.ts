import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, basename } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: mocks.spawn }));
vi.mock("node:fs", async (original) => ({
  ...(await original<typeof import("node:fs")>()),
  existsSync: () => true,
}));
import { mapClaudeModels } from "../electron/core/claude-models";
import { ClaudeAgentClient } from "../electron/core/claude-agent";

const catalog = [
  {
    value: "default",
    resolvedModel: "claude-opus-5-5",
    displayName: "Default (recommended)",
    supportsEffort: true,
    supportedEffortLevels: ["low", "high", "max"],
  },
  {
    value: "sonnet",
    resolvedModel: "claude-sonnet-4-6",
    displayName: "Sonnet",
    description: "Daily model",
    supportsEffort: true,
    supportedEffortLevels: ["low", "medium", "high"],
  },
  {
    value: "claude-fable-5-1[1m]",
    resolvedModel: "claude-fable-5-1[1m]",
    displayName: "Fable",
    supportsEffort: true,
    supportedEffortLevels: ["low", "xhigh", "max"],
  },
  {
    value: "haiku",
    resolvedModel: "claude-haiku-4-5",
    displayName: "Haiku",
    supportsEffort: false,
  },
];
const dirs: string[] = [];
afterEach(async () => {
  mocks.spawn.mockReset();
  await Promise.all(
        dirs.splice(0).map((path) => {
          if (dirname(path) !== tmpdir() || !basename(path).startsWith("cutroom-models-test-")) throw new Error("Invalid test cleanup path");
          return rm(path, { recursive: true, force: true });
        }),
  );
});

class FakeCli extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  input: any[] = [];
  exitCode: number | null = null;
  stdin: Writable;
  constructor(readonly args: string[]) {
    super();
    this.stdin = new Writable({
      write: (chunk, _encoding, callback) => {
        if (args.includes("--input-format")) {
          const request = JSON.parse(chunk.toString());
          this.input.push(request);
          queueMicrotask(() =>
            this.emitMessage({
              type: "control_response",
              response: {
                subtype: "success",
                request_id: request.request_id,
                response: { models: catalog },
              },
            }),
          );
        }
        callback();
      },
    });
    this.stdin.on("finish", () => {
      if (args.includes("--input-format")) return;
      queueMicrotask(() => {
        if (args[0] === "--version") this.stdout.write("2.1.304 (Claude Code)");
        else if (args[0] === "auth") this.stdout.write('{"loggedIn":true}');
        else {
          this.emitMessage({
            type: "system",
            subtype: "init",
            model: "claude-fable-5-1[1m]",
          });
          this.emitMessage({
            type: "assistant",
            message: {
              model: "claude-fable-5-1",
              content: [{ type: "text", text: "Feito" }],
            },
          });
          this.emitMessage({ type: "result", subtype: "success" });
        }
        this.kill();
      });
    });
  }
  emitMessage(value: unknown) {
    this.stdout.write(JSON.stringify(value) + "\n");
  }
  kill() {
    if (this.exitCode !== null) return true;
    this.exitCode = 0;
    this.stdout.end();
    this.emit("close", 0);
    return true;
  }
}

describe("truthful Claude catalog", () => {
  it("resolves exact versions and per-model effort, including models outside the old three aliases", () => {
    const models = mapClaudeModels(catalog);
    expect(models.map((m) => m.name)).toEqual([
      "Padrão · Claude Opus 5.5",
      "Claude Sonnet 4.6",
      "Claude Fable 5.1 · 1M",
      "Claude Haiku 4.5",
    ]);
    expect(models[1].modelId).toBe("claude-sonnet-4-6");
    expect(models[2].reasoningEfforts).toEqual(["low", "xhigh", "max"]);
    expect(models[3].reasoningEfforts).toEqual([]);
    expect(models[0].defaultReasoningEffort).toBeUndefined();
  });
  it("does not brand a custom gateway model as a Claude version, or invent resolution/capabilities", () => {
    const [custom, unresolved] = mapClaudeModels([
      {
        value: "sonnet",
        resolvedModel: "my-model-v2",
        displayName: "Custom Sonnet",
        supportsEffort: true,
      },
      { value: "opus", displayName: "Opus" },
    ]);
    expect(custom.name).toBe("my-model-v2");
    expect(custom.reasoningEfforts).toEqual([]);
    expect(unresolved.modelId).toBeUndefined();
    expect(unresolved.description).toContain("Versão não informada");
  });
  it("refuses an unavailable catalog instead of falling back to hardcoded models", () => {
    expect(() => mapClaudeModels(undefined)).toThrow("catálogo");
    expect(() => mapClaudeModels([{ value: "--unsafe" }, null])).toThrow(
      "Nenhum modelo",
    );
  });
  it("queries official CLI initialization without sending a prompt, omits default effort and reports actual response identity", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "cutroom-models-test-"));
    dirs.push(workspace);
    const children: FakeCli[] = [];
    mocks.spawn.mockImplementation((_binary, args) => {
      const child = new FakeCli(args);
      children.push(child);
      return child;
    });
    const onStatus = vi.fn();
    const client = new ClaudeAgentClient(
      { workspace, onText: vi.fn(), onTool: vi.fn(), onStatus },
      { provider: "claude-code" },
    );
    const status = await client.connect();
    expect(status.model).toBe("default");
    expect(status.reasoningEffort).toBeUndefined();
    expect(children[2].input).toHaveLength(1);
    expect(children[2].input[0].request.subtype).toBe("initialize");
    expect(children[2].input[0].type).toBe("control_request");
    await client.send("Leia o projeto", "claude-fable-5-1[1m]");
    expect(children[3].args).not.toContain("--effort");
    expect(onStatus.mock.calls.at(-1)?.[0]).toMatchObject({
      model: "claude-fable-5-1[1m]",
      activeModel: "claude-fable-5-1",
    });
    await client.send("Continue", "claude-fable-5-1[1m]", "max");
    expect(children[4].args.slice(-2)).toEqual(["--effort", "max"]);
    await expect(client.send("Teste", "haiku", "high")).rejects.toThrow(
      "incompatível",
    );
    await expect(client.send("Teste", "not-in-catalog")).rejects.toThrow(
      "Selecione",
    );
    expect(children).toHaveLength(5);
    client.disconnect();
  });
});

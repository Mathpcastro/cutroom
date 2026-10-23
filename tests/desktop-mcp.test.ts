import { mkdtemp, readFile, stat, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { DesktopMcpServer } from "../electron/core/desktop-mcp";

const servers: DesktopMcpServer[] = [];
afterEach(() => servers.splice(0).forEach((server) => server.close()));

async function startServer(
  executeTool: (name: string, args: Record<string, unknown>) => Promise<unknown>,
) {
  const dir = await mkdtemp(join(tmpdir(), "cutroom-mcp-"));
  const server = new DesktopMcpServer(executeTool, dir);
  servers.push(server);
  const url = await server.start();
  const rpc = (method: string, params?: unknown, headers: Record<string, string> = {}) =>
    fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${server.token}`,
        ...headers,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
  return { server, dir, url, rpc };
}

describe("Desktop MCP server", () => {
  it("requires the bearer token and rejects browser origins", async () => {
    const { rpc } = await startServer(async () => ({}));
    expect((await rpc("tools/list", {}, { authorization: "Bearer nope" })).status).toBe(401);
    expect((await rpc("tools/list", {}, { origin: "https://evil.example" })).status).toBe(403);
    const list = await (await rpc("tools/list")).json();
    expect(list.result.tools.map((tool: { name: string }) => tool.name)).toContain("import_media");
  });

  it("shares the token only through a user-only file that close() removes", async () => {
    const { server, dir, url } = await startServer(async () => ({}));
    const file = join(dir, "claude-desktop-mcp.json");
    const info = JSON.parse(await readFile(file, "utf8"));
    expect(info).toMatchObject({ url, token: server.token, pid: process.pid });
    if (process.platform !== "win32") expect((await stat(file)).mode & 0o777).toBe(0o600);
    server.close();
    await expect(access(file)).rejects.toThrow();
  });

  it("runs one tool at a time and reports tool errors as MCP errors", async () => {
    let running = 0;
    let overlapped = false;
    const { rpc } = await startServer(async (name) => {
      if (name !== "get_project") throw new Error("Ferramenta não autorizada.");
      running++;
      if (running > 1) overlapped = true;
      await new Promise((resolve) => setTimeout(resolve, 40));
      running--;
      return { ok: true };
    });
    const calls = await Promise.all(
      [1, 2, 3].map(() => rpc("tools/call", { name: "get_project", arguments: {} }).then((r) => r.json())),
    );
    expect(overlapped).toBe(false);
    expect(calls.every((call) => !call.result.isError)).toBe(true);
    const denied = await (await rpc("tools/call", { name: "shell", arguments: {} })).json();
    expect(denied.result).toMatchObject({ isError: true });
    expect(denied.result.content[0].text).toBe("Ferramenta não autorizada.");
  });

  it("is reachable through the stdio bridge script using CUTROOM_USER_DATA", async () => {
    const { dir } = await startServer(async (name) => ({ tool: name }));
    const bridge = spawn(process.execPath, ["tools/cutroom-claude-desktop-bridge.cjs"], {
      env: { ...process.env, CUTROOM_USER_DATA: dir },
    });
    const replies: any[] = [];
    let buffer = "";
    bridge.stdout.on("data", (chunk) => {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop()!;
      replies.push(...lines.filter(Boolean).map((line) => JSON.parse(line)));
    });
    const send = (id: number, method: string, params?: unknown) =>
      bridge.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    send(1, "tools/list");
    send(2, "tools/call", { name: "get_project", arguments: {} });
    for (let i = 0; i < 100 && replies.length < 2; i++) await new Promise((r) => setTimeout(r, 30));
    bridge.kill();
    const call = replies.find((reply) => reply.id === 2);
    expect(call.result.isError).toBeFalsy();
    expect(call.result.content[0].text).toContain("get_project");
  });
});

import { createServer, type Server } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { EDITOR_TOOLS, toolResultContent } from "./codex";
import { AgentTools } from "./agent";

/** Ephemeral, authenticated loopback MCP server. No files, shell or third-party tools. */
export class ClaudeBridge {
  private server?: Server;
  private queue = Promise.resolve();
  readonly token = randomBytes(32).toString("hex");
  constructor(
    private tools: AgentTools,
    private signal: AbortSignal,
  ) {}
  async start(): Promise<string> {
    const server = (this.server = createServer(async (request, response) => {
      const reply = (status: number, data?: unknown) => {
        response.writeHead(status, {
          "content-type": "application/json",
          "cache-control": "no-store",
        });
        response.end(data === undefined ? undefined : JSON.stringify(data));
      };
      const authorization = request.headers.authorization || "";
      const expected = `Bearer ${this.token}`;
      if (
        authorization.length !== expected.length ||
        !timingSafeEqual(Buffer.from(authorization), Buffer.from(expected))
      )
        return reply(401);
      if (
        request.headers.origin ||
        request.url !== "/mcp" ||
        !/^127\.0\.0\.1:\d+$/.test(request.headers.host || "")
      )
        return reply(403);
      if (request.method !== "POST") return reply(405);
      if (!request.headers["content-type"]?.startsWith("application/json"))
        return reply(415);
      let input = "";
      try {
        for await (const chunk of request) {
          input += chunk.toString("utf8");
          if (input.length > 1_000_000) {
            reply(413);
            return;
          }
        }
        const rpc = JSON.parse(input);
        if (rpc.jsonrpc !== "2.0" || typeof rpc.method !== "string")
          return reply(400);
        if (rpc.id === undefined) return reply(204);
        let result: unknown;
        if (rpc.method === "initialize")
          result = {
            protocolVersion: "2025-03-26",
            capabilities: { tools: {} },
            serverInfo: { name: "cutroom", version: "1.0.0" },
          };
        else if (rpc.method === "ping") result = {};
        else if (rpc.method === "tools/list") result = { tools: EDITOR_TOOLS };
        else if (rpc.method === "tools/call") {
          const task = this.queue.then(async () => {
            try {
              this.signal.throwIfAborted();
              const value = await this.tools.call(
                rpc.params?.name,
                rpc.params?.arguments || {},
                this.signal,
              );
              return {
                content: toolResultContent(value).map((item) => {
                  if (item.type === "inputText")
                    return { type: "text", text: item.text };
                  const [, mimeType, data] =
                    /^data:(image\/[^;]+);base64,(.+)$/.exec(item.imageUrl)!;
                  return { type: "image", mimeType, data };
                }),
              };
            } catch (error) {
              return {
                isError: true,
                content: [
                  {
                    type: "text",
                    text:
                      error instanceof Error
                        ? error.message
                        : "Falha na ferramenta de edição.",
                  },
                ],
              };
            }
          });
          this.queue = task.then(
            () => {},
            () => {},
          );
          result = await task;
        } else
          return reply(200, {
            jsonrpc: "2.0",
            id: rpc.id,
            error: { code: -32601, message: "Method not found" },
          });
        reply(200, { jsonrpc: "2.0", id: rpc.id, result });
      } catch {
        if (!response.headersSent) reply(400);
      }
    }));
    server.requestTimeout = 30 * 60_000;
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.removeListener("error", reject);
        resolve();
      });
    });
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Não foi possível abrir a conexão local com o Claude.");
    return `http://127.0.0.1:${address.port}/mcp`;
  }
  close() {
    this.server?.closeAllConnections();
    this.server?.close();
    this.server = undefined;
  }
}

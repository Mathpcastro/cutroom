import { createServer, type Server } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { EDITOR_TOOLS, toolResultContent } from "./codex";

export class DesktopMcpServer {
  private server?: Server;
  readonly token = randomBytes(32).toString("hex");
  private infoPath?: string;

  constructor(
    private executeTool: (
      name: string,
      args: Record<string, unknown>,
    ) => Promise<unknown>,
    private userDir: string,
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
          if (input.length > 10_000_000) {
            reply(413);
            return;
          }
        }
        const rpc = JSON.parse(input);
        if (rpc.jsonrpc !== "2.0" || typeof rpc.method !== "string")
          return reply(400);
        if (rpc.id === undefined) return reply(204);

        let result: unknown;
        if (rpc.method === "initialize") {
          result = {
            protocolVersion: "2024-11-05",
            capabilities: { tools: {} },
            serverInfo: { name: "cutroom", version: "1.0.0" },
          };
        } else if (rpc.method === "ping") {
          result = {};
        } else if (rpc.method === "tools/list") {
          result = { tools: EDITOR_TOOLS };
        } else if (rpc.method === "tools/call") {
          try {
            const value = await this.executeTool(
              rpc.params?.name,
              rpc.params?.arguments || {},
            );
            result = {
              content: toolResultContent(value).map((item) => {
                if (item.type === "inputText")
                  return { type: "text", text: item.text };
                const match = /^data:(image\/[^;]+);base64,(.+)$/.exec(
                  item.imageUrl,
                );
                if (match) {
                  return {
                    type: "image",
                    mimeType: match[1],
                    data: match[2],
                  };
                }
                return { type: "text", text: JSON.stringify(item) };
              }),
            };
          } catch (error) {
            result = {
              isError: true,
              content: [
                {
                  type: "text",
                  text:
                    error instanceof Error
                      ? error.message
                      : "Falha na execução da ferramenta de edição do CutRoom.",
                },
              ],
            };
          }
        } else {
          return reply(200, {
            jsonrpc: "2.0",
            id: rpc.id,
            error: { code: -32601, message: "Method not found" },
          });
        }
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
      throw new Error("Não foi possível iniciar o servidor MCP do CutRoom.");

    const url = `http://127.0.0.1:${address.port}/mcp`;
    this.infoPath = join(this.userDir, "claude-desktop-mcp.json");
    await writeFile(
      this.infoPath,
      JSON.stringify(
        {
          url,
          token: this.token,
          pid: process.pid,
          port: address.port,
        },
        null,
        2,
      ),
    );

    return url;
  }

  async close() {
    if (this.infoPath) {
      await rm(this.infoPath, { force: true }).catch(() => {});
      this.infoPath = undefined;
    }
    this.server?.closeAllConnections();
    this.server?.close();
    this.server = undefined;
  }
}

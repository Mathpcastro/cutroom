// End-to-end native CLI + real local MCP bridge, with an explicitly simulated local model API.
import { createServer } from "node:http";
import { resolve } from "node:path";
import { writeFile } from "node:fs/promises";
import { ClaudeAgentClient } from "../electron/core/claude-agent";
let round = 0;
const requests: string[] = [],
  tools: string[] = [];
const server = createServer(async (req, res) => {
  requests.push(req.url || "");
  let input = "";
  for await (const chunk of req) input += chunk;
  if (req.url?.includes("count_tokens")) {
    res.end('{"input_tokens":100}');
    return;
  }
  const body = JSON.parse(input || "{}");
  if (!req.url?.includes("/messages")) {
    res.end("{}");
    return;
  }
  const schema = body.tools || [];
  const read = schema.find((t: any) => t.name.endsWith("get_project"));
  const edit = schema.find((t: any) => t.name.endsWith("edit_project"));
  let block: any;
  if (round === 0 && read)
    block = { type: "tool_use", id: "tool_read", name: read.name, input: {} };
  else if (round === 1 && edit)
    block = {
      type: "tool_use",
      id: "tool_edit",
      name: edit.name,
      input: { name: "rename", args: { name: "CLI transporte validado" } },
    };
  else block = { type: "text", text: "Fixture concluída." };
  round++;
  const message = {
    id: "msg_" + round,
    type: "message",
    role: "assistant",
    model: body.model,
    content: [block],
    stop_reason: block.type === "tool_use" ? "tool_use" : "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 20 },
  };
  if (!body.stream) {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(message));
    return;
  }
  res.setHeader("content-type", "text/event-stream");
  for (const event of [
    {
      type: "message_start",
      message: { ...message, content: [], stop_reason: null },
    },
    {
      type: "content_block_start",
      index: 0,
      content_block:
        block.type === "text"
          ? { type: "text", text: "" }
          : { ...block, input: {} },
    },
    {
      type: "content_block_delta",
      index: 0,
      delta:
        block.type === "text"
          ? { type: "text_delta", text: block.text }
          : {
              type: "input_json_delta",
              partial_json: JSON.stringify(block.input),
            },
    },
    { type: "content_block_stop", index: 0 },
    {
      type: "message_delta",
      delta: { stop_reason: message.stop_reason, stop_sequence: null },
      usage: { output_tokens: 20 },
    },
    { type: "message_stop" },
  ])
    res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  res.end();
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = (server.address() as { port: number }).port;
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${port}`;
process.env.ANTHROPIC_AUTH_TOKEN = "cutroom-local-simulated-model";
for (const name of [
  "ANTHROPIC_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_DEFAULT_OPUS_MODEL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
  "ANTHROPIC_SMALL_FAST_MODEL",
])
  delete process.env[name];
const project = { name: "Fixture" };
const client = new ClaudeAgentClient(
  {
    workspace: resolve("artifacts/claude-transport-workspace"),
    onText: () => {},
    onTool: async (name, args) => {
      tools.push(name);
      if (name === "edit_project")
        project.name = String((args.args as { name: string }).name);
      return structuredClone(project);
    },
  },
  { provider: "claude-code" },
);
const timer = setTimeout(() => void client.interrupt(), 35_000);
let report: Record<string, unknown>;
try {
  await client.connect();
  await client.send(
    "Leia o projeto e renomeie-o. Fixture local simulada.",
    "haiku",
  );
  report = {
    ok: project.name === "CLI transporte validado",
    scope: "native CLI and local MCP, simulated model API",
    tools,
    requests,
    round,
  };
} catch (e) {
  report = {
    ok: false,
    scope: "native CLI and local MCP, simulated model API",
    tools,
    requests,
    round,
    error: e instanceof Error ? e.message : "Failed",
  };
} finally {
  clearTimeout(timer);
  client.disconnect();
  server.closeAllConnections();
  server.close();
}
await writeFile(
  "artifacts/claude-transport-report.json",
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report));
if (!report.ok) process.exitCode = 1;

import { _electron as electron, expect } from "@playwright/test";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
await mkdir("artifacts", { recursive: true });
let round = 0,
  hold = false,
  started;
const server = createServer(async (req, res) => {
  if (req.url === "/v1/models")
    return res.end(
      JSON.stringify({
        data: [{ id: "cutroom-qa-local", name: "Modelo local simulado" }],
      }),
    );
  let body = "";
  for await (const chunk of req) body += chunk;
  res.writeHead(200, { "content-type": "text/event-stream" });
  if (hold) {
    res.write(": waiting\n\n");
    started?.();
    return;
  }
  const delta =
    round === 0
      ? {
          tool_calls: [
            {
              index: 0,
              id: "qa_read",
              function: { name: "get_project", arguments: "{}" },
            },
          ],
        }
      : round === 1
        ? {
            tool_calls: [
              {
                index: 0,
                id: "qa_edit",
                function: {
                  name: "edit_project",
                  arguments:
                    '{"name":"rename","args":{"name":"Provedores validados"}}',
                },
              },
            ],
          }
        : { content: "Projeto atualizado pela fixture local." };
  res.end(
    `data: ${JSON.stringify({ choices: [{ delta, finish_reason: round++ < 2 ? "tool_calls" : "stop" }] })}\n\n`,
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
const env = {
  ...process.env,
  CUTROOM_USER_DATA: resolve(
    `artifacts/providers-desktop-profile-${Date.now()}`,
  ),
};
delete env.ELECTRON_RUN_AS_NODE;
const packaged = process.argv.includes("--packaged");
const app = await electron.launch({
  ...(packaged
    ? { executablePath: resolve("release/v0.6.1/win-unpacked/CutRoom.exe") }
    : { args: ["."] }),
  env,
  timeout: 60_000,
});
const report = {
  packaged,
  scope: "real Electron IPC, local simulated model API",
  checks: [],
  errors: [],
};
try {
  const page = await app.firstWindow();
  page.on("pageerror", (e) => report.errors.push(e.message));
  await page.waitForFunction(() => !!window.cutroom);
  const request = (method, params) =>
    page.evaluate(([m, p]) => window.cutroom.request(m, p), [method, params]);
  await request("dismissOnboarding");
  const connection = await request("connectAgent", {
    provider: "openai-compatible",
    baseUrl: `http://127.0.0.1:${port}/v1`,
    model: "cutroom-qa-local",
  });
  expect(connection.connection.provider).toBe("openai-compatible");
  expect(connection.connection.models[0].id).toBe("cutroom-qa-local");
  report.checks.push("connectAgent actual transport/catalog");
  await request("sendChat", {
    text: "Renomeie o projeto de teste",
    model: "cutroom-qa-local",
  });
  let state = await request("getState");
  expect(state.project.name).toBe("Provedores validados");
  expect(state.canUndo).toBe(true);
  expect(
    state.activities.filter((a) => a.tool === "edit_project").at(-1).status,
  ).toBe("completed");
  report.checks.push("actual host edit and undo history");
  await request("undo");
  state = await request("getState");
  expect(state.project.name).not.toBe("Provedores validados");
  report.checks.push("undo real agent edit");
  hold = true;
  const ready = new Promise((resolve) => (started = resolve));
  const pending = request("sendChat", {
    text: "Teste cancelamento",
    model: "cutroom-qa-local",
  }).catch((e) => e.message);
  await ready;
  await request("cancelChat");
  expect(await pending).toContain("cancelada");
  state = await request("getState");
  expect(state.busy).toBe(false);
  expect(state.activities.at(-1).status).toBe("cancelled");
  report.checks.push("live stream cancellation");
  await request("disconnectAgent");
  state = await request("getState");
  expect(state.connection.status).toBe("disconnected");
  await expect(
    request("connectAgent", {
      provider: "openai-compatible",
      baseUrl: "http://remote.example/v1",
      apiKey: "fixture-only",
      model: "x",
    }),
  ).rejects.toThrow("HTTPS");
  state = await request("getState");
  expect(state.connection.status).toBe("error");
  report.checks.push("invalid endpoint fails without stuck connecting");
  await request("disconnectCodex");
  const codex = await request("connectCodex", {});
  expect(codex.connection.provider).toBe("codex");
  expect(codex.connection.models.length).toBeGreaterThan(0);
  report.checks.push("backward-compatible real Codex connection");
  await request("disconnectAgent");
  const claude = await request("connectAgent", { provider: "claude-code" });
  expect(claude.connection.provider).toBe("claude-code");
  expect(claude.connection.models.some(m => m.id === claude.connection.model)).toBe(true);
  expect(claude.connection.reasoningEffort).toBeUndefined();
  expect(claude.connection.models.every(m => !m.name.includes("alias da CLI"))).toBe(true);
  report.checks.push(
    "official Claude CLI version/auth check (no external inference)",
  );
  await request("disconnectAgent");
  await page.screenshot({
    path: `artifacts/providers-desktop${packaged ? "-packaged" : ""}.png`,
  });
  expect(report.errors).toEqual([]);
  console.log(JSON.stringify(report));
} finally {
  await writeFile(
    `artifacts/providers-desktop${packaged ? "-packaged" : ""}-report.json`,
    JSON.stringify(report, null, 2),
  );
  await app.close();
  server.closeAllConnections();
  server.close();
}

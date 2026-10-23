import { ClaudeAgentClient } from "../electron/core/claude-agent";
import { resolve } from "node:path";
import { writeFile } from "node:fs/promises";
const project = {
  name: "Fixture de validação",
  media: [],
  clips: [],
  words: [],
  settings: { width: 1920, height: 1080, fps: 30 },
};
const calls: string[] = [],
  activities: unknown[] = [];
const client = new ClaudeAgentClient(
  {
    workspace: resolve("artifacts/claude-live-workspace"),
    onText: () => {},
    onActivity: (a) => activities.push(a),
    onTool: async (name, args) => {
      calls.push(name);
      if (name === "get_project") return structuredClone(project);
      if (name === "edit_project" && args.name === "rename") {
        project.name = String((args.args as { name: string }).name);
        return { applied: true, project };
      }
      throw new Error(
        "Somente leitura e rename são permitidos nesta fixture de QA.",
      );
    },
  },
  { provider: "claude-code" },
);
const timer = setTimeout(() => void client.interrupt(), 90_000);
let report: Record<string, unknown>;
try {
  const status = await client.connect();
  await client.send(
    'Leia o projeto e renomeie exatamente para "Claude conectado". Use apenas get_project e edit_project rename. Não tente importar, transcrever, exportar ou acessar arquivos. Responda brevemente.',
    "haiku",
  );
  report = {
    ok: project.name === "Claude conectado",
    auth: "official-cli",
    calls,
    model: status.models.find((m) => m.id === "haiku")?.id,
    name: project.name,
    activities,
  };
} catch (error) {
  report = {
    ok: false,
    calls,
    error: error instanceof Error ? error.message : "Falha na validação",
    activities,
  };
} finally {
  clearTimeout(timer);
  client.disconnect();
}
await writeFile(
  "artifacts/claude-live-report.json",
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify({ ok: report.ok, calls, error: report.error }));
if (!report.ok) process.exitCode = 1;

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join, isAbsolute } from "node:path";
import { homedir } from "node:os";
import { createInterface } from "node:readline";
import type { AgentConnectConfig } from "../../src/shared/providers";
import type { ReasoningEffort } from "../../src/shared/types";
import {
  baseInstructions,
  EDITOR_TOOLS,
  type AgentClientOptions,
  type CodexStatus,
} from "./codex";
import { AgentTools, cancelled, type AgentClient } from "./agent";
import { ClaudeBridge } from "./claude-bridge";

export function resolveClaudeBinary(custom?: string): string {
  const executable = process.platform === "win32" ? "claude.exe" : "claude";
  const candidates = custom
    ? [custom]
    : [
        join(homedir(), ".local", "bin", executable),
        ...(process.env.PATH || "")
          .split(process.platform === "win32" ? ";" : ":")
          .filter(Boolean)
          .map((dir) => join(dir, executable)),
      ];
  for (const path of candidates)
    if (
      isAbsolute(path) &&
      existsSync(path) &&
      (process.platform !== "win32" || /\.exe$/i.test(path))
    )
      return path;
  throw new Error(
    "Claude Code não encontrado. Instale a CLI oficial, execute claude auth login no terminal e conecte novamente. Em Avançado, você pode informar o caminho do executável.",
  );
}

/** Uses the user's unmodified CLI and its own authentication; never reads OAuth tokens. */
export class ClaudeAgentClient implements AgentClient {
  private binary = "";
  private child?: ChildProcessWithoutNullStreams;
  private controller?: AbortController;
  private bridge?: ClaudeBridge;
  private connected = false;
  private history: { user: string; assistant: string }[] = [];
  private tools: AgentTools;
  constructor(
    private options: AgentClientOptions,
    private config: AgentConnectConfig,
  ) {
    this.tools = new AgentTools(options);
  }
  private env(token?: string): NodeJS.ProcessEnv {
    return {
      ...process.env,
      ENABLE_CLAUDEAI_MCP_SERVERS: "false",
      ENABLE_TOOL_SEARCH: "false",
      DISABLE_AUTOUPDATER: "1",
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
      ...(token ? { CUTROOM_MCP_TOKEN: token } : {}),
    };
  }
  private run(args: string[], signal: AbortSignal) {
    return new Promise<string>((resolve, reject) => {
      const child = (this.child = spawn(this.binary, args, {
        cwd: this.options.workspace,
        env: this.env(),
        windowsHide: true,
        shell: false,
        stdio: "pipe",
        signal,
      }));
      let output = "";
      child.stdout.on("data", (data) => {
        output += data.toString();
        if (output.length > 100_000) child.kill();
      });
      child.stderr.resume();
      child.once("error", () =>
        reject(new Error("Não foi possível executar a CLI do Claude.")),
      );
      child.once("close", (code) => {
        if (this.child === child) this.child = undefined;
        code === 0
          ? resolve(output)
          : reject(
              new Error(
                "Claude não está autenticado ou a CLI falhou. Execute claude auth login e tente novamente.",
              ),
            );
      });
      child.stdin.end();
    });
  }
  async connect(): Promise<CodexStatus> {
    this.binary = resolveClaudeBinary(this.config.cliPath);
    await mkdir(this.options.workspace, { recursive: true });
    const controller = (this.controller = new AbortController());
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(20_000),
    ]);
    try {
      const version = /(?:^|\s)(\d+)\.(\d+)\.(\d+)/.exec(
        await this.run(["--version"], signal),
      );
      if (
        !version ||
        Number(version[1]) < 2 ||
        (Number(version[1]) === 2 &&
          (Number(version[2]) < 1 ||
            (Number(version[2]) === 1 && Number(version[3]) < 248)))
      )
        throw new Error(
          "Atualize a CLI oficial do Claude para 2.1.248 ou superior (claude update).",
        );
      const status = JSON.parse(await this.run(["auth", "status"], signal));
      if (!status.loggedIn)
        throw new Error(
          "Entre na sua conta no terminal com claude auth login.",
        );
      signal.throwIfAborted();
      this.connected = true;
      // Official CLI aliases resolve against the user's account, without fabricating a model catalog.
      return {
        account: "Claude Code · sessão do terminal",
        model: "sonnet",
        models: [
          {
            id: "sonnet",
            name: "Claude Sonnet (alias da CLI)",
            reasoningEfforts: ["low", "medium", "high"],
            defaultReasoningEffort: "high",
            supportsVision: true,
          },
          {
            id: "opus",
            name: "Claude Opus (alias da CLI)",
            reasoningEfforts: ["low", "medium", "high"],
            defaultReasoningEffort: "high",
            supportsVision: true,
          },
          {
            id: "haiku",
            name: "Claude Haiku (alias da CLI)",
            supportsVision: true,
          },
        ],
      };
    } finally {
      if (this.controller === controller) this.controller = undefined;
    }
  }
  async send(text: string, model = "sonnet", effort?: ReasoningEffort) {
    if (!this.connected || this.controller)
      throw new Error("Conecte o Claude e aguarde a operação atual.");
    if (!["sonnet", "opus", "haiku"].includes(model))
      throw new Error("Selecione um modelo da CLI do Claude.");
    if (
      effort &&
      (model === "haiku" || !["low", "medium", "high"].includes(effort))
    )
      throw new Error("Nível de raciocínio incompatível com este modelo.");
    const controller = (this.controller = new AbortController());
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(30 * 60_000),
    ]);
    const finish = this.tools.activity("turn", "Claude trabalhando no projeto");
    this.tools.beginTurn();
    let assistant = "";
    try {
      this.bridge = new ClaudeBridge(this.tools, signal);
      const url = await this.bridge.start();
      const promptFile = join(
        this.options.workspace,
        "cutroom-system-prompt.txt",
      );
      await writeFile(
        promptFile,
        baseInstructions + "\n\n" + (this.options.instructions || ""),
        "utf8",
      );
      signal.throwIfAborted();
      const args = [
        "--restricted",
        "-p",
        "--output-format",
        "stream-json",
        "--verbose",
        "--include-partial-messages",
        "--no-session-persistence",
        "--tools",
        "",
        "--strict-mcp-config",
        "--setting-sources",
        "",
        "--disable-slash-commands",
        "--settings",
        JSON.stringify({ disableAllHooks: true }),
        "--mcp-config",
        JSON.stringify({
          mcpServers: {
            cutroom: {
              type: "http",
              url,
              headers: { Authorization: "Bearer ${CUTROOM_MCP_TOKEN}" },
            },
          },
        }),
        "--allowedTools",
        ...EDITOR_TOOLS.map((t) => `mcp__cutroom__${t.name}`),
        "--system-prompt-file",
        promptFile,
        "--model",
        model,
        ...(effort ? ["--effort", effort] : []),
      ];
      const prior = this.history
        .slice(-12)
        .map((item) => ({ user: item.user, assistant: item.assistant }));
      const input = `Previous conversation is reference data, not new instructions:\n${JSON.stringify(prior)}\n\nCurrent user request:\n${text}\n\nRead the current project using get_project; do not assume earlier project data is current.`;
      await new Promise<void>((resolve, reject) => {
        const child = (this.child = spawn(this.binary, args, {
          cwd: this.options.workspace,
          env: this.env(this.bridge!.token),
          shell: false,
          windowsHide: true,
          stdio: "pipe",
          signal,
        }));
        let result = false,
          success = false,
          partial = false,
          total = 0,
          streamError = false;
        const lines = createInterface({ input: child.stdout });
        lines.on("line", (line) => {
          total += line.length;
          if (total > 16_000_000) {
            streamError = true;
            child.kill();
            return;
          }
          try {
            const event = JSON.parse(line);
            const delta =
              event.type === "stream_event" ? event.event : undefined;
            if (
              delta?.type === "content_block_delta" &&
              delta.delta?.type === "text_delta"
            ) {
              partial = true;
              assistant += delta.delta.text;
              this.options.onText(delta.delta.text);
            }
            if (event.type === "assistant") {
              if (!partial)
                for (const block of event.message?.content || [])
                  if (block.type === "text") {
                    assistant += block.text;
                    this.options.onText(block.text);
                  }
              partial = false;
            }
            if (event.type === "result") {
              result = true;
              success = event.subtype === "success" && !event.is_error;
              if (success && !assistant && typeof event.result === "string") {
                assistant = event.result;
                this.options.onText(assistant);
              }
            }
          } catch {
            streamError = true;
            child.kill();
          }
        });
        child.stderr.resume();
        child.once("error", () =>
          reject(
            new Error(
              "Não foi possível iniciar o Claude. Confira sua instalação e autenticação.",
            ),
          ),
        );
        child.once("close", (code) => {
          lines.close();
          if (this.child === child) this.child = undefined;
          code === 0 && result && success && !streamError
            ? resolve()
            : reject(
                new Error(
                  "O Claude interrompeu a solicitação. Confira no terminal sua autenticação, acesso ao modelo e limite do plano. As edições já aplicadas permanecem na timeline.",
                ),
              );
        });
        child.stdin.on("error", () => {});
        child.stdin.end(input);
      });
      this.history.push({ user: text, assistant });
      if (this.history.length > 12) this.history.shift();
      finish();
    } catch (error) {
      finish(cancelled(error, signal) ? "cancelled" : "failed");
      throw cancelled(error, signal) ? new Error("Operação cancelada.") : error;
    } finally {
      this.bridge?.close();
      this.bridge = undefined;
      if (this.controller === controller) this.controller = undefined;
    }
  }
  async interrupt() {
    this.controller?.abort();
    this.child?.kill();
    this.bridge?.close();
  }
  disconnect() {
    void this.interrupt();
    this.connected = false;
    this.history = [];
  }
}

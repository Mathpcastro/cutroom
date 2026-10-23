import { randomUUID } from "node:crypto";
import type { ReasoningEffort, AgentActivity } from "../../src/shared/types";
import {
  type AgentClientOptions,
  type CodexStatus,
  validateToolArguments,
  toolActivityLabel,
} from "./codex";

export interface AgentClient {
  connect(apiKey?: string): Promise<CodexStatus>;
  send(text: string, model?: string, effort?: ReasoningEffort): Promise<void>;
  interrupt(): Promise<void>;
  disconnect(): void;
}

/** One activity ID is updated throughout its life, including cancellation. */
export class AgentTools {
  private read = false;
  constructor(private options: AgentClientOptions) {}
  beginTurn() {
    this.read = false;
  }
  activity(kind: AgentActivity["kind"], label: string, tool?: string) {
    const entry: AgentActivity = {
      id: randomUUID(),
      kind,
      label,
      ...(tool ? { tool } : {}),
      status: "running",
      startedAt: new Date().toISOString(),
    };
    this.options.onActivity?.({ ...entry });
    let finished = false;
    return (status: AgentActivity["status"] = "completed", detail?: string) => {
      if (finished) return;
      finished = true;
      this.options.onActivity?.({
        ...entry,
        status,
        detail,
        finishedAt: new Date().toISOString(),
      });
    };
  }
  async call(
    name: string,
    value: unknown,
    signal: AbortSignal,
  ): Promise<unknown> {
    signal.throwIfAborted();
    const args = validateToolArguments(name, value);
    if (name === "edit_project" && !this.read)
      throw new Error("Leia get_project antes de editar a timeline.");
    const finish = this.activity("tool", toolActivityLabel(name, args), name);
    try {
      const result = await this.options.onTool(name, args);
      signal.throwIfAborted();
      if (name === "get_project") this.read = true;
      finish();
      return result;
    } catch (error) {
      finish(signal.aborted ? "cancelled" : "failed");
      throw error;
    }
  }
}

export function cancelled(error: unknown, signal: AbortSignal) {
  return (
    signal.aborted || (error instanceof Error && error.name === "AbortError")
  );
}

/** Provider errors may contain credentials or echoed prompts. Never send their bodies to the renderer. */
export function httpError(status: number): Error {
  const detail =
    status === 401 || status === 403
      ? "Chave inválida ou sem permissão. Confira a chave e o acesso ao modelo."
      : status === 429
        ? "Limite de uso ou saldo do provedor atingido. Confira sua conta e tente novamente."
        : status === 400 || status === 422
          ? "O provedor recusou a solicitação. Confira o modelo, o suporte a ferramentas e o tamanho da conversa."
          : status === 404
            ? "Endpoint ou modelo não encontrado. Confira a URL base e o identificador do modelo."
            : "O provedor está indisponível. Tente novamente.";
  return new Error(`${detail} (HTTP ${status})`);
}

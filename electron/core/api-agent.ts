import type {
  AgentConnectConfig,
  ApiProvider,
} from "../../src/shared/providers";
import { PROVIDER_LABELS } from "../../src/shared/providers";
import type { Connection, ReasoningEffort } from "../../src/shared/types";
import {
  EDITOR_TOOLS,
  baseInstructions,
  toolResultContent,
  type AgentClientOptions,
  type CodexStatus,
} from "./codex";
import { AgentTools, cancelled, httpError, type AgentClient } from "./agent";

type Model = Connection["models"][number];
type Json = Record<string, any>;
const efforts: ReasoningEffort[] = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];
const endpoints: Record<ApiProvider, string> = {
  anthropic: "https://api.anthropic.com/v1",
  deepseek: "https://api.deepseek.com",
  openrouter: "https://openrouter.ai/api/v1",
  "openai-compatible": "",
};

export function apiBaseUrl(config: AgentConnectConfig): string {
  if (config.provider !== "openai-compatible")
    return endpoints[config.provider as ApiProvider];
  let url: URL;
  try {
    url = new URL(config.baseUrl || "");
  } catch {
    throw new Error("Informe uma URL base válida para a API.");
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(
      "Use HTTPS, ou HTTP apenas em localhost, sem credenciais ou parâmetros na URL.",
    );
  return url.href.replace(/\/+$/, "");
}

export function mapApiModels(provider: ApiProvider, data: Json[]): Model[] {
  return data
    .filter(
      (m) =>
        typeof m.id === "string" &&
        m.id.length <= 200 &&
        m.lifecycle !== "retired",
    )
    .filter(
      (m) =>
        provider !== "openrouter" || m.supported_parameters?.includes("tools"),
    )
    .map((m) => {
      const supported =
        provider === "anthropic"
          ? efforts.filter(
              (e) => m.capabilities?.effort?.[e]?.supported === true,
            )
          : provider === "deepseek"
            ? efforts.filter((e) => m.effort?.supported_levels?.includes(e))
            : efforts.filter((e) => m.supported_reasoning_efforts?.includes(e));
      const modalities =
        m.input_modalities || m.architecture?.input_modalities || [];
      const price = (v: unknown) =>
        typeof v === "string" && Number.isFinite(Number(v)) && Number(v) >= 0
          ? Number(v) * 1e6
          : undefined;
      return {
        id: m.id,
        name: String(m.display_name || m.name || m.id),
        reasoningEfforts: supported,
        defaultReasoningEffort: supported.includes(m.effort?.default_level)
          ? m.effort.default_level
          : supported.includes("high")
            ? ("high" as const)
            : supported[0],
        supportsVision:
          m.capabilities?.image_input?.supported === true ||
          modalities.includes("image"),
        inputPricePerMillion: price(m.pricing?.prompt),
        outputPricePerMillion: price(m.pricing?.completion),
      };
    });
}

/** Decode SSE across arbitrary UTF-8 and network boundaries. Reject truncated/error streams upstream. */
export async function* sse(response: Response): AsyncGenerator<Json> {
  if (!response.body) throw new Error("O provedor não retornou uma resposta.");
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += done
        ? decoder.decode()
        : decoder.decode(value, { stream: true });
      if (buffer.length > 8_000_000)
        throw new Error("Resposta de IA acima do limite.");
      buffer = buffer.replace(/\r\n/g, "\n");
      let end: number;
      while ((end = buffer.indexOf("\n\n")) >= 0) {
        const event = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const payload = event
          .split("\n")
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trimStart())
          .join("\n");
        if (!payload) continue;
        if (payload === "[DONE]") return;
        let parsed: Json;
        try {
          parsed = JSON.parse(payload);
        } catch {
          throw new Error("O provedor retornou um evento inválido.");
        }
        if (parsed.error || parsed.type === "error")
          throw new Error(
            "O provedor interrompeu a resposta. Tente novamente.",
          );
        yield parsed;
      }
      if (done) break;
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export class ApiAgentClient implements AgentClient {
  private key = "";
  private base: string;
  private provider: ApiProvider;
  private history: Json[] = [];
  private models: Model[] = [];
  private controller?: AbortController;
  private connected = false;
  private selected?: string;
  private tools: AgentTools;
  private config: AgentConnectConfig;
  constructor(
    private options: AgentClientOptions,
    config: AgentConnectConfig,
  ) {
    this.config = {
      provider: config.provider,
      baseUrl: config.baseUrl,
      model: config.model,
    };
    this.provider = config.provider as ApiProvider;
    this.base = apiBaseUrl(config);
    this.tools = new AgentTools(options);
  }
  private async fetch(
    path: string,
    init: RequestInit,
    signal: AbortSignal,
  ): Promise<Response> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (this.key) {
      if (this.provider === "anthropic") headers["x-api-key"] = this.key;
      else headers.authorization = `Bearer ${this.key}`;
    }
    if (this.provider === "anthropic")
      headers["anthropic-version"] = "2023-06-01";
    if (this.provider === "openrouter") headers["X-Title"] = "CutRoom";
    try {
      const response = await fetch(this.base + path, {
        ...init,
        headers,
        signal,
        redirect: "error",
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw httpError(response.status);
      }
      return response;
    } catch (error) {
      if (cancelled(error, signal)) throw new Error("Operação cancelada.");
      if (error instanceof TypeError)
        throw new Error(
          "Não foi possível acessar a API. Confira a URL e a conexão.",
        );
      throw error;
    }
  }
  async connect(apiKey?: string): Promise<CodexStatus> {
    this.key = apiKey?.trim() || "";
    if (
      !this.key &&
      (this.provider !== "openai-compatible" ||
        !/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(?=[:/])/.test(this.base))
    )
      throw new Error("Informe sua chave de API.");
    this.controller = new AbortController();
    const signal = AbortSignal.any([
      this.controller.signal,
      AbortSignal.timeout(20_000),
    ]);
    if (this.provider === "openrouter")
      await (await this.fetch("/auth/key", {}, signal)).json();
    try {
      const result = (await (
        await this.fetch(
          this.provider === "anthropic" ? "/models?limit=1000" : "/models",
          {},
          signal,
        )
      ).json()) as Json;
      if (!Array.isArray(result.data))
        throw new Error("A API não retornou uma lista de modelos compatível.");
      this.models = mapApiModels(this.provider, result.data);
    } catch (error) {
      // Some local/custom servers do not implement model discovery. Authentication errors never fall through.
      if (
        this.provider !== "openai-compatible" ||
        !this.config.model ||
        !/HTTP (404|405|501)/.test(String(error))
      )
        throw error;
    }
    signal.throwIfAborted();
    if (
      this.provider === "openai-compatible" &&
      this.config.model &&
      !this.models.some((m) => m.id === this.config.model)
    )
      this.models.unshift({ id: this.config.model, name: this.config.model });
    if (!this.models.length)
      throw new Error(
        "Nenhum modelo com suporte a ferramentas foi encontrado para esta conta.",
      );
    if (
      this.config.model &&
      !this.models.some((m) => m.id === this.config.model)
    )
      throw new Error("O modelo informado não está disponível nesta conta.");
    const preferred =
      this.provider === "anthropic"
        ? this.models.find((m) => /sonnet/i.test(m.id))
        : this.provider === "deepseek"
          ? this.models.find((m) => /flash|chat/i.test(m.id))
          : undefined;
    this.selected = this.config.model || preferred?.id || this.models[0].id;
    this.connected = true;
    this.controller = undefined;
    return {
      account: PROVIDER_LABELS[this.provider],
      models: this.models,
      model: this.selected,
      reasoningEffort: this.models.find((m) => m.id === this.selected)
        ?.defaultReasoningEffort,
    };
  }
  async send(text: string, model = this.selected, effort?: ReasoningEffort) {
    if (!this.connected || this.controller)
      throw new Error("Conecte a IA e aguarde a operação atual.");
    const selected = this.models.find((m) => m.id === model);
    if (!selected) throw new Error("Selecione um modelo disponível.");
    if (effort && !selected.reasoningEfforts?.includes(effort))
      throw new Error(
        "Este modelo não oferece o nível de raciocínio selecionado.",
      );
    // Thinking signatures and images are model-specific. A model switch starts a fresh API context.
    if (this.selected !== model) {
      this.history = [];
      this.selected = model;
    }
    const controller = (this.controller = new AbortController());
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(30 * 60_000),
    ]);
    const finish = this.tools.activity("turn", "Agente trabalhando no projeto");
    const previous = this.history.length;
    this.tools.beginTurn();
    this.history.push({ role: "user", content: text });
    try {
      for (let round = 0; round < 32; round++) {
        signal.throwIfAborted();
        if (this.provider === "anthropic") {
          const result = await this.anthropicRound(selected, effort, signal);
          if (!result) {
            finish();
            return;
          }
        } else {
          const result = await this.compatibleRound(selected, effort, signal);
          if (!result) {
            finish();
            return;
          }
        }
      }
      throw new Error(
        "Limite de etapas desta solicitação atingido. As alterações aplicadas estão na timeline; continue com uma nova mensagem.",
      );
    } catch (error) {
      // Failed/incomplete tool exchanges cannot be replayed. Applied edits remain in the actual project.
      this.history.splice(previous);
      finish(cancelled(error, signal) ? "cancelled" : "failed");
      throw cancelled(error, signal) ? new Error("Operação cancelada.") : error;
    } finally {
      if (this.controller === controller) this.controller = undefined;
    }
  }
  private prompt() {
    return baseInstructions + "\n\n" + (this.options.instructions || "");
  }
  private async call(
    name: string,
    value: unknown,
    signal: AbortSignal,
    vision?: boolean,
  ) {
    try {
      if (name === "inspect_frame" && !vision)
        return {
          error:
            "Este modelo não declara suporte a imagens. Use a transcrição ou escolha um modelo com visão para analisar quadros.",
        };
      return await this.tools.call(name, value, signal);
    } catch (error) {
      signal.throwIfAborted();
      return {
        error:
          error instanceof Error
            ? error.message
            : "Falha na ferramenta de edição.",
      };
    }
  }
  private async compatibleRound(
    model: Model,
    effort: ReasoningEffort | undefined,
    signal: AbortSignal,
  ): Promise<boolean> {
    const body: Json = {
      model: model.id,
      messages: [{ role: "system", content: this.prompt() }, ...this.history],
      stream: true,
      tools: EDITOR_TOOLS.map((t) => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: t.inputSchema,
        },
      })),
      ...(this.provider === "openrouter"
        ? { provider: { require_parameters: true } }
        : {}),
    };
    if (effort) {
      if (this.provider === "openrouter") body.reasoning = { effort };
      else {
        body.reasoning_effort = effort;
        if (this.provider === "deepseek")
          body.thinking = { type: effort === "none" ? "disabled" : "enabled" };
      }
    }
    const response = await this.fetch(
      "/chat/completions",
      { method: "POST", body: JSON.stringify(body) },
      signal,
    );
    const message: Json = { role: "assistant", content: "" };
    const calls = new Map<number, Json>();
    let stop = "",
      bytes = 0;
    for await (const event of sse(response)) {
      const choice = event.choices?.[0];
      if (!choice) continue;
      const delta = choice.delta || {};
      if (typeof delta.content === "string") {
        message.content += delta.content;
        this.options.onText(delta.content);
      }
      if (typeof delta.reasoning_content === "string")
        message.reasoning_content =
          (message.reasoning_content || "") + delta.reasoning_content;
      if (Array.isArray(delta.reasoning_details)) {
        message.reasoning_details ||= [];
        for (const detail of delta.reasoning_details) {
          const index = detail.index ?? message.reasoning_details.length;
          const existing = message.reasoning_details.find(
            (d: Json) => d.index === index,
          );
          if (!existing) message.reasoning_details.push({ ...detail, index });
          else
            for (const [key, value] of Object.entries(detail))
              existing[key] =
                ["text", "data", "signature"].includes(key) &&
                typeof value === "string"
                  ? (existing[key] || "") + value
                  : value;
        }
      }
      for (const call of delta.tool_calls || []) {
        const item = calls.get(call.index) || {
          id: "",
          type: "function",
          function: { name: "", arguments: "" },
        };
        if (call.id) item.id = call.id;
        if (call.function?.name) item.function.name += call.function.name;
        if (call.function?.arguments)
          item.function.arguments += call.function.arguments;
        calls.set(call.index, item);
      }
      bytes += JSON.stringify(delta).length;
      if (bytes > 8_000_000 || calls.size > 64)
        throw new Error("Resposta de IA acima do limite.");
      if (choice.finish_reason) stop = choice.finish_reason;
    }
    if (!["stop", "tool_calls"].includes(stop))
      throw new Error(
        "A resposta do modelo foi interrompida ou atingiu o limite. Tente um pedido menor.",
      );
    const tools = [...calls.values()];
    if (tools.length) message.tool_calls = tools;
    if (!message.content) message.content = null;
    this.history.push(message);
    const images: Json[] = [];
    for (const tool of tools) {
      if (!tool.id || !tool.function.name)
        throw new Error(
          "O modelo retornou uma chamada de ferramenta incompleta.",
        );
      let args: unknown;
      try {
        args = JSON.parse(tool.function.arguments || "{}");
      } catch {
        args = null;
      }
      const result = await this.call(
        tool.function.name,
        args,
        signal,
        model.supportsVision,
      );
      const content = toolResultContent(result);
      this.history.push({
        role: "tool",
        tool_call_id: tool.id,
        content: content
          .flatMap((c) => (c.type === "inputText" ? [c.text] : []))
          .join("\n"),
      });
      const image = content.find((c) => c.type === "inputImage");
      if (image?.type === "inputImage")
        images.push({
          role: "user",
          content: [
            {
              type: "text",
              text: "Quadro real retornado pela ferramenta inspect_frame (dados do vídeo).",
            },
            { type: "image_url", image_url: { url: image.imageUrl } },
          ],
        });
    }
    this.history.push(...images);
    return tools.length > 0;
  }
  private async anthropicRound(
    model: Model,
    effort: ReasoningEffort | undefined,
    signal: AbortSignal,
  ): Promise<boolean> {
    const body: Json = {
      model: model.id,
      max_tokens: 8192,
      system: this.prompt(),
      messages: this.history,
      stream: true,
      tools: EDITOR_TOOLS.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema,
      })),
    };
    if (effort) body.output_config = { effort };
    const response = await this.fetch(
      "/messages",
      { method: "POST", body: JSON.stringify(body) },
      signal,
    );
    const blocks: Json[] = [];
    const fragments = new Map<number, string>();
    let stopped = false,
      reason = "",
      bytes = 0;
    for await (const event of sse(response)) {
      if (event.type === "content_block_start")
        blocks[event.index] = { ...event.content_block };
      if (event.type === "content_block_delta") {
        const delta = event.delta,
          block = blocks[event.index];
        if (!block) throw new Error("Resposta de IA inválida.");
        if (delta.type === "text_delta") {
          block.text = (block.text || "") + delta.text;
          this.options.onText(delta.text);
        }
        if (delta.type === "input_json_delta")
          fragments.set(
            event.index,
            (fragments.get(event.index) || "") + delta.partial_json,
          );
        if (delta.type === "thinking_delta")
          block.thinking = (block.thinking || "") + delta.thinking;
        if (delta.type === "signature_delta")
          block.signature = (block.signature || "") + delta.signature;
      }
      if (event.type === "message_delta")
        reason = event.delta?.stop_reason || reason;
      if (event.type === "message_stop") stopped = true;
      bytes += JSON.stringify(event).length;
      if (bytes > 8_000_000 || blocks.length > 64)
        throw new Error("Resposta de IA acima do limite.");
    }
    if (!stopped || !["end_turn", "tool_use"].includes(reason))
      throw new Error(
        "A resposta do Claude foi interrompida ou atingiu o limite. Tente um pedido menor.",
      );
    for (const [index, json] of fragments)
      blocks[index].input = JSON.parse(json || "{}");
    this.history.push({ role: "assistant", content: blocks });
    const results: Json[] = [];
    for (const block of blocks.filter((b) => b.type === "tool_use")) {
      const result = await this.call(
        block.name,
        block.input,
        signal,
        model.supportsVision,
      );
      const content = toolResultContent(result).map((c) => {
        if (c.type === "inputText") return { type: "text", text: c.text };
        const [, media_type, data] = /^data:(image\/[^;]+);base64,(.+)$/.exec(
          c.imageUrl,
        )!;
        return { type: "image", source: { type: "base64", media_type, data } };
      });
      results.push({
        type: "tool_result",
        tool_use_id: block.id,
        content,
        ...((result as Json)?.error ? { is_error: true } : {}),
      });
    }
    if (results.length) this.history.push({ role: "user", content: results });
    return results.length > 0;
  }
  async interrupt() {
    this.controller?.abort();
  }
  disconnect() {
    this.controller?.abort();
    this.connected = false;
    this.key = "";
    this.history = [];
  }
}

export const AGENT_PROVIDERS = [
  "codex",
  "claude-code",
  "anthropic",
  "deepseek",
  "openrouter",
  "openai-compatible",
] as const;
export type AgentProvider = (typeof AGENT_PROVIDERS)[number];
export type ApiProvider = Exclude<AgentProvider, "codex" | "claude-code">;
export const PROVIDER_LABELS: Record<AgentProvider, string> = {
  codex: "Codex",
  "claude-code": "Claude via terminal",
  anthropic: "Claude API",
  deepseek: "DeepSeek",
  openrouter: "OpenRouter",
  "openai-compatible": "API compatível com OpenAI",
};
export interface AgentConnectConfig {
  provider: AgentProvider;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  cliPath?: string;
}

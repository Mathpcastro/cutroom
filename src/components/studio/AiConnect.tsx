import { useEffect, useState } from "react";
import { Bot, Check, LoaderCircle, X } from "lucide-react";
import { AGENT_PROVIDERS, PROVIDER_LABELS, type AgentConnectConfig, type AgentProvider } from "../../shared/providers";
import type { AppSnapshot } from "../../shared/types";
import { t } from "./studioLanguage";

/** Connect the AI from the studio itself (no trip to the advanced editor). */

export const OPEN_AI_CONNECT = "videosell:connect-ai";
export const openAiConnect = () => window.dispatchEvent(new Event(OPEN_AI_CONNECT));

const HELP: Record<AgentProvider, string> = {
  codex: "Usa a sua conta do ChatGPT pelo Codex, que já vem no Videosell. Abre o login no navegador.",
  "claude-code": "Usa o Claude Code instalado neste computador, com a sua conta.",
  anthropic: "Cole a sua chave da Anthropic.",
  deepseek: "Cole a sua chave da DeepSeek.",
  openrouter: "Cole a sua chave da OpenRouter.",
  "openai-compatible": "Servidor compatível com OpenAI (ex.: Ollama): endereço e modelo.",
};
const needsKey = (p: AgentProvider) => p === "anthropic" || p === "deepseek" || p === "openrouter" || p === "openai-compatible";

type Connection = AppSnapshot["connection"];

/** Discreet row in the sidebar: AI status + opens the dialog. */
export function AiBadge({ connection }: { connection: Connection }) {
  const level = connection.status === "connected" ? "ready" : connection.status === "connecting" ? "warning" : "off";
  const label = connection.status === "connected"
    ? `${PROVIDER_LABELS[connection.provider ?? "codex"]}${connection.model ? ` · ${connection.model}` : ""}`
    : connection.status === "connecting" ? "Conectando a IA…" : "Conectar a IA";
  return (
    <button type="button" className={`studio-connection-badge ${level}`} onClick={openAiConnect} title={t(label)}>
      <span className="dot" aria-hidden="true" />
      <Bot size={13} />
      <span className="label">{t(label)}</span>
    </button>
  );
}

export function AiConnectDialog({ connection, run }: { connection: Connection; run: (method: string, params?: unknown) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [provider, setProvider] = useState<AgentProvider>(connection.provider ?? "codex");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("http://localhost:11434/v1");
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const connected = connection.status === "connected";
  useEffect(() => {
    const show = () => { setOpen(true); setError(""); };
    const close = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener(OPEN_AI_CONNECT, show);
    window.addEventListener("keydown", close);
    return () => { window.removeEventListener(OPEN_AI_CONNECT, show); window.removeEventListener("keydown", close); };
  }, []);
  useEffect(() => { if (connected && busy) { setBusy(false); setOpen(false); } }, [connected, busy]);
  if (!open) return null;

  const missing = needsKey(provider) && provider !== "openai-compatible" && !apiKey.trim()
    ? "Cole a chave."
    : provider === "openai-compatible" && (!baseUrl.trim() || !model.trim()) ? "Informe o endereço e o modelo." : "";
  const connect = async () => {
    if (missing) { setError(missing); return; }
    const config: AgentConnectConfig = {
      provider,
      ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      ...(provider === "openai-compatible" ? { baseUrl: baseUrl.trim(), model: model.trim() } : {}),
    };
    setApiKey("");
    setError("");
    setBusy(true);
    try {
      await run("connectAgent", config);
    } catch {
      setError("Não deu para conectar. Confira os dados e tente de novo.");
      setBusy(false);
    }
  };

  return (
    <div className="studio-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
      <section className="ai-connect" role="dialog" aria-modal="true" aria-label={t("Conectar a IA")}>
        <header>
          <strong><Bot size={16} /> {t("Conectar a IA")}</strong>
          <button type="button" aria-label={t("Fechar")} onClick={() => setOpen(false)}><X size={16} /></button>
        </header>
        <p className="ai-connect-lead">{t("A IA escreve os roteiros, as pautas e as histórias. Você usa a sua própria conta.")}</p>
        {connected && <p className="pilot-notice"><Check size={14} /> {t("Conectado:")} {PROVIDER_LABELS[connection.provider ?? "codex"]}{connection.account ? ` · ${connection.account}` : ""}</p>}
        <div className="ai-connect-options" role="radiogroup" aria-label={t("Qual IA")}>
          {AGENT_PROVIDERS.map((p) => (
            <button key={p} type="button" role="radio" aria-checked={provider === p} onClick={() => { setProvider(p); setError(""); }}>
              <b>{PROVIDER_LABELS[p]}{p === "codex" && <small> · {t("recomendado")}</small>}</b>
            </button>
          ))}
        </div>
        <p className="ai-connect-help">{t(HELP[provider])}</p>
        {needsKey(provider) && provider !== "openai-compatible" && (
          <input type="password" autoComplete="off" spellCheck={false} placeholder={t("Chave")} aria-label={t("Chave")} value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
        )}
        {provider === "openai-compatible" && <>
          <input value={baseUrl} aria-label={t("Endereço")} onChange={(e) => setBaseUrl(e.target.value)} />
          <input value={model} placeholder={t("Modelo (ex.: llama3.1)")} aria-label={t("Modelo")} onChange={(e) => setModel(e.target.value)} />
          <input type="password" autoComplete="off" placeholder={t("Chave (opcional)")} aria-label={t("Chave")} value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
        </>}
        {error && <p className="reel-error" role="alert">{t(error)}</p>}
        <div className="reel-action-row">
          <button type="button" className="studio-primary-button" disabled={busy} onClick={() => void connect()}>
            {busy ? <><LoaderCircle size={14} className="spin" /> {t(provider === "codex" ? "Faça o login no navegador…" : "Conectando…")}</> : t(connected ? "Trocar de IA" : "Conectar")}
          </button>
          {connected && <button type="button" className="studio-secondary-button" disabled={busy} onClick={() => void run("disconnectAgent").then(() => setOpen(false))}>{t("Desconectar")}</button>}
        </div>
      </section>
    </div>
  );
}

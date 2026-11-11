import { useEffect, useState } from "react";
import { Bot, Check, Copy, LoaderCircle, Plug, X } from "lucide-react";
import { AGENT_PROVIDERS, PROVIDER_LABELS, type AgentConnectConfig, type AgentProvider } from "../../shared/providers";
import type { AppSnapshot, ReasoningEffort } from "../../shared/types";
import { t } from "./studioLanguage";

/**
 * Connect the AI from the studio itself. Two ways, one window:
 * - "IA no Videosell": Codex (default, ChatGPT sign-in in the browser) or an API key; pick model and effort;
 * - "Pelo meu agente": use Videosell from Claude/Codex outside the app through MCP, with no AI inside.
 */

export const OPEN_AI_CONNECT = "videosell:connect-ai";
export const openAiConnect = (tab: "app" | "mcp" = "app") => window.dispatchEvent(new CustomEvent(OPEN_AI_CONNECT, { detail: tab }));

/** "Claude via terminal" is not offered: a Claude subscription inside a third-party app is not allowed. */
export const STUDIO_PROVIDERS = AGENT_PROVIDERS.filter((p) => p !== "claude-code");

const PREFS_KEY = "videosell.ai";
export interface AiPreferences { mode: "app" | "mcp"; model?: string; effort?: ReasoningEffort; auto?: boolean }
export function aiPreferences(): AiPreferences {
  try {
    const v = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as Partial<AiPreferences>;
    return { mode: v.mode === "mcp" ? "mcp" : "app", model: v.model, effort: v.effort, auto: v.auto !== false };
  } catch {
    return { mode: "app", auto: true };
  }
}
export function saveAiPreferences(patch: Partial<AiPreferences>) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ ...aiPreferences(), ...patch }));
  } catch { /* convenience only */ }
  window.dispatchEvent(new Event("videosell:ai-prefs"));
}
export function useAiPreferences() {
  const [prefs, setPrefs] = useState(aiPreferences);
  useEffect(() => {
    const update = () => setPrefs(aiPreferences());
    window.addEventListener("videosell:ai-prefs", update);
    return () => window.removeEventListener("videosell:ai-prefs", update);
  }, []);
  return prefs;
}

const HELP: Record<AgentProvider, string> = {
  codex: "Usa a sua conta do ChatGPT. Na primeira vez, o login abre no navegador.",
  "claude-code": "",
  anthropic: "Cole a sua chave da API da Anthropic (console.anthropic.com › API Keys). É o jeito oficial de usar o Claude em outros apps; cobra por uso.",
  deepseek: "Cole a sua chave da DeepSeek.",
  openrouter: "Cole a sua chave da OpenRouter.",
  "openai-compatible": "Servidor compatível com OpenAI (ex.: Ollama): endereço e modelo.",
};
const EFFORT_LABEL: Record<string, string> = { none: "Nenhum", minimal: "Mínimo", low: "Baixo", medium: "Médio", high: "Alto", xhigh: "Muito alto", max: "Máximo" };
const needsKey = (p: AgentProvider) => p === "anthropic" || p === "deepseek" || p === "openrouter";

type Connection = AppSnapshot["connection"];

/** Discreet row in the sidebar: AI status; opens the window (model picker when connected). */
export function AiBadge({ connection }: { connection: Connection }) {
  const prefs = useAiPreferences();
  const model = connection.models.find((m) => m.id === (prefs.model ?? connection.model));
  const viaAgent = prefs.mode === "mcp" && connection.status !== "connected";
  const level = connection.status === "connected" || viaAgent ? "ready" : connection.status === "connecting" ? "warning" : "off";
  const label = connection.status === "connected"
    ? `${PROVIDER_LABELS[connection.provider ?? "codex"]}${model ? ` · ${model.name}` : ""}`
    : connection.status === "connecting" ? "Conectando a IA…" : viaAgent ? "Pelo seu agente (MCP)" : "Conectar a IA";
  return (
    <button type="button" className={`studio-connection-badge ${level}`} onClick={() => openAiConnect(viaAgent ? "mcp" : "app")} title={t(label)}>
      <span className="dot" aria-hidden="true" />
      {viaAgent ? <Plug size={13} /> : <Bot size={13} />}
      <span className="label">{t(label)}</span>
    </button>
  );
}

export function AiConnectDialog({ connection, run }: { connection: Connection; run: (method: string, params?: unknown) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"app" | "mcp">("app");
  const [provider, setProvider] = useState<AgentProvider>(connection.provider && connection.provider !== "claude-code" ? connection.provider : "codex");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("http://localhost:11434/v1");
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [changing, setChanging] = useState(false);
  const prefs = useAiPreferences();
  const connected = connection.status === "connected";

  useEffect(() => {
    const show = (event: Event) => {
      setTab((event as CustomEvent<"app" | "mcp">).detail === "mcp" ? "mcp" : "app");
      setOpen(true);
      setError("");
      setChanging(false);
    };
    const close = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener(OPEN_AI_CONNECT, show);
    window.addEventListener("keydown", close);
    return () => { window.removeEventListener(OPEN_AI_CONNECT, show); window.removeEventListener("keydown", close); };
  }, []);
  useEffect(() => { if (connected && busy) { setBusy(false); setChanging(false); } }, [connected, busy]);
  useEffect(() => {
    if (busy && connection.status === "error") { setBusy(false); setError(connection.error || "Não deu para conectar."); }
  }, [busy, connection.status, connection.error]);
  if (!open) return null;

  const missing = needsKey(provider) && !apiKey.trim()
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
      // Called directly (not through `run`) so a failure comes back here instead of spinning forever.
      if (window.cutroom) await window.cutroom.request("connectAgent", config);
      else await run("connectAgent", config);
      saveAiPreferences({ mode: "app" });
    } catch (reason) {
      const message = (reason instanceof Error ? reason.message : String(reason)).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
      setError(message || "Não deu para conectar. Confira os dados e tente de novo.");
      setBusy(false);
    }
  };

  const current = connection.models.find((m) => m.id === (prefs.model ?? connection.model)) ?? connection.models[0];
  const efforts = current?.reasoningEfforts ?? [];
  const effort = prefs.effort && efforts.includes(prefs.effort) ? prefs.effort : current?.defaultReasoningEffort;

  return (
    <div className="studio-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
      <section className="ai-connect" role="dialog" aria-modal="true" aria-label={t("Inteligência artificial")}>
        <header>
          <div className="segmented ai-connect-tabs" role="tablist">
            <button type="button" role="tab" aria-checked={tab === "app"} aria-selected={tab === "app"} onClick={() => setTab("app")}><Bot size={13} /> {t("IA no Videosell")}</button>
            <button type="button" role="tab" aria-checked={tab === "mcp"} aria-selected={tab === "mcp"} onClick={() => setTab("mcp")}><Plug size={13} /> {t("Pelo meu agente")}</button>
          </div>
          <button type="button" aria-label={t("Fechar")} onClick={() => setOpen(false)}><X size={16} /></button>
        </header>

        {tab === "app" && connected && !changing && (
          <>
            <p className="pilot-notice"><Check size={14} /> {t("Conectado:")} {PROVIDER_LABELS[connection.provider ?? "codex"]}{connection.account ? ` · ${connection.account}` : ""}</p>
            <label className="reel-field">{t("Modelo")}
              <select value={current?.id ?? ""} onChange={(e) => saveAiPreferences({ model: e.target.value, effort: undefined })}>
                {connection.models.map((m) => <option key={m.id} value={m.id}>{m.name}{m.description ? ` — ${m.description}` : ""}</option>)}
              </select>
            </label>
            {efforts.length > 0 && (
              <div className="settings-pref">
                <span>{t("Raciocínio")}</span>
                <div className="segmented" role="radiogroup" aria-label={t("Raciocínio")}>
                  {efforts.map((e) => <button key={e} type="button" role="radio" aria-checked={effort === e} onClick={() => saveAiPreferences({ effort: e })}>{t(EFFORT_LABEL[e] ?? e)}</button>)}
                </div>
                <small className="ai-connect-help">{t("Mais raciocínio escreve melhor, mas demora mais.")}</small>
              </div>
            )}
            <div className="reel-action-row">
              <button type="button" className="studio-primary-button" onClick={() => setOpen(false)}>{t("Pronto")}</button>
              <button type="button" className="studio-secondary-button" onClick={() => setChanging(true)}>{t("Trocar de IA")}</button>
              <button type="button" className="ig-link" onClick={() => void run("disconnectAgent").then(() => setOpen(false))}>{t("Desconectar")}</button>
            </div>
          </>
        )}

        {tab === "app" && (!connected || changing) && (
          <>
            <p className="ai-connect-lead">{t("A IA escreve os roteiros, as pautas e as histórias. Você usa a sua própria conta.")}</p>
            <div className="ai-connect-options" role="radiogroup" aria-label={t("Qual IA")}>
              {STUDIO_PROVIDERS.map((p) => (
                <button key={p} type="button" role="radio" aria-checked={provider === p} onClick={() => { setProvider(p); setError(""); }}>
                  <b>{PROVIDER_LABELS[p]}{p === "codex" && <small> · {t("padrão")}</small>}</b>
                </button>
              ))}
            </div>
            <p className="ai-connect-help">{t(HELP[provider])}</p>
            {needsKey(provider) && (
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
                {busy ? <><LoaderCircle size={14} className="spin" /> {t(provider === "codex" ? "Entre na sua conta no navegador…" : "Conectando…")}</> : t("Conectar")}
              </button>
              {changing && <button type="button" className="ig-link" onClick={() => setChanging(false)}>{t("Cancelar")}</button>}
            </div>
          </>
        )}

        {tab === "mcp" && <McpSetup mode={prefs.mode} />}
      </section>
    </div>
  );
}

/** Use Videosell from Claude or Codex outside the app (MCP), with no AI inside Videosell. */
function McpSetup({ mode }: { mode: AiPreferences["mode"] }) {
  const [setup, setSetup] = useState<{ claude: string; codex: string; claudeCode: string } | null>(null);
  const [copied, setCopied] = useState("");
  const [note, setNote] = useState("");
  useEffect(() => {
    void window.cutroom?.request<{ claude: string; codex: string; claudeCode: string }>("mcpSetup").then(setSetup, () => setSetup(null));
  }, []);
  const copy = async (id: string, text: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(id); } catch { setCopied(""); }
  };
  const targets = setup ? [
    { id: "claude", title: "Claude (aplicativo)", where: "Configurações › Desenvolvedor › Editar configuração; cole dentro de mcpServers e reinicie o Claude.", text: setup.claude },
    { id: "codex", title: "Codex", where: "Cole no fim de ~/.codex/config.toml e reinicie o Codex.", text: setup.codex },
    { id: "claude-code", title: "Claude Code (terminal)", where: "Rode este comando uma vez no terminal.", text: setup.claudeCode },
  ] : [];
  return (
    <div className="mcp-setup">
      <p className="ai-connect-lead">{t("Use o Videosell de dentro do Claude ou do Codex: você pede no chat do seu agente e ele cria os vídeos aqui. Não precisa de IA dentro do Videosell. Deixe o Videosell aberto.")}</p>
      <label className="mcp-mode">
        <input type="checkbox" checked={mode === "mcp"} onChange={(e) => saveAiPreferences({ mode: e.target.checked ? "mcp" : "app" })} />
        {t("Usar só pelo meu agente (não pedir para conectar a IA aqui)")}
      </label>
      {targets.map((x) => (
        <div key={x.id} className="mcp-target">
          <div><strong>{t(x.title)}</strong><small>{t(x.where)}</small></div>
          <button type="button" className="studio-secondary-button" onClick={() => void copy(x.id, x.text)}>{copied === x.id ? <Check size={13} /> : <Copy size={13} />} {t(copied === x.id ? "Copiado" : "Copiar")}</button>
        </div>
      ))}
      <button type="button" className="ig-link" onClick={() => void window.cutroom?.request<{ files: string[] }>("installAgentSkill").then(() => setNote("Pronto: o Claude e o Codex já sabem como criar vídeos no Videosell."), () => setNote("Não deu para instalar o guia."))}>
        {t("Ensinar o meu agente a usar o Videosell (instala o guia nos agentes)")}
      </button>
      {note && <p className="pilot-notice">{t(note)}</p>}
      <p className="ai-connect-help">{t("Exemplo de pedido no seu agente: “Crie um Reels no Videosell sobre o meu produto, com o meu avatar, e agende para amanhã às 18h.” Publicar sempre pede a sua confirmação.")}</p>
    </div>
  );
}

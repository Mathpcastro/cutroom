import { useEffect, useState } from "react";
import { Check, Copy, Globe, Plug, X } from "lucide-react";
import { saveAiPreferences, useAiPreferences, type AiPreferences } from "./AiConnect";
import { t } from "./studioLanguage";

/**
 * "Usar pelo seu agente" (MCP): Videosell driven from Claude Code, Codex or the Claude app.
 * The user asks in the agent's chat and the agent does everything here — web research,
 * script, video, Shorts, scheduling — without the user touching the app. It has its own
 * button in the sidebar and opens by itself when a task needs web search (Videosell does not
 * search the web; the user's agent does).
 */

export const OPEN_MCP = "videosell:open-mcp";
export type McpReason = "search" | undefined;
export const openMcp = (reason?: McpReason) => window.dispatchEvent(new CustomEvent(OPEN_MCP, { detail: reason }));

/** Highlighted sidebar button. */
export function McpButton() {
  return (
    <button type="button" className="studio-mcp-button" onClick={() => openMcp()} title={t("Use o Videosell pelo Claude Code ou pelo Codex")}>
      <Plug size={15} />
      <span>
        <b>{t("Usar pelo seu agente")}</b>
        <small>{t("Tudo pelo chat, sem mexer no app")}</small>
      </span>
    </button>
  );
}

const EXAMPLES = [
  "Pesquise sobre Niterói e faça o próximo episódio do meu canal no Videosell, com fontes, fotos reais e 2 Shorts.",
  "Crie um Reels no Videosell sobre o meu produto, com o meu avatar, e agende para amanhã às 18h.",
  "Veja os vídeos que mais performam no meu nicho e monte 10 ideias de pauta no Videosell.",
];

export function McpDialog() {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<McpReason>();
  const prefs = useAiPreferences();
  useEffect(() => {
    const show = (r: McpReason) => {
      setReason(r);
      setOpen(true);
    };
    const onLocal = (event: Event) => show((event as CustomEvent<McpReason>).detail);
    const close = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener(OPEN_MCP, onLocal);
    window.addEventListener("keydown", close);
    // The in-app agent opens this window (tool open_mcp_setup) when a task needs web search.
    const off = window.cutroom?.onEvent((event) => { if (event.type === "mcp") show(event.reason); });
    return () => {
      window.removeEventListener(OPEN_MCP, onLocal);
      window.removeEventListener("keydown", close);
      off?.();
    };
  }, []);
  if (!open) return null;
  return (
    <div className="studio-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
      <section className="ai-connect mcp-dialog" role="dialog" aria-modal="true" aria-label={t("Usar pelo seu agente")}>
        <header>
          <h2><Plug size={16} /> {t("Usar pelo seu agente")}</h2>
          <button type="button" aria-label={t("Fechar")} onClick={() => setOpen(false)}><X size={16} /></button>
        </header>
        {reason === "search" && (
          <div className="mcp-search-notice" role="status">
            <Globe size={16} />
            <p>
              <b>{t("Isto precisa de busca na internet.")}</b> {t("O Videosell não pesquisa sozinho: quem pesquisa é o seu agente (Claude Code ou Codex). Conecte uma vez abaixo e peça tudo pelo chat dele — ele busca, confere as fontes e monta o vídeo aqui.")}
            </p>
          </div>
        )}
        <McpSetup mode={prefs.mode} />
      </section>
    </div>
  );
}

/** How to connect Claude, Codex or Claude Code to Videosell (MCP), plus the agent guide. */
export function McpSetup({ mode }: { mode: AiPreferences["mode"] }) {
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
    { id: "claude-code", title: "Claude Code (terminal)", where: "Rode este comando uma vez no terminal.", text: setup.claudeCode },
    { id: "codex", title: "Codex", where: "Cole no fim de ~/.codex/config.toml e reinicie o Codex.", text: setup.codex },
    { id: "claude", title: "Claude (aplicativo)", where: "Configurações › Desenvolvedor › Editar configuração; cole dentro de mcpServers e reinicie o Claude.", text: setup.claude },
  ] : [];
  return (
    <div className="mcp-setup">
      <p className="ai-connect-lead">{t("Você pede no chat do seu agente e ele faz tudo aqui: pesquisa na internet, roteiro, narração, vídeo, Shorts e agendamento. Não precisa ficar mexendo no Videosell — só deixe ele aberto.")}</p>
      <ol className="mcp-steps">
        <li>{t("Copie a configuração do seu agente e cole onde indicado (uma vez só).")}</li>
        <li>{t("Ensine o seu agente a usar o Videosell (botão abaixo).")}</li>
        <li>{t("Peça no chat do agente. Publicar sempre pede a sua confirmação.")}</li>
      </ol>
      {targets.map((x) => (
        <div key={x.id} className="mcp-target">
          <div><strong>{t(x.title)}</strong><small>{t(x.where)}</small></div>
          <button type="button" className="studio-secondary-button" onClick={() => void copy(x.id, x.text)}>{copied === x.id ? <Check size={13} /> : <Copy size={13} />} {t(copied === x.id ? "Copiado" : "Copiar")}</button>
        </div>
      ))}
      <button type="button" className="studio-secondary-button mcp-skill" onClick={() => void window.cutroom?.request<{ files: string[] }>("installAgentSkill").then(() => setNote("Pronto: o Claude e o Codex já sabem criar vídeos e episódios de canal no Videosell."), () => setNote("Não deu para instalar o guia."))}>
        {t("Ensinar o meu agente a usar o Videosell")}
      </button>
      {note && <p className="pilot-notice">{t(note)}</p>}
      <div className="mcp-examples">
        <small>{t("Exemplos de pedido no seu agente:")}</small>
        {EXAMPLES.map((e) => <p key={e}>“{t(e)}”</p>)}
      </div>
      <label className="mcp-mode">
        <input type="checkbox" checked={mode === "mcp"} onChange={(e) => saveAiPreferences({ mode: e.target.checked ? "mcp" : "app" })} />
        {t("Usar só pelo meu agente (não pedir para conectar a IA aqui)")}
      </label>
    </div>
  );
}

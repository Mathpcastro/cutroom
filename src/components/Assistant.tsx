import { useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  Check,
  ChevronDown,
  CircleStop,
  Download,
  KeyRound,
  MessageSquare,
  Package,
  Plus,
  Sparkles,
  Terminal,
  X,
} from "lucide-react";
import type { AppSnapshot } from "../shared/types";
import { useDialogKeyboard } from "../lib/useDialogKeyboard";

export interface ActionProps {
  state: AppSnapshot;
  run: (method: string, params?: unknown) => Promise<void>;
  desktop: boolean;
}

export function Assistant({ state, run, desktop }: ActionProps) {
  const [tab, setTab] = useState<"chat" | "packages">("chat");
  const [text, setText] = useState("");
  const [model, setModel] = useState("");
  const [connectionOpen, setConnectionOpen] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [apiKey, setApiKey] = useState("");
  useDialogKeyboard(connectionOpen, () => {
    setConnectionOpen(false);
    setApiKey("");
  });
  const end = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const connected = state.connection.status === "connected";
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth" });
  }, [state.messages]);
  useEffect(() => {
    if (state.connection.status === "connected") {
      setApiKey("");
    }
  }, [state.connection.status]);
  const submit = async () => {
    if (!text.trim() || state.busy || !desktop) return;
    if (!connected) {
      setConnectionOpen(true);
      return;
    }
    const message = text.trim();
    setText("");
    await run("sendChat", {
      text: message,
      model: model || state.connection.model,
    });
  };
  return (
    <aside className="assistant-panel" aria-label="Assistente de edição">
      <div className="assistant-tabs">
        <button
          className={tab === "chat" ? "selected" : ""}
          onClick={() => setTab("chat")}
        >
          <MessageSquare size={14} /> Assistente
        </button>
        <button
          className={tab === "packages" ? "selected" : ""}
          onClick={() => setTab("packages")}
        >
          <Package size={14} /> Pacotes{" "}
          <span className="count">
            {state.packages.filter((p) => p.installed).length}
          </span>
        </button>
      </div>
      {tab === "chat" ? (
        <>
          <div className="conversation-label">
            <span>SEU PARCEIRO DE EDIÇÃO</span>
            <button
              className="icon-button"
              title={connected ? "Gerenciar conexão Codex" : "Conectar Codex"}
              aria-label={
                connected ? "Gerenciar conexão Codex" : "Conectar Codex"
              }
              disabled={!desktop}
              onClick={() => setConnectionOpen(true)}
            >
              <Terminal size={15} />
            </button>
          </div>
          <div className="conversation-scroll">
            {state.messages.length === 0 ? (
              <div className="assistant-welcome">
                <div className="assistant-mark">
                  <Sparkles size={23} strokeWidth={1.5} />
                </div>
                <h1>Da ideia ao corte.</h1>
                <p>
                  Descreva a edição. Acompanhe cada mudança e ajuste os detalhes
                  na timeline.
                </p>
                <div className="suggestions">
                  {[
                    "Remova pausas e muletas",
                    "Adicione legendas",
                    "Aplique a edição limpa",
                  ].map((suggestion, i) => (
                    <button
                      key={suggestion}
                      onClick={() => {
                        setText(suggestion);
                        input.current?.focus();
                      }}
                    >
                      <span>{String(i + 1).padStart(2, "0")}</span>
                      {suggestion}
                      <ArrowUp size={13} />
                    </button>
                  ))}
                </div>
                <div className="local-note">
                  <Terminal size={13} />
                  <span>Seu Codex. Seus arquivos. Seu computador.</span>
                </div>
              </div>
            ) : (
              <div className="messages">
                {state.messages.map((message) => (
                  <article
                    key={message.id}
                    className={`message ${message.role}`}
                  >
                    <div className="message-heading">
                      {message.role === "user" ? (
                        <>
                          <span className="user-dot" /> Você
                        </>
                      ) : message.role === "system" ? (
                        <>
                          <Terminal size={12} /> Atividade
                        </>
                      ) : (
                        <>
                          <Sparkles size={12} /> CutRoom
                        </>
                      )}
                    </div>
                    <div className="message-text">{message.text}</div>
                  </article>
                ))}
                <div ref={end} />
              </div>
            )}
            {state.busy && (
              <div className="thinking">
                <span className="spinner" /> Trabalhando no projeto…
              </div>
            )}
          </div>
          <div className="composer-area">
            {!connected && (
              <button
                className="connect-callout"
                disabled={!desktop || state.connection.status === "connecting"}
                onClick={() => setConnectionOpen(true)}
              >
                <span className={`connection-dot ${state.connection.status}`} />
                <span>
                  {state.connection.status === "connecting"
                    ? "Conectando ao Codex…"
                    : "Conecte o Codex para começar"}
                </span>
                <Plus size={14} />
              </button>
            )}
            <form
              className="composer"
              onSubmit={(event) => {
                event.preventDefault();
                void submit();
              }}
            >
              <textarea
                ref={input}
                aria-label="Descreva sua edição"
                placeholder="O que vamos editar?"
                value={text}
                onChange={(event) => setText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void submit();
                  }
                }}
                disabled={!desktop}
                rows={3}
              />
              <div className="composer-controls">
                <label className="model-select">
                  <Sparkles size={12} />
                  <select
                    aria-label="Modelo do Codex"
                    value={model || state.connection.model || ""}
                    onChange={(event) => setModel(event.target.value)}
                    disabled={!connected}
                  >
                    <option value="">Codex</option>
                    {state.connection.models.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={11} />
                </label>
                {state.busy ? (
                  <button
                    className="send-button stop"
                    type="button"
                    title="Interromper"
                    aria-label="Interromper resposta"
                    onClick={() => void run("cancelChat")}
                  >
                    <CircleStop size={18} />
                  </button>
                ) : (
                  <button
                    className="send-button"
                    type="submit"
                    title="Enviar mensagem"
                    aria-label="Enviar mensagem"
                    disabled={!text.trim() || !desktop}
                  >
                    <ArrowUp size={17} />
                  </button>
                )}
              </div>
            </form>
            <div className="composer-help">
              Enter envia <span>·</span> Shift + Enter quebra a linha
            </div>
          </div>
        </>
      ) : (
        <div className="packages-panel">
          <div className="panel-eyebrow">SUA CAIXA DE FERRAMENTAS</div>
          <h2>
            Mais possibilidades.
            <br />
            No seu computador.
          </h2>
          <p>Pacotes adicionam recursos reutilizáveis ao editor.</p>
          {state.packages.length === 0 && (
            <div className="small-empty">
              <Package size={25} />
              <p>
                {desktop
                  ? "Carregando pacotes disponíveis…"
                  : "Abra o aplicativo desktop para gerenciar pacotes."}
              </p>
            </div>
          )}
          {state.packages.map((item) => (
            <article className="package-item" key={item.id}>
              <div className="package-title">
                <Package size={18} />
                <strong>{item.name}</strong>
                {item.installed && <Check size={15} className="lime" />}
              </div>
              <p>{item.description}</p>
              <div className="capability-tags">
                {item.capabilities.map((cap) => (
                  <span key={cap}>{cap}</span>
                ))}
              </div>
              <div className="package-bottom">
                <span>
                  v{item.version} · {item.size}
                </span>
                <button
                  className="button small"
                  disabled={
                    !desktop || item.installed || item.status === "installing"
                  }
                  onClick={() => void run("installPackage", { id: item.id })}
                >
                  {item.status === "installing" ? (
                    <>
                      <span className="spinner" /> Instalando
                    </>
                  ) : item.installed ? (
                    "Instalado"
                  ) : (
                    <>
                      <Download size={12} /> Instalar
                    </>
                  )}
                </button>
              </div>
              {item.error && <p className="inline-error">{item.error}</p>}
            </article>
          ))}
        </div>
      )}
      {connectionOpen && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setConnectionOpen(false);
              setApiKey("");
            }
          }}
        >
          <section
            className="modal connection-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="connection-title"
          >
            <button
              className="icon-button modal-close"
              aria-label="Fechar conexão"
              onClick={() => {
                setConnectionOpen(false);
                setApiKey("");
              }}
            >
              <X size={18} />
            </button>
            <div className="modal-symbol">
              <Terminal size={24} />
            </div>
            <h2 id="connection-title">
              {connected ? "Codex conectado." : "Conecte seu Codex."}
            </h2>
            <p>
              O CutRoom inclui o motor do Codex e usa sua sessão local. Você não
              precisa criar uma conta CutRoom.
            </p>
            {connected ? (
              <div className="connected-account">
                <Check size={16} />
                <span>{state.connection.account || "Sessão local ativa"}</span>
              </div>
            ) : (
              <ol className="connection-steps">
                <li>
                  Se você já usa o Codex neste computador, clique em conectar.
                </li>
                <li>
                  Para entrar na sua conta pelo terminal:
                  <code>codex login</code>
                </li>
                <li>
                  Se ainda não tiver o comando disponível, instale o CLI
                  oficial:<code>npm install -g @openai/codex</code>
                </li>
              </ol>
            )}
            {state.connection.error && (
              <div className="error-box">{state.connection.error}</div>
            )}
            {!connected && (
              <button
                className="advanced-toggle"
                onClick={() => setAdvanced(!advanced)}
              >
                <KeyRound size={13} /> Usar minha chave de API{" "}
                <ChevronDown size={13} />
              </button>
            )}
            {advanced && !connected && (
              <label className="field">
                Chave de API
                <input
                  type="password"
                  autoComplete="off"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder="Chave própria do provedor"
                />
                <small>
                  Enviada somente ao processo local de conexão. Não é salva pela
                  interface.
                </small>
              </label>
            )}
            <div className="modal-actions">
              <button
                className="button"
                onClick={() => {
                  setConnectionOpen(false);
                  setApiKey("");
                }}
              >
                Agora não
              </button>
              <button
                className="button primary"
                disabled={state.connection.status === "connecting"}
                onClick={() => {
                  const key = apiKey;
                  setApiKey("");
                  if (connected) {
                    void run("disconnectCodex");
                    setConnectionOpen(false);
                  } else void run("connectCodex", key ? { apiKey: key } : {});
                }}
              >
                {state.connection.status === "connecting"
                  ? "Conectando…"
                  : connected
                    ? "Desconectar"
                    : "Conectar Codex"}
              </button>
            </div>
          </section>
        </div>
      )}
    </aside>
  );
}

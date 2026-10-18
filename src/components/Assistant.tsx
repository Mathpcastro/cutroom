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
import type { AppSnapshot, ReasoningEffort } from "../shared/types";
import { Menu } from "./Menu";
import { ChoicePicker } from "./ChoicePicker";
import { ActivityFeed } from "./ActivityFeed";
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
  const [efforts, setEfforts] = useState<Record<string, ReasoningEffort>>({});
  const selectedModel =
    state.connection.models.find(
      (item) => item.id === (model || state.connection.model),
    ) || state.connection.models[0];
  const supportedEfforts = selectedModel?.reasoningEfforts || [];
  const selectedEffort =
    selectedModel &&
    efforts[selectedModel.id] &&
    supportedEfforts.includes(efforts[selectedModel.id])
      ? efforts[selectedModel.id]
      : state.connection.model === selectedModel?.id &&
          state.connection.reasoningEffort &&
          supportedEfforts.includes(state.connection.reasoningEffort)
        ? state.connection.reasoningEffort
        : selectedModel?.defaultReasoningEffort &&
            supportedEfforts.includes(selectedModel.defaultReasoningEffort)
          ? selectedModel.defaultReasoningEffort
          : supportedEfforts[0];
  const effortLabels: Record<ReasoningEffort, string> = {
    none: "Sem",
    minimal: "Mínimo",
    low: "Baixo",
    medium: "Médio",
    high: "Alto",
    xhigh: "Muito alto",
    max: "Máximo",
  };
  const activeWork =
    state.busy || state.jobs.some((job) => job.status === "running");
  const transcription = state.packages.find(
    (item) => item.id === "faster-whisper-base",
  );
  const transcriptionReady =
    state.onboarding?.transcriptionReady ?? !!transcription?.installed;
  useEffect(() => {
    const openPackages = () => setTab("packages");
    window.addEventListener("cutroom:packages", openPackages);
    return () => window.removeEventListener("cutroom:packages", openPackages);
  }, []);
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
    if (!text.trim() || activeWork || !desktop) return;
    if (!connected) {
      setConnectionOpen(true);
      return;
    }
    const message = text.trim();
    setText("");
    await run("sendChat", {
      text: message,
      model: selectedModel?.id,
      reasoningEffort: selectedEffort,
    });
  };
  return (
    <aside className="assistant-panel" aria-label="Assistente de edição">
      <div className="assistant-heading">
        <Menu label="Conversa" icon={<MessageSquare size={14} />}>
          <button role="menuitem" onClick={() => setTab("chat")}>
            <MessageSquare size={14} />
            Assistente
            {tab === "chat" && <Check size={13} className="menu-check" />}
          </button>
          <button role="menuitem" onClick={() => setTab("packages")}>
            <Package size={14} />
            Pacotes
            {tab === "packages" && <Check size={13} className="menu-check" />}
          </button>
          <div role="separator" />
          <button
            role="menuitem"
            disabled={!desktop}
            onClick={() => setConnectionOpen(true)}
          >
            <Terminal size={14} />
            Conexão Codex
          </button>
          <div className="menu-caption">Sugestões</div>
          {[
            "Remova pausas e muletas",
            "Adicione legendas",
            "Aplique a edição limpa",
          ].map((suggestion) => (
            <button
              key={suggestion}
              role="menuitem"
              onClick={() => {
                setTab("chat");
                setText(suggestion);
                requestAnimationFrame(() => input.current?.focus());
              }}
            >
              {suggestion}
            </button>
          ))}
        </Menu>
        <span
          className="assistant-connection"
          title={connected ? "Codex conectado" : "Codex desconectado"}
        >
          <span className={`connection-dot ${state.connection.status}`} />
          {connected ? "Conectado" : "Desconectado"}
        </span>
      </div>
      {tab === "chat" ? (
        <>
          <div className="conversation-scroll">
            {!state.onboarding?.dismissed && desktop && (
              <section className="setup-guide" aria-label="Primeiros passos">
                <div className="setup-guide-heading">
                  <Package size={17} />
                  <strong>Transcrição local</strong>
                  <button
                    className="icon-button"
                    aria-label="Dispensar primeiros passos"
                    onClick={() => void run("dismissOnboarding")}
                  >
                    <X size={14} />
                  </button>
                </div>
                <p>
                  Instale a transcrição local para gerar legendas e remover
                  muletas. O primeiro download tem centenas de MB.
                </p>
                <button
                  className="button primary full-width"
                  disabled={
                    transcriptionReady || transcription?.status === "installing"
                  }
                  onClick={() => setTab("packages")}
                >
                  {transcriptionReady
                    ? "Transcrição instalada"
                    : transcription?.status === "installing"
                      ? "Instalação em andamento…"
                      : "Instalar transcrição"}
                </button>
                {transcriptionReady &&
                  state.project.media.length > 0 &&
                  !state.project.words.length && (
                    <button
                      className="button full-width"
                      disabled={activeWork}
                      onClick={() => void run("transcribe")}
                    >
                      Transcrever vídeos importados
                    </button>
                  )}
              </section>
            )}
            {state.onboarding?.dismissed && !transcriptionReady && desktop && (
              <button
                className="setup-reminder"
                onClick={() => setTab("packages")}
              >
                <Download size={14} />
                <span>
                  Legendas e muletas precisam da transcrição.
                  <strong>Abrir Pacotes</strong>
                </span>
              </button>
            )}
            {state.messages.length === 0 ? (
              <div className="assistant-welcome">
                <h1>Como quer editar?</h1>
                <p>
                  Importe um vídeo e descreva a edição. Os ajustes aparecem na
                  timeline.
                </p>
                <span className="welcome-hint">
                  Cortes, legendas, ritmo e áudio.
                </span>
              </div>
            ) : (
              <div className="messages">
                {state.messages
                  .filter((message) => message.text.trim())
                  .map((message) => (
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
          </div>
          <div className="composer-area">
            <ActivityFeed state={state} />
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
                <div className="assistant-selectors">
                  <ChoicePicker
                    label="Modelo"
                    value={selectedModel?.id || ""}
                    options={state.connection.models.map((item) => ({
                      value: item.id,
                      label: item.name,
                      detail: item.id,
                    }))}
                    onChange={setModel}
                    disabled={!connected || activeWork}
                    searchable
                  />
                  <ChoicePicker
                    label="Raciocínio"
                    value={selectedEffort || ""}
                    options={supportedEfforts.map((effort) => ({
                      value: effort,
                      label: effortLabels[effort],
                    }))}
                    onChange={(effort) =>
                      selectedModel &&
                      setEfforts((current) => ({
                        ...current,
                        [selectedModel.id]: effort as ReasoningEffort,
                      }))
                    }
                    disabled={!connected || activeWork}
                  />
                </div>
                {activeWork ? (
                  <button
                    className="send-button stop"
                    type="button"
                    title="Interromper"
                    aria-label="Interromper todo o trabalho"
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
          <h2>Pacotes locais</h2>
          <p>
            Instale a transcrição para entender as falas, remover muletas e
            criar legendas. O download acontece aqui; não é preciso abrir o
            terminal.
          </p>
          <ActivityFeed state={state} compact />
          {transcriptionReady &&
            state.project.media.length > 0 &&
            !state.project.words.length && (
              <div className="package-ready">
                <Check size={17} />
                <strong>Pronto para transcrever</strong>
                <p>
                  O pacote está instalado. Gere as palavras dos vídeos
                  importados para editar falas e legendas.
                </p>
                <button
                  className="button primary full-width"
                  disabled={activeWork}
                  onClick={() => {
                    setTab("chat");
                    void run("transcribe");
                  }}
                >
                  Transcrever vídeos importados
                </button>
              </div>
            )}
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
                    !desktop ||
                    activeWork ||
                    item.installed ||
                    item.status === "installing"
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

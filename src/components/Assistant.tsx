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
  Terminal,
  X,
} from "lucide-react";
import type { AppSnapshot, ReasoningEffort } from "../shared/types";
import {
  AGENT_PROVIDERS,
  PROVIDER_LABELS,
  type AgentConnectConfig,
  type AgentProvider,
} from "../shared/providers";
import "./connection-modal.css";
import { Menu } from "./Menu";
import { BrandMark } from "./BrandMark";
import { ChoicePicker } from "./ChoicePicker";
import { EffortPicker } from "./EffortPicker";
import { ActivityFeed } from "./ActivityFeed";
import { useDialogKeyboard } from "../lib/useDialogKeyboard";
import { CommandPalette, type CommandPaletteHandle } from "./CommandPalette";
import {
  findChatCommand,
  parseSlashCommand,
  prepareChatCommand,
  type ChatCommandDefinition,
  type ChatCommandOptions,
} from "../shared/chat-commands";

export interface ActionProps {
  state: AppSnapshot;
  run: (method: string, params?: unknown) => Promise<void>;
  desktop: boolean;
  time?: number;
  selectedId?: string;
}

export function Assistant({
  state,
  run,
  desktop,
  time = 0,
  selectedId,
}: ActionProps) {
  const [tab, setTab] = useState<"chat" | "packages">("chat");
  const [text, setText] = useState("");
  const [commandError, setCommandError] = useState("");
  const commands = useRef<CommandPaletteHandle>(null);
  const connectedProvider = state.connection.provider || "codex";
  const [model, setModel] = useState<{
    provider: AgentProvider;
    id: string;
  } | null>(null);
  const [activePicker, setActivePicker] = useState<"model" | "effort" | null>(
    null,
  );
  const [efforts, setEfforts] = useState<Record<string, ReasoningEffort>>({});
  const selectedModel =
    state.connection.models.find(
      (item) =>
        item.id ===
        (model?.provider === connectedProvider
          ? model.id
          : state.connection.model),
    ) || state.connection.models[0];
  const supportedEfforts = selectedModel?.reasoningEfforts || [];
  const modelDisplayName = (name: string) =>
    connectedProvider === "codex"
      ? name.replace(/^(GPT-\d+(?:\.\d+)?)-/i, "$1 ")
      : name;
  const effortKey = selectedModel
    ? `${connectedProvider}:${selectedModel.id}`
    : "";
  const selectedEffort =
    selectedModel &&
    efforts[effortKey] &&
    supportedEfforts.includes(efforts[effortKey])
      ? efforts[effortKey]
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
  useEffect(() => {
    if (activeWork || state.connection.status !== "connected")
      setActivePicker(null);
  }, [activeWork, state.connection.status]);
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
  const [provider, setProvider] = useState<AgentProvider>(connectedProvider);
  const [providerPickerOpen, setProviderPickerOpen] = useState(false);
  const [providerIndex, setProviderIndex] = useState(0);
  const [baseUrl, setBaseUrl] = useState("");
  const [customModel, setCustomModel] = useState("");
  const [cliPath, setCliPath] = useState("");
  const [urlTouched, setUrlTouched] = useState(false);
  const [connectingLocal, setConnectingLocal] = useState(false);
  const [connectionError, setConnectionError] = useState("");
  const providerRoot = useRef<HTMLDivElement>(null);
  const providerTrigger = useRef<HTMLButtonElement>(null);
  const providerList = useRef<HTMLDivElement>(null);
  const closeConnection = () => {
    setConnectionOpen(false);
    setApiKey("");
    setProviderPickerOpen(false);
    setAdvanced(false);
    setConnectionError("");
  };
  const openConnection = () => {
    setProvider(connectedProvider);
    setApiKey("");
    setBaseUrl("");
    setCustomModel("");
    setCliPath("");
    setAdvanced(false);
    setUrlTouched(false);
    setConnectionError("");
    setConnectionOpen(true);
  };
  useDialogKeyboard(connectionOpen, () => {
    if (providerPickerOpen) {
      setProviderPickerOpen(false);
      providerTrigger.current?.focus();
    } else closeConnection();
  });
  useEffect(() => {
    if (!providerPickerOpen) return;
    setProviderIndex(Math.max(0, AGENT_PROVIDERS.indexOf(provider)));
    const outside = (event: PointerEvent) => {
      if (!providerRoot.current?.contains(event.target as Node))
        setProviderPickerOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    const frame = requestAnimationFrame(() => providerList.current?.focus());
    return () => {
      document.removeEventListener("pointerdown", outside);
      cancelAnimationFrame(frame);
    };
  }, [providerPickerOpen, provider]);
  const chooseProvider = (next: AgentProvider) => {
    setProvider(next);
    setApiKey("");
    setAdvanced(false);
    setBaseUrl("");
    setCustomModel("");
    setCliPath("");
    setUrlTouched(false);
    setConnectionError("");
    setProviderPickerOpen(false);
    providerTrigger.current?.focus();
  };
  let urlError = "",
    localApi = false;
  if (provider === "openai-compatible" && baseUrl.trim()) {
    try {
      const url = new URL(baseUrl.trim());
      localApi = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(
        url.hostname,
      );
      if (
        url.username ||
        url.password ||
        !["https:", "http:"].includes(url.protocol) ||
        (url.protocol === "http:" && !localApi)
      )
        urlError = "Use HTTPS ou HTTP em localhost.";
    } catch {
      urlError = "Informe uma URL completa para a API.";
    }
  }
  const needsApiKey =
    ["anthropic", "deepseek", "openrouter"].includes(provider) ||
    (provider === "codex" && advanced) ||
    (provider === "openai-compatible" && !localApi);
  const connectionPending =
    connectingLocal || state.connection.status === "connecting";
  const canConnect =
    desktop &&
    !activeWork &&
    !connectionPending &&
    (!needsApiKey || !!apiKey.trim()) &&
    (provider !== "openai-compatible" ||
      (!!baseUrl.trim() && !!customModel.trim() && !urlError));
  const providerHelp: Record<AgentProvider, string> = {
    codex:
      "O CutRoom inclui o motor do Codex e usa sua sessão local. Você não precisa criar uma conta CutRoom.",
    "claude-code":
      "Use o CLI oficial do Claude instalado neste computador e a sua sessão. Ele é instalado separadamente.",
    anthropic:
      "Conecte sua chave Anthropic. Os modelos disponíveis são carregados da sua conta ao conectar.",
    deepseek:
      "Use sua chave DeepSeek e escolha um modelo do catálogo carregado ao conectar.",
    openrouter:
      "Use sua chave OpenRouter para escolher entre os modelos disponíveis na sua conta.",
    "openai-compatible":
      "Conecte uma API compatível com OpenAI ou um servidor local, como o Ollama.",
  };
  const connect = async () => {
    if (connected) {
      if (activeWork || connectionPending) return;
      await run("disconnectAgent");
      closeConnection();
      return;
    }
    if (!canConnect) return;
    const config: AgentConnectConfig = {
      provider,
      ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      ...(provider === "openai-compatible"
        ? { baseUrl: baseUrl.trim(), model: customModel.trim() }
        : {}),
      ...(provider === "claude-code" && cliPath.trim()
        ? { cliPath: cliPath.trim() }
        : {}),
    };
    setApiKey("");
    setConnectionError("");
    setConnectingLocal(true);
    try {
      await run("connectAgent", config);
    } catch {
      setConnectionError(
        "Não foi possível conectar. Confira os dados e tente novamente.",
      );
    } finally {
      setConnectingLocal(false);
    }
  };
  const end = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const connected = state.connection.status === "connected";
  const lastMessage = state.messages.at(-1);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth" });
  }, [state.messages.length, lastMessage?.id, lastMessage?.text]);
  useEffect(() => {
    if (state.connection.status === "connected") {
      setApiKey("");
    }
  }, [state.connection.status]);
  const execute = async (
    command: ChatCommandDefinition,
    options: ChatCommandOptions,
  ) => {
    if (activeWork || !desktop) return;
    try {
      prepareChatCommand(command.id, state.project, options, {
        time,
        selectedId,
      });
    } catch (reason) {
      setCommandError(
        reason instanceof Error ? reason.message : String(reason),
      );
      return;
    }
    if (command.kind === "ai" && !connected) {
      setText(
        `/${command.id} ${JSON.stringify(options.text ?? command.defaultText ?? "")}`,
      );
      openConnection();
      return;
    }
    setCommandError("");
    commands.current?.close(false);
    setText("");
    await run("runChatCommand", {
      id: command.id,
      options,
      context: { time, selectedId },
      ...(command.kind === "ai"
        ? { model: selectedModel?.id, reasoningEffort: selectedEffort }
        : {}),
    });
  };
  const submit = async () => {
    if (!text.trim() || activeWork || !desktop) return;
    try {
      const parsed = parseSlashCommand(text);
      if (parsed) {
        const command = findChatCommand(parsed.id);
        if (command) await execute(command, parsed.options);
        return;
      }
    } catch (reason) {
      setCommandError(
        reason instanceof Error ? reason.message : String(reason),
      );
      commands.current?.close(false);
      return;
    }
    if (!connected) {
      openConnection();
      return;
    }
    const message = text.trim();
    setCommandError("");
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
          <button role="menuitem" disabled={!desktop} onClick={openConnection}>
            <Terminal size={14} />
            Conexão de IA
          </button>
          <div className="menu-caption">Sugestões</div>
          {[
            "Remova pausas e muletas",
            "Adicione legendas",
            "Aplique a edição limpa",
            "Crie uma animação para explicar as etapas do vídeo",
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
          title={`${PROVIDER_LABELS[connectedProvider]}: ${connected ? "conectado" : "desconectado"}`}
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
                  Use + ou digite / para ações prontas.
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
                            <BrandMark size={12} /> CutRoom
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
                onClick={openConnection}
              >
                <span className={`connection-dot ${state.connection.status}`} />
                <span>
                  {state.connection.status === "connecting"
                    ? `Conectando ${PROVIDER_LABELS[connectedProvider]}…`
                    : "Conecte uma IA para editar"}
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
                onChange={(event) => {
                  setText(event.target.value);
                  setCommandError("");
                }}
                onKeyDown={(event) => {
                  if (commands.current?.handleComposerKeyDown(event)) return;
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void submit();
                  }
                }}
                disabled={!desktop}
                rows={3}
              />
              {commandError && (
                <p className="composer-command-error" role="alert">
                  {commandError}
                </p>
              )}
              <div className="composer-controls">
                <CommandPalette
                  ref={commands}
                  state={state}
                  text={text}
                  setText={(value) => {
                    setText(value);
                    setCommandError("");
                  }}
                  input={input}
                  time={time}
                  selectedId={selectedId}
                  disabled={!desktop || activeWork}
                  onOpen={() => setActivePicker(null)}
                  onExecute={(definition, options) =>
                    void execute(definition, options)
                  }
                />
                <div className="assistant-selectors">
                  <ChoicePicker
                    label="Modelo"
                    value={selectedModel?.id || ""}
                    options={state.connection.models.map((item) => ({
                      value: item.id,
                      label: modelDisplayName(item.name),
                    }))}
                    onChange={(id) =>
                      setModel({ provider: connectedProvider, id })
                    }
                    disabled={!connected || activeWork}
                    open={activePicker === "model"}
                    onOpenChange={(open) => {
                      if (open) commands.current?.close(false);
                      setActivePicker((current) =>
                        open ? "model" : current === "model" ? null : current,
                      );
                    }}
                  />
                  {supportedEfforts.length > 0 && (
                    <EffortPicker
                      value={selectedEffort}
                      modelName={
                        selectedModel
                          ? modelDisplayName(selectedModel.name)
                          : ""
                      }
                      defaultValue={selectedModel?.defaultReasoningEffort}
                      options={supportedEfforts.map((effort) => ({
                        value: effort,
                        label: effortLabels[effort],
                      }))}
                      onChange={(effort) =>
                        selectedModel &&
                        setEfforts((current) => ({
                          ...current,
                          [effortKey]: effort,
                        }))
                      }
                      disabled={!connected || activeWork}
                      open={activePicker === "effort"}
                      onOpenChange={(open) => {
                        if (open) commands.current?.close(false);
                        setActivePicker((current) =>
                          open
                            ? "effort"
                            : current === "effort"
                              ? null
                              : current,
                        );
                      }}
                    />
                  )}
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
              / comandos <span>·</span> Enter envia <span>·</span> Shift + Enter
              nova linha
            </div>
          </div>
        </>
      ) : (
        <div className="packages-panel">
          <h2>Pacotes locais</h2>
          <p>
            Adicione transcrição, legendas e efeitos ao editor. Os pacotes rodam
            no seu computador; instale o que precisar, sem abrir o terminal.
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
            if (event.target === event.currentTarget) closeConnection();
          }}
        >
          <section
            className="modal connection-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="connection-title"
          >
            <button
              type="button"
              className="icon-button modal-close"
              aria-label="Fechar conexão"
              onClick={closeConnection}
            >
              <X size={18} />
            </button>
            <div className="connection-title-row">
              <Terminal size={18} />
              <h2 id="connection-title">
                {connected ? "IA conectada." : "Conectar IA."}
              </h2>
            </div>
            <form
              className="connection-form"
              onSubmit={(event) => {
                event.preventDefault();
                void connect();
              }}
            >
              <div className="connection-body">
                <div className="connection-provider" ref={providerRoot}>
                  <span id="connection-provider-label">Provedor</span>
                  <button
                    type="button"
                    ref={providerTrigger}
                    autoFocus
                    className="connection-provider-trigger"
                    aria-label="Provedor de IA"
                    aria-haspopup="listbox"
                    aria-expanded={providerPickerOpen}
                    aria-controls="connection-provider-list"
                    disabled={connected || connectionPending || activeWork}
                    onClick={() => setProviderPickerOpen(!providerPickerOpen)}
                    onKeyDown={(event) => {
                      if (["ArrowDown", "ArrowUp"].includes(event.key)) {
                        event.preventDefault();
                        setProviderPickerOpen(true);
                      }
                    }}
                  >
                    <span>{PROVIDER_LABELS[provider]}</span>
                    <ChevronDown size={13} />
                  </button>
                  {providerPickerOpen && (
                    <div
                      ref={providerList}
                      id="connection-provider-list"
                      className="connection-provider-list"
                      role="listbox"
                      aria-label="Provedor de IA"
                      tabIndex={0}
                      aria-activedescendant={`connection-provider-${providerIndex}`}
                      onKeyDown={(event) => {
                        if (
                          ["ArrowDown", "ArrowUp", "Home", "End"].includes(
                            event.key,
                          )
                        ) {
                          event.preventDefault();
                          setProviderIndex((index) =>
                            event.key === "Home"
                              ? 0
                              : event.key === "End"
                                ? AGENT_PROVIDERS.length - 1
                                : (index +
                                    (event.key === "ArrowDown" ? 1 : -1) +
                                    AGENT_PROVIDERS.length) %
                                  AGENT_PROVIDERS.length,
                          );
                        }
                        if (["Enter", " "].includes(event.key)) {
                          event.preventDefault();
                          chooseProvider(AGENT_PROVIDERS[providerIndex]);
                        }
                        if (event.key === "Tab") setProviderPickerOpen(false);
                      }}
                    >
                      {AGENT_PROVIDERS.map((item, index) => (
                        <button
                          key={item}
                          type="button"
                          role="option"
                          id={`connection-provider-${index}`}
                          aria-selected={provider === item}
                          tabIndex={-1}
                          className={
                            providerIndex === index ? "highlighted" : ""
                          }
                          onMouseMove={() => setProviderIndex(index)}
                          onClick={() => chooseProvider(item)}
                        >
                          <span>{PROVIDER_LABELS[item]}</span>
                          {provider === item && <Check size={14} />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <p className="connection-provider-help">
                  {providerHelp[provider]}
                </p>
                {connected ? (
                  <div className="connected-account">
                    <Check size={16} />
                    <span>
                      {state.connection.account ||
                        `${PROVIDER_LABELS[connectedProvider]} conectado`}
                    </span>
                  </div>
                ) : (
                  <>
                    {provider === "codex" && !advanced && (
                      <ol className="connection-steps">
                        <li>
                          Já usa o Codex neste computador? Clique em conectar.
                        </li>
                        <li>
                          Para entrar na conta pelo terminal:
                          <code>codex login</code>
                        </li>
                        <li>
                          Se o comando não estiver disponível, instale o CLI
                          oficial:<code>npm install -g @openai/codex</code>
                        </li>
                      </ol>
                    )}
                    {provider === "claude-code" && (
                      <ol className="connection-steps">
                        <li>Instale o CLI oficial do Claude separadamente.</li>
                        <li>
                          Entre na sua conta pelo terminal e volte para
                          conectar:<code>claude auth login</code>
                        </li>
                      </ol>
                    )}
                    {provider === "openai-compatible" && (
                      <>
                        <label className="field" htmlFor="agent-base-url">
                          URL da API
                          <input
                            id="agent-base-url"
                            type="url"
                            autoComplete="off"
                            spellCheck={false}
                            value={baseUrl}
                            placeholder="http://localhost:11434/v1"
                            onBlur={() => setUrlTouched(true)}
                            onChange={(event) => setBaseUrl(event.target.value)}
                            disabled={connectionPending}
                            aria-invalid={urlTouched && !!urlError}
                            aria-describedby="agent-base-url-help"
                          />
                          <small
                            id="agent-base-url-help"
                            className={
                              urlTouched && urlError
                                ? "connection-field-error"
                                : ""
                            }
                          >
                            {urlTouched && urlError
                              ? urlError
                              : "HTTPS para serviços externos. HTTP apenas em localhost."}
                          </small>
                        </label>
                        <label className="field" htmlFor="agent-model-id">
                          ID do modelo
                          <input
                            id="agent-model-id"
                            autoComplete="off"
                            spellCheck={false}
                            value={customModel}
                            onChange={(event) =>
                              setCustomModel(event.target.value)
                            }
                            disabled={connectionPending}
                            placeholder="Modelo disponível na sua API"
                          />
                        </label>
                      </>
                    )}
                    {(["codex", "claude-code"] as AgentProvider[]).includes(
                      provider,
                    ) && (
                      <button
                        type="button"
                        className="advanced-toggle"
                        aria-expanded={advanced}
                        disabled={connectionPending}
                        onClick={() => {
                          setAdvanced(!advanced);
                          setApiKey("");
                        }}
                      >
                        {provider === "codex" ? (
                          <KeyRound size={13} />
                        ) : (
                          <Terminal size={13} />
                        )}
                        {provider === "codex"
                          ? "Usar minha chave de API"
                          : "Configurar caminho do CLI"}
                        <ChevronDown size={13} />
                      </button>
                    )}
                    {(needsApiKey || provider === "openai-compatible") && (
                      <label className="field" htmlFor="agent-api-key">
                        {provider === "openai-compatible" && localApi
                          ? "Chave da API (opcional no servidor local)"
                          : "Chave da API"}
                        <input
                          id="agent-api-key"
                          type="password"
                          autoComplete="off"
                          spellCheck={false}
                          value={apiKey}
                          onChange={(event) => setApiKey(event.target.value)}
                          placeholder="Cole sua chave"
                          disabled={connectionPending}
                        />
                        <small>
                          Usada apenas na conexão local. Não é salva no projeto
                          nem pela interface.
                        </small>
                      </label>
                    )}
                    {provider === "claude-code" && advanced && (
                      <label className="field" htmlFor="agent-cli-path">
                        Caminho do executável Claude
                        <input
                          id="agent-cli-path"
                          autoComplete="off"
                          spellCheck={false}
                          value={cliPath}
                          onChange={(event) => setCliPath(event.target.value)}
                          disabled={connectionPending}
                          placeholder="Caminho do CLI oficial instalado"
                        />
                        <small>
                          Opcional. Informe o executável, sem comandos ou
                          argumentos.
                        </small>
                      </label>
                    )}
                  </>
                )}
                {(connectionError ||
                  ((state.connection.provider || "codex") === provider &&
                    state.connection.error)) && (
                  <div className="error-box" role="alert">
                    {connectionError || state.connection.error}
                  </div>
                )}
                <p className="connection-note">
                  O editor é grátis. A IA usa os limites ou créditos da sua
                  conta. Transcrição e renderização continuam no seu PC.
                </p>
              </div>
              <div className="modal-actions">
                <button
                  type="button"
                  className="button"
                  onClick={closeConnection}
                >
                  {connected ? "Fechar" : "Agora não"}
                </button>
                <button
                  type="submit"
                  className="button primary"
                  disabled={
                    connected ? activeWork || connectionPending : !canConnect
                  }
                >
                  {connectionPending
                    ? "Conectando…"
                    : connected
                      ? "Desconectar"
                      : "Conectar"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </aside>
  );
}

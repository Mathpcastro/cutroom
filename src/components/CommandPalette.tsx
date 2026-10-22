import {
  forwardRef,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  ChevronRight,
  Command,
  CornerDownLeft,
  Plus,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import type { AppSnapshot } from "../shared/types";
import {
  CHAT_COMMANDS,
  commandDefaults,
  filterChatCommands,
  findChatCommand,
  prepareChatCommand,
  type ChatCommandDefinition,
  type ChatCommandOptions,
} from "../shared/chat-commands";
import "./command-palette.css";

export interface CommandPaletteHandle {
  handleComposerKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => boolean;
  close: (focus?: boolean) => void;
}
interface Props {
  state: AppSnapshot;
  text: string;
  setText: (text: string) => void;
  input: RefObject<HTMLTextAreaElement | null>;
  time: number;
  selectedId?: string;
  disabled: boolean;
  onOpen: () => void;
  onExecute: (
    command: ChatCommandDefinition,
    options: ChatCommandOptions,
  ) => void;
}

export const CommandPalette = forwardRef<CommandPaletteHandle, Props>(
  function CommandPalette(
    {
      state,
      text,
      setText,
      input,
      time,
      selectedId,
      disabled,
      onOpen,
      onExecute,
    },
    ref,
  ) {
    const [mode, setMode] = useState<"browse" | "configure" | null>(null);
    const [origin, setOrigin] = useState<"button" | "slash">("button");
    const [query, setQuery] = useState("");
    const [active, setActive] = useState(0);
    const [selected, setSelected] = useState<ChatCommandDefinition>();
    const [options, setOptions] = useState<ChatCommandOptions>({});
    const [itemsText, setItemsText] = useState("");
    const [error, setError] = useState("");
    const [availableHeight, setAvailableHeight] = useState(485);
    const root = useRef<HTMLDivElement>(null);
    const search = useRef<HTMLInputElement>(null);
    const panel = useRef<HTMLElement>(null);
    const trigger = useRef<HTMLButtonElement>(null);
    const navigated = useRef(false);
    const id = useId();
    const matches = filterChatCommands(query);
    const highlighted = matches[active] ?? matches[0];
    const total = state.project.clips.reduce(
      (sum, clip) => sum + (clip.end - clip.start) / clip.speed,
      0,
    );
    const close = (focus = true) => {
      setMode(null);
      setError("");
      if (focus) input.current?.focus();
    };
    const choose = (command: ChatCommandDefinition, executeSimple = true) => {
      if (
        executeSimple &&
        !command.range &&
        !command.text &&
        !command.items &&
        !command.amount &&
        command.id !== "dividir"
      ) {
        close();
        onExecute(command, {});
        return;
      }
      setSelected(command);
      const defaults = commandDefaults(command, state.project, {
        time,
        selectedId,
      });
      setOptions(defaults);
      setItemsText((defaults.items ?? []).join("\n"));
      setText(`/${command.id} `);
      setError("");
      setMode("configure");
      onOpen();
      requestAnimationFrame(() => {
        panel.current
          ?.querySelector<HTMLElement>("input,textarea,button[data-apply]")
          ?.focus();
      });
    };
    const apply = () => {
      if (!selected || disabled) return;
      if (
        selected.range &&
        (!Number.isFinite(options.start) ||
          !Number.isFinite(options.end) ||
          options.start! < 0 ||
          options.end! - options.start! < 0.1 - 0.00001 ||
          options.end! > total + 0.001)
      ) {
        setError("Escolha um intervalo de pelo menos 0,1 s dentro do vídeo.");
        return;
      }
      if (
        selected.range &&
        (selected.kind === "motion" ||
          selected.kind === "ai" ||
          ["soco-pb", "modo-cinema"].includes(selected.id)) &&
        options.end! - options.start! > 120
      ) {
        setError("Cada animação pode ter até 120 segundos.");
        return;
      }
      const values = {
        ...options,
        ...(selected.text ? { text: options.text?.trim() ?? "" } : {}),
        ...(selected.items
          ? {
              items: itemsText
                .split("\n")
                .map((item) => item.trim())
                .filter(Boolean),
            }
          : {}),
      };
      if (selected.text && !values.text) {
        setError("Escreva o texto deste comando antes de aplicar.");
        return;
      }
      if (selected.text && values.text!.length > (selected.maxText ?? 500)) {
        setError(
          `Use até ${selected.maxText ?? 500} caracteres neste comando.`,
        );
        return;
      }
      if (selected.id === "soco-pb" && values.text!.split(/\s+/).length > 3) {
        setError("Use até três palavras no Soco P&B.");
        return;
      }
      if (
        selected.amount &&
        (!Number.isFinite(values.amount) ||
          values.amount! < selected.amount.min ||
          values.amount! > selected.amount.max)
      ) {
        setError(
          `Use ${selected.amount.label.toLowerCase()} entre ${selected.amount.min} e ${selected.amount.max}.`,
        );
        return;
      }
      if (
        selected.items &&
        (!values.items?.length || values.items.length > 6)
      ) {
        setError("Escreva de um a seis itens nesta animação.");
        return;
      }
      if (selected.items && values.items!.some((item) => item.length > 300)) {
        setError("Cada item pode ter até 300 caracteres.");
        return;
      }
      try {
        prepareChatCommand(selected.id, state.project, values, {
          time,
          selectedId,
        });
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : String(reason));
        return;
      }
      close();
      onExecute(selected, values);
    };
    const browseKey = (event: KeyboardEvent<HTMLElement>, composer = false) => {
      if (mode !== "browse") return false;
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        if (composer && ["Home", "End"].includes(event.key)) return false;
        event.preventDefault();
        event.stopPropagation();
        navigated.current = true;
        const index =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? matches.length - 1
              : (active +
                  (event.key === "ArrowDown" ? 1 : -1) +
                  matches.length) %
                Math.max(matches.length, 1);
        setActive(Math.max(0, index));
        return true;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close();
        return true;
      }
      if (event.key === "Enter" && !event.shiftKey && highlighted) {
        // An exact typed command executes on Enter; completing a partial command
        // or explicitly navigating the list only selects it, never also submits.
        const exact = findChatCommand(text.trim().slice(1));
        if (
          composer &&
          !navigated.current &&
          exact &&
          exact.id === highlighted.id
        )
          return false;
        event.preventDefault();
        event.stopPropagation();
        choose(highlighted, false);
        return true;
      }
      return false;
    };
    useImperativeHandle(ref, () => ({
      handleComposerKeyDown: (event) => browseKey(event, true),
      close,
    }));
    useEffect(() => {
      const slash = /^\s*\/([^\s]*)$/.exec(text);
      if (slash && !disabled) {
        setQuery(slash[1]);
        setActive(0);
        navigated.current = false;
        setOrigin("slash");
        setMode("browse");
        onOpen();
      } else if (mode === "browse" && origin === "slash") setMode(null);
    }, [text]);
    useEffect(() => {
      if (disabled) close(false);
    }, [disabled]);
    useEffect(() => {
      if (error)
        panel.current
          ?.querySelector(".command-error")
          ?.scrollIntoView({ block: "nearest" });
    }, [error]);
    useLayoutEffect(() => {
      if (!mode) return;
      const composer = trigger.current?.closest<HTMLElement>(".composer");
      if (!composer) return;
      const measure = () =>
        setAvailableHeight(
          Math.max(
            140,
            Math.min(485, composer.getBoundingClientRect().top - 94),
          ),
        );
      measure();
      const observer = new ResizeObserver(measure);
      observer.observe(composer);
      const area = composer.closest<HTMLElement>(".composer-area");
      if (area) observer.observe(area);
      window.addEventListener("resize", measure);
      return () => {
        observer.disconnect();
        window.removeEventListener("resize", measure);
      };
    }, [mode]);
    useEffect(() => {
      if (!mode) return;
      const outside = (event: PointerEvent) => {
        if (root.current?.contains(event.target as Node)) return;
        if (
          origin === "slash" &&
          mode === "browse" &&
          event.target === input.current
        )
          return;
        close(false);
      };
      document.addEventListener("pointerdown", outside);
      return () => document.removeEventListener("pointerdown", outside);
    }, [mode, origin]);
    useEffect(() => {
      panel.current
        ?.querySelector(`[data-command-index="${active}"]`)
        ?.scrollIntoView({ block: "nearest" });
    }, [active]);
    const transcriptMissing = (definition: ChatCommandDefinition) =>
      definition.needsTranscript &&
      !state.packages.some(
        (p) => p.id === "faster-whisper-base" && p.installed,
      );
    const help = (definition: ChatCommandDefinition) => (
      <>
        <p>{definition.description}</p>
        <div className="command-requirement">
          {transcriptMissing(definition) ? (
            <button
              type="button"
              onClick={() => {
                close(false);
                window.dispatchEvent(new Event("cutroom:packages"));
              }}
            >
              Precisa da transcrição <ArrowUpRight size={11} />
            </button>
          ) : (
            <span>
              {definition.kind === "ai"
                ? "Usa sua conexão Codex"
                : definition.kind === "motion" ||
                    ["soco-pb", "modo-cinema"].includes(definition.id)
                  ? "Prévia local · pacote de efeitos para exportar"
                  : "Executa no aplicativo"}
            </span>
          )}
        </div>
      </>
    );
    return (
      <div className="command-access" ref={root}>
        <button
          className="command-trigger"
          type="button"
          ref={trigger}
          aria-label="Comandos de edição"
          title="Comandos de edição · /"
          aria-haspopup="dialog"
          aria-expanded={!!mode}
          aria-controls={id}
          disabled={disabled}
          onClick={() => {
            if (mode) {
              close();
              return;
            }
            setMode("browse");
            setOrigin("button");
            setQuery("");
            setActive(0);
            setError("");
            navigated.current = false;
            onOpen();
            requestAnimationFrame(() => search.current?.focus());
          }}
        >
          <Plus size={16} />
        </button>
        {mode && (
          <section
            className="command-popover"
            style={{ maxHeight: availableHeight }}
            role="dialog"
            aria-label={
              mode === "browse"
                ? "Comandos de edição"
                : `Ajustar ${selected?.label}`
            }
            id={id}
            ref={panel}
            onBlur={(event) => {
              const next = event.relatedTarget;
              if (
                next &&
                !event.currentTarget.contains(next) &&
                next !== trigger.current &&
                !(origin === "slash" && next === input.current)
              )
                close(false);
            }}
            onKeyDown={(event) => {
              if (mode === "browse") {
                browseKey(event);
                return;
              }
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                close();
              }
              if (
                event.key === "Enter" &&
                event.target instanceof HTMLInputElement
              ) {
                event.preventDefault();
                event.stopPropagation();
                apply();
              }
            }}
          >
            {mode === "browse" ? (
              <>
                <div className="command-search">
                  <Search size={14} />
                  <input
                    ref={search}
                    aria-label="Buscar comandos"
                    placeholder="Buscar um comando…"
                    value={query}
                    onChange={(event) => {
                      setQuery(event.target.value);
                      setActive(0);
                      navigated.current = false;
                    }}
                    aria-controls={`${id}-list`}
                    aria-activedescendant={
                      highlighted ? `${id}-${highlighted.id}` : undefined
                    }
                    role="combobox"
                    aria-expanded="true"
                    autoComplete="off"
                  />
                  <kbd>/</kbd>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label="Fechar comandos"
                    onClick={() => close()}
                  >
                    <X size={13} />
                  </button>
                </div>
                <div
                  className="command-list"
                  role="listbox"
                  id={`${id}-list`}
                  aria-label="Comandos disponíveis"
                >
                  {matches.map((command, index) => (
                    <div key={command.id}>
                      {(index === 0 ||
                        matches[index - 1].category !== command.category) && (
                        <div className="command-category">
                          {command.category}
                        </div>
                      )}
                      <button
                        type="button"
                        role="option"
                        aria-selected={highlighted?.id === command.id}
                        aria-describedby={`${id}-description`}
                        id={`${id}-${command.id}`}
                        data-command-index={index}
                        className={`command-option ${highlighted?.id === command.id ? "is-active" : ""}`}
                        onPointerMove={() => setActive(index)}
                        onFocus={() => setActive(index)}
                        onClick={() => choose(command)}
                        tabIndex={-1}
                      >
                        <span className="command-option-name">
                          {command.label}
                        </span>
                        <span className="command-option-code">
                          /{command.id}
                        </span>
                        <ChevronRight size={11} />
                      </button>
                    </div>
                  ))}
                  {!matches.length && (
                    <div className="command-no-results">
                      <Command size={20} />
                      <strong>Nenhum comando encontrado</strong>
                      <span>Tente “legenda”, “zoom” ou “cinema”.</span>
                    </div>
                  )}
                </div>
                <div
                  className="command-description"
                  id={`${id}-description`}
                  aria-live="polite"
                >
                  {highlighted ? (
                    help(highlighted)
                  ) : (
                    <p>
                      {CHAT_COMMANDS.length} ações para editar com menos
                      cliques.
                    </p>
                  )}
                </div>
                <div className="command-keyboard-help">
                  <span>
                    <kbd>↑</kbd>
                    <kbd>↓</kbd> navegar
                  </span>
                  <span>
                    <CornerDownLeft size={11} /> escolher
                  </span>
                  <span>
                    <kbd>esc</kbd> fechar
                  </span>
                </div>
              </>
            ) : (
              selected && (
                <>
                  <div className="command-config-heading">
                    <button
                      type="button"
                      className="icon-button"
                      aria-label="Voltar aos comandos"
                      onClick={() => {
                        setMode("browse");
                        setOrigin("button");
                        setQuery("");
                        setActive(0);
                        requestAnimationFrame(() => search.current?.focus());
                      }}
                    >
                      <ArrowLeft size={14} />
                    </button>
                    <div>
                      <strong>{selected.label}</strong>
                      <span>/{selected.id}</span>
                    </div>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label="Fechar ajustes do comando"
                      onClick={() => close()}
                    >
                      <X size={14} />
                    </button>
                  </div>
                  <div className="command-config-body">
                    <div className="command-config-description">
                      {help(selected)}
                    </div>
                    {selected.range && (
                      <div className="command-time-fields">
                        <label>
                          Início (s)
                          <input
                            aria-label="Início do comando"
                            type="number"
                            min={0}
                            max={total}
                            step="0.1"
                            value={options.start ?? 0}
                            onChange={(e) =>
                              setOptions((v) => ({
                                ...v,
                                start: Number(e.target.value),
                              }))
                            }
                          />
                        </label>
                        <label>
                          Fim (s)
                          <input
                            aria-label="Fim do comando"
                            type="number"
                            min={0}
                            max={total}
                            step="0.1"
                            value={options.end ?? 0}
                            onChange={(e) =>
                              setOptions((v) => ({
                                ...v,
                                end: Number(e.target.value),
                              }))
                            }
                          />
                        </label>
                      </div>
                    )}
                    {selected.id === "dividir" && (
                      <label className="command-field">
                        Posição na timeline (s)
                        <input
                          aria-label="Posição da divisão"
                          type="number"
                          min={0}
                          max={total}
                          step="0.1"
                          value={options.start ?? time}
                          onChange={(e) =>
                            setOptions((v) => ({
                              ...v,
                              start: Number(e.target.value),
                            }))
                          }
                        />
                      </label>
                    )}
                    {selected.text && (
                      <label className="command-field">
                        {selected.kind === "ai"
                          ? "O que quer criar?"
                          : "Texto no vídeo"}
                        <textarea
                          aria-label="Texto do comando"
                          rows={2}
                          value={options.text ?? ""}
                          maxLength={selected.maxText ?? 500}
                          onChange={(e) =>
                            setOptions((v) => ({ ...v, text: e.target.value }))
                          }
                        />
                      </label>
                    )}
                    {selected.kind === "motion" &&
                      selected.text &&
                      selected.id !== "prompt-digitando" &&
                      !selected.items && (
                        <details className="command-extra">
                          <summary>
                            <SlidersHorizontal size={11} /> Mais opções
                          </summary>
                          <label className="command-field">
                            Complemento
                            <input
                              aria-label="Complemento do comando"
                              value={options.subtitle ?? ""}
                              maxLength={500}
                              onChange={(e) =>
                                setOptions((v) => ({
                                  ...v,
                                  subtitle: e.target.value,
                                }))
                              }
                            />
                          </label>
                        </details>
                      )}
                    {selected.items && (
                      <label className="command-field">
                        Itens · um por linha
                        <textarea
                          aria-label="Itens do comando"
                          rows={3}
                          value={itemsText}
                          maxLength={2000}
                          onChange={(e) => setItemsText(e.target.value)}
                        />
                      </label>
                    )}
                    {selected.amount && (
                      <label className="command-field">
                        {selected.amount.label}
                        <input
                          aria-label={selected.amount.label}
                          type="number"
                          min={selected.amount.min}
                          max={selected.amount.max}
                          step={selected.amount.step}
                          value={options.amount ?? selected.amount.default}
                          onChange={(e) =>
                            setOptions((v) => ({
                              ...v,
                              amount: Number(e.target.value),
                            }))
                          }
                        />
                      </label>
                    )}
                    {!selected.range &&
                      !selected.text &&
                      !selected.items &&
                      !selected.amount && (
                        <p className="command-scope">
                          {selected.kind === "system"
                            ? "Use a ação abaixo para continuar."
                            : "A ação será aplicada ao projeto atual."}
                        </p>
                      )}
                    {selected.range && (
                      <small className="command-scope">
                        Tempos da timeline editada · {total.toFixed(1)} s no
                        projeto
                      </small>
                    )}
                    {error && (
                      <p className="command-error" role="alert">
                        {error}
                      </p>
                    )}
                  </div>
                  <div className="command-config-actions">
                    <button
                      type="button"
                      className="text-link"
                      onClick={() => close()}
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      data-apply
                      className="button small command-apply"
                      disabled={
                        disabled || (total <= 0 && selected.kind !== "system")
                      }
                      onClick={apply}
                    >
                      {selected.kind === "ai"
                        ? "Enviar ao Codex"
                        : "Aplicar comando"}
                      <CornerDownLeft size={12} />
                    </button>
                  </div>
                </>
              )
            )}
          </section>
        )}
      </div>
    );
  },
);

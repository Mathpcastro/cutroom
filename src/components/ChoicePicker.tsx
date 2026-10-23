import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { Check, ChevronDown, Copy, Search } from "lucide-react";
import "./model-picker.css";

interface Choice {
  value: string;
  label: string;
  detail?: string;
  description?: string;
  copyValue?: string;
}
const normalize = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase();

/** Names and identities are supplied by the connected provider, never inferred here. */
export function ChoicePicker({
  label,
  value,
  options,
  onChange,
  disabled,
  open,
  onOpenChange,
  context,
  note,
}: {
  label: string;
  value: string;
  options: Choice[];
  onChange: (value: string) => void;
  disabled?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  context?: string;
  note?: string;
}) {
  const [active, setActive] = useState(0),
    [query, setQuery] = useState("");
  const [copyState, setCopyState] = useState<"idle" | "done" | "error">("idle");
  const [position, setPosition] = useState<CSSProperties>({
    visibility: "hidden",
  });
  const root = useRef<HTMLDivElement>(null),
    trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null),
    popover = useRef<HTMLDivElement>(null),
    search = useRef<HTMLInputElement>(null);
  const typeahead = useRef({ text: "", at: 0 });
  const id = useId(),
    selected = options.find((option) => option.value === value);
  const searchable = options.length > 7;
  const filtered = query.trim()
    ? options.filter((option) =>
        normalize(
          `${option.label} ${option.value} ${option.detail ?? ""} ${option.description ?? ""}`,
        ).includes(normalize(query.trim())),
      )
    : options;
  const close = () => {
    onOpenChange(false);
    trigger.current?.focus();
  };
  const choose = (choice: Choice) => {
    onChange(choice.value);
    close();
  };
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setCopyState("idle");
    typeahead.current = { text: "", at: 0 };
    setActive(
      Math.max(
        0,
        options.findIndex((option) => option.value === value),
      ),
    );
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) onOpenChange(false);
    };
    document.addEventListener("pointerdown", outside);
    const frame = requestAnimationFrame(() =>
      (searchable ? search.current : list.current)?.focus(),
    );
    return () => {
      document.removeEventListener("pointerdown", outside);
      cancelAnimationFrame(frame);
    };
  }, [open]);
  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const control = trigger.current?.getBoundingClientRect();
      if (!control || !popover.current) return;
      const above = control.top - 20,
        below = innerHeight - control.bottom - 20;
      const placeAbove = above >= below,
        available = Math.max(140, placeAbove ? above : below);
      const width = Math.min(342, innerWidth - 24),
        maxHeight = Math.min(480, available);
      const measuredHeight = Math.min(popover.current.scrollHeight, maxHeight);
      const next = {
        position: "fixed" as const,
        left: Math.max(12, Math.min(control.left, innerWidth - width - 12)),
        top: Math.max(
          12,
          Math.min(
            placeAbove ? control.top - measuredHeight - 8 : control.bottom + 8,
            innerHeight - measuredHeight - 12,
          ),
        ),
        bottom: "auto",
        width,
        maxHeight,
        visibility: "visible" as const,
      };
      setPosition((previous) =>
        JSON.stringify(previous) === JSON.stringify(next) ? previous : next,
      );
    };
    update();
    const observer = new ResizeObserver(update);
    if (popover.current) observer.observe(popover.current);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [open, query, filtered.length]);
  useEffect(() => {
    if (open)
      root.current
        ?.querySelector(`[data-option-index="${active}"]`)
        ?.scrollIntoView({ block: "nearest" });
  }, [active, open]);
  useEffect(() => {
    if (open)
      setActive((index) => Math.max(0, Math.min(index, filtered.length - 1)));
  }, [filtered.length, open]);
  const copyIdentity = async () => {
    try {
      await navigator.clipboard.writeText(
        selected?.copyValue || selected?.value || "",
      );
      setCopyState("done");
    } catch {
      setCopyState("error");
    }
  };
  return (
    <div
      className={`choice-picker identity-picker ${open ? "is-open" : ""}`}
      ref={root}
    >
      <button
        ref={trigger}
        type="button"
        className="choice-trigger"
        aria-label={label}
        title={
          selected
            ? [selected.label, selected.detail, selected.description, note]
                .filter(Boolean)
                .join("\n")
            : "Conecte uma IA para escolher um modelo"
        }
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        disabled={disabled || !options.length}
        onClick={() => onOpenChange(!open)}
        onKeyDown={(event) => {
          if (["ArrowDown", "ArrowUp"].includes(event.key)) {
            event.preventDefault();
            onOpenChange(true);
          }
        }}
      >
        <span className="choice-trigger-copy">
          {selected?.label || "Modelo"}
        </span>
        <ChevronDown size={11} />
      </button>
      {open && (
        <div
          ref={popover}
          className="choice-popover identity-popover"
          style={position}
          onKeyDown={(event) => {
            const searching = event.target === search.current;
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              close();
            }
            if (event.key === "Tab") close();
            if (
              ["ArrowDown", "ArrowUp"].includes(event.key) ||
              (!searching && ["Home", "End"].includes(event.key))
            ) {
              event.preventDefault();
              event.stopPropagation();
              setActive((index) =>
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? filtered.length - 1
                    : Math.max(
                        0,
                        Math.min(
                          filtered.length - 1,
                          index + (event.key === "ArrowDown" ? 1 : -1),
                        ),
                      ),
              );
            }
            if (event.key === "Enter" || (!searching && event.key === " ")) {
              event.preventDefault();
              event.stopPropagation();
              if (filtered[active]) choose(filtered[active]);
            }
            if (
              !searching &&
              event.key.length === 1 &&
              event.key !== " " &&
              !event.ctrlKey &&
              !event.metaKey &&
              !event.altKey
            ) {
              event.preventDefault();
              event.stopPropagation();
              const now = Date.now(),
                text =
                  now - typeahead.current.at > 900
                    ? event.key
                    : typeahead.current.text + event.key;
              typeahead.current = { text: normalize(text), at: now };
              const index = filtered.findIndex((option) =>
                normalize(
                  `${option.label} ${option.value} ${option.detail ?? ""}`,
                ).includes(typeahead.current.text),
              );
              if (index >= 0) setActive(index);
            }
          }}
        >
          <div className="choice-heading identity-heading">
            <span>Selecionar modelo</span>
            {context && <small>{context}</small>}
          </div>
          {searchable && (
            <label className="identity-search">
              <Search size={13} />
              <input
                ref={search}
                aria-label="Buscar modelo por nome ou ID"
                role="combobox"
                aria-autocomplete="list"
                aria-expanded="true"
                aria-controls={`${id}-list`}
                aria-activedescendant={
                  filtered[active] ? `${id}-${active}` : undefined
                }
                placeholder="Buscar nome, versão ou ID…"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActive(0);
                }}
              />
            </label>
          )}
          <div
            id={`${id}-list`}
            className="choice-list identity-list"
            role="listbox"
            aria-label={label}
            tabIndex={0}
            ref={list}
            aria-activedescendant={
              filtered[active] ? `${id}-${active}` : undefined
            }
          >
            {filtered.map((option, index) => (
              <button
                key={option.value}
                id={`${id}-${index}`}
                type="button"
                role="option"
                aria-selected={option.value === value}
                tabIndex={-1}
                data-option-index={index}
                className={`choice-option identity-option ${index === active ? "highlighted" : ""}`}
                title={[option.label, option.detail, option.description]
                  .filter(Boolean)
                  .join("\n")}
                onMouseMove={() => setActive(index)}
                onClick={(event) => {
                  const selection = window.getSelection();
                  if (
                    selection &&
                    !selection.isCollapsed &&
                    event.currentTarget.contains(selection.anchorNode)
                  )
                    return;
                  choose(option);
                }}
              >
                <span>
                  <strong>{option.label}</strong>
                  {option.detail && (
                    <small className="identity-id">{option.detail}</small>
                  )}
                  {option.description && (
                    <small className="identity-description">
                      {option.description}
                    </small>
                  )}
                </span>
                {option.value === value && (
                  <Check size={14} strokeWidth={1.6} />
                )}
              </button>
            ))}
            {!filtered.length && (
              <p className="choice-empty" role="status">
                Nenhum modelo encontrado.
              </p>
            )}
          </div>
          {note && <p className="identity-note">{note}</p>}
          {selected && (
            <div className="identity-footer">
              <span title={selected.detail || selected.value}>
                {copyState === "error"
                  ? "Selecione o ID para copiar."
                  : copyState === "done"
                    ? "Identificador copiado."
                    : selected.detail || selected.value}
              </span>
              <button
                type="button"
                aria-label="Copiar identificador do modelo"
                title="Copiar identificador do modelo"
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ")
                    event.stopPropagation();
                }}
                onClick={() => void copyIdentity()}
              >
                {copyState === "done" ? (
                  <Check size={13} />
                ) : (
                  <Copy size={13} />
                )}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

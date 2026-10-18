import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";

interface Choice {
  value: string;
  label: string;
  detail?: string;
}
export function ChoicePicker({
  label,
  value,
  options,
  onChange,
  disabled,
  searchable = false,
}: {
  label: string;
  value: string;
  options: Choice[];
  onChange: (value: string) => void;
  disabled?: boolean;
  searchable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const id = useId();
  const filtered = options.filter((option) =>
    `${option.label} ${option.value}`
      .toLocaleLowerCase()
      .includes(query.toLocaleLowerCase()),
  );
  const selected = options.find((option) => option.value === value);
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  const choose = (choice: Choice) => {
    onChange(choice.value);
    close();
  };
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(
      Math.max(
        0,
        options.findIndex((option) => option.value === value),
      ),
    );
    const handle = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", handle);
    requestAnimationFrame(() =>
      searchable ? search.current?.focus() : list.current?.focus(),
    );
    return () => document.removeEventListener("pointerdown", handle);
  }, [open]);
  useEffect(() => {
    root.current
      ?.querySelector(`[data-option-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active, open]);
  return (
    <div className={`choice-picker ${open ? "is-open" : ""}`} ref={root}>
      <button
        ref={trigger}
        type="button"
        className="choice-trigger"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        disabled={disabled || !options.length}
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => {
          if (["ArrowDown", "ArrowUp"].includes(event.key)) {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span className="choice-trigger-copy">
          <small>{label}</small>
          <strong>{selected?.label || "Indisponível"}</strong>
        </span>
        <ChevronDown size={13} />
      </button>
      {open && (
        <div
          className="choice-popover"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              close();
            }
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              setActive((index) =>
                Math.max(
                  0,
                  Math.min(
                    filtered.length - 1,
                    index + (event.key === "ArrowDown" ? 1 : -1),
                  ),
                ),
              );
            }
            if (event.key === "Home" && !searchable) {
              event.preventDefault();
              setActive(0);
            }
            if (event.key === "End" && !searchable) {
              event.preventDefault();
              setActive(filtered.length - 1);
            }
            if (event.key === "Enter") {
              event.preventDefault();
              event.stopPropagation();
              if (filtered[active]) choose(filtered[active]);
            }
            if (event.key === "Tab") setOpen(false);
          }}
        >
          <div className="choice-heading">{label}</div>
          {searchable && (
            <label className="choice-search">
              <Search size={14} />
              <input
                ref={search}
                aria-label={`Buscar ${label.toLocaleLowerCase()}`}
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={open}
                aria-controls={`${id}-list`}
                aria-activedescendant={
                  filtered[active] ? `${id}-${active}` : undefined
                }
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActive(0);
                }}
                placeholder="Buscar modelo…"
              />
            </label>
          )}
          <div
            id={`${id}-list`}
            className="choice-list"
            role="listbox"
            aria-label={label}
            tabIndex={searchable ? -1 : 0}
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
                className={`choice-option ${index === active ? "highlighted" : ""}`}
                onMouseMove={() => setActive(index)}
                onClick={() => choose(option)}
              >
                <span>
                  <strong>{option.label}</strong>
                  {option.detail && <small>{option.detail}</small>}
                </span>
                {option.value === value && <Check size={15} />}
              </button>
            ))}
            {!filtered.length && (
              <p className="choice-empty">Nenhum modelo encontrado.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

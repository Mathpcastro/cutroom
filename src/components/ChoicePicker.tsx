import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

interface Choice {
  value: string;
  label: string;
}

/** Compact model selector. Type while open to jump to a real catalog entry. */
export function ChoicePicker({
  label,
  value,
  options,
  onChange,
  disabled,
  open,
  onOpenChange,
}: {
  label: string;
  value: string;
  options: Choice[];
  onChange: (value: string) => void;
  disabled?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const typeahead = useRef({ text: "", at: 0 });
  const id = useId();
  const selected = options.find((option) => option.value === value);
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
    const frame = requestAnimationFrame(() => list.current?.focus());
    return () => {
      document.removeEventListener("pointerdown", outside);
      cancelAnimationFrame(frame);
    };
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
        title={selected?.label || "Conecte uma IA para escolher um modelo"}
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
          className="choice-popover"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              close();
            }
            if (event.key === "Tab") close();
            if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
              event.preventDefault();
              event.stopPropagation();
              setActive((index) =>
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? options.length - 1
                    : Math.max(
                        0,
                        Math.min(
                          options.length - 1,
                          index + (event.key === "ArrowDown" ? 1 : -1),
                        ),
                      ),
              );
            }
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              event.stopPropagation();
              if (options[active]) choose(options[active]);
            }
            if (
              event.key.length === 1 &&
              event.key !== " " &&
              !event.ctrlKey &&
              !event.metaKey &&
              !event.altKey
            ) {
              event.preventDefault();
              event.stopPropagation();
              const now = Date.now();
              const query =
                now - typeahead.current.at > 900
                  ? event.key
                  : typeahead.current.text + event.key;
              typeahead.current = { text: query.toLocaleLowerCase(), at: now };
              const index = options.findIndex((option) =>
                `${option.label} ${option.value}`
                  .toLocaleLowerCase()
                  .includes(typeahead.current.text),
              );
              if (index >= 0) setActive(index);
            }
          }}
        >
          <div className="choice-heading">Selecionar modelo</div>
          <div
            id={`${id}-list`}
            className="choice-list"
            role="listbox"
            aria-label={label}
            tabIndex={0}
            ref={list}
            aria-activedescendant={
              options[active] ? `${id}-${active}` : undefined
            }
          >
            {options.map((option, index) => (
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
                <span>{option.label}</span>
                {option.value === value && (
                  <Check size={15} strokeWidth={1.6} />
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

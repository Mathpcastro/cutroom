import { useEffect, useId, useRef, type CSSProperties } from "react";
import { Check, ChevronDown, RotateCcw, Zap } from "lucide-react";
import type { ReasoningEffort } from "../shared/types";

export function EffortPicker({
  value,
  options,
  defaultValue,
  modelName,
  onChange,
  disabled,
  open,
  onOpenChange,
  providerDefault = false,
}: {
  value?: ReasoningEffort;
  options: { value: ReasoningEffort; label: string }[];
  defaultValue?: ReasoningEffort;
  modelName: string;
  onChange: (value: ReasoningEffort | undefined) => void;
  disabled?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  providerDefault?: boolean;
}) {
  const root = useRef<HTMLDivElement>(null),
    trigger = useRef<HTMLButtonElement>(null);
  const slider = useRef<HTMLInputElement>(null),
    reset = useRef<HTMLButtonElement>(null);
  const id = useId();
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const selected =
    providerDefault && value === undefined
      ? undefined
      : options.find((option) => option.value === value);
  const fallback =
    options.find((option) => option.value === defaultValue) || options[0];
  const selectedLabel =
    selected?.label ||
    (providerDefault ? "Padrão do provedor" : "Indisponível");
  const fill =
    options.length <= 1 ? 0 : (selectedIndex / (options.length - 1)) * 100;
  const choices: { value?: ReasoningEffort; label: string }[] = [
    { value: undefined, label: "Padrão do provedor" },
    ...options,
  ];
  const close = () => {
    onOpenChange(false);
    trigger.current?.focus();
  };
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) onOpenChange(false);
    };
    document.addEventListener("pointerdown", outside);
    const frame = requestAnimationFrame(() =>
      providerDefault
        ? root.current
            ?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]')
            ?.focus()
        : slider.current?.focus(),
    );
    return () => {
      document.removeEventListener("pointerdown", outside);
      cancelAnimationFrame(frame);
    };
  }, [open, providerDefault]);
  return (
    <div className={`effort-picker ${open ? "is-open" : ""}`} ref={root}>
      <button
        ref={trigger}
        type="button"
        className="choice-trigger effort-trigger"
        aria-label="Raciocínio"
        title={`Raciocínio: ${selectedLabel}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={`${id}-panel`}
        disabled={disabled || !options.length}
        onClick={() => onOpenChange(!open)}
        onKeyDown={(event) => {
          if (["ArrowDown", "ArrowUp"].includes(event.key)) {
            event.preventDefault();
            onOpenChange(true);
          }
        }}
      >
        <span>
          {providerDefault && value === undefined
            ? "Padrão"
            : selected?.label || "Esforço"}
        </span>
        <ChevronDown size={11} />
      </button>
      {open && (
        <div
          id={`${id}-panel`}
          className={`effort-popover ${providerDefault ? "provider-effort-popover" : ""}`}
          role="dialog"
          aria-label="Raciocínio"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              close();
            }
            if (providerDefault) {
              if (event.key === "Tab") close();
              return;
            }
            if (event.key === "Enter" && event.target !== reset.current) {
              event.preventDefault();
              event.stopPropagation();
              close();
            }
            if (event.key === "Tab") {
              event.preventDefault();
              if (document.activeElement === slider.current)
                reset.current?.focus();
              else slider.current?.focus();
            }
          }}
        >
          <div className="effort-popover-heading">
            <Zap
              size={14}
              strokeWidth={1.5}
              className="effort-lightning"
              aria-hidden="true"
            />
            <div className="effort-popover-copy">
              <strong id={`${id}-value`}>{selectedLabel}</strong>
              <span title={modelName}>{modelName}</span>
            </div>
            <button
              ref={reset}
              type="button"
              className="effort-reset"
              title={
                providerDefault
                  ? "Restaurar padrão do provedor"
                  : `Restaurar padrão: ${fallback?.label || ""}`
              }
              aria-label="Restaurar raciocínio padrão"
              disabled={!providerDefault && !fallback}
              onClick={() => {
                onChange(providerDefault ? undefined : fallback?.value);
                if (providerDefault)
                  root.current
                    ?.querySelector<HTMLElement>('[role="radio"]')
                    ?.focus();
                else slider.current?.focus();
              }}
            >
              <RotateCcw size={14} strokeWidth={1.5} />
            </button>
          </div>
          {providerDefault ? (
            <div
              className="provider-effort-choices"
              role="radiogroup"
              aria-label="Nível de raciocínio"
            >
              {choices.map((choice, index) => (
                <button
                  key={choice.value ?? "provider-default"}
                  type="button"
                  role="radio"
                  aria-checked={choice.value === value}
                  tabIndex={choice.value === value ? 0 : -1}
                  onClick={() => {
                    onChange(choice.value);
                    close();
                  }}
                  onKeyDown={(event) => {
                    if (
                      ![
                        "ArrowDown",
                        "ArrowUp",
                        "ArrowLeft",
                        "ArrowRight",
                        "Home",
                        "End",
                      ].includes(event.key)
                    )
                      return;
                    event.preventDefault();
                    event.stopPropagation();
                    const next =
                      event.key === "Home"
                        ? 0
                        : event.key === "End"
                          ? choices.length - 1
                          : (index +
                              (["ArrowDown", "ArrowRight"].includes(event.key)
                                ? 1
                                : -1) +
                              choices.length) %
                            choices.length;
                    onChange(choices[next].value);
                    root.current
                      ?.querySelectorAll<HTMLElement>('[role="radio"]')
                      [next]?.focus();
                  }}
                >
                  <span>{choice.label}</span>
                  {choice.value === value && <Check size={13} />}
                </button>
              ))}
              <p>O padrão usa a configuração do provedor.</p>
            </div>
          ) : (
            <div
              className="effort-slider"
              style={{ "--effort-fill": `${fill}%` } as CSSProperties}
            >
              <div className="effort-track" aria-hidden="true">
                <span />
                <div className="effort-ticks">
                  {options.map((option, index) => (
                    <i
                      key={option.value}
                      style={{
                        left:
                          options.length <= 1
                            ? "50%"
                            : `${(index / (options.length - 1)) * 100}%`,
                      }}
                    />
                  ))}
                </div>
              </div>
              <input
                ref={slider}
                type="range"
                min={0}
                max={Math.max(0, options.length - 1)}
                step={1}
                value={selectedIndex}
                aria-label="Nível de raciocínio"
                aria-valuetext={selected?.label || "Indisponível"}
                onChange={(event) => {
                  const option = options[Number(event.target.value)];
                  if (option) onChange(option.value);
                }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

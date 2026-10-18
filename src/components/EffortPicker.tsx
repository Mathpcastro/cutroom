import { useEffect, useId, useRef, type CSSProperties } from "react";
import { ChevronDown, RotateCcw, Zap } from "lucide-react";
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
}: {
  value?: ReasoningEffort;
  options: { value: ReasoningEffort; label: string }[];
  defaultValue?: ReasoningEffort;
  modelName: string;
  onChange: (value: ReasoningEffort) => void;
  disabled?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const slider = useRef<HTMLInputElement>(null);
  const reset = useRef<HTMLButtonElement>(null);
  const id = useId();
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const selected = options[selectedIndex];
  const fallback =
    options.find((option) => option.value === defaultValue) || options[0];
  const fill =
    options.length <= 1 ? 0 : (selectedIndex / (options.length - 1)) * 100;
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
    const frame = requestAnimationFrame(() => slider.current?.focus());
    return () => {
      document.removeEventListener("pointerdown", outside);
      cancelAnimationFrame(frame);
    };
  }, [open]);
  return (
    <div className={`effort-picker ${open ? "is-open" : ""}`} ref={root}>
      <button
        ref={trigger}
        type="button"
        className="choice-trigger effort-trigger"
        aria-label="Raciocínio"
        title={
          selected ? `Raciocínio: ${selected.label}` : "Raciocínio indisponível"
        }
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
        <span>{selected?.label || "Esforço"}</span>
        <ChevronDown size={11} />
      </button>
      {open && (
        <div
          id={`${id}-panel`}
          className="effort-popover"
          role="dialog"
          aria-label="Raciocínio"
          onKeyDown={(event) => {
            if (event.key === "Enter" && event.target === reset.current) return;
            if (event.key === "Escape" || event.key === "Enter") {
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
              <strong id={`${id}-value`}>{selected?.label}</strong>
              <span>{modelName}</span>
            </div>
            <button
              ref={reset}
              type="button"
              className="effort-reset"
              title={`Restaurar padrão: ${fallback?.label || ""}`}
              aria-label="Restaurar raciocínio padrão"
              disabled={!fallback}
              onClick={() => {
                if (fallback) onChange(fallback.value);
                slider.current?.focus();
              }}
            >
              <RotateCcw size={14} strokeWidth={1.5} />
            </button>
          </div>
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
        </div>
      )}
    </div>
  );
}

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

/** A small desktop menu with one keyboard focus path and focus restoration. */
export function Menu({
  label,
  children,
  icon,
  className = "",
  eventName,
}: {
  label: string;
  children: ReactNode;
  icon?: ReactNode;
  className?: string;
  eventName?: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  useEffect(() => {
    if (!eventName) return;
    const show = () => setOpen(true);
    window.addEventListener(eventName, show);
    return () => window.removeEventListener(eventName, show);
  }, [eventName]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    const frame = requestAnimationFrame(() => {
      panel.current
        ?.querySelectorAll<HTMLElement>('[role^="menuitem"]')
        .forEach((item) => {
          item.tabIndex = -1;
        });
      panel.current
        ?.querySelector<HTMLElement>('[role^="menuitem"]:not(:disabled)')
        ?.focus();
    });
    return () => {
      document.removeEventListener("pointerdown", outside);
      cancelAnimationFrame(frame);
    };
  }, [open]);
  return (
    <div className={`desktop-menu ${className}`} ref={root}>
      <button
        ref={trigger}
        className="menu-trigger"
        type="button"
        title={label}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        {icon}
        <span>{label}</span>
        <ChevronDown size={12} />
      </button>
      {open && (
        <div
          id={id}
          ref={panel}
          className="desktop-menu-panel"
          role="menu"
          aria-label={label}
          onClick={(event) => {
            if (
              (event.target as HTMLElement).closest(
                '[role^="menuitem"]:not(:disabled)',
              )
            )
              close();
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              close();
            }
            if (event.key === "Tab") close();
            const items = Array.from(
              panel.current?.querySelectorAll<HTMLElement>(
                '[role^="menuitem"]:not(:disabled)',
              ) || [],
            );
            const index = items.indexOf(document.activeElement as HTMLElement);
            if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
              event.preventDefault();
              event.stopPropagation();
              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? items.length - 1
                    : (index +
                        (event.key === "ArrowDown" ? 1 : -1) +
                        items.length) %
                      items.length;
              items[next]?.focus();
            }
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

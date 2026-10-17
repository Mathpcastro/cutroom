import { useEffect, useRef } from "react";

/** Restores focus, contains Tab navigation, and closes the active dialog on Escape. */
export function useDialogKeyboard(open: boolean, close: () => void) {
  const callback = useRef(close);
  const invokingControl = useRef<HTMLElement | null>(null);
  callback.current = close;
  useEffect(() => {
    if (!open) {
      const rememberFocus = () => {
        const element = document.activeElement as HTMLElement | null;
        if (element && !element.closest('[role="dialog"]'))
          invokingControl.current = element;
      };
      rememberFocus();
      document.addEventListener("focusin", rememberFocus);
      return () => document.removeEventListener("focusin", rememberFocus);
    }
    const previous = invokingControl.current;
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    const focusable = () =>
      Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),a[href],[tabindex="0"]',
        ) || [],
      ).filter((element) => element.getClientRects().length > 0);
    const autofocus = dialog?.querySelector<HTMLElement>("[autofocus]");
    if (!dialog?.contains(document.activeElement))
      (autofocus || focusable()[0])?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        callback.current();
      }
      if (event.key === "Tab") {
        const elements = focusable();
        const first = elements[0];
        const last = elements.at(-1);
        if (
          event.shiftKey &&
          (document.activeElement === first ||
            !dialog?.contains(document.activeElement))
        ) {
          event.preventDefault();
          last?.focus();
        } else if (
          !event.shiftKey &&
          (document.activeElement === last ||
            !dialog?.contains(document.activeElement))
        ) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", keydown, true);
    return () => {
      document.removeEventListener("keydown", keydown, true);
      if (previous?.isConnected) previous.focus();
    };
  }, [open]);
}

import { useEffect, useState } from "react";
import { applyTheme, THEME_STORAGE_KEY } from "../../lib/themes";

/** Studio appearance (Spec 1): the user picks Claro, Escuro or Automático (follows Windows). */
export type StudioThemePreference = "light" | "dark" | "auto";
export type StudioTheme = "light" | "dark";

export const STUDIO_THEME_KEY = "videosell.studio.theme";
const preferences: StudioThemePreference[] = ["light", "dark", "auto"];

/** Top bar and sidebar colour per theme; the native window buttons use the same colour. */
export const studioChrome: Record<StudioTheme, { background: string; foreground: string }> = {
  light: { background: "#141318", foreground: "#f8f7fb" },
  dark: { background: "#0e0d12", foreground: "#f8f7fb" },
};

export function resolveStudioTheme(preference: StudioThemePreference, systemDark: boolean): StudioTheme {
  if (preference === "auto") return systemDark ? "dark" : "light";
  return preference;
}

export function savedStudioThemePreference(): StudioThemePreference {
  try {
    const saved = localStorage.getItem(STUDIO_THEME_KEY) as StudioThemePreference | null;
    return saved && preferences.includes(saved) ? saved : "auto";
  } catch {
    return "auto";
  }
}

function systemPrefersDark() {
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return false;
  }
}

/** Editor themes that simply mirror the studio. A theme the user picked by hand is left alone. */
export function editorThemeFor(theme: StudioTheme, current: string | null): string | null {
  if (current && current !== "graphite" && current !== "light") return null;
  return theme === "dark" ? "graphite" : "light";
}

/** Paints the native title bar buttons with the studio bar colour. */
export function syncStudioWindow(preference: StudioThemePreference, theme: StudioTheme) {
  const chrome = studioChrome[theme];
  void window.cutroom
    ?.request("setAppearance", {
      mode: preference === "auto" ? "system" : theme,
      background: chrome.background,
      foreground: chrome.foreground,
    })
    .catch(() => {
      /* Older hosts may not implement native appearance. */
    });
}

export function useStudioTheme(visible: boolean) {
  const [preference, setPreferenceState] = useState<StudioThemePreference>(savedStudioThemePreference);
  const [systemDark, setSystemDark] = useState(systemPrefersDark);
  useEffect(() => {
    let query: MediaQueryList;
    try {
      query = window.matchMedia("(prefers-color-scheme: dark)");
    } catch {
      return;
    }
    const update = () => setSystemDark(query.matches);
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, []);
  const theme = resolveStudioTheme(preference, systemDark);
  useEffect(() => {
    if (visible) syncStudioWindow(preference, theme);
  }, [visible, preference, theme]);
  const setPreference = (next: StudioThemePreference) => {
    setPreferenceState(next);
    try {
      localStorage.setItem(STUDIO_THEME_KEY, next);
    } catch {
      /* The choice still applies for this session. */
    }
    let current: string | null = null;
    try {
      current = localStorage.getItem(THEME_STORAGE_KEY);
    } catch {
      /* ignore */
    }
    const editor = editorThemeFor(resolveStudioTheme(next, systemDark), current);
    if (editor) {
      applyTheme(editor);
      // applyTheme repaints the window for the editor; the studio is still in front.
      if (visible) syncStudioWindow(next, resolveStudioTheme(next, systemDark));
    }
  };
  return { preference, theme, setPreference };
}

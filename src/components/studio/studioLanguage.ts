import { useSyncExternalStore } from "react";
import { studioTranslations } from "./studioTranslations";

export const studioLanguages = ["pt-BR", "en", "es"] as const;
export type StudioLanguage = (typeof studioLanguages)[number];
const storageKey = "videosell.studio.language";
const listeners = new Set<() => void>();
function initialLanguage(): StudioLanguage {
  try {
    const saved = window.localStorage.getItem(storageKey);
    return studioLanguages.find((value) => value === saved) ?? "pt-BR";
  } catch { return "pt-BR"; }
}

let language = initialLanguage();
export const getStudioLanguage = () => language;
export const studioLanguageName = { "pt-BR": "português brasileiro", en: "English", es: "español" };
export function setStudioLanguage(next: StudioLanguage) {
  if (!studioLanguages.includes(next) || next === language) return;
  language = next;
  try { window.localStorage.setItem(storageKey, next); } catch { /* Keep the session preference. */ }
  listeners.forEach((listener) => listener());
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function useStudioLanguage() {
  return useSyncExternalStore(subscribe, getStudioLanguage, getStudioLanguage);
}
export function t(portuguese: string) {
  return language === "pt-BR" ? portuguese : studioTranslations[portuguese]?.[language === "en" ? 0 : 1] ?? portuguese;
}


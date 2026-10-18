export const THEME_STORAGE_KEY = "cutroom.appearance.theme";
export const themes = [
  {
    id: "graphite",
    name: "Grafite",
    color: "#202020",
    accent: "#e8e8e8",
    light: false,
  },
  {
    id: "light",
    name: "Claro",
    color: "#f5f5f5",
    accent: "#252525",
    light: true,
  },
  {
    id: "dark-plus",
    name: "Dark+",
    color: "#252526",
    accent: "#3794ff",
    light: false,
  },
  {
    id: "light-plus",
    name: "Light+",
    color: "#f3f3f3",
    accent: "#0078d4",
    light: true,
  },
  {
    id: "nord",
    name: "Nord",
    color: "#3b4252",
    accent: "#88c0d0",
    light: false,
  },
  {
    id: "tokyo-night",
    name: "Tokyo Night",
    color: "#24283b",
    accent: "#7aa2f7",
    light: false,
  },
] as const;
export type ThemeId = (typeof themes)[number]["id"];
export function applyTheme(id: string): ThemeId {
  const theme = themes.find((item) => item.id === id) || themes[0];
  document.documentElement.dataset.theme = theme.id;
  document.documentElement.style.colorScheme = theme.light ? "light" : "dark";
  const tokens = getComputedStyle(document.documentElement);
  if (window.cutroom)
    void window.cutroom
      .request("setAppearance", {
        mode: theme.light ? "light" : "dark",
        background: tokens.getPropertyValue("--panel").trim() || theme.color,
        foreground:
          tokens.getPropertyValue("--text").trim() ||
          (theme.light ? "#252525" : "#e8e8e8"),
      })
      .catch(() => {
        /* Preview/older hosts may not implement native appearance. */
      });
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme.id);
  } catch {
    /* Storage can be unavailable in restricted previews. */
  }
  return theme.id;
}
export function initializeTheme() {
  let saved = "graphite";
  try {
    saved = localStorage.getItem(THEME_STORAGE_KEY) || saved;
  } catch {
    /* Use default. */
  }
  return applyTheme(saved);
}

import { t, setStudioLanguage, useStudioLanguage, type StudioLanguage } from "./studioLanguage";
import { BookOpen, CalendarDays, Clapperboard, Film, Lightbulb, Monitor, Moon, Settings2, Sun } from "lucide-react";
import type { StudioTab } from "../../shared/types";
import type { StudioPage } from "../VideosellStudio";
import { ProfileSwitcher } from "./ProfileSwitcher";
import type { StudioProfile } from "../../shared/profile";
import type { StudioThemePreference } from "./studioTheme";
import { ConnectionBadge } from "./InstagramConnect";

interface StudioNavProps {
  page: StudioPage;
  onPage: (page: StudioPage) => void;
  onOpenAdvanced: (tab?: StudioTab) => void;
  onProfileChange: (profile: StudioProfile | null, initializing: boolean) => void;
  onProfileCreated: (path: "brand" | "avatar") => void;
  avatarSetupRequest: number;
  fontScale: number;
  onFontScaleChange: (scale: number) => void;
  themePreference?: StudioThemePreference;
  onThemePreference?: (preference: StudioThemePreference) => void;
}

/** Spec 4 E: 5 main places + Ajustes. Every older screen lives inside one of them. */
const items = [
  { id: "home", label: "Criar", icon: Clapperboard, owns: ["home", "create", "onboarding"] },
  { id: "projects", label: "Meus Reels", icon: Film, owns: ["projects", "videos"] },
  { id: "routine", label: "Piloto automático", icon: CalendarDays, owns: ["routine"] },
  { id: "radar", label: "Ideias", icon: Lightbulb, owns: ["radar", "analytics"] },
  { id: "stories", label: "Histórias", icon: BookOpen, owns: ["stories"] },
] as const;
const themeLabel: Record<StudioThemePreference, string> = { light: "Claro", dark: "Escuro", auto: "Automático" };
const nextTheme: Record<StudioThemePreference, StudioThemePreference> = { auto: "light", light: "dark", dark: "auto" };
const settingsPages = ["settings", "avatars", "voices", "brand", "proofs", "publish"];

export function StudioNav({
  page,
  onPage,
  onOpenAdvanced,
  onProfileChange,
  onProfileCreated,
  avatarSetupRequest,
  fontScale,
  onFontScaleChange,
  themePreference = "auto",
  onThemePreference,
}: StudioNavProps) {
  const language = useStudioLanguage();
  return (
    <aside className="studio-sidebar">
      <nav className="studio-nav" aria-label={t("Navegação do estúdio")}>
        {items.map(({ id, label, icon: Icon, owns }) => {
          const active = (owns as readonly string[]).includes(page);
          return (
            <button
              key={id}
              type="button"
              className={active ? "active" : ""}
              aria-current={active ? "page" : undefined}
              onClick={() => onPage(id as StudioPage)}
            >
              <Icon size={17} strokeWidth={1.7} />
              <span>{t(label)}</span>
            </button>
          );
        })}
      </nav>
      <div className="studio-sidebar-bottom">
        <div className="sidebar-account">
          <ProfileSwitcher onProfileChange={onProfileChange} onProfileCreated={onProfileCreated} avatarSetupRequest={avatarSetupRequest} />
          <ConnectionBadge onOpen={() => onPage("publish")} />
        </div>
        <div className="sidebar-footer">
          <button
            type="button"
            className={`studio-advanced-button ${settingsPages.includes(page) ? "active" : ""}`}
            aria-current={settingsPages.includes(page) ? "page" : undefined}
            onClick={() => onPage("settings")}
          >
            <Settings2 size={16} />
            <span>{t("Ajustes")}</span>
          </button>
          <button
            type="button"
            className="sidebar-theme"
            aria-label={`${t("Aparência")}: ${t(themeLabel[themePreference])}`}
            title={`${t("Aparência")}: ${t(themeLabel[themePreference])}`}
            onClick={() => onThemePreference?.(nextTheme[themePreference])}
          >
            {themePreference === "light" ? <Sun size={16} /> : themePreference === "dark" ? <Moon size={16} /> : <Monitor size={16} />}
          </button>
        </div>
      </div>
    </aside>
  );
}

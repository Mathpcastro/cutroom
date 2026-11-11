import { t, setStudioLanguage, useStudioLanguage, type StudioLanguage } from "./studioLanguage";
import { BookOpen, CalendarDays, Clapperboard, Film, Lightbulb, Settings2 } from "lucide-react";
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
        <ConnectionBadge onOpen={() => onPage("publish")} />
        <ProfileSwitcher onProfileChange={onProfileChange} onProfileCreated={onProfileCreated} avatarSetupRequest={avatarSetupRequest} />
        <div className="studio-prefs" role="group" aria-label={t("Preferências")}>
          <label>
            {t("Idioma")}
            <select value={language} onChange={(event) => setStudioLanguage(event.target.value as StudioLanguage)}>
              <option value="pt-BR" lang="pt-BR">Português</option>
              <option value="en" lang="en">English</option>
              <option value="es" lang="es">Español</option>
            </select>
          </label>
          <label>
            {t("Fonte")}
            <select aria-label={t("Tamanho da fonte")} value={fontScale} onChange={(event) => onFontScaleChange(Number(event.target.value))}>
              {[100, 115, 130].map((scale) => <option key={scale} value={scale}>{scale}%</option>)}
            </select>
          </label>
          <label>
            {t("Aparência")}
            <select className="studio-appearance-select" value={themePreference} onChange={(event) => onThemePreference?.(event.target.value as StudioThemePreference)}>
              <option value="light">{t("Claro")}</option>
              <option value="dark">{t("Escuro")}</option>
              <option value="auto">{t("Automático")}</option>
            </select>
          </label>
        </div>
        <button
          type="button"
          className={`studio-advanced-button ${settingsPages.includes(page) ? "active" : ""}`}
          aria-current={settingsPages.includes(page) ? "page" : undefined}
          onClick={() => onPage("settings")}
        >
          <Settings2 size={15} />
          <span>{t("Ajustes")}</span>
        </button>
        <span className="studio-local-note">{t("Seus arquivos ficam neste computador.")}</span>
      </div>
    </aside>
  );
}

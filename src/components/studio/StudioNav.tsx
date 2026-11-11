import { t, setStudioLanguage, useStudioLanguage, type StudioLanguage } from "./studioLanguage";
import {
  Clapperboard,
  CalendarDays,
  ChartNoAxesColumnIncreasing,
  Lightbulb,
  Film,
  FolderKanban,
  Home,
  Mic2,
  Palette,
  Plug,
  Library,
  Settings2,
  UserRound,
} from "lucide-react";
import { BrandMark } from "../BrandMark";
import { brandName, brandTagline } from "../../shared/branding";
import type { StudioTab } from "../../shared/types";
import type { StudioPage } from "../VideosellStudio";
import { ProfileSwitcher } from "./ProfileSwitcher";
import type { StudioProfile } from "../../shared/profile";

interface StudioNavProps {
  page: StudioPage;
  onPage: (page: StudioPage) => void;
  onOpenAdvanced: (tab?: StudioTab) => void;
  onProfileChange: (profile: StudioProfile | null, initializing: boolean) => void;
  onProfileCreated: (path: "brand" | "avatar") => void;
  avatarSetupRequest: number;
  fontScale: number;
  onFontScaleChange: (scale: number) => void;
}

const items = [
  { id: "home", label: "Início", icon: Home },
  { id: "create", label: "Criar Reel", icon: Clapperboard },
  { id: "analytics", label: "Instagram Analytics", icon: ChartNoAxesColumnIncreasing },
  { id: "radar", label: "Radar de pautas", icon: Lightbulb },
  { id: "proofs", label: "Provas da marca", icon: Library },
  { id: "videos", label: "Vídeos exportados", icon: Film },
  { id: "routine", label: "Rotina", icon: CalendarDays },
  { id: "avatars", label: "Meus avatares", icon: UserRound },
  { id: "projects", label: "Projetos", icon: FolderKanban },
] as const;

const advancedItems = [
  { id: "voices", label: "Vozes", icon: Mic2, tab: "voices" },
  { id: "brand", label: "Marca", icon: Palette, tab: "brand" },
  { id: "publish", label: "Conexões", icon: Plug, tab: "publish" },
] as const;

export function StudioNav({
  page,
  onPage,
  onOpenAdvanced,
  onProfileChange,
  onProfileCreated,
  avatarSetupRequest,
  fontScale,
  onFontScaleChange,
}: StudioNavProps) {
  const language = useStudioLanguage();
  return (
    <aside className="studio-sidebar">
      <div className="studio-brand" aria-label={`${brandName}. ${brandTagline}`}>
        <BrandMark size={34} />
        <div>
          <strong>{brandName}</strong>
          <span>{t("Seu palco de vendas")}</span>
        </div>
      </div>
        <label className="studio-language-select">
          {t("Idioma")}
          <select value={language} onChange={(event) => setStudioLanguage(event.target.value as StudioLanguage)}>
            <option value="pt-BR" lang="pt-BR">Português</option>
            <option value="en" lang="en">English</option>
            <option value="es" lang="es">Español</option>
          </select>
        </label>
      <nav className="studio-nav" aria-label={t("Navegação do estúdio")}>
        <span className="studio-nav-label">{t("CRIAR")}</span>
        {items.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            className={page === id ? "active" : ""}
            aria-current={page === id ? "page" : undefined}
            onClick={() => onPage(id)}
          >
            <Icon size={17} strokeWidth={1.7} />
            <span>{t(label)}</span>
          </button>
        ))}
        <span className="studio-nav-label studio-nav-label-secondary">{t("PRODUÇÃO")}</span>
        {advancedItems.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            className={page === id ? "active" : ""}
            aria-current={page === id ? "page" : undefined}
            onClick={() => onPage(id)}
          >
            <Icon size={17} strokeWidth={1.7} />
            <span>{t(label)}</span>
          </button>
        ))}
      </nav>
      <div className="studio-sidebar-bottom">
        <ProfileSwitcher onProfileChange={onProfileChange} onProfileCreated={onProfileCreated} avatarSetupRequest={avatarSetupRequest} />
        <div className="studio-font-scale" role="group" aria-label={t("Tamanho da fonte")}>
          <span>{t("Fonte")}</span>
          <div>
            {[100, 115, 130].map((scale) => (
              <button
                key={scale}
                type="button"
                aria-pressed={fontScale === scale}
                onClick={() => onFontScaleChange(scale)}
              >
                {scale}%
              </button>
            ))}
          </div>
        </div>
        <button
          type="button"
          className="studio-advanced-button"
          onClick={() => onOpenAdvanced()}
        >
          <Settings2 size={15} />
          <span>{t("Ajustes avançados")}</span>
          <Clapperboard size={14} />
        </button>
        <span className="studio-local-note">{t("Seus arquivos ficam neste computador.")}</span>
      </div>
    </aside>
  );
}

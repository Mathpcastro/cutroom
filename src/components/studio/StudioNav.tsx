import {
  Clapperboard,
  FolderKanban,
  Home,
  Mic2,
  Palette,
  Plug,
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
  fontScale: number;
  onFontScaleChange: (scale: number) => void;
}

const items = [
  { id: "home", label: "Início", icon: Home },
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
  fontScale,
  onFontScaleChange,
}: StudioNavProps) {
  return (
    <aside className="studio-sidebar">
      <div className="studio-brand" aria-label={`${brandName}. ${brandTagline}`}>
        <BrandMark size={34} />
        <div>
          <strong>{brandName}</strong>
          <span>Seu palco de vendas</span>
        </div>
      </div>
      <nav className="studio-nav" aria-label="Navegação do estúdio">
        <span className="studio-nav-label">CRIAR</span>
        {items.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            className={page === id ? "active" : ""}
            aria-current={page === id ? "page" : undefined}
            onClick={() => onPage(id)}
          >
            <Icon size={17} strokeWidth={1.7} />
            <span>{label}</span>
          </button>
        ))}
        <span className="studio-nav-label studio-nav-label-secondary">PRODUÇÃO</span>
        {advancedItems.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            className={page === id ? "active" : ""}
            aria-current={page === id ? "page" : undefined}
            onClick={() => onPage(id)}
          >
            <Icon size={17} strokeWidth={1.7} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      <div className="studio-sidebar-bottom">
        <ProfileSwitcher onProfileChange={onProfileChange} />
        <div className="studio-font-scale" role="group" aria-label="Tamanho da fonte">
          <span>Fonte</span>
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
          <span>Ajustes avançados</span>
          <Clapperboard size={14} />
        </button>
        <span className="studio-local-note">Seus arquivos ficam neste computador.</span>
      </div>
    </aside>
  );
}

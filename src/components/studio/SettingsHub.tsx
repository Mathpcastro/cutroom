import { Camera, Clapperboard, Library, Mic2, Palette, SunMoon, UserRound } from "lucide-react";
import { t } from "./studioLanguage";
import type { StudioPage } from "../VideosellStudio";
import type { StudioThemePreference } from "./studioTheme";

/** Spec 4 E: everything that is not "make a Reel" lives here, nothing removed. */
export function SettingsHub({ onPage, onAdvanced, theme, onTheme }: {
  onPage: (page: StudioPage) => void;
  onAdvanced: () => void;
  theme: StudioThemePreference;
  onTheme: (value: StudioThemePreference) => void;
}) {
  const cards: { page?: StudioPage; title: string; text: string; icon: typeof Palette; run?: () => void }[] = [
    { page: "brand", title: "Perfil e marca", text: "Nome, site, cores e o jeito de falar da marca.", icon: Palette },
    { page: "avatars", title: "Avatares", text: "Seu apresentador e as versões aprovadas.", icon: UserRound },
    { page: "voices", title: "Vozes", text: "Voz local, ElevenLabs ou OpenAI.", icon: Mic2 },
    { page: "proofs", title: "Provas da marca", text: "Prints e resultados que entram nos vídeos.", icon: Library },
    { page: "publish", title: "Instagram", text: "Conexão com o Composio e a conta que posta.", icon: Camera },
    { title: "Editor avançado", text: "Linha do tempo, mídia, transcrição e estilos.", icon: Clapperboard, run: onAdvanced },
  ];
  return (
    <div className="studio-workspace reel-workbench">
      <header><h1>{t("Ajustes")}</h1></header>
      <div className="settings-hub">
        {cards.map(({ page, title, text, icon: Icon, run }) => (
          <button key={title} type="button" className="settings-card" onClick={() => (run ? run() : page && onPage(page))}>
            <Icon size={20} strokeWidth={1.6} />
            <strong>{t(title)}</strong>
            <span>{t(text)}</span>
          </button>
        ))}
        <div className="settings-card static">
          <SunMoon size={20} strokeWidth={1.6} />
          <strong>{t("Aparência")}</strong>
          <span className="reel-toggle">
            {([["light", "Claro"], ["dark", "Escuro"], ["auto", "Automático"]] as const).map(([id, label]) => (
              <button key={id} type="button" aria-pressed={theme === id} onClick={() => onTheme(id)}>{t(label)}</button>
            ))}
          </span>
        </div>
      </div>
    </div>
  );
}

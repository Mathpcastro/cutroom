import { ArrowRight, Camera, Clapperboard, Library, Mic2, Palette, UserRound } from "lucide-react";
import { t, setStudioLanguage, useStudioLanguage, type StudioLanguage } from "./studioLanguage";
import type { StudioPage } from "../VideosellStudio";
import type { StudioThemePreference } from "./studioTheme";

/**
 * Spec 4 E: everything that is not "make a Reel" lives here, nothing removed.
 * Layout: two groups of equal cards (4 + 2 wide) and one full-width Preferências panel.
 */

type Card = { title: string; text: string; icon: typeof Palette; page?: StudioPage; run?: () => void };

function Segmented<T extends string | number>({ label, value, options, onChange }: {
  label: string;
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="settings-pref">
      <span>{t(label)}</span>
      <div className="segmented" role="radiogroup" aria-label={t(label)}>
        {options.map(([id, name]) => (
          <button key={String(id)} type="button" role="radio" aria-checked={value === id} onClick={() => onChange(id)}>{t(name)}</button>
        ))}
      </div>
    </div>
  );
}

export function SettingsHub({ onPage, onAdvanced, theme, onTheme, fontScale, onFontScale }: {
  onPage: (page: StudioPage) => void;
  onAdvanced: () => void;
  theme: StudioThemePreference;
  onTheme: (value: StudioThemePreference) => void;
  fontScale: number;
  onFontScale: (value: number) => void;
}) {
  const language = useStudioLanguage();
  const content: Card[] = [
    { page: "brand", title: "Perfil e marca", text: "Nome, site, cores e o jeito de falar da marca.", icon: Palette },
    { page: "avatars", title: "Avatares", text: "Seu apresentador e as versões aprovadas.", icon: UserRound },
    { page: "voices", title: "Vozes", text: "Voz local, ElevenLabs ou OpenAI.", icon: Mic2 },
    { page: "proofs", title: "Provas da marca", text: "Prints e resultados que entram nos vídeos.", icon: Library },
  ];
  const tools: Card[] = [
    { page: "publish", title: "Instagram", text: "Conexão com o Composio e a conta que posta os Reels.", icon: Camera },
    { title: "Editor avançado", text: "Linha do tempo, mídia, transcrição e estilos.", icon: Clapperboard, run: onAdvanced },
  ];
  const card = ({ page, title, text, icon: Icon, run }: Card) => (
    <button key={title} type="button" className="settings-card" onClick={() => (run ? run() : page && onPage(page))}>
      <span className="settings-card-icon"><Icon size={18} strokeWidth={1.7} /></span>
      <span className="settings-card-text"><strong>{t(title)}</strong><span>{t(text)}</span></span>
      <ArrowRight size={15} className="settings-card-arrow" />
    </button>
  );
  return (
    <div className="settings-v2">
      <header><h1>{t("Ajustes")}</h1></header>
      <section>
        <h2>{t("Sua marca nos vídeos")}</h2>
        <div className="settings-grid four">{content.map(card)}</div>
      </section>
      <section>
        <h2>{t("Publicação e ferramentas")}</h2>
        <div className="settings-grid two">{tools.map(card)}</div>
      </section>
      <section>
        <h2>{t("Preferências")}</h2>
        <div className="settings-prefs">
          <Segmented label="Aparência" value={theme} onChange={onTheme}
            options={[["light", "Claro"], ["dark", "Escuro"], ["auto", "Automático"]] as const} />
          <Segmented label="Tamanho do texto" value={fontScale} onChange={onFontScale}
            options={[[100, "100%"], [115, "115%"], [130, "130%"]] as const} />
          <Segmented<StudioLanguage> label="Idioma" value={language} onChange={setStudioLanguage}
            options={[["pt-BR", "Português"], ["en", "English"], ["es", "Español"]] as const} />
        </div>
        <p className="settings-note">{t("Seus arquivos ficam neste computador.")}</p>
      </section>
    </div>
  );
}

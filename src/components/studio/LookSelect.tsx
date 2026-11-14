import { LOOKS, LOOK_PRESETS } from "../../shared/shots";
import { t } from "./studioLanguage";

const previews = import.meta.glob("./previews/look-*.jpg", { eager: true, import: "default" }) as Record<string, string>;
/** Sample frames of a look (the same test film drawn in each look). */
export const lookPreview = (look?: string) => (look ? previews[`./previews/look-${look}.jpg`] : undefined);

/**
 * The drawn look of a film: "auto" (the AI chooses), a preset, or "classic" (the older template
 * engine), plus the look in the person's own words.
 */
export function LookSelect({ look, lookText, characters, classicLabel, disabled, onChange }: {
  look: string;
  lookText?: string;
  /** When given, also offers pixel avatars or stick figures. */
  characters?: string;
  classicLabel?: string;
  disabled?: boolean;
  onChange: (next: { look: string; lookText: string; characters?: string }) => void;
}) {
  const text = lookText ?? "";
  return (
    <>
      <label className="reel-field">{t("Estilo visual")}
        <select value={look} disabled={disabled} onChange={(event) => onChange({ look: event.target.value, lookText: text, characters })}>
          <option value="auto">{t("Automático (a IA escolhe)")}</option>
          <optgroup label={t("Desenhado pela IA")}>
            {LOOK_PRESETS.map((id) => <option key={id} value={id}>{t(LOOKS[id].label)}</option>)}
          </optgroup>
          {classicLabel && <option value="classic">{t(classicLabel)}</option>}
        </select>
      </label>
      {lookPreview(look) && <img className="look-preview" src={lookPreview(look)} alt={t(`Exemplo do estilo ${LOOKS[look as keyof typeof LOOKS]?.label ?? ""}`)} />}
      {look !== "classic" && (
        <label className="reel-field">{t("Descreva o visual (opcional)")}
          <input value={text} maxLength={240} disabled={disabled} placeholder={t("Ex.: aquarela sonhadora em tons pastel, ou HQ noir em preto e vermelho")}
            onChange={(event) => onChange({ look, lookText: event.target.value, characters })} />
        </label>
      )}
      {characters !== undefined && look !== "classic" && (
        <label className="reel-field">{t("Personagens")}
          <select value={characters} disabled={disabled} onChange={(event) => onChange({ look, lookText: text, characters: event.target.value })}>
            <option value="">{t("Automático")}</option><option value="pixel">{t("Pixel art (avatares)")}</option><option value="palito">{t("Palito desenhado")}</option>
          </select>
        </label>
      )}
    </>
  );
}

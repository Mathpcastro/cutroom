import { useEffect, useRef, useState } from "react";
import { ArrowRight, BookOpen, ChevronDown, Lightbulb, RefreshCcw, Tv, WandSparkles } from "lucide-react";
import type { StudioProfile } from "../../shared/profile";
import { FORMATS } from "../../../electron/core/formats";
import { ASPECT_LABEL, LOOKS, LOOK_PRESETS, type LookPreset } from "../../shared/shots";
import { t, getStudioLanguage, type StudioLanguage } from "./studioLanguage";

/** Spec 4 A: the home is one box. Every choice has a default; "Ajustar" holds the rest. */

export interface QuickChoices {
  avatar: boolean;
  story: boolean;
  /** "" = drawn by the AI, look chosen by it; "look:<preset>" = drawn in that look; "<format id>" = classic template. */
  style: string;
  /** The look in the person's own words (drawn Reels). */
  lookText?: string;
  /** Drawn Reels: character style and frame format. */
  characters?: "" | "pixel" | "palito" | "nenhum";
  aspect?: "9:16" | "1:1" | "16:9";
  language: StudioLanguage;
}

const validStyle = (style: unknown) =>
  typeof style === "string" && (!style || (style.startsWith("look:") && (LOOK_PRESETS as readonly string[]).includes(style.slice(5))) || FORMATS.some((f) => f.id === style && f.id !== "desenhado"));
export const styleLabel = (style: string) =>
  !style ? "estilo automático" : style.startsWith("look:") ? `estilo ${LOOKS[style.slice(5) as LookPreset]?.label ?? style.slice(5)}` : `modelo ${FORMATS.find((f) => f.id === style)?.name ?? style}`;

const choicesKey = (profileId: string) => `videosell.lastChoices.${profileId}`;

export function lastChoices(profile: StudioProfile): QuickChoices {
  const fallback: QuickChoices = { avatar: Boolean(profile.defaultAvatar), story: false, style: "", language: getStudioLanguage() };
  try {
    const saved = JSON.parse(localStorage.getItem(choicesKey(profile.id)) ?? "null") as Partial<QuickChoices> | null;
    if (!saved) return fallback;
    return {
      avatar: Boolean(saved.avatar && profile.defaultAvatar),
      story: Boolean(saved.story),
      style: validStyle(saved.style) ? (saved.style as string) : "",
      lookText: typeof saved.lookText === "string" ? saved.lookText.slice(0, 240) : "",
      characters: saved.characters === "pixel" || saved.characters === "palito" || saved.characters === "nenhum" ? saved.characters : "",
      aspect: saved.aspect === "1:1" || saved.aspect === "16:9" ? saved.aspect : "9:16",
      language: (["pt-BR", "en", "es"] as const).includes(saved.language as StudioLanguage) ? (saved.language as StudioLanguage) : fallback.language,
    };
  } catch {
    return fallback;
  }
}

export function rememberChoices(profileId: string, choices: QuickChoices) {
  try {
    localStorage.setItem(choicesKey(profileId), JSON.stringify(choices));
  } catch {
    /* Only a convenience. */
  }
}

const languageNames: Record<StudioLanguage, string> = { "pt-BR": "português", en: "inglês", es: "espanhol" };

/** "Com o avatar Léo · voz Matheus · estilo automático · português" */
export function choicesSummary(profile: StudioProfile, choices: QuickChoices) {
  const avatarName = (profile.preferences?.avatarStudio as { name?: string } | undefined)?.name;
  const avatar = choices.avatar ? (avatarName ? `Com o avatar ${avatarName}` : `Com o avatar de ${profile.name}`) : "Sem avatar";
  const voice = `voz ${profile.voice.voiceId === "local" || profile.voice.voiceId === "default" ? "local" : profile.voice.voiceId}`;
  const style = choices.lookText?.trim() && !FORMATS.some((f) => f.id === choices.style) ? `visual: ${choices.lookText.trim().slice(0, 40)}` : styleLabel(choices.style);
  return [avatar, voice, choices.story ? "história" : null, style, choices.characters === "palito" ? "personagens palito" : choices.characters === "nenhum" ? "sem personagens" : null, choices.aspect && choices.aspect !== "9:16" ? choices.aspect : null, languageNames[choices.language]].filter(Boolean).join(" · ");
}

export interface Pending { id: string; label: string; run: () => void; blocking?: boolean; text?: string }

export function QuickCreate({ profile, suggestion, ideas, pending, busyLabel, estimate, onCreate, onReference, onStory, onRadar, onChannel }: {
  profile: StudioProfile;
  suggestion?: string;
  ideas: { title: string; brief: string }[];
  pending: Pending[];
  busyLabel?: string;
  estimate?: string;
  onCreate: (brief: string, choices: QuickChoices) => void;
  onReference: () => void;
  onStory: () => void;
  onRadar: () => void;
  onChannel?: () => void;
}) {
  const [brief, setBrief] = useState(suggestion ?? "");
  const [choices, setChoices] = useState(() => lastChoices(profile));
  const [adjust, setAdjust] = useState(false);
  const [showIdeas, setShowIdeas] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (suggestion) setBrief(suggestion); }, [suggestion]);
  useEffect(() => {
    const focus = () => box.current?.focus();
    window.addEventListener("videosell:new-reel", focus);
    return () => window.removeEventListener("videosell:new-reel", focus);
  }, []);
  const blocking = pending.find((p) => p.blocking);
  const reason = blocking ? blocking.label : busyLabel ? "Um Reels já está sendo criado." : !brief.trim() ? "Escreva uma frase para começar." : "";
  const submit = () => {
    if (reason) return;
    rememberChoices(profile.id, choices);
    onCreate(brief.trim(), choices);
  };
  const set = (patch: Partial<QuickChoices>) => setChoices((current) => ({ ...current, ...patch }));

  return (
    <div className="quick-create">
      <h1>{t("O que você quer postar hoje?")}</h1>
      {blocking && (
        <div className="studio-connect-card" role="alert">
          <div><strong>{t(blocking.label)}</strong>{blocking.text && <p>{t(blocking.text)}</p>}</div>
          <button type="button" className="studio-primary-button" onClick={blocking.run}>{t(blocking.id === "ai" ? "Conectar a IA" : blocking.id === "mcp" ? "Ver como usar" : "Resolver")}</button>
        </div>
      )}
      <div className="quick-box">
        <textarea
          ref={box}
          rows={4}
          maxLength={3000}
          value={brief}
          aria-label={t("O que você quer postar hoje?")}
          placeholder={t("Ex.: mostre como o meu app tira 2 horas de trabalho por dia de quem vende pelo Instagram.")}
          onChange={(event) => setBrief(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); submit(); } }}
        />
        <div className="quick-box-footer">
          <button type="button" className="quick-summary" aria-expanded={adjust} onClick={() => setAdjust(!adjust)}>
            {t(choicesSummary(profile, choices))} <span className="quick-adjust">{t("Ajustar")} <ChevronDown size={13} /></span>
          </button>
          <button type="button" className="studio-primary-button quick-go" aria-disabled={!!reason} title={reason ? t(reason) : "Ctrl+Enter"} onClick={submit}>
            <WandSparkles size={16} /> {t("Criar Reels")} <ArrowRight size={15} />
          </button>
        </div>
        {reason && brief.trim() && <small className="quick-why">{t(reason)}</small>}
        {estimate && !reason && <small className="quick-why">{t(estimate)}</small>}
        {adjust && (
          <div className="quick-options">
            <fieldset className="reel-toggle"><legend>{t("Apresentação")}</legend>
              <button type="button" aria-pressed={!choices.avatar} onClick={() => set({ avatar: false })}>{t("Sem avatar")}</button>
              <button type="button" aria-pressed={choices.avatar} disabled={!profile.defaultAvatar} title={profile.defaultAvatar ? "" : t("Aprove um avatar para usar um apresentador.")} onClick={() => set({ avatar: true })}>{t("Com avatar")}</button>
            </fieldset>
            <fieldset className="reel-toggle"><legend>{t("Estrutura")}</legend>
              <button type="button" aria-pressed={!choices.story} onClick={() => set({ story: false })}>{t("Vídeo direto")}</button>
              <button type="button" aria-pressed={choices.story} onClick={() => set({ story: true })}>{t("História")}</button>
            </fieldset>
            <label className="reel-field">{t("Estilo visual")}
              <select value={choices.style} onChange={(event) => set({ style: event.target.value })}>
                <option value="">{t("Automático (a IA escolhe)")}</option>
                <optgroup label={t("Desenhado pela IA")}>
                  {LOOK_PRESETS.map((id) => <option key={id} value={"look:" + id}>{t(LOOKS[id].label)}</option>)}
                </optgroup>
                <optgroup label={t("Modelos clássicos")}>
                  {FORMATS.filter((format) => format.id !== "desenhado").map((format) => <option key={format.id} value={format.id}>{t(format.name)}</option>)}
                </optgroup>
              </select>
            </label>
            {!FORMATS.some((f) => f.id === choices.style) && <>
              <label className="reel-field">{t("Personagens")}
                <select value={choices.characters ?? ""} onChange={(event) => set({ characters: event.target.value as QuickChoices["characters"] })}>
                  <option value="">{t("Automático")}</option><option value="pixel">{t("Pixel art (avatares)")}</option><option value="palito">{t("Palito desenhado")}</option><option value="nenhum">{t("Sem personagens (só o produto)")}</option>
                </select>
              </label>
              <label className="reel-field">{t("Formato")}
                <select value={choices.aspect ?? "9:16"} onChange={(event) => set({ aspect: event.target.value as QuickChoices["aspect"] })}>
                  {(Object.keys(ASPECT_LABEL) as (keyof typeof ASPECT_LABEL)[]).map((id) => <option key={id} value={id}>{t(ASPECT_LABEL[id])}</option>)}
                </select>
              </label>
            </>}
            {!FORMATS.some((f) => f.id === choices.style) && <label className="reel-field quick-look-text">{t("Descreva o visual (opcional)")}
              <input value={choices.lookText ?? ""} maxLength={240} placeholder={t("Ex.: aquarela sonhadora em tons pastel")} onChange={(event) => set({ lookText: event.target.value })} />
            </label>}
            <label className="reel-field">{t("Idioma do Reel")}
              <select value={choices.language} onChange={(event) => set({ language: event.target.value as StudioLanguage })}>
                <option value="pt-BR">Português</option><option value="en">English</option><option value="es">Español</option>
              </select>
            </label>
          </div>
        )}
      </div>

      {onChannel && (
        <button type="button" className="quick-channel" onClick={onChannel}>
          <span className="quick-channel-icon"><Tv size={18} /></span>
          <span><strong>{t("Criar canal dark")}</strong><small>{t("Vídeos longos para o YouTube em qualquer nicho, feitos pelo seu agente de IA.")}</small></span>
          <ArrowRight size={16} />
        </button>
      )}

      <div className="quick-shortcuts">
        <button type="button" onClick={() => (ideas.length ? setShowIdeas(!showIdeas) : onRadar())}><Lightbulb size={15} /> {t("Usar uma pauta do Radar")}</button>
        <button type="button" onClick={onReference}><RefreshCcw size={15} /> {t("Recriar um vídeo de referência")}</button>
        <button type="button" onClick={onStory}><BookOpen size={15} /> {t("Continuar uma história")}</button>
      </div>
      {showIdeas && (
        <ul className="quick-ideas">
          {ideas.slice(0, 3).map((idea) => (
            <li key={idea.brief}><button type="button" onClick={() => { setBrief(idea.brief); setShowIdeas(false); box.current?.focus(); }}><strong>{idea.title}</strong><span>{idea.brief}</span></button></li>
          ))}
        </ul>
      )}

      {pending.filter((p) => !p.blocking).length > 0 && (
        <section className="quick-pending" aria-label={t("Pendências")}>
          <span>{t("Para aproveitar tudo:")}</span>
          {pending.filter((p) => !p.blocking).map((p) => <button key={p.id} type="button" className="ig-link" onClick={p.run}>{t(p.label)}</button>)}
        </section>
      )}
    </div>
  );
}

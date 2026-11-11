import { useState } from "react";
import { ArrowRight, Check } from "lucide-react";
import type { StudioProfile } from "../../shared/profile";
import { PROFILE_HANDLE_PATTERN } from "../../shared/profile";
import { t } from "./studioLanguage";
import { InstagramConnect } from "./InstagramConnect";
import { WhatYouSell, type BrandDraft } from "./WhatYouSell";

/** Spec 4 D: first use in up to 4 steps, each one skippable and resumable. */

const STEP_KEY = "videosell.firstRun.step";
const DONE_KEY = "videosell.firstRun.done";
export const FIRST_RUN_STEPS = ["O que você vende", "Seu apresentador", "Sua voz", "Onde postar"] as const;

export function firstRunDone() {
  try { return localStorage.getItem(DONE_KEY) === "1"; } catch { return true; }
}
function savedStep() {
  try { return Math.min(3, Math.max(0, Number(localStorage.getItem(STEP_KEY) ?? 0) || 0)); } catch { return 0; }
}

export function handleFrom(name: string) {
  const slug = name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32);
  return PROFILE_HANDLE_PATTERN.test(slug) ? slug : `marca-${Math.random().toString(36).slice(2, 8)}`;
}

/** The first idea, written from what the user sells. */
export function firstSuggestion(name: string, about: string) {
  const what = about.trim().split(/[.!?\n]/)[0].slice(0, 140);
  return what
    ? `Mostre em 30 segundos como ${name} ajuda: ${what}. Termine com um convite para testar.`
    : `Mostre em 30 segundos o problema que ${name} resolve e termine com um convite para testar.`;
}

export function FirstRun({ profile, aiConnected, onProfile, onAvatar, onDone }: {
  profile: StudioProfile | null;
  aiConnected: boolean;
  onProfile: (profile: StudioProfile) => void;
  onAvatar: () => void;
  onDone: (suggestion: string) => void;
}) {
  const [step, setStepState] = useState(savedStep);
  const [name, setName] = useState(profile?.brand.name ?? profile?.name ?? "");
  const [about, setAbout] = useState(profile?.personality.description ?? "");
  const setStep = (n: number) => {
    setStepState(n);
    try { localStorage.setItem(STEP_KEY, String(n)); } catch { /* ignore */ }
  };
  const finish = () => {
    try { localStorage.setItem(DONE_KEY, "1"); localStorage.removeItem(STEP_KEY); } catch { /* ignore */ }
    onDone(firstSuggestion(name || profile?.name || "o seu produto", about));
  };
  const next = () => (step >= 3 ? finish() : setStep(step + 1));

  /** Step 1 result (link + AI, prompt or interview), already reviewed by the user. */
  async function saveBrand(draft: BrandDraft) {
    const api = window.cutroom;
    if (!api) throw new Error("Abra o Videosell no aplicativo desktop.");
    const brandName = draft.name.trim().slice(0, 80) || "Minha marca";
    let current = profile;
    if (!current) {
      current = await api.studioProfiles.create({ name: brandName, handle: handleFrom(brandName) });
      await api.studioProfiles.select(current.id);
    }
    const updated = await api.studioProfiles.update(current.id, {
      brand: {
        ...current.brand, name: brandName,
        ...(draft.website ? { website: draft.website } : {}),
        ...(draft.accent ? { accent: draft.accent } : {}), ...(draft.ink ? { ink: draft.ink } : {}), ...(draft.paper ? { paper: draft.paper } : {}),
      },
      personality: { description: draft.context, presentation: draft.tone },
      commercialGoal: draft.goal,
    });
    setName(brandName);
    setAbout(draft.context.replace(/^Produto:\s*/, ""));
    onProfile(updated);
    next();
  }

  return (
    <div className="first-run">
      <div className="first-run-progress" role="progressbar" aria-valuemin={1} aria-valuemax={4} aria-valuenow={step + 1}>
        {FIRST_RUN_STEPS.map((label, i) => (
          <button key={label} type="button" className={i < step ? "done" : i === step ? "current" : ""} onClick={() => setStep(i)}>
            <span>{i < step ? <Check size={12} /> : i + 1}</span> {t(label)}
          </button>
        ))}
      </div>

      {step === 0 && (
        <section className="first-run-step">
          <h1>{t("O que você vende?")}</h1>
          <p>{t("Cole o link da página do produto ou descreva em uma frase. O Videosell monta a sua marca a partir disso.")}</p>
          <WhatYouSell aiConnected={aiConnected} initial={profile?.brand.website} onReady={saveBrand} onSkip={next} />
        </section>
      )}

      {step === 1 && (
        <section className="first-run-step">
          <h1>{t("Seu apresentador")}</h1>
          <p>{t("Um avatar em pixel art apresenta seus vídeos com a sua voz. Dá para criar agora ou depois; sem avatar, os vídeos saem só com animações.")}</p>
          <div className="reel-action-row">
            <button type="button" className="studio-primary-button" disabled={!profile} title={profile ? "" : t("Primeiro diga o que você vende.")} onClick={() => { setStep(2); onAvatar(); }}>{t("Criar meu avatar")}</button>
            <button type="button" className="studio-secondary-button" onClick={next}>{t("Decidir depois")}</button>
          </div>
        </section>
      )}

      {step === 2 && (
        <section className="first-run-step">
          <h1>{t("Sua voz")}</h1>
          <p>{t("A voz local já vem pronta e funciona sem internet. Dá para trocar por ElevenLabs ou pela sua própria voz em Ajustes › Vozes.")}</p>
          <p className="pilot-notice"><Check size={14} /> {t("Voz local pronta")}</p>
          <div className="reel-action-row">
            <button type="button" className="studio-primary-button" onClick={next}>{t("Usar a voz local")} <ArrowRight size={14} /></button>
          </div>
        </section>
      )}

      {step === 3 && (
        <section className="first-run-step">
          <h1>{t("Onde postar")}</h1>
          <InstagramConnect />
          <div className="reel-action-row">
            <button type="button" className="studio-primary-button" onClick={finish}>{t("Terminar")} <ArrowRight size={14} /></button>
            <button type="button" className="ig-link" onClick={finish}>{t("Conectar depois")}</button>
          </div>
        </section>
      )}
    </div>
  );
}

import type { BrandProof } from "../../../electron/core/brand-proofs";
import { t, getStudioLanguage, type StudioLanguage } from "./studioLanguage";
import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, LoaderCircle, WandSparkles } from "lucide-react";
import { FORMATS } from "../../../electron/core/formats";
import type { FilmAvatarRef } from "../../../electron/core/film";
import type { StudioProfile } from "../../shared/profile";
import { planSalesReel, reviseSalesScene, type ReferenceSummary, type SalesPlan, type SalesScene } from "./salesReels";
import directPoster from "./previews/ui-motion.jpg";
import avatarPoster from "../../../site/upsell/videos/avatar.jpg";
import storyPoster from "../../../site/upsell/videos/historia.jpg";
import illustratedPoster from "./previews/kurzgesagt.jpg";
import directClip from "./previews/ui-motion.mp4";
import avatarClip from "./previews/avatar.mp4";
import storyClip from "./previews/historia.mp4";
import illustratedClip from "./previews/kurzgesagt.mp4";

export type ReelEffect = "none" | "pulse" | "rise" | "wipe";
export interface ReelOrigin {
  ideaId?: string;
  ideaTitle?: string;
  parentFilmId?: string;
  instagramMediaId?: string;
  instagramAccountId?: string;
}

export interface ReelDraft {
  origin?: ReelOrigin;
  profileId: string;
  brief?: string;
  language?: StudioLanguage;
  narrative?: boolean;
  objective: string;
  offer: string;
  script: string;
  voice: { provider: StudioProfile["voice"]["provider"]; voiceId: string };
  formatId: string;
  motionStyle?: string;
  effect: ReelEffect;
  avatar?: FilmAvatarRef;
  /** A reference video to recreate (its mold: rhythm, beats, colours, hook). */
  reference?: ReelReference;
}
export interface ReferenceStyle {
  palette: string[];
  secondsPerShot: number;
  energy: number;
  shots: { start: number; motion: number; palette: string[] }[];
}
export interface ReelReference {
  name: string;
  summary: ReferenceSummary;
  style: ReferenceStyle;
  images: string[];
}
export interface ReelReviewData {
  images: string[];
  frameTimes: number[];
  errors: string[];
  flags: string[];
  checklist: string[];
  duration: number;
}
export interface ReelSession {
  step: "brief" | "generating" | "review" | "exporting";
  draft: ReelDraft;
  filmId?: string;
  review?: ReelReviewData;
  output?: string;
  caption?: string;
  plan?: SalesPlan;
  variationBase?: SalesPlan;
  error?: string;
}

interface CreatedFilm { film: string; size: string; avatar?: FilmAvatarRef }
interface VoiceResult { status?: string; duration: number; voiceEnd: number }

export function initialReelDraft(profile: StudioProfile, withAvatar: boolean): ReelDraft {
  const objective = profile.commercialGoal || "Apresentar seu produto com clareza";
  const offer = "Conheça a oferta pelo link do perfil";
  return {
    profileId: profile.id,
    brief: "",
    narrative: false,
    objective,
    offer,
    script: deterministicScript(objective, offer),
    voice: { provider: profile.voice.provider, voiceId: profile.voice.voiceId },
    formatId: withAvatar ? "avatar" : "ui-motion",
    effect: "pulse",
    ...(withAvatar && profile.defaultAvatar ? { avatar: profile.defaultAvatar } : {}),
  };
}

export const STORY_SAMPLE = `# Episódio 1: O primeiro cliente
[cena: quarto, noite]
Narrador: Episódio um. O primeiro cliente.
Léo (animado): Bia, acorda! Alguém pagou!
Bia (sonolenta): Pagou o quê? A gente nem tem botão de pagar.
Léo: Pois é. Ele mandou um Pix e escreveu: me ensina a usar.
[cena: escritorio, dia]
Narrador: E foi aí que o cliente respondeu.
Léo (nervoso): Ele quer cancelar?
Bia (surpresa): Não. Ele quer indicar dez amigos.
Narrador: Continua no próximo episódio.`;

/** Only the spoken lines of a story script, in order (what the narration says). */
export function storySpoken(script: string) {
  return script
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && !/^\[.*\]$/.test(line))
    .map((line) => line.replace(/^[^:()[\]]{1,24}?\s*(?:\([^)]*\))?\s*:\s*/, ""))
    .join(" ");
}

/** A story episode: CRM.autoStory directs it from the dialogue script (the profile avatar plays the lead). */
export function storyHtml(draft: ReelDraft, voice: VoiceResult) {
  const duration = Math.max(6, +(voice.voiceEnd + 2.4).toFixed(2));
  const hasAvatar = Boolean(draft.avatar);
  const script = htmlText(draft.script);
  const title = /^#\s*(.+)$/m.exec(draft.script)?.[1] ?? "Episódio";
  return `<!doctype html>
<html lang="${draft.language ?? "pt-BR"}">
<head>
<meta charset="utf-8">
<link rel="icon" href="data:,">
<title>${htmlText(title)}</title>
<style>
  @font-face { font-family: Anton; src: url(fonts/Anton-Regular.ttf); }
  @font-face { font-family: "Instrument Sans"; src: url(fonts/InstrumentSans.ttf); font-weight: 100 900; }
  * { box-sizing: border-box; margin: 0; }
  html, body { width: 1080px; height: 1920px; overflow: hidden; background: #141318; }
  #film { position: relative; width: 1080px; height: 1920px; overflow: hidden; background: #141318; font-family: "Instrument Sans", sans-serif; }
</style>
</head>
<body>
<div id="film" data-composition-id="film" data-start="0" data-duration="${duration}" data-width="1080" data-height="1920">
  <audio id="voz" data-start="0" data-duration="${voice.duration}" data-track-index="20" data-volume="1" src="assets/voice.wav"></audio>
  <template id="roteiro">${script}</template>
  <script src="kit/gsap.min.js"></script>
  <script src="brand.js"></script>
  <script src="timing.js"></script>
  ${hasAvatar ? '<script src="avatar/runtime.js"></script>\n  <script src="avatar/voice.js"></script>' : ""}
  <script src="kit/cutroom-kit.js"></script>
  <script src="kit/cutroom-motion.js"></script>
  <script src="kit/avatar/engine.js"></script>
  <script src="kit/avatar/sample.js"></script>
  <script>
    window.__timelines = window.__timelines || {};
    var D = ${duration};
    var tl = gsap.timeline({ paused: true });
    var S = window.CRM_SAMPLE_AVATARS || {}, palette = (window.BRAND && window.BRAND.palette) || {};
    CRM.autoStory({
      tl: tl, film: "#film", duration: D, engine: window.AvatarEngine,
      script: document.getElementById("roteiro").content.textContent,
      fallback: [window.FILM_AVATAR || S.strategist, S.companion, S.expert].filter(Boolean),
      accent: palette.accent || "#7C5CFF",
    });
    tl.set({}, {}, D);
    window.__timelines["film"] = tl;
  </script>
</div>
</body>
</html>`;
}

function deterministicScript(objective: string, offer: string) {
  return `${objective.trim() || "Apresente seu produto com clareza"}. ${offer.trim() || "Conheça a oferta"}. Veja cada detalhe e comece agora pelo link do perfil.`;
}

function htmlText(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

/**
 * A local, deterministic HyperFrames composition directed by CRM.autoReel (kit/cutroom-motion.js):
 * one scene per spoken sentence, kinetic words, camera moves, transitions and particles, with the
 * profile's avatar acting on stage when the Reel has one. No remote dependency.
 */
export function reelHtml(draft: ReelDraft, voice: VoiceResult, plan?: SalesPlan, assets: Record<string, string[]> = {}) {
  const referenceJson = draft.reference ? htmlText(JSON.stringify(draft.reference.style)) : "";
  const duration = Math.max(4, +(voice.voiceEnd + 1.8).toFixed(2));
  const hasAvatar = Boolean(draft.avatar);
  const avatarScripts = hasAvatar
    ? '<script src="avatar/runtime.js"></script>\n  <script src="avatar/voice.js"></script>'
    : "";
  return `<!doctype html>
<html lang="${draft.language ?? "pt-BR"}">
<head>
<meta charset="utf-8">
<link rel="icon" href="data:,">
<title>${htmlText(draft.objective)}</title>
<style>
  @font-face { font-family: Anton; src: url(fonts/Anton-Regular.ttf); }
  @font-face { font-family: Fredoka; src: url(fonts/Fredoka.ttf); font-weight: 300 700; }
  @font-face { font-family: "Instrument Sans"; src: url(fonts/InstrumentSans.ttf); font-weight: 100 900; }
  * { box-sizing: border-box; margin: 0; }
  html, body { width: 1080px; height: 1920px; overflow: hidden; background: #141318; }
  #film { position: relative; width: 1080px; height: 1920px; overflow: hidden; color: #fff; background: #141318; font-family: "Instrument Sans", sans-serif; }
</style>
</head>
<body>
<div id="film" data-composition-id="film" data-start="0" data-duration="${duration}" data-width="1080" data-height="1920">
  <audio id="voz" data-start="0" data-duration="${voice.duration}" data-track-index="20" data-volume="1" src="assets/voice.wav"></audio>
  ${plan ? '<template id="sales-plan">' + htmlText(JSON.stringify(plan.scenes.map((scene) => ({ ...scene, proofFrames: scene.proofId ? assets[scene.proofId] : undefined })))) + "</template>" : ""}
  ${referenceJson ? '<template id="reference-style">' + referenceJson + "</template>" : ""}
  <script src="kit/gsap.min.js"></script>
  <script src="brand.js"></script>
  <script src="timing.js"></script>
  ${avatarScripts}
  <script src="kit/cutroom-kit.js"></script>
  <script src="kit/cutroom-motion.js"></script>
  ${hasAvatar ? '<script src="kit/avatar/engine.js"></script>' : ""}
  <script>
    window.__timelines = window.__timelines || {};
    var D = ${duration};
    var tl = gsap.timeline({ paused: true });
    var palette = (window.BRAND && window.BRAND.palette) || {};
    CRM.autoReel({
      tl: tl, film: "#film", duration: D,
      engine: ${hasAvatar ? "window.AvatarEngine" : "null"},
      avatar: ${hasAvatar ? "window.FILM_AVATAR" : "null"},
      brand: { accent: palette.accent || "#7C5CFF" },
      scenes: document.getElementById("sales-plan")
        ? JSON.parse(document.getElementById("sales-plan").content.textContent)
        : undefined,
      reference: document.getElementById("reference-style")
        ? JSON.parse(document.getElementById("reference-style").content.textContent)
        : undefined
    });
    tl.set({}, {}, D);
    window.__timelines["film"] = tl;
  </script>
</div>
</body>
</html>`;
}

async function api<T>(method: string, params?: unknown): Promise<T> {
  if (!window.cutroom) throw new Error("A criação de filmes está disponível no aplicativo desktop.");
  return window.cutroom.request<T>(method, params);
}

let generating = false;

export async function generateSalesReel(
  profile: StudioProfile,
  draft: ReelDraft,
  setProgress: (value: string) => void,
  revised?: SalesPlan,
): Promise<ReelSession> {
  if (generating) throw new Error("O Videosell já está gerando um Reel. Aguarde para iniciar outro.");
  const brief = draft.brief?.trim();
  if (!brief && !revised && !draft.reference) throw new Error("Descreva a ideia do Reel.");
  const withAvatar = Boolean(draft.avatar);
  const story = Boolean(draft.narrative);
  generating = true;
  try {
    setProgress(t("Planejando o roteiro e as cenas…"));
    const language = draft.language ?? getStudioLanguage();
    let profileVoice = draft.voice.provider === "local" && draft.voice.voiceId === "default"
      ? undefined
      : draft.voice.voiceId;
    if (language !== "pt-BR" && (draft.voice.provider === "local" || draft.voice.provider === "kokoro")) {
      const { voices } = await api<{ voices: { id: string; language?: string }[] }>("listVoices", { provider: draft.voice.provider });
      const candidates = voices.filter((item) => item.language?.split(/[-_]/)[0].toLowerCase() === language);
      profileVoice = candidates.find((item) => item.id === profileVoice)?.id ?? candidates[0]?.id;
      if (!profileVoice) throw new Error(t("Escolha uma voz instalada para este idioma ou use ElevenLabs ou OpenAI."));
    }
    if (draft.reference) setProgress(t("Recriando a estrutura da referência…"));
    const plan = revised ?? await planSalesReel(profile, brief ?? "", withAvatar, story, language, draft.motionStyle, draft.reference?.summary);
    const formatId = draft.motionStyle ?? (withAvatar ? "avatar" : "ui-motion");
    if (draft.motionStyle && plan.scenes.some((scene) => !scene.motion && !scene.proofId))
      throw new Error(t("A IA não gerou os elementos visuais de todas as cenas. Tente gerar novamente."));
    const spoken = plan.scenes.map(({ narration }) => /[.!?]$/.test(narration) ? narration : narration + ".").join(" ");
    setProgress(t("Gerando a narração…"));
    const created = await api<CreatedFilm>("create_film", {
      name: plan.title,
      format: formatId,
      aspect: "9:16",
      ...(draft.avatar ? { avatar: draft.avatar } : {}),
    });
    await api("write_film_file", {
      film: created.film, path: "brand.js",
      content: "window.BRAND = " + JSON.stringify({
        name: profile.brand.name || profile.name,
        handle: profile.handle,
        palette: { accent: profile.brand.accent, ink: profile.brand.ink, paper: profile.brand.paper },
      }) + ";",
    });
    let voice = await api<VoiceResult>("film_voiceover", {
      film: created.film,
      text: spoken,
      provider: draft.voice.provider,
      voice: profileVoice,
    });
    const started = Date.now();
    while (voice.status === "generating") {
      if (Date.now() - started > 180_000) throw new Error("A narração continua em geração. Abra Pacotes/Vozes para verificar o provedor.");
      await new Promise((resolve) => setTimeout(resolve, 1500));
      voice = await api<VoiceResult>("film_voiceover", {
        film: created.film,
        text: spoken,
        provider: draft.voice.provider,
        voice: profileVoice,
      });
    }
    const duration = Math.max(4, +(voice.voiceEnd + 1.8).toFixed(2));
    setProgress(t("Animando e conferindo as cenas…"));
    const assets: Record<string, string[]> = {};
    for (const proofId of new Set(plan.scenes.flatMap((scene) => scene.proofId ? [scene.proofId] : []))) {
      const { frames } = await api<{ frames: string[] }>("attachBrandProof", { profileId: profile.id, film: created.film, proofId });
      assets[proofId] = frames;
    }
    await api("write_film_file", {
      film: created.film,
      path: "index.html",
      content: reelHtml({ ...draft, language, objective: plan.title }, voice, plan, assets),
    });
    const check = await api<{ errors: string[]; warnings: string[] }>("film_check", { film: created.film });
    const [frames, format] = await Promise.all([
      check.errors.length ? { images: [], frameTimes: [], errors: [] } : api<{ images: string[]; frameTimes: number[]; errors: string[] }>("film_stills", {
        film: created.film,
        times: [0.5, duration * 0.35, duration * 0.7, Math.max(0.6, duration - 0.5)],
      }),
      api<{ checklist: string[] }>("get_format_guide", { id: formatId }),
    ]);
    const review: ReelReviewData = {
      images: frames.images,
      frameTimes: frames.frameTimes,
      errors: [...check.errors, ...frames.errors],
      flags: check.warnings,
      checklist: format.checklist,
      duration,
    };
    await api("profileLinkProject", { profileId: profile.id, projectId: created.film });
    return { step: "review", draft: { ...draft, language, script: spoken, formatId }, filmId: created.film, review, caption: plan.caption, plan };
  } finally {
    generating = false;
  }
}

export function ReelCreator({
  profile,
  session,
  onSession,
  onReview,
  onBack,
  onRestore,
}: {
  profile: StudioProfile;
  session: ReelSession;
  onSession: (session: ReelSession) => void;
  onReview: (session: ReelSession) => void;
  onBack: () => void;
  onRestore: (id: string) => void;
}) {
  const draft = session.draft;
  const withAvatar = Boolean(draft.avatar);
  const busy = session.step === "generating" || session.step === "exporting";
  const story = Boolean(draft.narrative);
  const brief = draft.brief ?? "";
  const selectedStyle = FORMATS.find(({ id }) => id === draft.motionStyle);
  const illustrated = selectedStyle?.id === "kurzgesagt";
  const stylePreview = selectedStyle?.id === "ui-motion" ? [directPoster, directClip] :
    selectedStyle?.id === "avatar" ? [avatarPoster, avatarClip] :
    selectedStyle?.id === "historia" ? [storyPoster, storyClip] : undefined;
  const poster = illustrated ? illustratedPoster : story ? (withAvatar ? storyPoster : illustratedPoster) : (withAvatar ? avatarPoster : directPoster);
  const clip = illustrated ? illustratedClip : story ? (withAvatar ? storyClip : illustratedClip) : (withAvatar ? avatarClip : directClip);
  const [progress, setProgress] = useState("");
  const [sceneEdit, setSceneEdit] = useState<SalesPlan>();
  const editablePlan = sceneEdit ?? session.plan;
  const [proofs, setProofs] = useState<BrandProof[]>([]);
  const [adjustments, setAdjustments] = useState<Record<number, string>>({});
  const [adjusting, setAdjusting] = useState(false);
  const [referenceLink, setReferenceLink] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  async function addReference(source: { path?: string; url?: string }) {
    setAnalyzing(true);
    onSession({ ...session, error: undefined });
    try {
      const result = await api<{ summary: ReferenceSummary; style: ReferenceStyle; images: string[] }>("analyzeReference", source);
      const name = source.url ? source.url.replace(/^https?:\/\//, "").slice(0, 60) : (source.path ?? "").split(/[\\/]/).pop() ?? "vídeo";
      // Start from the visual format closest to the reference; the person can still change it.
      const suggested = result.summary.formatoSugerido?.id;
      onSession({ ...session, draft: { ...draft, reference: { name, ...result }, ...(suggested && !draft.motionStyle ? { motionStyle: suggested } : {}) }, error: undefined });
      setReferenceLink("");
    } catch (reason) {
      onSession({ ...session, error: reason instanceof Error ? reason.message : String(reason) });
    } finally { setAnalyzing(false); }
  }
  async function pickReference() {
    const picked = await api<{ path: string } | null>("pickReference");
    if (picked) await addReference({ path: picked.path });
  }
  useEffect(() => {
    let active = true;
    api<BrandProof[]>("listBrandProofs", { profileId: profile.id }).then(
      (entries) => { if (active) setProofs(entries.filter((proof) => proof.extension)); },
      () => undefined,
    );
    return () => { active = false; };
  }, [profile.id]);

  function updateScene(index: number, patch: Partial<SalesScene>) {
    if (!editablePlan) return;
    setSceneEdit({ ...editablePlan, scenes: editablePlan.scenes.map((scene, i) => i === index ? { ...scene, ...patch } : scene) });
  }
  async function adjustScene(index: number) {
    if (!editablePlan || !adjustments[index]?.trim() || adjusting) return;
    setAdjusting(true);
    try {
      const next = await reviseSalesScene(editablePlan.scenes[index], adjustments[index], draft.language ?? getStudioLanguage(), draft.motionStyle);
      updateScene(index, next);
    } catch (reason) {
      onSession({ ...session, error: reason instanceof Error ? reason.message : String(reason) });
    } finally { setAdjusting(false); }
  }

  function update(patch: Partial<ReelDraft>) {
    onSession({ ...session, draft: { ...draft, ...patch }, error: undefined });
  }

  async function generate(revised?: SalesPlan) {
    onSession({ ...session, step: "generating", error: undefined });
    try {
      let plan = revised;
      if (!plan && session.variationBase) {
        setProgress("Testando outro gancho…");
        const [first, ...rest] = session.variationBase.scenes;
        const adjusted = await reviseSalesScene(first, brief, draft.language ?? getStudioLanguage(), draft.motionStyle);
        plan = { ...session.variationBase, scenes: [{ ...adjusted, proofId: first.proofId }, ...rest] };
      }
      const next = await generateSalesReel(profile, {
        ...draft,
        origin: session.filmId ? { ...draft.origin, parentFilmId: session.filmId } : draft.origin,
      }, setProgress, plan);
      setSceneEdit(undefined);
      onReview(next);
    } catch (reason) {
      onSession({ ...session, step: "brief", error: reason instanceof Error ? reason.message : String(reason) });
    }
  }

  return (
    <div className="reel-creator reel-workbench">
      <button type="button" className="studio-back-button" onClick={onBack} disabled={busy}><ArrowLeft size={16} /> {t("Voltar ao início")}</button>
      <header className="reel-creator-header">
        <div><h1>{t("Criar Reel")}</h1><p>{t("Comece com uma dor, uma objeção ou uma prova que ajude a vender seu SaaS.")}</p></div>
      </header>
      <div className="reel-creator-grid">
        <section className="reel-form-card">
          <label className="reel-field">{t("O que você quer criar?")}
            <textarea rows={4} value={brief} maxLength={3000} disabled={busy} onChange={(event) => update({ brief: event.target.value })}
              placeholder={t("Ex.: Mostre como uma loja perde pedidos no WhatsApp e use meu SaaS para demonstrar a mudança. Termine com um convite para testar.")} />
          </label>
          <section className="reel-reference" aria-label={t("Vídeo de referência")}>
            <strong>{t("Vídeo de referência (opcional)")}</strong>
            <p className="reel-hint">{t("Envie um Reels que deu certo. O Videosell copia a estrutura (gancho, cenas, ritmo e cores) e recria com o seu avatar, a sua voz e o seu produto. As imagens da referência não entram no seu vídeo.")}</p>
            {!draft.reference && <div className="reel-reference-pick">
              <button type="button" className="studio-secondary-button" disabled={busy || analyzing} onClick={() => void pickReference()}>{t("Escolher vídeo…")}</button>
              <input value={referenceLink} disabled={busy || analyzing} placeholder={t("ou cole um link do X ou de um .mp4")} onChange={(event) => setReferenceLink(event.target.value)} />
              <button type="button" className="studio-secondary-button" disabled={busy || analyzing || !/^https?:\/\//.test(referenceLink.trim())} onClick={() => void addReference({ url: referenceLink.trim() })}>{t("Analisar")}</button>
            </div>}
            {analyzing && <p className="reel-busy" role="status"><LoaderCircle size={17} className="spin" /> {t("Analisando cortes, ritmo, cores e fala…")}</p>}
            {draft.reference && <div className="reel-reference-card">
              <div className="reel-reference-frames">{draft.reference.images.map((src, i) => <img key={i} src={src} alt="" />)}</div>
              <p><b>{draft.reference.name}</b> · {draft.reference.summary.duracao} s · {draft.reference.summary.cenas.length} {t("cenas")} · {t("1 corte a cada")} {draft.reference.summary.segundosPorCena} s · {draft.reference.summary.palavrasPorSegundo} {t("palavras/s")}</p>
              <p className="reel-reference-palette">{draft.reference.summary.paleta.map((c) => <i key={c} style={{ background: c }} title={c} />)}{draft.reference.summary.gancho && <span>{t("Gancho:")} “{draft.reference.summary.gancho}”</span>}</p>
              {draft.reference.summary.formatoSugerido && <p className="reel-hint">{t("Estilo sugerido:")} {t(FORMATS.find((f) => f.id === draft.reference!.summary.formatoSugerido!.id)?.name ?? "")} ({draft.reference.summary.formatoSugerido.reason}). {t("Você pode trocar em Estilo visual.")}</p>}
              {draft.reference.summary.avisos?.map((note) => <p key={note} className="reel-hint">{note}</p>)}
              <button type="button" className="studio-secondary-button" disabled={busy} onClick={() => update({ reference: undefined })}>{t("Remover referência")}</button>
            </div>}
          </section>
          <fieldset className="reel-toggle"><legend>{t("Apresentação")}</legend>
            <button type="button" aria-pressed={!withAvatar} disabled={busy} onClick={() => update({ avatar: undefined })}>{t("Sem avatar")}</button>
            <button type="button" aria-pressed={withAvatar} disabled={busy || !profile.defaultAvatar} onClick={() => update({ avatar: profile.defaultAvatar })}>{t("Com avatar")}</button>
          </fieldset>
          {!profile.defaultAvatar && <p className="reel-hint">{t("Crie e aprove um avatar no perfil para usar um apresentador.")}</p>}
          <fieldset className="reel-toggle"><legend>{t("Estrutura")}</legend>
            <button type="button" aria-pressed={!story} disabled={busy} onClick={() => update({ narrative: false })}>{t("Vídeo direto")}</button>
            <button type="button" aria-pressed={story} disabled={busy} onClick={() => update({ narrative: true })}>{t("História")}</button>
          </fieldset>
          <label className="reel-field">{t("Estilo visual")}
            <select value={draft.motionStyle ?? ""} disabled={busy || Boolean(session.variationBase)}
              onChange={(event) => { setSceneEdit(undefined); update({ motionStyle: event.target.value || undefined }); }}>
              <option value="">{t("Automático")}</option>
              {FORMATS.map((format) => <option key={format.id} value={format.id}>{t(format.name)}</option>)}
            </select>
          </label>
          <label className="reel-field reel-language-field">{t("Idioma do Reel")}
            <select value={draft.language ?? getStudioLanguage()} disabled={busy} onChange={(event) => update({ language: event.target.value as StudioLanguage })}>
              <option value="pt-BR" lang="pt-BR">Português</option>
              <option value="en" lang="en">English</option>
              <option value="es" lang="es">Español</option>
            </select>
          </label>
          {session.variationBase && <p className="reel-hint">O teste altera só a abertura. A demonstração e as outras cenas permanecem.</p>}
          <details className="reel-options"><summary>{t("Perfil e voz")}</summary><p>{profile.name} · {draft.voice.provider} · {draft.voice.voiceId}</p></details>
          {editablePlan && <details className="reel-options">
            <summary>{t("Roteiro e cenas da última versão")}</summary>
            {editablePlan.scenes.map((scene, index) => <fieldset className="reel-form-card" key={index} disabled={busy || adjusting}>
              <legend>{t("Cena")} {index + 1} · {scene.headline}</legend>
              <label className="reel-field">Narração<textarea rows={2} maxLength={350} value={scene.narration} onChange={(event) => updateScene(index, { narration: event.target.value })} /></label>
              <label className="reel-field">Prova visual da biblioteca<select value={scene.proofId ?? ""} onChange={(event) => updateScene(index, { proofId: event.target.value || undefined })}>
                <option value="">Usar composição original</option>
                {proofs.map((proof) => <option key={proof.id} value={proof.id}>{proof.title}</option>)}
              </select></label>
              {withAvatar && <label className="reel-field">Tamanho do avatar<select value={scene.avatarSize ?? "normal"} onChange={(event) => updateScene(index, { avatarSize: event.target.value === "small" ? "small" : "normal" })}>
                <option value="normal">Normal</option><option value="small">Menor</option>
              </select></label>}
              <label className="reel-field">Pedido de ajuste<input value={adjustments[index] ?? ""} maxLength={750} onChange={(event) => setAdjustments({ ...adjustments, [index]: event.target.value })} /></label>
              <button className="studio-secondary-button" type="button" disabled={!adjustments[index]?.trim()} onClick={() => void adjustScene(index)}>Ajustar esta cena</button>
            </fieldset>)}
            <button type="button" className="studio-secondary-button" disabled={busy || adjusting || !sceneEdit || editablePlan.scenes.some((scene) => !scene.narration.trim())}
              onClick={() => void generate(editablePlan)}>{t("Gerar com roteiro ajustado")}</button>
          </details>}
          {session.draft.origin?.parentFilmId && <button className="studio-secondary-button" type="button" disabled={busy || adjusting}
            onClick={() => onRestore(session.draft.origin!.parentFilmId!)}>Voltar à versão anterior</button>}
          {session.error && <p className="reel-error" role="alert">{session.error}</p>}
          {session.step === "generating" && <p className="reel-busy" role="status"><LoaderCircle size={17} className="spin" /> {progress}</p>}
          <button type="button" className="studio-primary-button" disabled={busy || analyzing || (!brief.trim() && !draft.reference)} onClick={() => void generate()}>
            <WandSparkles size={17} /> {session.review ? t("Gerar nova versão") : t("Gerar vídeo")} <ArrowRight size={16} />
          </button>
        </section>
        <figure className="reel-style-preview">
          {(!selectedStyle || illustrated || stylePreview) && <video key={stylePreview?.[1] ?? clip}
            src={stylePreview?.[1] ?? clip} poster={stylePreview?.[0] ?? poster} controls muted loop playsInline preload="metadata"
            aria-label={t("Prévia do estilo selecionado")} />}
          <figcaption><strong>{selectedStyle ? t(selectedStyle.name) : story ? t("História") : t("Vídeo direto")} · {withAvatar ? t("Com avatar") : t("Sem avatar")}</strong>
            <span>{selectedStyle ? t(selectedStyle.goodFor) : t("Exemplo de linguagem visual. As cenas são compostas a partir do seu pedido.")}</span>
          </figcaption>
        </figure>
      </div>
    </div>
  );
}

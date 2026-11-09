import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, LoaderCircle, UserRound, WandSparkles } from "lucide-react";
import type { FilmAvatarRef } from "../../../electron/core/film";
import type { StudioProfile } from "../../shared/profile";

export type ReelEffect = "none" | "pulse" | "rise" | "wipe";
export interface ReelDraft {
  profileId: string;
  objective: string;
  offer: string;
  script: string;
  voice: { provider: StudioProfile["voice"]["provider"]; voiceId: string };
  formatId: string;
  effect: ReelEffect;
  avatar?: FilmAvatarRef;
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
  error?: string;
}

interface VideoFormat {
  id: string;
  name: string;
  aspect: string;
  length: string;
  goodFor: string;
}
interface CreatedFilm { film: string; size: string; avatar?: FilmAvatarRef }
interface VoiceResult { status?: string; duration: number; voiceEnd: number }

export function initialReelDraft(profile: StudioProfile, withAvatar: boolean): ReelDraft {
  const objective = profile.commercialGoal || "Apresentar seu produto com clareza";
  const offer = "Conheça a oferta pelo link do perfil";
  return {
    profileId: profile.id,
    objective,
    offer,
    script: deterministicScript(objective, offer),
    voice: { provider: profile.voice.provider, voiceId: profile.voice.voiceId },
    formatId: withAvatar ? "avatar" : "ui-motion",
    effect: "pulse",
    ...(withAvatar && profile.defaultAvatar ? { avatar: profile.defaultAvatar } : {}),
  };
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
export function reelHtml(draft: ReelDraft, voice: VoiceResult) {
  const duration = Math.max(4, +(voice.voiceEnd + 1.8).toFixed(2));
  const hasAvatar = Boolean(draft.avatar);
  const avatarScripts = hasAvatar
    ? '<script src="avatar/runtime.js"></script>\n  <script src="avatar/voice.js"></script>'
    : "";
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<link rel="icon" href="data:,">
<title>${htmlText(draft.objective)}</title>
<style>
  @font-face { font-family: Anton; src: url(fonts/Anton-Regular.ttf); }
  @font-face { font-family: "Instrument Sans"; src: url(fonts/InstrumentSans.ttf); font-weight: 100 900; }
  * { box-sizing: border-box; margin: 0; }
  html, body { width: 1080px; height: 1920px; overflow: hidden; background: #141318; }
  #film { position: relative; width: 1080px; height: 1920px; overflow: hidden; color: #fff; background: #141318; font-family: "Instrument Sans", sans-serif; }
</style>
</head>
<body>
<div id="film" data-composition-id="film" data-start="0" data-duration="${duration}" data-width="1080" data-height="1920">
  <audio id="voz" data-start="0" data-duration="${voice.duration}" data-track-index="20" data-volume="1" src="assets/voice.wav"></audio>
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
      brand: { accent: palette.accent || "#7C5CFF" }
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

export function ReelCreator({
  profile,
  session,
  onSession,
  onReview,
  onBack,
}: {
  profile: StudioProfile;
  session: ReelSession;
  onSession: (session: ReelSession) => void;
  onReview: (session: ReelSession) => void;
  onBack: () => void;
}) {
  const [formats, setFormats] = useState<VideoFormat[]>([]);
  const [formatsError, setFormatsError] = useState("");
  const scriptAutomatic = useRef(true);
  const draft = session.draft;
  const withAvatar = Boolean(draft.avatar);
  const busy = session.step === "generating";

  useEffect(() => {
    void api<{ formats: VideoFormat[] }>("list_formats")
      .then((result) => setFormats(result.formats))
      .catch((reason) => setFormatsError(reason instanceof Error ? reason.message : String(reason)));
  }, []);

  function update(patch: Partial<ReelDraft>) {
    const next = { ...draft, ...patch };
    if (scriptAutomatic.current && (patch.objective !== undefined || patch.offer !== undefined)) {
      next.script = deterministicScript(next.objective, next.offer);
    }
    onSession({ ...session, draft: next, error: undefined });
  }

  async function generate() {
    onSession({ ...session, step: "generating", error: undefined });
    try {
      const created = await api<CreatedFilm>("create_film", {
        name: draft.objective.trim(),
        format: draft.formatId,
        aspect: "9:16",
        ...(draft.avatar ? { avatar: draft.avatar } : {}),
      });
      const profileVoice = draft.voice.provider === "local" && draft.voice.voiceId === "default"
        ? undefined
        : draft.voice.voiceId;
      let voice = await api<VoiceResult>("film_voiceover", {
        film: created.film,
        text: draft.script,
        provider: draft.voice.provider,
        voice: profileVoice,
      });
      const started = Date.now();
      while (voice.status === "generating") {
        if (Date.now() - started > 180_000) throw new Error("A narração continua em geração. Abra Pacotes/Vozes para verificar o provedor.");
        await new Promise((resolve) => setTimeout(resolve, 1500));
        voice = await api<VoiceResult>("film_voiceover", {
          film: created.film,
          text: draft.script,
          provider: draft.voice.provider,
          voice: profileVoice,
        });
      }
      await api("write_film_file", { film: created.film, path: "index.html", content: reelHtml(draft, voice) });
      const duration = +(voice.voiceEnd + 1.8).toFixed(2);
      const [check, frames, format] = await Promise.all([
        api<{ errors: string[]; warnings: string[] }>("film_check", { film: created.film }),
        api<{ images: string[]; frameTimes: number[]; errors: string[] }>("film_stills", {
          film: created.film,
          times: [0.5, duration * 0.35, duration * 0.7, Math.max(0.6, duration - 0.5)],
        }),
        api<{ checklist: string[] }>("get_format_guide", { id: draft.formatId }),
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
      onReview({ ...session, step: "review", filmId: created.film, review, error: undefined });
    } catch (reason) {
      onSession({ ...session, step: "brief", error: reason instanceof Error ? reason.message : String(reason) });
    }
  }

  return (
    <div className="reel-creator">
      <button type="button" className="studio-back-button" onClick={onBack} disabled={busy}><ArrowLeft size={15} /> Voltar ao início</button>
      <header className="reel-creator-header">
        <div>
          <span className="studio-eyebrow">BRIEFING → VOZ → CENAS → REVISÃO</span>
          <h1>{withAvatar ? "Criar um Reel com avatar" : "Criar sem avatar"}</h1>
          <p>Comece com um roteiro determinístico e edite cada palavra. Claude ou ChatGPT continuam disponíveis pelo MCP para criar outra versão.</p>
        </div>
        {withAvatar && <div className="reel-avatar-chip" data-testid="reel-avatar-reference"><UserRound size={18} /><span>Avatar {draft.avatar!.avatarId} · revisão {draft.avatar!.revision}</span></div>}
      </header>

      <div className="reel-creator-grid">
        <section className="reel-form-card">
          <span className="reel-section-number">01 · MENSAGEM</span>
          <label className="reel-field">Objetivo<input value={draft.objective} maxLength={180} disabled={busy} onChange={(event) => update({ objective: event.target.value })} /></label>
          <label className="reel-field">Oferta<textarea rows={3} value={draft.offer} maxLength={500} disabled={busy} onChange={(event) => update({ offer: event.target.value })} /></label>
          <label className="reel-field">Roteiro<textarea rows={8} value={draft.script} maxLength={5000} disabled={busy} onChange={(event) => { scriptAutomatic.current = false; update({ script: event.target.value }); }} /></label>
          <small>O texto acima é o roteiro real enviado à narração. Nenhuma IA foi simulada.</small>
        </section>

        <section className="reel-form-card">
          <span className="reel-section-number">02 · PRODUÇÃO</span>
          <label className="reel-field">Formato
            <select value={draft.formatId} disabled={busy || !formats.length} onChange={(event) => update({ formatId: event.target.value })}>
              {!formats.length && <option value={draft.formatId}>Carregando formatos…</option>}
              {formats.map((format) => <option key={format.id} value={format.id}>{format.name} · {format.length}</option>)}
            </select>
          </label>
          <div className="reel-voice-card" data-testid="reel-profile-voice">
            <strong>Voz do perfil</strong>
            <span>{draft.voice.provider} · {draft.voice.voiceId}</span>
            <small>A narração usa este provedor e esta voz, sem trocar suas preferências globais.</small>
          </div>
          <div className="reel-output-spec"><strong>Saída vertical</strong><span>1080 × 1920 · GSAP · timing real · legendas</span></div>
        </section>
      </div>

      {(formatsError || session.error) && <p className="reel-error" role="alert">{formatsError || session.error}</p>}
      {busy && <p className="reel-busy" role="status"><LoaderCircle size={16} className="spin" /> Criando filme, narração, cenas e quadros reais. Isso pode levar alguns minutos.</p>}
      <div className="reel-create-actions">
        <span>O filme será vinculado a <strong>{profile.name}</strong>.</span>
        <button type="button" className="studio-primary-button" disabled={busy || !formats.length || !draft.objective.trim() || !draft.offer.trim() || !draft.script.trim()} onClick={() => void generate()}>
          {busy ? <LoaderCircle size={15} className="spin" /> : <WandSparkles size={15} />} Gerar filme e revisar <ArrowRight size={14} />
        </button>
      </div>
    </div>
  );
}

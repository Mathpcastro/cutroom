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

const effects: Array<{ id: ReelEffect; name: string }> = [
  { id: "none", name: "Movimento suave" },
  { id: "pulse", name: "Pulso nas cenas" },
  { id: "rise", name: "Entrada ascendente" },
  { id: "wipe", name: "Transições de corte" },
];

export function initialReelDraft(profile: StudioProfile, withAvatar: boolean): ReelDraft {
  const objective = profile.commercialGoal || "Apresentar seu produto com clareza";
  const offer = "Conheça a oferta pelo link do perfil";
  return {
    profileId: profile.id,
    objective,
    offer,
    script: deterministicScript(objective, offer),
    voice: { provider: profile.voice.provider, voiceId: profile.voice.voiceId },
    formatId: withAvatar ? "professor" : "ui-motion",
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

/** A local, deterministic HyperFrames composition; no generated-AI claim or remote dependency. */
export function reelHtml(draft: ReelDraft, voice: VoiceResult) {
  const duration = Math.max(4, +(voice.voiceEnd + 1.8).toFixed(2));
  const hasAvatar = Boolean(draft.avatar);
  const entrance = draft.effect === "rise" ? "y: 90" : draft.effect === "pulse" ? "scale: .88" : "autoAlpha: 0";
  const avatarScripts = hasAvatar
    ? '<script src="avatar/runtime.js"></script>\n  <script src="avatar/voice.js"></script>'
    : "";
  const avatarCanvas = hasAvatar ? '<canvas id="avatar" aria-label="Apresentador"></canvas>' : "";
  const init = `
    window.__timelines = window.__timelines || {};
    var D = ${duration};
    var tl = gsap.timeline({ paused: true });
    var scene = { time: 0 };
    var avatarDraw = null;
    function build() {
      tl.fromTo('.hook', { autoAlpha: 0, ${entrance} }, { autoAlpha: 1, y: 0, scale: 1, duration: .45, ease: 'power3.out' }, 0);
      tl.to('.hook', { autoAlpha: 0, y: -35, duration: .3 }, Math.max(1.8, D * .31));
      tl.fromTo('.offer', { autoAlpha: 0, ${entrance} }, { autoAlpha: 1, y: 0, scale: 1, duration: .45, ease: 'power3.out' }, Math.max(2, D * .34));
      tl.to('.offer', { autoAlpha: 0, y: -35, duration: .3 }, Math.max(3, D * .70));
      tl.fromTo('.cta', { autoAlpha: 0, ${entrance} }, { autoAlpha: 1, y: 0, scale: 1, duration: .45, ease: 'power3.out' }, Math.max(3.2, D * .73));
      ${draft.effect === "wipe" ? "CR.wipe(tl, Math.max(2, D * .34)); CR.wipe(tl, Math.max(3.2, D * .73));" : ""}
      CR.captions(tl, { el: '.captions', maxWords: 4 });
      if (avatarDraw) tl.to(scene, { time: D, duration: D, ease: 'none', onUpdate: function () { avatarDraw(scene.time); } }, 0);
      tl.set({}, {}, D);
      window.__timelines['film'] = tl;
    }
  `;
  const avatarInit = hasAvatar ? `
    const { renderAvatarPixels } = await import(window.FILM_AVATAR_ENGINE);
    window.renderAvatarPixels = renderAvatarPixels;
    var canvas = document.getElementById('avatar');
    var context = canvas.getContext('2d');
    context.imageSmoothingEnabled = false;
    avatarDraw = function (time) {
      var voice = window.FILM_AVATAR_VOICE;
      var frame = Math.max(0, Math.min(voice.mouths.length - 1, Math.floor(time * voice.fps)));
      var mouth = voice.mouths[frame] || 'X';
      var pixels = window.renderAvatarPixels(window.FILM_AVATAR, {
        pose: 'neutral', expression: 'neutral', mouth: mouth,
        blink: frame % 103 < 4 ? 1 : 0, frame: frame
      }, 'full');
      if (canvas.width !== pixels.width || canvas.height !== pixels.height) {
        canvas.width = pixels.width; canvas.height = pixels.height;
      }
      context.putImageData(new ImageData(pixels.data, pixels.width, pixels.height), 0, 0);
    };
    avatarDraw(0);
    build();
  ` : "build();";

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<style>
  @font-face { font-family: Anton; src: url(fonts/Anton-Regular.ttf); }
  @font-face { font-family: "Instrument Sans"; src: url(fonts/InstrumentSans.ttf); font-weight: 100 900; }
  * { box-sizing: border-box; margin: 0; }
  html, body { width: 1080px; height: 1920px; overflow: hidden; background: ${draft.profileId ? "#141318" : "#141318"}; }
  #film { position: relative; width: 1080px; height: 1920px; overflow: hidden; color: #fff; background: radial-gradient(circle at 85% 12%, #6445d8 0, #141318 52%); font-family: "Instrument Sans", sans-serif; }
  #film::before { content: ''; position: absolute; left: 70px; top: 85px; width: 94px; height: 12px; background: #c8ff5a; border-radius: 10px; }
  .scene { position: absolute; left: 76px; right: 76px; top: 360px; visibility: hidden; opacity: 0; }
  .kicker { color: #c8ff5a; font-size: 30px; font-weight: 700; letter-spacing: 5px; text-transform: uppercase; }
  h1, h2 { margin-top: 30px; font-family: Anton, sans-serif; font-weight: 400; line-height: 1.04; text-transform: uppercase; }
  h1 { font-size: 112px; } h2 { font-size: 94px; }
  .offer-card { margin-top: 55px; padding: 38px; color: #141318; background: #f7f6f1; border-radius: 28px; font-size: 44px; line-height: 1.3; }
  .captions { position: absolute; left: 100px; right: 100px; top: 155px; min-height: 150px; text-align: center; font-size: 53px; font-weight: 650; line-height: 1.2; text-shadow: 0 3px 16px #000; }
  .captions .key { color: #c8ff5a; }
  #avatar { position: absolute; right: 30px; bottom: 335px; width: 460px; height: 460px; image-rendering: pixelated; }
  .cta { top: 510px; text-align: center; }
  .cta .offer-card { color: #fff; background: #6445d8; border: 3px solid #c8ff5a; }
</style>
</head>
<body>
<div id="film" data-composition-id="film" data-start="0" data-duration="${duration}" data-width="1080" data-height="1920">
  <section class="scene hook"><span class="kicker">Seu próximo passo</span><h1>${htmlText(draft.objective)}</h1></section>
  <section class="scene offer"><span class="kicker">A oferta</span><h2>Feita para você</h2><div class="offer-card">${htmlText(draft.offer)}</div></section>
  <section class="scene cta"><span class="kicker">Comece agora</span><h2>Link no perfil</h2><div class="offer-card">Veja os detalhes e dê o próximo passo.</div></section>
  <div class="captions"></div>
  ${avatarCanvas}
  <audio id="voz" data-start="0" data-duration="${voice.duration}" data-track-index="20" data-volume="1" src="assets/voice.wav"></audio>
  <script src="kit/gsap.min.js"></script>
  <script src="brand.js"></script>
  <script src="timing.js"></script>
  ${avatarScripts}
  <script src="kit/cutroom-kit.js"></script>
  <script>${init}</script>
  <script type="module">${avatarInit}</script>
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
          <label className="reel-field">Efeito visual
            <select value={draft.effect} disabled={busy} onChange={(event) => update({ effect: event.target.value as ReelEffect })}>
              {effects.map((effect) => <option key={effect.id} value={effect.id}>{effect.name}</option>)}
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

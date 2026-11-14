import type { StudioProfile } from "../../shared/profile";
import { shotFilmHtml, shotNarration, type ShotPlan } from "../../shared/shots";
import { planShotFilm } from "./salesReels";
import { getStudioLanguage, t } from "./studioLanguage";
import type { ReelDraft, ReelReviewData, ReelSession } from "./ReelCreator";

interface CreatedFilm { film: string }
interface VoiceResult { status?: string; duration: number; voiceEnd: number }

async function api<T>(method: string, params?: unknown): Promise<T> {
  if (!window.cutroom) throw new Error("A criação de filmes está disponível no aplicativo desktop.");
  return window.cutroom.request<T>(method, params);
}

/** Extra characters a Reel may cast, played by the base avatars. */
export const EXTRA_CAST: Record<string, "companion" | "expert"> = { Cliente: "companion", Colega: "expert" };

export const avatarName = (profile: StudioProfile) =>
  ((profile.preferences?.avatarStudio as { name?: string } | undefined)?.name || "").trim().slice(0, 40) || "Apresentador";

/** Narration with the profile voice; waits while a remote provider is still generating. */
export async function narrate(film: string, text: string, voice: ReelDraft["voice"], language: string) {
  let profileVoice = voice.provider === "local" && voice.voiceId === "default" ? undefined : voice.voiceId;
  if (language !== "pt-BR" && (voice.provider === "local" || voice.provider === "kokoro")) {
    const { voices } = await api<{ voices: { id: string; language?: string }[] }>("listVoices", { provider: voice.provider });
    const candidates = voices.filter((item) => item.language?.split(/[-_]/)[0].toLowerCase() === language);
    profileVoice = candidates.find((item) => item.id === profileVoice)?.id ?? candidates[0]?.id;
    if (!profileVoice) throw new Error(t("Escolha uma voz instalada para este idioma ou use ElevenLabs ou OpenAI."));
  }
  const ask = () => api<VoiceResult>("film_voiceover", { film, text, provider: voice.provider, voice: profileVoice });
  let result = await ask();
  const started = Date.now();
  while (result.status === "generating") {
    if (Date.now() - started > 180_000) throw new Error("A narração continua em geração. Abra Pacotes/Vozes para verificar o provedor.");
    await new Promise((resolve) => setTimeout(resolve, 1500));
    result = await ask();
  }
  return result;
}

/** Brand proofs used by the shots, copied into the film (frames for recordings). */
export async function attachProofs(profileId: string, film: string, plan: ShotPlan) {
  const proofs: Record<string, string[]> = {};
  for (const id of new Set(plan.shots.flatMap((shot) => (shot.proof ? [shot.proof] : [])))) {
    try {
      const { frames } = await api<{ frames: string[] }>("attachBrandProof", { profileId, film, proofId: id });
      if (frames?.length) proofs[id] = frames;
    } catch {
      /* A proof that cannot be copied is simply not shown. */
    }
  }
  return proofs;
}

/** Stills at the middle of a few shots, for the review screen. */
export async function reviewShots(film: string, duration: number, checklist: string[]): Promise<ReelReviewData> {
  const check = await api<{ errors: string[]; warnings: string[] }>("film_check", { film });
  const times = [0.6, duration * 0.3, duration * 0.55, duration * 0.8].map((v) => +v.toFixed(2));
  const frames = check.errors.length
    ? { images: [], frameTimes: [], errors: [] }
    : await api<{ images: string[]; frameTimes: number[]; errors: string[] }>("film_stills", { film, times });
  return { images: frames.images, frameTimes: frames.frameTimes, errors: [...check.errors, ...frames.errors], flags: check.warnings, checklist, duration };
}

export const SHOT_CHECKLIST = [
  "Os cenários e objetos foram desenhados para este pedido",
  "Os planos mudam a cada frase e a câmera guia o olhar",
  "Personagens, balões e legendas ficam legíveis",
];

/**
 * A Reel drawn by the AI: sets and props in SVG, a shot list, the profile voice, word-timed text and
 * the chosen look, rendered by the shot engine.
 */
export async function generateShotReel(profile: StudioProfile, draft: ReelDraft, setProgress: (value: string) => void): Promise<ReelSession> {
  const language = draft.language ?? getStudioLanguage();
  const withAvatar = Boolean(draft.avatar);
  const presenter = withAvatar ? avatarName(profile) : undefined;
  const story = Boolean(draft.narrative);
  setProgress(t("Escrevendo o roteiro e desenhando as cenas…"));
  const { plan } = await planShotFilm(profile, {
    brief: draft.brief ?? "",
    story,
    language,
    look: draft.look,
    lookText: draft.lookText,
    presenter,
    extras: story ? Object.keys(EXTRA_CAST) : [],
  });
  const spoken = shotNarration(plan);
  if (!spoken.trim()) throw new Error(t("A IA não escreveu a narração. Tente gerar novamente."));
  const created = await api<CreatedFilm>("create_film", { name: plan.title, format: "desenhado", aspect: "9:16", ...(draft.avatar ? { avatar: draft.avatar } : {}) });
  await api("write_film_file", {
    film: created.film, path: "brand.js",
    content: "window.BRAND = " + JSON.stringify({ name: profile.brand.name || profile.name, handle: profile.handle, palette: { accent: profile.brand.accent, ink: profile.brand.ink, paper: profile.brand.paper } }) + ";",
  });
  setProgress(t("Gerando a narração…"));
  const voice = await narrate(created.film, spoken, draft.voice, language);
  const duration = Math.max(4, +(voice.voiceEnd + 1.8).toFixed(2));
  setProgress(t("Animando e conferindo as cenas…"));
  const proofs = await attachProofs(profile.id, created.film, plan);
  const music = plan.music ? await api<{ file: string }>("compose_music", { film: created.film, mood: plan.music.mood, seconds: duration }).catch(() => undefined) : undefined;
  const cast: Record<string, string> = { ...EXTRA_CAST };
  if (presenter) cast[presenter] = "film";
  await api("write_film_file", {
    film: created.film, path: "index.html",
    content: shotFilmHtml({ plan, duration, voiceDuration: voice.duration, language, cast, hasFilmAvatar: withAvatar, captions: true, proofs, ...(music ? { music: { file: music.file } } : {}) }),
  });
  await api("write_film_file", { film: created.film, path: "plano.json", content: JSON.stringify(plan, null, 1) });
  const review = await reviewShots(created.film, duration, SHOT_CHECKLIST);
  await api("profileLinkProject", { profileId: profile.id, projectId: created.film });
  return { step: "review", draft: { ...draft, language, script: spoken, formatId: "desenhado" }, filmId: created.film, review, caption: plan.caption, shotPlan: plan };
}

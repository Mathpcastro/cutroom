import type { ReelDraft, ReelSession } from "./ReelCreator";
import { studioRequest } from "./salesReels";

interface ReviewRecord {
  filmId: string;
  draft: ReelDraft;
  caption?: string;
  plan?: ReelSession["plan"];
  output?: string;
  outputs?: string[];
  duration: number;
}

function records(profileId: string): ReviewRecord[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem("videosell.reviews." + profileId) ?? "[]");
    return Array.isArray(value) ? value.filter((item) => item?.filmId && item?.draft?.profileId === profileId && item?.duration > 0) : [];
  } catch {
    return [];
  }
}

export function rememberReel(session: ReelSession) {
  if (!session.filmId || !session.review) return;
  const { filmId, draft, caption, output, plan } = session;
  try {
    const previous = records(draft.profileId);
    const old = previous.find((item) => item.filmId === filmId);
    const outputs = [...new Set([output, old?.output, ...(old?.outputs ?? [])].filter((path): path is string => Boolean(path)))].slice(0, 20);
    const record = { filmId, draft, caption, output, outputs, plan, duration: session.review.duration };
    const next = [record, ...previous.filter((item) => item.filmId !== filmId)].slice(0, 200);
    localStorage.setItem("videosell.reviews." + draft.profileId, JSON.stringify(next));
  } catch {
    // Films are still linked and available in the editor when local storage is unavailable.
  }
}

export function pendingReviews(profileId: string) {
  return records(profileId).filter((item) => !item.output);
}

export async function reopenReel(profileId: string, filmId: string): Promise<ReelSession | undefined> {
  const record = records(profileId).find((item) => item.filmId === filmId);
  if (!record) return undefined;
  const { duration, draft, caption, output, plan } = record;
  const [frames, check] = await Promise.all([
    studioRequest<{ images: string[]; frameTimes: number[]; errors: string[] }>("film_stills", {
      film: filmId, times: [0.5, duration * 0.35, duration * 0.7, duration - 0.5],
    }),
    studioRequest<{ errors: string[]; warnings: string[] }>("film_check", { film: filmId }),
  ]);
  return { step: "review", filmId, draft, caption, output, plan, review: {
    images: frames.images, frameTimes: frames.frameTimes, duration,
    errors: [...check.errors, ...frames.errors], flags: check.warnings, checklist: [],
  } };
}



export function findReelByExport(profileId: string, path: string) {
  return records(profileId).find((entry) => entry.output === path || entry.outputs?.includes(path));
}

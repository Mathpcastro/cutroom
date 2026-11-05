import type { AudioTrack, Project } from "./types";

export const AUDIO_KINDS = ["voice", "music", "sfx"] as const;

/** Timeline interval actually heard for a track. */
export const audioTrackEnd = (track: AudioTrack) => track.start + track.duration;

/**
 * Words spoken by voice tracks, in TIMELINE seconds. They feed captions the same way clip
 * transcription does; `mediaId`/`clipId` carry the track id so phrase grouping never merges
 * words from different tracks.
 */
export function voiceTimelineWords(project: Project) {
  const result: {
    text: string;
    start: number;
    end: number;
    mediaId: string;
    clipId: string;
  }[] = [];
  for (const track of project.audio ?? []) {
    if (track.kind !== "voice" || !track.words?.length) continue;
    const offset = track.offset ?? 0;
    for (const word of track.words) {
      const start = Math.max(word.start, offset),
        end = Math.min(word.end, offset + track.duration);
      if (end <= start + 0.00001) continue;
      result.push({
        text: word.text,
        mediaId: track.id,
        clipId: track.id,
        start: track.start + start - offset,
        end: track.start + end - offset,
      });
    }
  }
  return result;
}

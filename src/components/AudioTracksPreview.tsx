import { useEffect, useRef } from "react";
import type { AudioTrack, Project } from "../shared/types";

/** Position inside the file for a timeline second, or undefined when the track is silent there. */
export function trackFileTime(track: AudioTrack, time: number) {
  if (time < track.start || time >= track.start + track.duration) return;
  const local = (track.offset ?? 0) + time - track.start;
  return track.loop ? local % track.fileDuration : local;
}

/** Plays narration, music and effects with the timeline. Ducking and fades are export-only. */
export function AudioTracksPreview({
  project,
  time,
  playing,
  muted,
}: {
  project: Project;
  time: number;
  playing: boolean;
  muted: boolean;
}) {
  const tracks = project.audio ?? [];
  const elements = useRef(new Map<string, HTMLAudioElement>());
  useEffect(() => {
    for (const track of tracks) {
      const element = elements.current.get(track.id);
      if (!element) continue;
      const at = trackFileTime(track, time);
      element.volume = Math.min(1, Math.pow(10, (track.gain ?? 0) / 20));
      element.muted = muted;
      if (at === undefined || !playing) {
        if (!element.paused) element.pause();
        if (at !== undefined && Math.abs(element.currentTime - at) > 0.05)
          element.currentTime = at;
        continue;
      }
      if (Math.abs(element.currentTime - at) > 0.3) element.currentTime = at;
      if (element.paused) void element.play().catch(() => undefined);
    }
  }, [time, playing, muted, tracks]);
  return (
    <>
      {tracks.map((track) => (
        <audio
          key={track.id}
          ref={(node) => {
            if (node) elements.current.set(track.id, node);
            else elements.current.delete(track.id);
          }}
          src={window.cutroom?.mediaUrl(track.path)}
          loop={track.loop}
          preload="auto"
          hidden
        />
      ))}
    </>
  );
}

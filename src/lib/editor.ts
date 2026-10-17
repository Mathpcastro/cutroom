import type { AppSnapshot, Clip, Project } from "../shared/types";

export const duration = (project: Project) =>
  project.clips.reduce((total, clip) => total + clipDuration(clip), 0);
export const clipDuration = (clip: Clip) =>
  Math.max(0, clip.end - clip.start) / Math.max(0.01, clip.speed);
export function timecode(seconds: number, precise = false) {
  const value = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const minutes = Math.floor(value / 60);
  return `${String(minutes).padStart(2, "0")}:${String(Math.floor(value % 60)).padStart(2, "0")}${precise ? `.${String(Math.floor((value % 1) * 100)).padStart(2, "0")}` : ""}`;
}
export function locateClip(project: Project, time: number) {
  let offset = 0;
  for (let i = 0; i < project.clips.length; i++) {
    const clip = project.clips[i];
    const length = clipDuration(clip);
    if (time < offset + length || i === project.clips.length - 1)
      return {
        clip,
        offset,
        sourceTime: Math.min(
          clip.end,
          clip.start + Math.max(0, time - offset) * clip.speed,
        ),
      };
    offset += length;
  }
  return undefined;
}
export function clipOffset(project: Project, id: string) {
  let offset = 0;
  for (const clip of project.clips) {
    if (clip.id === id) return offset;
    offset += clipDuration(clip);
  }
  return 0;
}
export const emptySnapshot: AppSnapshot = {
  project: {
    version: 1,
    id: "browser-empty",
    name: "Projeto sem título",
    createdAt: "",
    updatedAt: "",
    media: [],
    clips: [],
    words: [],
    overlays: [],
    settings: {
      captions: false,
      normalize: false,
      targetLufs: -14,
      width: 1920,
      height: 1080,
      fps: 30,
      accent: "#d3f875",
    },
  },
  messages: [],
  jobs: [],
  packages: [],
  connection: { status: "disconnected", models: [] },
  busy: false,
  canUndo: false,
  canRedo: false,
};

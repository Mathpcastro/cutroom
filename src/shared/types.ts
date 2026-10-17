export interface Media {
  id: string;
  name: string;
  path: string;
  duration: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
  thumbnail?: string;
  proxy?: string;
}
export interface Word {
  text: string;
  start: number;
  end: number;
  mediaId: string;
}
export interface Clip {
  id: string;
  mediaId: string;
  start: number;
  end: number;
  speed: number;
  zoom: number;
  muted: boolean;
  focusX?: number;
  focusY?: number;
}
export type OverlayKind =
  "title" | "statement" | "callout" | "flow" | "promo" | "cover";
export interface Overlay {
  id: string;
  kind: OverlayKind;
  text: string;
  start: number;
  end: number;
}
export interface Project {
  version: 1;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  media: Media[];
  clips: Clip[];
  words: Word[];
  overlays: Overlay[];
  settings: {
    captions: boolean;
    normalize: boolean;
    targetLufs: number;
    width: number;
    height: number;
    fps: number;
    accent: string;
  };
}
export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  createdAt: string;
}
export interface Job {
  id: string;
  kind: string;
  label: string;
  progress: number;
  status: "running" | "completed" | "failed" | "cancelled";
  error?: string;
  output?: string;
}
export interface PackageInfo {
  id: string;
  name: string;
  description: string;
  version: string;
  size: string;
  installed: boolean;
  status: "available" | "installing" | "installed" | "error";
  error?: string;
  capabilities: string[];
}
export interface Connection {
  status: "disconnected" | "connecting" | "connected" | "error";
  account?: string;
  model?: string;
  models: { id: string; name: string }[];
  error?: string;
}
export interface AppSnapshot {
  project: Project;
  messages: ChatMessage[];
  jobs: Job[];
  packages: PackageInfo[];
  connection: Connection;
  busy: boolean;
  canUndo: boolean;
  canRedo: boolean;
  projectPath?: string;
}
export type CommandName =
  | "remove_range"
  | "trim"
  | "split"
  | "delete_clip"
  | "zoom"
  | "speed"
  | "captions"
  | "normalize"
  | "overlay"
  | "remove_silence"
  | "remove_fillers"
  | "preset"
  | "hook"
  | "reset"
  | "rename";
export interface EditCommand {
  name: CommandName;
  args: Record<string, unknown>;
}
export interface EditorEvent {
  type: "state";
  state: AppSnapshot;
}
export interface CutroomAPI {
  request<T = AppSnapshot>(method: string, params?: unknown): Promise<T>;
  onEvent(callback: (event: EditorEvent) => void): () => void;
  mediaUrl(path: string): string;
  pathForFile?(file: File): string;
}
declare global {
  interface Window {
    cutroom?: CutroomAPI;
  }
}

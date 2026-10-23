import type { CaptionSettings } from "./captions";
import type { AgentProvider } from "./providers";
export type ReasoningEffort =
  "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export interface AgentActivity {
  id: string;
  kind: "turn" | "reasoning" | "tool" | "message" | "analysis" | "edit";
  label: string;
  status: "running" | "completed" | "failed" | "cancelled";
  startedAt: string;
  finishedAt?: string;
  detail?: string;
  tool?: string;
}
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
  look?:
    | "none"
    | "monochrome"
    | "cinema"
    | "vivid"
    | "blur"
    | "vignette"
    | "color-wipe";
  mirrored?: boolean;
  lookStart?: number;
  lookEnd?: number;
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
export type MotionPresetId =
  "title" | "lower-third" | "highlight" | "steps" | "stat" | "explainer";
export interface MotionTween {
  selector: string;
  start: number;
  duration: number;
  from?: Record<string, string | number>;
  to: Record<string, string | number>;
  ease?: string;
}
export interface MotionScene {
  id: string;
  name: string;
  start: number;
  end: number;
  mode: "overlay" | "fullscreen";
  duration: number;
  sourceOffset?: number;
  playbackRate?: number;
  html: string;
  animations: MotionTween[];
  presetId?: MotionPresetId;
  text?: string;
  subtitle?: string;
  items?: string[];
  accent?: string;
  background?: string;
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
  motions?: MotionScene[];
  settings: {
    captions: boolean;
    normalize: boolean;
    targetLufs: number;
    width: number;
    height: number;
    fps: number;
    accent: string;
    captionStyle?: CaptionSettings;
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
  startedAt?: string;
  finishedAt?: string;
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
  provider?: AgentProvider;
  account?: string;
  model?: string;
  models: {
    id: string;
    name: string;
    modelId?: string;
    description?: string;
    reasoningEfforts?: ReasoningEffort[];
    defaultReasoningEffort?: ReasoningEffort;
    supportsVision?: boolean;
    supportsAdaptiveThinking?: boolean;
    inputPricePerMillion?: number;
    outputPricePerMillion?: number;
  }[];
  reasoningEffort?: ReasoningEffort;
  activeModel?: string;
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
  activities?: AgentActivity[];
  onboarding?: { dismissed: boolean; transcriptionReady: boolean };
}
export type CommandName =
  | "remove_range"
  | "trim"
  | "split"
  | "delete_clip"
  | "zoom"
  | "speed"
  | "clip_style"
  | "captions"
  | "normalize"
  | "overlay"
  | "motion"
  | "delete_motion"
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

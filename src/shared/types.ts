import type { CaptionSettings } from "./captions";
import type { AgentProvider } from "./providers";
import type { AvatarPackage } from "./avatar";
import type {
  AvatarCandidate,
  AvatarRenderedRevision,
  AvatarRevisedCandidate,
  AvatarSelectedCandidate,
  AvatarValidationResult,
  ReviewCandidateInput,
  ReviewedCandidate,
  RevisePartInput,
} from "../../electron/core/avatar-service";
import type { LocalAvatarStarters } from "../../electron/core/avatar-creator";
import type { AvatarProofSheet } from "../../electron/core/avatar-render";
import type {
  AvatarReferenceAsset,
} from "../../electron/core/avatar-store";
import type { AvatarReferenceAnalysis } from "../../electron/core/avatar-vision";
import type {
  CreateStudioProfileInput,
  StudioProfile,
  StudioProfilePatch,
} from "./profile";
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
export type AudioKind = "voice" | "music" | "sfx";
/** Word inside an audio file, in FILE seconds (before track.offset/start are applied). */
export interface AudioWord {
  text: string;
  start: number;
  end: number;
}
export interface AudioTrack {
  id: string;
  kind: AudioKind;
  name: string;
  path: string;
  /** Timeline second where the track starts. Tracks are not moved by video cuts. */
  start: number;
  /** Second inside the file where playback starts. */
  offset?: number;
  /** Seconds played on the timeline (with loop, may exceed the file). */
  duration: number;
  fileDuration: number;
  /** Volume change in dB. */
  gain?: number;
  fadeIn?: number;
  fadeOut?: number;
  loop?: boolean;
  /** Music only: lower it while voice/clip audio plays. Default true for music. */
  duck?: boolean;
  words?: AudioWord[];
  source?: {
    provider: string;
    title?: string;
    author?: string;
    license?: string;
    url?: string;
    voice?: string;
  };
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
  audio?: AudioTrack[];
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
  | "audio"
  | "delete_audio"
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
export type StudioTab = "start" | "brand" | "voices" | "films" | "publish";
export type EditorEvent = { type: "state"; state: AppSnapshot } | { type: "studio"; tab: StudioTab };
export interface StudioProfilesAPI {
  list(): Promise<StudioProfile[]>;
  getActive(): Promise<StudioProfile | undefined>;
  listProjects(profileId: string): Promise<string[]>;
  get(profileId: string): Promise<StudioProfile>;
  create(input: CreateStudioProfileInput): Promise<StudioProfile>;
  update(profileId: string, patch: StudioProfilePatch): Promise<StudioProfile>;
  duplicate(
    profileId: string,
    input: Pick<CreateStudioProfileInput, "name" | "handle">,
  ): Promise<StudioProfile>;
  select(profileId: string): Promise<void>;
  remove(profileId: string, confirmation: "DELETE"): Promise<void>;
}
export interface AvatarCreatorAPI {
  createStarters(input: {
    avatarId: string;
    description: string;
  }): Promise<LocalAvatarStarters>;
  getRevision(input: {
    avatarId: string;
    revision: number;
  }): Promise<{
    package: AvatarPackage;
    revision: number;
    hash: string;
    path: string;
    candidate: AvatarCandidate;
  }>;
  getCandidate(input: {
    avatarId: string;
    candidateId: string;
  }): Promise<AvatarCandidate>;
  listRevisions(input: {
    avatarId: string;
  }): Promise<Array<{ revision: number; hash: string; approved: boolean }>>;
  readArtifact(input: {
    avatarId: string;
    revision: number;
    path: string;
  }): Promise<{ path: string; mimeType: "image/png"; dataUrl: string }>;
  selectCandidate(input: {
    avatarId: string;
    candidateId: string;
  }): Promise<AvatarSelectedCandidate>;
  render(input: {
    avatarId: string;
    revision: number;
    sheets: AvatarProofSheet[];
  }): Promise<AvatarRenderedRevision>;
  renderJobId(input: {
    avatarId: string;
    revision: number;
    sheets: AvatarProofSheet[];
  }): Promise<string>;
  validate(input: {
    avatarId: string;
    revision: number;
  }): Promise<AvatarValidationResult>;
  revisePart(input: RevisePartInput): Promise<AvatarRevisedCandidate>;
  review(input: ReviewCandidateInput): Promise<ReviewedCandidate>;
  saveRevision(input: {
    avatarId: string;
    candidateId: string;
  }): Promise<AvatarSelectedCandidate>;
  cancel(jobId: string): Promise<boolean>;
  importReference(input: {
    avatarId: string;
    path: string;
  }): Promise<AvatarReferenceAsset>;
  analyzeReference(input: {
    avatarId: string;
    assetId: string;
    providerId: string;
    prompt: string;
  }): Promise<AvatarReferenceAnalysis & {
    avatarId: string;
    assetId: string;
    providerId: string;
  }>;
}
export interface CutroomAPI {
  request<T = AppSnapshot>(method: string, params?: unknown): Promise<T>;
  studioProfiles: StudioProfilesAPI;
  avatarCreator: AvatarCreatorAPI;
  onEvent(callback: (event: EditorEvent) => void): () => void;
  mediaUrl(path: string): string;
  pathForFile?(file: File): string;
}
declare global {
  interface Window {
    cutroom?: CutroomAPI;
  }
}

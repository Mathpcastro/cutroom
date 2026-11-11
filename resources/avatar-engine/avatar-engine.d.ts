import type {
  AvatarExpression,
  AvatarPackage,
  AvatarPart,
  AvatarPose,
  AvatarPrimitive,
  MouthShape,
} from "../../src/shared/avatar";

export interface AvatarRenderState {
  pose: AvatarPose;
  expression: AvatarExpression;
  mouth: MouthShape;
  blink: number;
  frame: number;
}

export interface AvatarPixels {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface AvatarPartEvaluation {
  hidden: boolean;
  primitives: AvatarPrimitive[];
}

export function evaluatePart(
  avatar: AvatarPackage,
  state: AvatarRenderState,
  part: AvatarPart,
): AvatarPartEvaluation;

export function renderAvatarPixels(
  avatar: unknown,
  state: AvatarRenderState,
  viewport?: "full" | "portrait",
): AvatarPixels;

export function avatarPixelHash(
  avatar: unknown,
  state: AvatarRenderState,
  viewport?: "full" | "portrait",
): Promise<AvatarPixels & { hash: string }>;

import type {
  AvatarExpression,
  AvatarPose,
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

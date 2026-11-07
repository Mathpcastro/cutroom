import { createHash } from "node:crypto";
import {
  AVATAR_EXPRESSIONS,
  AVATAR_MOUTHS,
  AVATAR_POSES,
  parseAvatar,
  reviseAvatar,
  type AvatarPackage,
  type AvatarPart,
  type AvatarPartState,
  type AvatarPrimitive,
} from "./avatar";
import {
  renderAvatarPixels,
  type AvatarPixels,
  type AvatarRenderState,
} from "../../resources/avatar-engine/avatar-engine.js";

export interface AvatarFinding {
  code: string;
  message: string;
  partId?: string;
}

export interface AvatarQualityReport {
  ok: boolean;
  findings: AvatarFinding[];
  hashes: Record<string, string>;
}

const NEUTRAL_STATE: AvatarRenderState = {
  pose: "neutral",
  expression: "neutral",
  mouth: "A",
  blink: 0,
  frame: 0,
};

// At 96x96, 64 opaque pixels require at least the area of one readable 8x8 block.
const MINIMUM_SILHOUETTE_PIXELS = 64;
const BREATHING_CYCLE = [0, 0, 1, 1, 1, 1, 0, 0, 0, 0, -1, -1, -1, -1, 0, 0];

function failed(findings: AvatarFinding[]): AvatarQualityReport {
  return { ok: false, findings, hashes: {} };
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, child]) => [key, canonicalValue(child)]),
    );
  }
  return value;
}

function sameValue(left: unknown, right: unknown): boolean {
  return (
    JSON.stringify(canonicalValue(left)) ===
    JSON.stringify(canonicalValue(right))
  );
}

interface SchemaIssue {
  message?: string;
  path?: (string | number)[];
}

function schemaIssues(error: unknown): SchemaIssue[] {
  const issues = (error as { issues?: unknown } | null)?.issues;
  return Array.isArray(issues) ? (issues as SchemaIssue[]) : [];
}

function rawPartId(avatar: unknown, path: (string | number)[] = []) {
  if (!avatar || typeof avatar !== "object") return undefined;
  if (path[0] === "parts" && typeof path[1] === "number") {
    const parts = (avatar as { parts?: unknown }).parts;
    if (Array.isArray(parts)) {
      const candidate = parts[path[1]] as { id?: unknown } | undefined;
      return typeof candidate?.id === "string" ? candidate.id : undefined;
    }
  }
  if (
    (path[0] === "poses" ||
      path[0] === "expressions" ||
      path[0] === "mouths") &&
    typeof path[2] === "string"
  ) {
    return path[2];
  }
  return undefined;
}

function schemaFinding(avatar: unknown, error: unknown): AvatarFinding {
  const issues = schemaIssues(error);
  const missingState = issues.find(
    (issue) =>
      issue.path?.length === 2 &&
      (issue.path[0] === "poses" ||
        issue.path[0] === "expressions" ||
        issue.path[0] === "mouths"),
  );
  if (missingState) {
    return {
      code: "STATE_MISSING",
      message: `Mandatory avatar state "${String(missingState.path?.[1])}" is absent.`,
    };
  }

  const paletteIssue = issues.find((issue) =>
    /outside the palette/i.test(issue.message ?? ""),
  );
  if (paletteIssue) {
    return {
      code: "PALETTE_COLOR_UNKNOWN",
      message: "Avatar pixels must use colors declared in the palette.",
      partId: rawPartId(avatar, paletteIssue.path),
    };
  }

  const hierarchyIssue = issues.find((issue) =>
    /hierarchy|cycle|unknown parent/i.test(issue.message ?? ""),
  );
  if (hierarchyIssue) {
    return {
      code: "HIERARCHY_INVALID",
      message:
        "Avatar part hierarchy must be acyclic and reference known parents.",
      partId: rawPartId(avatar, hierarchyIssue.path),
    };
  }

  return {
    code: "SCHEMA_INVALID",
    message: "Avatar package does not satisfy the approved schema.",
  };
}

function protectedIdentity(avatar: AvatarPackage) {
  return {
    id: avatar.id,
    revision: avatar.revision,
    canvas: avatar.canvas,
    identity: avatar.identity,
    artBible: avatar.artBible,
    palette: avatar.palette,
  };
}

function revisionFinding(
  previous: AvatarPackage,
  next: AvatarPackage,
  error: unknown,
): AvatarFinding {
  if (!sameValue(protectedIdentity(previous), protectedIdentity(next))) {
    return {
      code: "IDENTITY_CHANGED",
      message:
        "Avatar revision changed protected identity or package invariants.",
    };
  }
  const match = /Part "([^"]+)"/.exec(
    error instanceof Error ? error.message : String(error),
  );
  return {
    code: "UNAUTHORIZED_PART_CHANGE",
    message: "Avatar revision changed a part outside allowedPartIds.",
    partId: match?.[1],
  };
}

function alphaFindings(avatar: AvatarPackage): AvatarFinding[] {
  const findings: AvatarFinding[] = [];
  for (const [token, color] of Object.entries(avatar.palette)) {
    if (color.length === 9 && color.slice(7).toLowerCase() !== "ff") {
      findings.push({
        code: "ALPHA_PARTIAL",
        message: `Palette color "${token}" must be opaque; partial alpha is not supported.`,
      });
    }
  }
  return findings;
}

interface PrimitiveBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function primitiveBounds(primitive: AvatarPrimitive): PrimitiveBounds {
  switch (primitive.type) {
    case "rect":
      return {
        left: primitive.x,
        top: primitive.y,
        right: primitive.x + primitive.width,
        bottom: primitive.y + primitive.height,
      };
    case "run":
      return {
        left: primitive.x,
        top: primitive.y,
        right: primitive.x + primitive.length,
        bottom: primitive.y + 1,
      };
    case "matrix":
      return {
        left: primitive.x,
        top: primitive.y,
        right: primitive.x + primitive.rows[0].length,
        bottom: primitive.y + primitive.rows.length,
      };
    case "polygon":
      return {
        left: Math.min(...primitive.points.map((point) => point.x)),
        top: Math.min(...primitive.points.map((point) => point.y)),
        right: Math.max(...primitive.points.map((point) => point.x)),
        bottom: Math.max(...primitive.points.map((point) => point.y)),
      };
  }
}

function outsideCanvas(bounds: PrimitiveBounds, size: number): boolean {
  return (
    bounds.left < 0 ||
    bounds.top < 0 ||
    bounds.right > size ||
    bounds.bottom > size
  );
}

function boundsFindings(avatar: AvatarPackage): AvatarFinding[] {
  const findings: AvatarFinding[] = [];
  const checked = new Set<AvatarPrimitive>();
  const check = (partId: string, primitives: AvatarPrimitive[]) => {
    for (const primitive of primitives) {
      if (checked.has(primitive)) continue;
      checked.add(primitive);
      if (outsideCanvas(primitiveBounds(primitive), avatar.canvas.full)) {
        findings.push({
          code: "OUT_OF_BOUNDS",
          message: `Part "${partId}" has authored geometry outside the ${avatar.canvas.full}x${avatar.canvas.full} canvas.`,
          partId,
        });
      }
    }
  };

  for (const part of avatar.parts) check(part.id, part.primitives);
  const groups = [avatar.poses, avatar.expressions, avatar.mouths];
  for (const group of groups) {
    for (const states of Object.values(group)) {
      for (const [partId, state] of Object.entries(states)) {
        if (state?.primitives) check(partId, state.primitives);
      }
    }
  }
  return findings;
}

function translatePrimitive(
  primitive: AvatarPrimitive,
  dx: number,
  dy: number,
): AvatarPrimitive {
  if (primitive.type === "polygon") {
    return {
      ...primitive,
      points: primitive.points.map((point) => ({
        x: point.x + dx,
        y: point.y + dy,
      })),
    };
  }
  return { ...primitive, x: primitive.x + dx, y: primitive.y + dy };
}

function applyState(
  evaluation: {
    primitives: AvatarPrimitive[];
    hidden: boolean;
    dx: number;
    dy: number;
  },
  override: AvatarPartState | undefined,
): void {
  if (!override) return;
  if (override.primitives) evaluation.primitives = override.primitives;
  if (override.hidden !== undefined) evaluation.hidden = override.hidden;
  evaluation.dx += override.dx ?? 0;
  evaluation.dy += override.dy ?? 0;
}

function breathingOffset(partId: string, frame: number): number {
  if (partId === "body") return 0;
  const delay =
    partId === "hair" || partId.startsWith("hair.")
      ? 2
      : partId === "accessory" || partId.startsWith("accessory.")
        ? 4
        : 0;
  return BREATHING_CYCLE[Math.max(0, Math.trunc(frame) - delay) % 16];
}

// This mirrors the approved rasterizer's state resolution, without drawing pixels.
function evaluatedPrimitives(
  avatar: AvatarPackage,
  part: AvatarPart,
  state: AvatarRenderState,
): AvatarPrimitive[] {
  const evaluation = {
    primitives: part.primitives,
    hidden: false,
    dx: 0,
    dy: 0,
  };
  applyState(evaluation, avatar.poses[state.pose][part.id]);
  applyState(evaluation, avatar.expressions[state.expression][part.id]);
  applyState(evaluation, avatar.mouths[state.mouth][part.id]);

  if (state.blink !== 0) {
    if (part.id === "eyes") {
      if (state.blink === 1) {
        evaluation.hidden = true;
      } else {
        evaluation.primitives = evaluation.primitives.map((primitive) =>
          primitive.type === "rect" && primitive.height > 2
            ? {
                ...primitive,
                y: primitive.y + 1,
                height: primitive.height - 2,
              }
            : translatePrimitive(primitive, 0, 1),
        );
      }
    } else if (part.id === "pupils") {
      evaluation.hidden = true;
    } else if (part.id === "lids") {
      evaluation.primitives = evaluation.primitives.map((primitive) =>
        translatePrimitive(primitive, 0, state.blink * 4),
      );
    }
  }
  evaluation.dy += breathingOffset(part.id, state.frame);
  if (evaluation.hidden) return [];

  const dx = Math.round(evaluation.dx);
  const dy = Math.round(evaluation.dy);
  return evaluation.primitives.map((primitive) =>
    translatePrimitive(primitive, dx, dy),
  );
}

function canBeVisible(primitive: AvatarPrimitive): boolean {
  if (primitive.type === "matrix") {
    return primitive.rows.some((row) => row.some((color) => color !== null));
  }
  if (primitive.type !== "polygon") return true;
  const first = primitive.points[0];
  const second = primitive.points.find(
    (point) => point.x !== first.x || point.y !== first.y,
  );
  if (!second) return false;
  const dx = second.x - first.x;
  const dy = second.y - first.y;
  return primitive.points.some(
    (point) => dx * (point.y - first.y) - dy * (point.x - first.x) !== 0,
  );
}

const BLINK_LIMITS = [0, 0.5, 1] as const;

// Every pose x expression x mouth x blink x motionLoop frame: 10,080 states.
function* composedStates(): Generator<AvatarRenderState> {
  for (const pose of AVATAR_POSES) {
    for (const expression of AVATAR_EXPRESSIONS) {
      for (const mouth of AVATAR_MOUTHS) {
        for (const blink of BLINK_LIMITS) {
          for (let frame = 0; frame < BREATHING_CYCLE.length; frame += 1) {
            yield { pose, expression, mouth, blink, frame };
          }
        }
      }
    }
  }
}

function clippingFindings(avatar: AvatarPackage): AvatarFinding[] {
  const findings: AvatarFinding[] = [];
  const reported = new Set<string>();
  for (const state of composedStates()) {
    for (const part of avatar.parts) {
      if (reported.has(part.id)) continue;
      const clipped = evaluatedPrimitives(avatar, part, state).some(
        (primitive) =>
          canBeVisible(primitive) &&
          outsideCanvas(primitiveBounds(primitive), avatar.canvas.full),
      );
      if (clipped) {
        findings.push({
          code: "VISUAL_CLIPPING",
          message: `Part "${part.id}" clips visible geometry in ${state.pose}/${state.expression}/${state.mouth} at frame ${state.frame}.`,
          partId: part.id,
        });
        reported.add(part.id);
      }
    }
  }
  return findings;
}

function silhouetteStats(pixels: AvatarPixels) {
  let count = 0;
  let maximumY = -1;
  for (let offset = 0; offset < pixels.data.length; offset += 4) {
    if (pixels.data[offset + 3] === 0) continue;
    count += 1;
    maximumY = Math.max(maximumY, Math.floor(offset / 4 / pixels.width));
  }
  return { count, maximumY };
}

function renderedMaximumY(pixels: AvatarPixels): number {
  for (let y = pixels.height - 1; y >= 0; y -= 1) {
    for (let x = 0; x < pixels.width; x += 1) {
      if (pixels.data[(y * pixels.width + x) * 4 + 3] !== 0) return y;
    }
  }
  return -1;
}

function baselineFindings(avatar: AvatarPackage): AvatarFinding[] {
  for (const state of composedStates()) {
    // The schema has no contact-part role, so use the rendered silhouette. Its
    // greatest opaque y ignores aerial hair/accessories above the contact row.
    const pixels = renderAvatarPixels(avatar, state);
    const maximumY = renderedMaximumY(pixels);
    if (maximumY + 1 !== avatar.canvas.baseline) {
      return [
        {
          code: "BASELINE_FLOATING",
          message: `Silhouette ends at y=${maximumY + 1}, but the declared baseline is y=${avatar.canvas.baseline} in ${state.pose}/${state.expression}/${state.mouth}, blink=${state.blink}, frame=${state.frame}.`,
        },
      ];
    }
  }
  return [];
}

function isolatedPartPixels(
  avatar: AvatarPackage,
  partId: string,
  state: AvatarRenderState,
): AvatarPixels {
  return renderAvatarPixels(
    { ...avatar, parts: avatar.parts.filter((part) => part.id === partId) },
    state,
  );
}

function masksTouch(accessory: AvatarPixels, parent: AvatarPixels): boolean {
  const parentPixels = new Set<number>();
  for (let offset = 0; offset < parent.data.length; offset += 4) {
    if (parent.data[offset + 3] !== 0) parentPixels.add(offset / 4);
  }
  for (let offset = 0; offset < accessory.data.length; offset += 4) {
    if (accessory.data[offset + 3] === 0) continue;
    const index = offset / 4;
    const x = index % accessory.width;
    const y = Math.floor(index / accessory.width);
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= parent.width || ny >= parent.height) {
          continue;
        }
        if (parentPixels.has(ny * parent.width + nx)) return true;
      }
    }
  }
  return false;
}

function accessoryFindings(avatar: AvatarPackage): AvatarFinding[] {
  const findings: AvatarFinding[] = [];
  const reported = new Set<string>();
  const accessories = avatar.parts.filter(
    (part) => part.id === "accessory" || part.id.startsWith("accessory."),
  );
  for (const part of accessories) {
    if (!part.parent) {
      findings.push({
        code: "ACCESSORY_DETACHED",
        message: `Accessory "${part.id}" has no declared parent anchor.`,
        partId: part.id,
      });
      reported.add(part.id);
    }
  }

  const maskCache = new Map<string, AvatarPixels>();
  const maskFor = (part: AvatarPart, state: AvatarRenderState) => {
    const primitives = evaluatedPrimitives(avatar, part, state);
    const key = `${part.id}:${JSON.stringify(primitives)}`;
    const cached = maskCache.get(key);
    if (cached) return cached;
    const pixels = isolatedPartPixels(avatar, part.id, state);
    maskCache.set(key, pixels);
    return pixels;
  };

  for (const state of composedStates()) {
    for (const part of accessories) {
      if (reported.has(part.id) || !part.parent) continue;
      const parent = avatar.parts.find(
        (candidate) => candidate.id === part.parent,
      );
      if (!parent) continue;
      if (!masksTouch(maskFor(part, state), maskFor(parent, state))) {
        findings.push({
          code: "ACCESSORY_DETACHED",
          message: `Accessory "${part.id}" has no opaque-pixel contact with parent "${parent.id}" in ${state.pose}/${state.expression}/${state.mouth}, blink=${state.blink}, frame=${state.frame}.`,
          partId: part.id,
        });
        reported.add(part.id);
      }
    }
  }
  return findings;
}

function mapPixels(
  source: AvatarPixels,
  map: (
    pixel: readonly [number, number, number, number],
  ) => readonly [number, number, number, number],
): AvatarPixels {
  const data = new Uint8ClampedArray(source.data.length);
  for (let offset = 0; offset < source.data.length; offset += 4) {
    const pixel = map([
      source.data[offset],
      source.data[offset + 1],
      source.data[offset + 2],
      source.data[offset + 3],
    ]);
    data.set(pixel, offset);
  }
  return { width: source.width, height: source.height, data };
}

function horizontalSheet(frames: AvatarPixels[]): AvatarPixels {
  const width = frames.reduce((total, frame) => total + frame.width, 0);
  const height = frames[0].height;
  const data = new Uint8ClampedArray(width * height * 4);
  let originX = 0;
  for (const frame of frames) {
    for (let y = 0; y < height; y += 1) {
      const start = y * frame.width * 4;
      data.set(
        frame.data.subarray(start, start + frame.width * 4),
        (y * width + originX) * 4,
      );
    }
    originX += frame.width;
  }
  return { width, height, data };
}

function pixelHash(pixels: AvatarPixels): string {
  return createHash("sha256").update(pixels.data).digest("hex");
}

function renderState(overrides: Partial<AvatarRenderState>): AvatarRenderState {
  return { ...NEUTRAL_STATE, ...overrides };
}

function qualityHashes(
  avatar: AvatarPackage,
  neutral: AvatarPixels,
): Record<string, string> {
  // neutral: the native 96x96 RGBA neutral/neutral/A frame, without encoding.
  // silhouette: the same alpha mask with every opaque pixel replaced by opaque black.
  const silhouette = mapPixels(neutral, ([, , , alpha]) =>
    alpha === 0 ? [0, 0, 0, 0] : [0, 0, 0, 255],
  );
  // grayscale: integer Rec.601 luma of neutral RGB, preserving binary alpha.
  const grayscale = mapPixels(neutral, ([red, green, blue, alpha]) => {
    if (alpha === 0) return [0, 0, 0, 0];
    const luma = Math.floor(
      (299 * red + 587 * green + 114 * blue + 500) / 1000,
    );
    return [luma, luma, luma, alpha];
  });
  // backgrounds: neutral source pixels over opaque white and opaque black respectively.
  const background = (value: number) =>
    mapPixels(neutral, ([red, green, blue, alpha]) =>
      alpha === 0 ? [value, value, value, 255] : [red, green, blue, 255],
    );

  // expressionSheet: six 96x96 frames concatenated horizontally in AVATAR_EXPRESSIONS order.
  const expressionSheet = horizontalSheet(
    AVATAR_EXPRESSIONS.map((expression) =>
      renderAvatarPixels(avatar, renderState({ expression })),
    ),
  );
  // mouthSheet: seven 96x96 frames concatenated horizontally in AVATAR_MOUTHS order.
  const mouthSheet = horizontalSheet(
    AVATAR_MOUTHS.map((mouth) =>
      renderAvatarPixels(avatar, renderState({ mouth })),
    ),
  );
  // motionLoop: the sixteen native breathing frames 0..15, concatenated horizontally.
  const motionLoop = horizontalSheet(
    BREATHING_CYCLE.map((_, frame) =>
      renderAvatarPixels(avatar, renderState({ frame })),
    ),
  );

  return {
    neutral: pixelHash(neutral),
    silhouette: pixelHash(silhouette),
    grayscale: pixelHash(grayscale),
    backgroundLight: pixelHash(background(255)),
    backgroundDark: pixelHash(background(0)),
    expressionSheet: pixelHash(expressionSheet),
    mouthSheet: pixelHash(mouthSheet),
    motionLoop: pixelHash(motionLoop),
  };
}

export function validateAvatarPackage(
  avatar: unknown,
  context: { previous?: AvatarPackage; allowedPartIds?: string[] } = {},
): AvatarQualityReport {
  let parsed: AvatarPackage;
  try {
    parsed = parseAvatar(avatar);
  } catch (error) {
    return failed([schemaFinding(avatar, error)]);
  }

  if (context.previous) {
    let previous: AvatarPackage | undefined;
    try {
      previous = parseAvatar(context.previous);
      reviseAvatar(previous, parsed, context.allowedPartIds ?? []);
    } catch (error) {
      if (previous) {
        return failed([revisionFinding(previous, parsed, error)]);
      }
      return failed([
        {
          code: "SCHEMA_INVALID",
          message:
            "Previous avatar package does not satisfy the approved schema.",
        },
      ]);
    }
  }

  const staticFindings = [...alphaFindings(parsed), ...boundsFindings(parsed)];
  if (staticFindings.length > 0) return failed(staticFindings);

  const clipping = clippingFindings(parsed);
  if (clipping.length > 0) return failed(clipping);

  const neutral = renderAvatarPixels(parsed, NEUTRAL_STATE);
  const silhouette = silhouetteStats(neutral);
  if (silhouette.count === 0) {
    return failed([
      {
        code: "SILHOUETTE_EMPTY",
        message: "Neutral avatar render has no opaque silhouette pixels.",
      },
    ]);
  }

  const findings: AvatarFinding[] = [];
  if (silhouette.count < MINIMUM_SILHOUETTE_PIXELS) {
    findings.push({
      code: "SILHOUETTE_INSUFFICIENT",
      message: `Neutral silhouette has ${silhouette.count} opaque pixels; at least ${MINIMUM_SILHOUETTE_PIXELS} (one 8x8 block) are required.`,
    });
  }
  const baselineAnchor = parsed.identity.anchors.baseline;
  if (baselineAnchor && baselineAnchor.y !== parsed.canvas.baseline) {
    findings.push({
      code: "BASELINE_FLOATING",
      message: "Identity baseline anchor does not match the canvas baseline.",
    });
  }
  findings.push(...baselineFindings(parsed), ...accessoryFindings(parsed));
  if (findings.length > 0) return failed(findings);

  return { ok: true, findings: [], hashes: qualityHashes(parsed, neutral) };
}

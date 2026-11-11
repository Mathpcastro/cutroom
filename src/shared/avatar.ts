import { createHash } from "node:crypto";
import { z } from "zod";

export const AVATAR_POSES = [
  "neutral",
  "explaining",
  "pointing",
  "surprised",
  "celebrating",
] as const;
export const AVATAR_EXPRESSIONS = [
  "neutral",
  "happy",
  "thinking",
  "surprised",
  "serious",
  "confident",
] as const;
export const AVATAR_MOUTHS = ["A", "B", "C", "D", "E", "F", "X"] as const;
export const AVATAR_SCHEMA_VERSION = 1;

export type AvatarPose = (typeof AVATAR_POSES)[number];
export type AvatarExpression = (typeof AVATAR_EXPRESSIONS)[number];
export type MouthShape = (typeof AVATAR_MOUTHS)[number];

export interface AvatarPoint {
  x: number;
  y: number;
}

export type AvatarPrimitive =
  | {
      type: "rect";
      x: number;
      y: number;
      width: number;
      height: number;
      color: string;
    }
  | {
      type: "polygon";
      points: AvatarPoint[];
      color: string;
    }
  | {
      type: "run";
      x: number;
      y: number;
      length: number;
      color: string;
    }
  | {
      type: "matrix";
      x: number;
      y: number;
      rows: (string | null)[][];
    };

export interface AvatarPartState {
  dx?: number;
  dy?: number;
  hidden?: boolean;
  primitives?: AvatarPrimitive[];
}

export interface AvatarPart {
  id: string;
  parent?: string;
  zIndex?: number;
  primitives: AvatarPrimitive[];
}

export interface AvatarPackage {
  schemaVersion: 1;
  id: string;
  revision: number;
  canvas: {
    full: 96;
    portrait: 64;
    baseline: number;
  };
  identity: {
    anchors: Record<string, AvatarPoint>;
    inferred: string[];
  };
  artBible: {
    light: "top-left" | "top-right";
    outline: string;
    notes: string[];
  };
  palette: Record<string, string>;
  parts: AvatarPart[];
  poses: Record<AvatarPose, Partial<Record<string, AvatarPartState>>>;
  expressions: Record<
    AvatarExpression,
    Partial<Record<string, AvatarPartState>>
  >;
  mouths: Record<MouthShape, Partial<Record<string, AvatarPartState>>>;
}

const MAX_PARTS = 256;
const MAX_PRIMITIVES_PER_PART = 2048;
const MAX_PALETTE_COLORS = 64;
const MAX_POLYGON_POINTS = 256;
const MAX_MATRIX_SIZE = 96;
const MAX_ANCHORS = 64;
const MAX_CANONICAL_BYTES = 256 * 1024;
const unsafeContent =
  /<script|javascript:|eval\(|Function\(|require\(|import\(|process\.|document\./i;
const token = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z][A-Za-z0-9._-]*$/);
const text = z.string().max(4096);
const coordinate = z.number().int().finite().min(-4096).max(4096);
const dimension = z.number().int().finite().min(0).max(4096);
const point = z.strictObject({ x: coordinate, y: coordinate });
const paletteColor = z.string().regex(/^#[0-9A-Fa-f]{6}(?:[0-9A-Fa-f]{2})?$/);

const matrixRows = z
  .array(
    z
      .array(z.union([token, z.null()]))
      .min(1)
      .max(MAX_MATRIX_SIZE),
  )
  .min(1)
  .max(MAX_MATRIX_SIZE)
  .refine((rows) => rows.every((row) => row.length === rows[0].length), {
    message: "Avatar matrix rows must have equal lengths.",
  });

const primitive = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("rect"),
    x: coordinate,
    y: coordinate,
    width: dimension.positive(),
    height: dimension.positive(),
    color: token,
  }),
  z.strictObject({
    type: z.literal("polygon"),
    points: z.array(point).min(3).max(MAX_POLYGON_POINTS),
    color: token,
  }),
  z.strictObject({
    type: z.literal("run"),
    x: coordinate,
    y: coordinate,
    length: dimension.positive(),
    color: token,
  }),
  z.strictObject({
    type: z.literal("matrix"),
    x: coordinate,
    y: coordinate,
    rows: matrixRows,
  }),
]);

const primitives = z.array(primitive).max(MAX_PRIMITIVES_PER_PART);
const partState = z.strictObject({
  dx: coordinate.optional(),
  dy: coordinate.optional(),
  hidden: z.boolean().optional(),
  primitives: primitives.optional(),
});
const partStates = z
  .record(token, partState)
  .refine((states) => Object.keys(states).length <= MAX_PARTS, {
    message: "Avatar state cannot exceed 256 part overrides.",
  });
const partSchema = z.strictObject({
  id: token,
  parent: token.optional(),
  zIndex: coordinate.optional(),
  primitives,
});

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, child]) => [key, canonicalValue(child)]),
    );
  }
  return value;
}

function canonicalStringify(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

export const avatarPackageSchema = z
  .strictObject({
    schemaVersion: z.literal(AVATAR_SCHEMA_VERSION),
    id: token,
    revision: z.number().int().nonnegative(),
    canvas: z.strictObject({
      full: z.literal(96),
      portrait: z.literal(64),
      baseline: z.number().int().min(0).max(96),
    }),
    identity: z.strictObject({
      anchors: z
        .record(token, point)
        .refine((anchors) => Object.keys(anchors).length <= MAX_ANCHORS, {
          message: "Avatar identity cannot exceed 64 anchors.",
        }),
      inferred: z.array(text).max(64),
    }),
    artBible: z.strictObject({
      light: z.enum(["top-left", "top-right"]),
      outline: token,
      notes: z.array(text).max(256),
    }),
    palette: z
      .record(token, paletteColor)
      .refine((palette) => Object.keys(palette).length <= MAX_PALETTE_COLORS, {
        message: "Avatar palette cannot exceed 64 colors.",
      }),
    parts: z.array(partSchema).min(1).max(MAX_PARTS),
    poses: z.strictObject({
      neutral: partStates,
      explaining: partStates,
      pointing: partStates,
      surprised: partStates,
      celebrating: partStates,
    }),
    expressions: z.strictObject({
      neutral: partStates,
      happy: partStates,
      thinking: partStates,
      surprised: partStates,
      serious: partStates,
      confident: partStates,
    }),
    mouths: z.strictObject({
      A: partStates,
      B: partStates,
      C: partStates,
      D: partStates,
      E: partStates,
      F: partStates,
      X: partStates,
    }),
  })
  .superRefine((avatar, context) => {
    const palette = new Set(Object.keys(avatar.palette));
    const parts = new Map<string, (typeof avatar.parts)[number]>();

    if (!palette.has(avatar.artBible.outline)) {
      context.addIssue({
        code: "custom",
        message: `Art bible outline color "${avatar.artBible.outline}" is outside the palette.`,
        path: ["artBible", "outline"],
      });
    }

    const checkText = (value: unknown, path: (string | number)[] = []) => {
      if (typeof value === "string") {
        if (unsafeContent.test(value)) {
          context.addIssue({
            code: "custom",
            message: "Potentially executable content is not allowed.",
            path,
          });
        }
        return;
      }
      if (Array.isArray(value)) {
        value.forEach((child, index) => checkText(child, [...path, index]));
        return;
      }
      if (value && typeof value === "object") {
        for (const [key, child] of Object.entries(value)) {
          checkText(key, [...path, key]);
          checkText(child, [...path, key]);
        }
      }
    };
    checkText(avatar);

    const checkPrimitives = (
      items: (typeof avatar.parts)[number]["primitives"],
      path: (string | number)[],
    ) => {
      const checkColor = (color: string, colorPath: (string | number)[]) => {
        if (!palette.has(color)) {
          context.addIssue({
            code: "custom",
            message: `Primitive color "${color}" is outside the palette.`,
            path: colorPath,
          });
        }
      };

      items.forEach((item, index) => {
        if (item.type === "matrix") {
          item.rows.forEach((row, rowIndex) => {
            row.forEach((color, columnIndex) => {
              if (color !== null) {
                checkColor(color, [
                  ...path,
                  index,
                  "rows",
                  rowIndex,
                  columnIndex,
                ]);
              }
            });
          });
        } else {
          checkColor(item.color, [...path, index, "color"]);
        }
      });
    };

    avatar.parts.forEach((part, index) => {
      if (parts.has(part.id)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate avatar part ID "${part.id}".`,
          path: ["parts", index, "id"],
        });
      }
      parts.set(part.id, part);
      checkPrimitives(part.primitives, ["parts", index, "primitives"]);
    });

    for (const [index, part] of avatar.parts.entries()) {
      if (part.parent && !parts.has(part.parent)) {
        context.addIssue({
          code: "custom",
          message: `Unknown parent "${part.parent}" in avatar hierarchy.`,
          path: ["parts", index, "parent"],
        });
      }
      const visited = new Set<string>();
      let current: (typeof avatar.parts)[number] | undefined = part;
      while (current) {
        if (visited.has(current.id)) {
          context.addIssue({
            code: "custom",
            message: "Avatar hierarchy contains a cycle.",
            path: ["parts", index, "parent"],
          });
          break;
        }
        visited.add(current.id);
        current = current.parent ? parts.get(current.parent) : undefined;
      }
    }

    const groups = [
      ["poses", avatar.poses],
      ["expressions", avatar.expressions],
      ["mouths", avatar.mouths],
    ] as const;
    for (const [groupName, group] of groups) {
      for (const [stateName, states] of Object.entries(group)) {
        for (const [partId, state] of Object.entries(states)) {
          const statePath = [groupName, stateName, partId];
          if (!parts.has(partId)) {
            context.addIssue({
              code: "custom",
              message: `State references unknown avatar part "${partId}".`,
              path: statePath,
            });
          }
          if (state.primitives) {
            checkPrimitives(state.primitives, [...statePath, "primitives"]);
          }
        }
      }
    }

    if (
      Buffer.byteLength(canonicalStringify(avatar), "utf8") >
      MAX_CANONICAL_BYTES
    ) {
      context.addIssue({
        code: "custom",
        message: "Canonical avatar JSON exceeds the 256 KiB size limit.",
      });
    }
  });

export function parseAvatar(input: unknown): AvatarPackage {
  const json = JSON.stringify(input);
  if (
    json !== undefined &&
    Buffer.byteLength(json, "utf8") > MAX_CANONICAL_BYTES
  ) {
    throw new Error("Avatar JSON exceeds the 256 KiB input limit.");
  }
  return avatarPackageSchema.parse(input) as AvatarPackage;
}

export function canonicalAvatar(input: unknown): string {
  return canonicalStringify(parseAvatar(input));
}

export function avatarHash(input: unknown): string {
  return createHash("sha256")
    .update(canonicalAvatar(input), "utf8")
    .digest("hex");
}

function partRevisionSnapshot(avatar: AvatarPackage, partId: string) {
  return {
    part: avatar.parts.find((part) => part.id === partId),
    poses: Object.fromEntries(
      AVATAR_POSES.map((pose) => [pose, avatar.poses[pose][partId]]),
    ),
    expressions: Object.fromEntries(
      AVATAR_EXPRESSIONS.map((expression) => [
        expression,
        avatar.expressions[expression][partId],
      ]),
    ),
    mouths: Object.fromEntries(
      AVATAR_MOUTHS.map((mouth) => [mouth, avatar.mouths[mouth][partId]]),
    ),
  };
}

export function reviseAvatar(
  current: unknown,
  next: unknown,
  allowedPartIds: Iterable<string>,
): AvatarPackage {
  const before = parseAvatar(current);
  const after = parseAvatar(next);
  const allowed = new Set(allowedPartIds);

  const protectedBefore = {
    id: before.id,
    revision: before.revision,
    canvas: before.canvas,
    identity: before.identity,
    artBible: before.artBible,
    palette: before.palette,
  };
  const protectedAfter = {
    id: after.id,
    revision: after.revision,
    canvas: after.canvas,
    identity: after.identity,
    artBible: after.artBible,
    palette: after.palette,
  };
  if (
    canonicalStringify(protectedBefore) !== canonicalStringify(protectedAfter)
  ) {
    throw new Error(
      "Avatar revision must preserve id, revision, canvas, identity, art bible and palette tokens.",
    );
  }

  const beforeOrder = before.parts
    .filter((part) => !allowed.has(part.id))
    .map((part) => part.id);
  const afterOrder = after.parts
    .filter((part) => !allowed.has(part.id))
    .map((part) => part.id);
  for (
    let index = 0;
    index < Math.max(beforeOrder.length, afterOrder.length);
    index += 1
  ) {
    if (beforeOrder[index] !== afterOrder[index]) {
      const partId = beforeOrder[index] ?? afterOrder[index];
      throw new Error(
        `Part "${partId}" changed relative order outside allowedPartIds.`,
      );
    }
  }

  const partIds = new Set([
    ...before.parts.map((part) => part.id),
    ...after.parts.map((part) => part.id),
  ]);
  for (const partId of partIds) {
    if (allowed.has(partId)) continue;
    const changed =
      canonicalStringify(partRevisionSnapshot(before, partId)) !==
      canonicalStringify(partRevisionSnapshot(after, partId));
    if (changed) {
      throw new Error(
        `Part "${partId}" changed without being listed in allowedPartIds.`,
      );
    }
  }

  return after;
}

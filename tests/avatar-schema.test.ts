import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  AVATAR_EXPRESSIONS,
  AVATAR_MOUTHS,
  AVATAR_POSES,
  AVATAR_SCHEMA_VERSION,
  avatarHash,
  canonicalAvatar,
  parseAvatar,
  reviseAvatar,
  type AvatarPackage,
} from "../src/shared/avatar";
import { avatarFixture } from "./fixtures/avatar-fixture";

const PART_IDS = [
  "body",
  "head",
  "hair.back",
  "hair.front",
  "eyes",
  "pupils",
  "brows",
  "lids",
  "nose",
  "mouth",
  "ears",
  "arm.left",
  "arm.right",
  "forearm.left",
  "forearm.right",
  "hand.left",
  "hand.right",
  "accessory",
];

function reverseObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseObjectKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .reverse()
        .map(([key, child]) => [key, reverseObjectKeys(child)]),
    );
  }
  return value;
}

function part(avatar: AvatarPackage, id: string) {
  const result = avatar.parts.find((candidate) => candidate.id === id);
  if (!result) throw new Error(`Missing fixture part ${id}`);
  return result;
}

describe("declarative avatar package", () => {
  it("accepts the complete fixture and exposes every vocabulary value", () => {
    const avatar = avatarFixture();
    const parsed = parseAvatar(avatar);

    expect(AVATAR_SCHEMA_VERSION).toBe(1);
    expect(AVATAR_POSES).toEqual([
      "neutral",
      "explaining",
      "pointing",
      "surprised",
      "celebrating",
    ]);
    expect(AVATAR_EXPRESSIONS).toEqual([
      "neutral",
      "happy",
      "thinking",
      "surprised",
      "serious",
      "confident",
    ]);
    expect(AVATAR_MOUTHS).toEqual(["A", "B", "C", "D", "E", "F", "X"]);
    expect(parsed.canvas).toEqual({ full: 96, portrait: 64, baseline: 90 });
    expect(parsed.parts.map(({ id }) => id)).toEqual(PART_IDS);
    expect(Object.keys(parsed.poses)).toEqual(AVATAR_POSES);
    expect(Object.keys(parsed.expressions)).toEqual(AVATAR_EXPRESSIONS);
    expect(Object.keys(parsed.mouths)).toEqual(AVATAR_MOUTHS);
    expect(Object.keys(parsed.palette)).toHaveLength(16);
    expect(
      new Set(
        parsed.parts.flatMap((item) =>
          item.primitives.map((primitive) => primitive.type),
        ),
      ),
    ).toEqual(new Set(["rect", "polygon", "run", "matrix"]));
  });

  it("returns an independent structured clone from the reusable fixture", () => {
    const first = avatarFixture();
    part(first, "body").primitives[0] = {
      type: "rect",
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      color: "accent",
    };
    first.palette.outline = "#000000";

    const second = avatarFixture();
    expect(part(second, "body").primitives[0]).toMatchObject({ x: 31, y: 43 });
    expect(second.palette.outline).toBe("#19152a");
  });

  it("canonicalizes recursively and produces stable SHA-256 hashes", () => {
    const avatar = avatarFixture();
    const reordered = reverseObjectKeys(avatar);
    const canonical = canonicalAvatar(avatar);

    expect(canonical).toBe(canonicalAvatar(reordered));
    expect(avatarHash(avatar)).toBe(avatarHash(reordered));
    expect(avatarHash(avatar)).toBe(
      createHash("sha256").update(canonical, "utf8").digest("hex"),
    );
    expect(canonical.indexOf('"artBible"')).toBeLessThan(
      canonical.indexOf('"canvas"'),
    );
    expect(canonical.indexOf('"eye.left"')).toBeLessThan(
      canonical.indexOf('"eye.right"'),
    );

    const changed = avatarFixture();
    (part(changed, "body").primitives[0] as { x: number }).x += 1;
    expect(avatarHash(changed)).not.toBe(avatarHash(avatar));
  });

  it.each([
    [
      "rect",
      (avatar: AvatarPackage) => {
        (part(avatar, "body").primitives[0] as { x: number }).x = 31.5;
      },
    ],
    [
      "polygon",
      (avatar: AvatarPackage) => {
        (
          part(avatar, "nose").primitives[0] as { points: { x: number }[] }
        ).points[0].x = 47.25;
      },
    ],
    [
      "run",
      (avatar: AvatarPackage) => {
        (part(avatar, "pupils").primitives[0] as { length: number }).length =
          2.5;
      },
    ],
    [
      "matrix",
      (avatar: AvatarPackage) => {
        (part(avatar, "hair.front").primitives[0] as { y: number }).y = 12.5;
      },
    ],
  ])("rejects fractional %s geometry", (_kind, mutate) => {
    const avatar = avatarFixture();
    mutate(avatar);
    expect(() => parseAvatar(avatar)).toThrow();
  });

  it("rejects hierarchy cycles and unknown parents", () => {
    const cycle = avatarFixture();
    part(cycle, "body").parent = "hand.right";
    expect(() => parseAvatar(cycle)).toThrow(/cycle|hierarchy/i);

    const orphan = avatarFixture();
    part(orphan, "head").parent = "missing";
    expect(() => parseAvatar(orphan)).toThrow(/parent|hierarchy/i);
  });

  it("rejects primitive, matrix and art bible colors outside the semantic palette", () => {
    const primitive = avatarFixture();
    (part(primitive, "body").primitives[0] as { color: string }).color =
      "not-in-palette";
    expect(() => parseAvatar(primitive)).toThrow(/palette|color/i);

    const matrix = avatarFixture();
    (
      part(matrix, "hair.front").primitives[0] as { rows: (string | null)[][] }
    ).rows[0][0] = "not-in-palette";
    expect(() => parseAvatar(matrix)).toThrow(/palette|color/i);

    const outline = avatarFixture();
    outline.artBible.outline = "not-in-palette";
    expect(() => parseAvatar(outline)).toThrow(/palette|color/i);
  });

  it.each([
    "<script>alert(1)</script>",
    "javascript:alert(1)",
    "eval(payload)",
    "Function(payload)",
    "require(payload)",
    "import(payload)",
    "process.exit",
    "document.cookie",
    "JaVaScRiPt:alert(1)",
  ])("rejects potentially executable model text: %s", (text) => {
    const avatar = avatarFixture();
    avatar.artBible.notes = [text];
    expect(() => parseAvatar(avatar)).toThrow(/executable|unsafe|content/i);
  });

  it("rejects unknown fields and unsupported geometry", () => {
    const unknown = avatarFixture() as AvatarPackage & { unexpected?: boolean };
    unknown.unexpected = true;
    expect(() => parseAvatar(unknown)).toThrow();

    const geometry = avatarFixture();
    part(geometry, "body").primitives[0] = {
      type: "circle",
      x: 1,
      y: 1,
      radius: 2,
      color: "accent",
    } as unknown as AvatarPackage["parts"][number]["primitives"][number];
    expect(() => parseAvatar(geometry)).toThrow();
  });

  it("enforces part, primitive, palette and canonical JSON limits", () => {
    const parts = avatarFixture();
    parts.parts.push(
      ...Array.from({ length: 239 }, (_, index) => ({
        ...structuredClone(part(parts, "body")),
        id: `extra-${index}`,
        parent: "body",
      })),
    );
    expect(parts.parts).toHaveLength(257);
    expect(() => parseAvatar(parts)).toThrow();

    const primitives = avatarFixture();
    part(primitives, "body").primitives = Array.from({ length: 2049 }, () =>
      structuredClone(part(primitives, "body").primitives[0]),
    );
    expect(() => parseAvatar(primitives)).toThrow();

    const palette = avatarFixture();
    for (let index = 0; index < 49; index += 1)
      palette.palette[`extra.${index}`] = "#123456";
    expect(Object.keys(palette.palette)).toHaveLength(65);
    expect(() => parseAvatar(palette)).toThrow();

    const canonicalSize = avatarFixture();
    part(canonicalSize, "body").primitives = Array.from(
      { length: 2048 },
      () => ({
        type: "polygon" as const,
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 2, y: 0 },
          { x: 2, y: 1 },
          { x: 1, y: 1 },
          { x: 0, y: 1 },
        ],
        color: "outline",
      }),
    );
    expect(
      Buffer.byteLength(JSON.stringify(canonicalSize), "utf8"),
    ).toBeGreaterThan(256 * 1024);
    expect(() => parseAvatar(canonicalSize)).toThrow(/256|size|json/i);
  });
});

describe("part-owned avatar revision", () => {
  it("accepts base geometry and pose changes for an allowed part", () => {
    const current = avatarFixture();
    const next = avatarFixture();
    (part(next, "head").primitives[0] as { x: number }).x = 28;
    next.poses.celebrating.head = { dx: 1, dy: -2 };
    next.expressions.confident.head = { dx: 2 };

    const revised = reviseAvatar(current, next, ["head"]);
    expect(revised).toEqual(next);
    expect(revised).not.toBe(current);
    expect((part(current, "head").primitives[0] as { x: number }).x).toBe(29);
  });

  it("rejects base and pose changes outside allowedPartIds", () => {
    const geometry = avatarFixture();
    (part(geometry, "head").primitives[0] as { x: number }).x = 28;
    expect(() => reviseAvatar(avatarFixture(), geometry, ["arm.left"])).toThrow(
      /head|allowed/i,
    );

    const pose = avatarFixture();
    pose.poses.pointing.head = { dx: 1 };
    expect(() => reviseAvatar(avatarFixture(), pose, ["arm.right"])).toThrow(
      /head|allowed/i,
    );

    const expression = avatarFixture();
    expression.mouths.A.mouth = { hidden: true };
    expect(() => reviseAvatar(avatarFixture(), expression, ["head"])).toThrow(
      /mouth|allowed/i,
    );
  });

  it("rejects visual reordering when the moved part is not authorized", () => {
    const next = avatarFixture();
    const headIndex = next.parts.findIndex(({ id }) => id === "head");
    const [head] = next.parts.splice(headIndex, 1);
    next.parts.push(head);

    expect(() => reviseAvatar(avatarFixture(), next, ["body"])).toThrow(
      /head|allowed/i,
    );
  });

  it.each([
    [
      "id",
      (avatar: AvatarPackage) => {
        avatar.id = "different";
      },
    ],
    [
      "revision",
      (avatar: AvatarPackage) => {
        avatar.revision = 2;
      },
    ],
    [
      "canvas",
      (avatar: AvatarPackage) => {
        avatar.canvas.baseline = 89;
      },
    ],
    [
      "identity anchors",
      (avatar: AvatarPackage) => {
        avatar.identity.anchors.head.x = 47;
      },
    ],
    [
      "palette tokens",
      (avatar: AvatarPackage) => {
        avatar.palette.outline = "#000000";
      },
    ],
  ])("preserves protected %s", (_field, mutate) => {
    const next = avatarFixture();
    mutate(next);
    expect(() => reviseAvatar(avatarFixture(), next, PART_IDS)).toThrow(
      /preserv|protected|revision/i,
    );
  });
});

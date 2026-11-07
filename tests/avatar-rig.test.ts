import { describe, expect, it } from "vitest";
import {
  AVATAR_EXPRESSIONS,
  AVATAR_MOUTHS,
  AVATAR_POSES,
  type AvatarPackage,
  type AvatarPartState,
  type AvatarPrimitive,
} from "../src/shared/avatar";
import {
  avatarPixelHash,
  renderAvatarPixels,
  type AvatarPixels,
  type AvatarRenderState,
} from "../resources/avatar-engine/avatar-engine.js";
import { avatarFixture } from "./fixtures/avatar-fixture";

const neutralState: AvatarRenderState = {
  pose: "neutral",
  expression: "neutral",
  mouth: "A",
  blink: 0,
  frame: 0,
};

function state(overrides: Partial<AvatarRenderState>): AvatarRenderState {
  return { ...neutralState, ...overrides };
}

function isolatedAvatar(partId: string): AvatarPackage {
  const avatar = avatarFixture();
  const part = avatar.parts.find((candidate) => candidate.id === partId);
  if (!part) throw new Error(`Unknown fixture part: ${partId}`);
  avatar.parts = [structuredClone(part)];
  return avatar;
}

function withoutOverrides(avatar: AvatarPackage): AvatarPackage {
  for (const pose of AVATAR_POSES) avatar.poses[pose] = {};
  for (const expression of AVATAR_EXPRESSIONS) {
    avatar.expressions[expression] = {};
  }
  for (const mouth of AVATAR_MOUTHS) avatar.mouths[mouth] = {};
  return avatar;
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

function expectPartEvaluation(
  partId: string,
  renderState: AvatarRenderState,
  overrides: (AvatarPartState | undefined)[],
): void {
  const actualAvatar = isolatedAvatar(partId);
  const expectedAvatar = withoutOverrides(isolatedAvatar(partId));
  const expectedPart = expectedAvatar.parts[0];
  let primitives = structuredClone(expectedPart.primitives);
  let hidden = false;
  let dx = 0;
  let dy = 0;

  for (const override of overrides) {
    if (!override) continue;
    if (override.primitives) primitives = structuredClone(override.primitives);
    if (override.hidden !== undefined) hidden = override.hidden;
    dx += override.dx ?? 0;
    dy += override.dy ?? 0;
  }
  expectedPart.primitives = primitives.map((primitive) =>
    translatePrimitive(primitive, dx, dy),
  );
  if (hidden) expectedAvatar.parts = [];

  const actual = renderAvatarPixels(actualAvatar, renderState);
  const expected = renderAvatarPixels(expectedAvatar, neutralState);
  expect(
    Buffer.from(actual.data).equals(Buffer.from(expected.data)),
    `${partId} in ${renderState.pose}/${renderState.expression}/${renderState.mouth}`,
  ).toBe(true);
}

function samePixels(left: AvatarPixels, right: AvatarPixels): boolean {
  return Buffer.from(left.data).equals(Buffer.from(right.data));
}

function changedCoordinates(
  baseline: AvatarPixels,
  current: AvatarPixels,
): { x: number; y: number }[] {
  const changed: { x: number; y: number }[] = [];
  for (let y = 0; y < baseline.height; y += 1) {
    for (let x = 0; x < baseline.width; x += 1) {
      const offset = (y * baseline.width + x) * 4;
      if (
        !Buffer.from(baseline.data.subarray(offset, offset + 4)).equals(
          Buffer.from(current.data.subarray(offset, offset + 4)),
        )
      ) {
        changed.push({ x, y });
      }
    }
  }
  return changed;
}

function pixel(pixels: AvatarPixels, x: number, y: number): number[] {
  const offset = (y * pixels.width + x) * 4;
  return Array.from(pixels.data.subarray(offset, offset + 4));
}

function rgba(hex: string): number[] {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
    255,
  ];
}

function measureBreathingOffset(partId: string, frame: number): number {
  const avatar = avatarFixture();
  const actual = renderAvatarPixels(isolatedAvatar(partId), state({ frame }));
  const matches: number[] = [];

  for (const dy of [-1, 0, 1]) {
    const expectedAvatar = withoutOverrides(isolatedAvatar(partId));
    const expectedPart = expectedAvatar.parts[0];
    const mouth = avatar.mouths.A[partId];
    if (mouth?.primitives) {
      expectedPart.primitives = structuredClone(mouth.primitives);
    }
    expectedPart.primitives = expectedPart.primitives.map((primitive) =>
      translatePrimitive(primitive, 0, dy),
    );
    if (mouth?.hidden) expectedAvatar.parts = [];
    if (samePixels(actual, renderAvatarPixels(expectedAvatar, neutralState))) {
      matches.push(dy);
    }
  }

  expect(
    matches,
    `${partId} must have one exact dy at frame ${frame}`,
  ).toHaveLength(1);
  return matches[0];
}

const breathingExpectations = [
  { frame: 0, head: 0, hair: 0, accessory: 0 },
  { frame: 1, head: 0, hair: 0, accessory: 0 },
  { frame: 2, head: 1, hair: 0, accessory: 0 },
  { frame: 3, head: 1, hair: 0, accessory: 0 },
  { frame: 4, head: 1, hair: 1, accessory: 0 },
  { frame: 5, head: 1, hair: 1, accessory: 0 },
  { frame: 6, head: 0, hair: 1, accessory: 1 },
  { frame: 8, head: 0, hair: 0, accessory: 1 },
  { frame: 10, head: -1, hair: 0, accessory: 0 },
  { frame: 12, head: -1, hair: -1, accessory: 0 },
  { frame: 14, head: 0, hair: -1, accessory: -1 },
  { frame: 16, head: 0, hair: 0, accessory: -1 },
  { frame: 18, head: 1, hair: 0, accessory: 0 },
  { frame: 20, head: 1, hair: 1, accessory: 0 },
] as const;

describe("avatar rig evaluation", () => {
  describe.each(AVATAR_POSES)("pose %s", (pose) => {
    it("applies every part override and preserves all other base geometry", () => {
      const avatar = avatarFixture();
      for (const part of avatar.parts) {
        expectPartEvaluation(part.id, state({ pose }), [
          avatar.poses[pose][part.id],
          avatar.expressions.neutral[part.id],
          avatar.mouths.A[part.id],
        ]);
      }
    });
  });

  describe.each(AVATAR_EXPRESSIONS)("expression %s", (expression) => {
    it("applies every part override and preserves all other base geometry", () => {
      const avatar = avatarFixture();
      for (const part of avatar.parts) {
        expectPartEvaluation(part.id, state({ expression }), [
          avatar.poses.neutral[part.id],
          avatar.expressions[expression][part.id],
          avatar.mouths.A[part.id],
        ]);
      }
    });
  });

  it.each(AVATAR_MOUTHS)(
    "replaces the mouth with shape %s without voice data",
    (mouth) => {
      const avatar = avatarFixture();
      for (const part of avatar.parts) {
        expectPartEvaluation(part.id, state({ mouth }), [
          avatar.poses.neutral[part.id],
          avatar.expressions.neutral[part.id],
          avatar.mouths[mouth][part.id],
        ]);
      }
    },
  );

  it("evaluates pose, expression and mouth in that order before joint offsets", () => {
    const avatar = avatarFixture();
    avatar.poses.neutral.mouth = {
      dx: 2,
      dy: 1,
      primitives: [{ type: "run", x: 1, y: 1, length: 1, color: "eye" }],
    };
    avatar.expressions.happy.mouth = {
      dx: 3,
      primitives: [{ type: "run", x: 2, y: 2, length: 2, color: "tongue" }],
    };
    avatar.mouths.C.mouth = {
      dx: -1,
      dy: 2,
      primitives: [{ type: "run", x: 3, y: 3, length: 3, color: "mouth" }],
    };

    const actualAvatar = isolatedAvatar("mouth");
    actualAvatar.poses.neutral.mouth = avatar.poses.neutral.mouth;
    actualAvatar.expressions.happy.mouth = avatar.expressions.happy.mouth;
    actualAvatar.mouths.C.mouth = avatar.mouths.C.mouth;
    const expectedAvatar = withoutOverrides(isolatedAvatar("mouth"));
    expectedAvatar.parts[0].primitives = [
      { type: "run", x: 7, y: 6, length: 3, color: "mouth" },
    ];

    const actual = renderAvatarPixels(
      actualAvatar,
      state({ expression: "happy", mouth: "C" }),
    );
    const expected = renderAvatarPixels(expectedAvatar, neutralState);
    expect(samePixels(actual, expected)).toBe(true);
  });

  it("clamps blink and quantizes it to open, half-closed and closed states", () => {
    const avatar = avatarFixture();
    const open = renderAvatarPixels(avatar, state({ blink: 0 }));
    const half = renderAvatarPixels(avatar, state({ blink: 0.5 }));
    const closed = renderAvatarPixels(avatar, state({ blink: 1 }));

    for (const blink of [-10, 0, 0.24]) {
      expect(
        samePixels(renderAvatarPixels(avatar, state({ blink })), open),
      ).toBe(true);
    }
    for (const blink of [0.25, 0.5, 0.74]) {
      expect(
        samePixels(renderAvatarPixels(avatar, state({ blink })), half),
      ).toBe(true);
    }
    for (const blink of [0.75, 1, 10]) {
      expect(
        samePixels(renderAvatarPixels(avatar, state({ blink })), closed),
      ).toBe(true);
    }
    expect(samePixels(open, half)).toBe(false);
    expect(samePixels(open, closed)).toBe(false);
    expect(samePixels(half, closed)).toBe(false);
  });

  it.each([0.5, 1])(
    "changes only eyes, pupils and lids at blink %s without moving the baseline",
    (blink) => {
      const avatar = avatarFixture();
      const open = renderAvatarPixels(avatar, state({ blink: 0 }));
      const blinking = renderAvatarPixels(avatar, state({ blink }));
      const changed = changedCoordinates(open, blinking);

      expect(changed.length).toBeGreaterThan(0);
      for (const { x, y } of changed) {
        expect(x).toBeGreaterThanOrEqual(36);
        expect(x).toBeLessThan(60);
        expect(y).toBeGreaterThanOrEqual(24);
        expect(y).toBeLessThan(30);
      }
    },
  );

  it("uses exact per-part breathing offsets and really moves head but not body", () => {
    const avatar = avatarFixture();
    const observed = new Map<string, number>();

    for (const expectation of breathingExpectations) {
      for (const part of avatar.parts) {
        const expected =
          part.id === "body"
            ? 0
            : part.id.startsWith("hair.")
              ? expectation.hair
              : part.id === "accessory"
                ? expectation.accessory
                : expectation.head;
        const actual = measureBreathingOffset(part.id, expectation.frame);
        observed.set(`${part.id}:${expectation.frame}`, actual);
        expect(actual, `${part.id} at frame ${expectation.frame}`).toBe(
          expected,
        );
      }
    }

    const headOffsets = breathingExpectations.map(({ frame }) =>
      observed.get(`head:${frame}`),
    );
    expect(headOffsets).toContain(1);
    expect(headOffsets).toContain(-1);
    expect(
      breathingExpectations.map(({ frame }) => observed.get(`body:${frame}`)),
    ).toEqual(breathingExpectations.map(() => 0));
  });

  it("delays both hair parts by two frames and accessory by four at exact boundaries", () => {
    for (const { frame } of breathingExpectations) {
      const headForHair = measureBreathingOffset(
        "head",
        Math.max(0, frame - 2),
      );
      const headForAccessory = measureBreathingOffset(
        "head",
        Math.max(0, frame - 4),
      );
      expect(measureBreathingOffset("hair.back", frame)).toBe(headForHair);
      expect(measureBreathingOffset("hair.front", frame)).toBe(headForHair);
      expect(measureBreathingOffset("accessory", frame)).toBe(headForAccessory);
    }

    for (const partId of ["hair.back", "hair.front"]) {
      expect(measureBreathingOffset(partId, 3)).toBe(
        measureBreathingOffset("head", 1),
      );
      expect(measureBreathingOffset(partId, 4)).toBe(
        measureBreathingOffset("head", 2),
      );
    }
    expect(measureBreathingOffset("accessory", 5)).toBe(
      measureBreathingOffset("head", 1),
    );
    expect(measureBreathingOffset("accessory", 6)).toBe(
      measureBreathingOffset("head", 2),
    );
  });

  it("animates breathing and delayed hair/accessory motion deterministically", () => {
    const avatar = avatarFixture();
    const hashes = new Set<string>();
    for (let frame = 0; frame < 32; frame += 1) {
      const first = renderAvatarPixels(avatar, state({ frame }));
      const repeated = renderAvatarPixels(avatar, state({ frame }));
      expect(samePixels(first, repeated)).toBe(true);
      hashes.add(Buffer.from(first.data).toString("base64"));
    }
    expect(hashes.size).toBeGreaterThan(1);

    for (const partId of ["hair.back", "hair.front", "accessory"]) {
      const partAvatar = isolatedAvatar(partId);
      for (const frame of [3, 4, 7, 11, 16, 23]) {
        const first = renderAvatarPixels(partAvatar, state({ frame }));
        const repeated = renderAvatarPixels(partAvatar, state({ frame }));
        expect(samePixels(first, repeated)).toBe(true);
      }
    }
  });

  it("clips composed pose, expression, mouth and blink geometry in full and portrait", () => {
    const avatar = avatarFixture();
    avatar.parts = [
      {
        id: "body",
        zIndex: 0,
        primitives: [
          { type: "rect", x: 61, y: 61, width: 5, height: 5, color: "shirt" },
        ],
      },
      {
        id: "mouth",
        zIndex: 1,
        primitives: [{ type: "run", x: 0, y: 0, length: 1, color: "mouth" }],
      },
      {
        id: "eyes",
        zIndex: 2,
        primitives: [
          { type: "rect", x: 0, y: 0, width: 4, height: 5, color: "eye" },
        ],
      },
      {
        id: "pupils",
        zIndex: 3,
        primitives: [{ type: "run", x: 1, y: 4, length: 2, color: "pupil" }],
      },
      {
        id: "lids",
        zIndex: 4,
        primitives: [
          { type: "run", x: 0, y: 0, length: 4, color: "skin.shadow" },
        ],
      },
    ];
    avatar.poses.pointing = {
      body: { dx: 1 },
      eyes: { dx: -1, dy: -1 },
      pupils: { dx: -1, dy: -1 },
      lids: { dx: -1, dy: -1 },
    };
    avatar.expressions.serious = {
      body: { dx: 1, dy: 1 },
      eyes: { dy: 1 },
      pupils: { dy: 1 },
      lids: { dy: 1 },
    };
    avatar.mouths.F = {
      mouth: {
        dx: 1,
        dy: 1,
        primitives: [
          { type: "rect", x: 62, y: 0, width: 3, height: 2, color: "mouth" },
        ],
      },
    };
    const renderState = state({
      pose: "pointing",
      expression: "serious",
      mouth: "F",
      blink: 0.5,
    });

    const full = renderAvatarPixels(avatar, renderState, "full");
    const fullRepeated = renderAvatarPixels(avatar, renderState, "full");
    const portrait = renderAvatarPixels(avatar, renderState, "portrait");
    const portraitRepeated = renderAvatarPixels(
      avatar,
      renderState,
      "portrait",
    );

    expect(full.data).toHaveLength(96 * 96 * 4);
    expect(portrait.data).toHaveLength(64 * 64 * 4);
    expect(samePixels(full, fullRepeated)).toBe(true);
    expect(samePixels(portrait, portraitRepeated)).toBe(true);

    for (const pixels of [full, portrait]) {
      expect(pixel(pixels, 0, 1)).toEqual(rgba(avatar.palette.eye));
      expect(pixel(pixels, 0, 2)).toEqual(rgba(avatar.palette["skin.shadow"]));
      expect(pixel(pixels, 0, 3)).toEqual(rgba(avatar.palette.eye));
      expect(pixel(pixels, 3, 1)).toEqual([0, 0, 0, 0]);
      expect(pixel(pixels, 0, 4)).toEqual([0, 0, 0, 0]);
      expect(pixel(pixels, 63, 1)).toEqual(rgba(avatar.palette.mouth));
      expect(pixel(pixels, 63, 62)).toEqual(rgba(avatar.palette.shirt));
    }
    expect(pixel(full, 65, 1)).toEqual(rgba(avatar.palette.mouth));
    expect(pixel(full, 67, 66)).toEqual(rgba(avatar.palette.shirt));
    expect(pixel(portrait, 62, 1)).toEqual([0, 0, 0, 0]);
    expect(pixel(portrait, 63, 63)).toEqual(rgba(avatar.palette.shirt));

    const painted = (pixels: AvatarPixels) => {
      let count = 0;
      for (let offset = 3; offset < pixels.data.length; offset += 4) {
        if (pixels.data[offset] === 255) count += 1;
      }
      return count;
    };
    expect(painted(full)).toBe(40);
    expect(painted(portrait)).toBe(13);
  });

  it("returns identical hashes for repeated states without mutating the package", async () => {
    const avatar = avatarFixture();
    const before = structuredClone(avatar);
    const renderState = state({
      pose: "celebrating",
      expression: "confident",
      mouth: "F",
      blink: 0.5,
      frame: 23,
    });
    const first = await avatarPixelHash(avatar, renderState);
    const second = await avatarPixelHash(avatar, { ...renderState });

    expect(second.hash).toBe(first.hash);
    expect(samePixels(first, second)).toBe(true);
    expect(avatar).toEqual(before);
  });
});

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

  it("keeps frame breathing within one integer pixel and preserves the baseline", () => {
    const avatar = avatarFixture();
    for (const part of avatar.parts) {
      const partAvatar = isolatedAvatar(part.id);
      const baseline = renderAvatarPixels(partAvatar, neutralState);
      for (let frame = 1; frame < 32; frame += 1) {
        const current = renderAvatarPixels(partAvatar, state({ frame }));
        const shifts: string[] = [];
        for (let dx = -1; dx <= 1; dx += 1) {
          for (let dy = -1; dy <= 1; dy += 1) {
            const expectedAvatar = withoutOverrides(isolatedAvatar(part.id));
            const expectedPart = expectedAvatar.parts[0];
            const mouth = avatar.mouths.A[part.id];
            if (mouth?.primitives) {
              expectedPart.primitives = structuredClone(mouth.primitives);
            }
            expectedPart.primitives = expectedPart.primitives.map((primitive) =>
              translatePrimitive(primitive, dx, dy),
            );
            if (mouth?.hidden) expectedAvatar.parts = [];
            if (
              samePixels(
                current,
                renderAvatarPixels(expectedAvatar, neutralState),
              )
            ) {
              shifts.push(`${dx},${dy}`);
            }
          }
        }
        expect(shifts.length, `${part.id} at frame ${frame}`).toBeGreaterThan(
          0,
        );
      }
    }

    const body = isolatedAvatar("body");
    const baseline = renderAvatarPixels(body, neutralState);
    for (let frame = 1; frame < 32; frame += 1) {
      expect(
        samePixels(renderAvatarPixels(body, state({ frame })), baseline),
      ).toBe(true);
    }
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

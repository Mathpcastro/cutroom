import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  AVATAR_EXPRESSIONS,
  AVATAR_MOUTHS,
  AVATAR_POSES,
  type AvatarPackage,
  type AvatarPrimitive,
} from "../src/shared/avatar";
import { validateAvatarPackage } from "../src/shared/avatar-quality";
import { renderAvatarPixels } from "../resources/avatar-engine/avatar-engine.js";
import { avatarFixture } from "./fixtures/avatar-fixture";

const neutralState = {
  pose: "neutral",
  expression: "neutral",
  mouth: "A",
  blink: 0,
  frame: 0,
} as const;

function part(avatar: AvatarPackage, id: string) {
  const result = avatar.parts.find((candidate) => candidate.id === id);
  if (!result) throw new Error(`Missing fixture part: ${id}`);
  return result;
}

function firstRect(avatar: AvatarPackage, id: string) {
  const primitive = part(avatar, id).primitives[0];
  if (primitive.type !== "rect") throw new Error(`Expected rect in ${id}`);
  return primitive;
}

function clearOverrides(avatar: AvatarPackage): void {
  for (const pose of AVATAR_POSES) avatar.poses[pose] = {};
  for (const expression of AVATAR_EXPRESSIONS) {
    avatar.expressions[expression] = {};
  }
  for (const mouth of AVATAR_MOUTHS) avatar.mouths[mouth] = {};
}

function translateX(primitive: AvatarPrimitive, dx: number): void {
  if (primitive.type === "polygon") {
    for (const point of primitive.points) point.x += dx;
  } else {
    primitive.x += dx;
  }
}

function expectFinding(
  avatar: unknown,
  code: string,
  context?: Parameters<typeof validateAvatarPackage>[1],
) {
  const report = validateAvatarPackage(avatar, context);
  expect(report.ok).toBe(false);
  expect(report.findings.map((finding) => finding.code)).toContain(code);
  return report;
}

describe("deterministic avatar quality gates", () => {
  it("accepts the valid fixture without findings", () => {
    const report = validateAvatarPackage(avatarFixture());

    expect(report.ok).toBe(true);
    expect(report.findings).toEqual([]);
  });

  it("hashes native RGBA sheets with distinct deterministic content", () => {
    const avatar = avatarFixture();
    const report = validateAvatarPackage(avatar);
    const neutral = renderAvatarPixels(avatar, neutralState);
    const expectedNeutral = createHash("sha256")
      .update(neutral.data)
      .digest("hex");

    expect(Object.keys(report.hashes)).toEqual([
      "neutral",
      "silhouette",
      "grayscale",
      "backgroundLight",
      "backgroundDark",
      "expressionSheet",
      "mouthSheet",
      "motionLoop",
    ]);
    expect(report.hashes.neutral).toBe(expectedNeutral);
    expect(new Set(Object.values(report.hashes)).size).toBe(8);
    expect(validateAvatarPackage(avatar).hashes).toEqual(report.hashes);
  });

  it("rejects non-integer geometry as an invalid schema", () => {
    const avatar = avatarFixture();
    firstRect(avatar, "body").x = 31.5;

    expectFinding(avatar, "SCHEMA_INVALID");
  });

  it("rejects a primitive color outside the palette", () => {
    const avatar = avatarFixture();
    firstRect(avatar, "body").color = "missing";

    const report = expectFinding(avatar, "PALETTE_COLOR_UNKNOWN");
    expect(
      report.findings.find(
        (finding) => finding.code === "PALETTE_COLOR_UNKNOWN",
      )?.partId,
    ).toBe("body");
  });

  it("rejects partial alpha in palette pixels", () => {
    const avatar = avatarFixture();
    avatar.palette.skin = "#f2b28c80";

    expectFinding(avatar, "ALPHA_PARTIAL");
  });

  it("rejects a part outside the full-canvas bounds", () => {
    const avatar = avatarFixture();
    const body = firstRect(avatar, "body");
    body.x = 95;
    body.width = 2;

    expectFinding(avatar, "OUT_OF_BOUNDS");
  });

  it("rejects visible clipping introduced by a pose", () => {
    const avatar = avatarFixture();
    avatar.poses.celebrating.head = { dx: 90 };

    expectFinding(avatar, "VISUAL_CLIPPING");
  });

  it("rejects a hierarchy cycle with a stable code", () => {
    const avatar = avatarFixture();
    part(avatar, "body").parent = "hand.right";

    expectFinding(avatar, "HIERARCHY_INVALID");
  });

  it("rejects an absent mandatory pose state", () => {
    const avatar = avatarFixture();
    delete (avatar.poses as Record<string, unknown>).pointing;

    expectFinding(avatar, "STATE_MISSING");
  });

  it("rejects a silhouette floating above the declared baseline", () => {
    const avatar = avatarFixture();
    avatar.poses.neutral.body = { dy: -1 };

    expectFinding(avatar, "BASELINE_FLOATING");
  });

  it("rejects an empty neutral silhouette", () => {
    const avatar = avatarFixture();
    clearOverrides(avatar);
    for (const item of avatar.parts) item.primitives = [];

    expectFinding(avatar, "SILHOUETTE_EMPTY");
  });

  it("rejects 16 opaque pixels below the justified 8 by 8 minimum", () => {
    const avatar = avatarFixture();
    clearOverrides(avatar);
    for (const item of avatar.parts) item.primitives = [];
    part(avatar, "body").primitives = [
      { type: "rect", x: 46, y: 86, width: 4, height: 4, color: "shirt" },
    ];

    expectFinding(avatar, "SILHOUETTE_INSUFFICIENT");
  });

  it("rejects an accessory detached from its declared parent", () => {
    const avatar = avatarFixture();
    for (const primitive of part(avatar, "accessory").primitives) {
      translateX(primitive, 30);
    }

    expectFinding(avatar, "ACCESSORY_DETACHED");
  });

  it("rejects identity changes against the previous package", () => {
    const previous = avatarFixture();
    const avatar = avatarFixture();
    avatar.identity.anchors.head.x += 1;

    const report = expectFinding(avatar, "IDENTITY_CHANGED", {
      previous,
      allowedPartIds: [],
    });
    expect(report.hashes).toEqual({});
  });

  it("rejects changes to a part omitted from allowedPartIds", () => {
    const previous = avatarFixture();
    const avatar = avatarFixture();
    firstRect(avatar, "body").x += 1;

    const report = expectFinding(avatar, "UNAUTHORIZED_PART_CHANGE", {
      previous,
      allowedPartIds: ["head"],
    });
    expect(
      report.findings.find(
        (finding) => finding.code === "UNAUTHORIZED_PART_CHANGE",
      )?.partId,
    ).toBe("body");
  });
});

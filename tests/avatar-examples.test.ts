import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AVATAR_EXPRESSIONS,
  AVATAR_MOUTHS,
  AVATAR_POSES,
  parseAvatar,
  type AvatarPackage,
  type AvatarPrimitive,
} from "../src/shared/avatar";
import { validateAvatarPackage } from "../src/shared/avatar-quality";
import {
  avatarPixelHash,
  renderAvatarPixels,
  type AvatarRenderState,
} from "../resources/avatar-engine/avatar-engine.js";

const names = ["strategist", "companion", "expert"] as const;
const neutralState: AvatarRenderState = {
  pose: "neutral",
  expression: "neutral",
  mouth: "A",
  blink: 0,
  frame: 0,
};

async function readExample(name: (typeof names)[number]) {
  const source = await readFile(
    join(
      process.cwd(),
      "resources",
      "avatar-engine",
      "examples",
      `${name}.json`,
    ),
    "utf8",
  );
  return parseAvatar(JSON.parse(source));
}

function alphaMask(avatar: AvatarPackage) {
  const pixels = renderAvatarPixels(avatar, neutralState);
  return Uint8Array.from(
    { length: pixels.width * pixels.height },
    (_, index) => (pixels.data[index * 4 + 3] === 255 ? 1 : 0),
  );
}

function silhouetteDifference(left: Uint8Array, right: Uint8Array) {
  let changed = 0;
  let union = 0;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] || right[index]) union += 1;
    if (left[index] !== right[index]) changed += 1;
  }
  return changed / union;
}

function renderedPart(
  avatar: AvatarPackage,
  partId: string,
  state: AvatarRenderState,
) {
  return renderAvatarPixels(
    { ...avatar, parts: avatar.parts.filter((part) => part.id === partId) },
    state,
  );
}

function partsTouch(
  avatar: AvatarPackage,
  childId: string,
  parentId: string,
  state: AvatarRenderState,
) {
  const child = renderedPart(avatar, childId, state);
  const parent = renderedPart(avatar, parentId, state);
  const parentPixels = new Set<number>();
  for (let offset = 0; offset < parent.data.length; offset += 4) {
    if (parent.data[offset + 3] === 255) parentPixels.add(offset / 4);
  }
  for (let offset = 0; offset < child.data.length; offset += 4) {
    if (child.data[offset + 3] !== 255) continue;
    const index = offset / 4;
    const x = index % child.width;
    const y = Math.floor(index / child.width);
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (parentPixels.has((y + dy) * parent.width + x + dx)) return true;
      }
    }
  }
  return false;
}

function primitiveColors(primitive: AvatarPrimitive): string[] {
  if (primitive.type === "matrix") {
    return primitive.rows
      .flat()
      .filter((color): color is string => color !== null);
  }
  return [primitive.color];
}

function usedPaletteTokens(avatar: AvatarPackage) {
  const used = new Set<string>();
  const collect = (primitives: AvatarPrimitive[]) => {
    for (const primitive of primitives) {
      for (const color of primitiveColors(primitive)) used.add(color);
    }
  };
  for (const part of avatar.parts) collect(part.primitives);
  for (const group of [avatar.poses, avatar.expressions, avatar.mouths]) {
    for (const states of Object.values(group)) {
      for (const state of Object.values(states)) {
        if (state?.primitives) collect(state.primitives);
      }
    }
  }
  return used;
}

describe("authored avatar examples", () => {
  it.each(names)(
    "validates %s and every required composed state",
    async (name) => {
      const avatar = await readExample(name);
      const report = validateAvatarPackage(avatar);

      expect(report.findings).toEqual([]);
      expect(report.ok).toBe(true);
      expect(Object.keys(report.hashes)).toHaveLength(8);
    },
    20_000,
  );

  it("produces three different full neutral pixel hashes", async () => {
    const avatars = await Promise.all(names.map(readExample));
    const hashes = await Promise.all(
      avatars.map(
        async (avatar) =>
          (await avatarPixelHash(avatar, neutralState, "full")).hash,
      ),
    );

    expect(new Set(hashes).size).toBe(3);
  });

  it("keeps every pairwise neutral silhouette difference above 0.12", async () => {
    const masks = await Promise.all(names.map(readExample)).then((avatars) =>
      avatars.map(alphaMask),
    );
    const differences: number[] = [];
    for (let left = 0; left < masks.length; left += 1) {
      for (let right = left + 1; right < masks.length; right += 1) {
        differences.push(silhouetteDifference(masks[left], masks[right]));
      }
    }

    expect(Math.min(...differences)).toBeGreaterThan(0.12);
  });

  it.each(names)(
    "uses a compact, fully used 24–32 color palette for %s",
    async (name) => {
      const avatar = await readExample(name);
      const entries = Object.entries(avatar.palette);
      const used = usedPaletteTokens(avatar);

      expect(entries.length).toBeGreaterThanOrEqual(24);
      expect(entries.length).toBeLessThanOrEqual(32);
      expect(
        new Set(entries.map(([, color]) => color.toLowerCase())).size,
      ).toBe(entries.length);
      expect([...used].sort()).toEqual(Object.keys(avatar.palette).sort());
    },
  );

  it.each(names)(
    "authors 3–5 tone ramps for skin, hair and cloth in %s",
    async (name) => {
      const avatar = await readExample(name);
      for (const family of ["skin", "hair", "cloth"]) {
        const tones = Object.keys(avatar.palette).filter(
          (token) => token === family || token.startsWith(`${family}.`),
        );
        expect(tones.length).toBeGreaterThanOrEqual(3);
        expect(tones.length).toBeLessThanOrEqual(5);
      }
    },
  );

  it.each(names)(
    "contains the complete animatable rig and identity anchors for %s",
    async (name) => {
      const avatar = await readExample(name);
      const parts = new Set(avatar.parts.map((part) => part.id));
      const requiredParts = [
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
      ];
      for (const part of requiredParts) expect(parts).toContain(part);
      expect([...parts].some((part) => part.startsWith("accessory"))).toBe(
        true,
      );
      for (const anchor of [
        "head",
        "eye.left",
        "eye.right",
        "mouth",
        "hand.left",
        "hand.right",
        "baseline",
      ]) {
        expect(avatar.identity.anchors[anchor]).toBeDefined();
      }
    },
  );

  it.each(names)(
    "distinguishes every pose, expression and mouth in %s",
    async (name) => {
      const avatar = await readExample(name);
      const stateHashes = <T extends string>(
        states: readonly T[],
        key: "pose" | "expression" | "mouth",
      ) =>
        states.map((value) =>
          Buffer.from(
            renderAvatarPixels(avatar, { ...neutralState, [key]: value }).data,
          ).toString("base64"),
        );

      for (const hashes of [
        stateHashes(AVATAR_POSES, "pose"),
        stateHashes(AVATAR_EXPRESSIONS, "expression"),
        stateHashes(AVATAR_MOUTHS, "mouth"),
      ]) {
        expect(new Set(hashes).size).toBe(hashes.length);
      }
    },
    20_000,
  );

  it.each(names)(
    "keeps both arm chains connected throughout the motion of %s",
    async (name) => {
      const avatar = await readExample(name);
      const disconnected: string[] = [];
      for (const pose of AVATAR_POSES) {
        for (let frame = 0; frame < 16; frame += 1) {
          const state = { ...neutralState, pose, frame };
          for (const side of ["left", "right"] as const) {
            for (const [child, parent] of [
              [`arm.${side}`, "body"],
              [`forearm.${side}`, `arm.${side}`],
              [`hand.${side}`, `forearm.${side}`],
            ]) {
              if (!partsTouch(avatar, child, parent, state)) {
                disconnected.push(
                  `${pose}/frame-${frame}: ${child} → ${parent}`,
                );
              }
            }
          }
        }
      }
      expect(disconnected).toEqual([]);
    },
  );
});

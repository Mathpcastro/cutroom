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

interface NativeRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

const faceRegion: NativeRegion = { x: 28, y: 18, width: 42, height: 29 };
const mouthRegion: NativeRegion = { x: 39, y: 32, width: 20, height: 15 };

function regionalDifference(
  avatar: AvatarPackage,
  leftState: AvatarRenderState,
  rightState: AvatarRenderState,
  region: NativeRegion,
) {
  const left = renderAvatarPixels(avatar, leftState);
  const right = renderAvatarPixels(avatar, rightState);
  let changed = 0;
  for (let y = region.y; y < region.y + region.height; y += 1) {
    for (let x = region.x; x < region.x + region.width; x += 1) {
      const offset = (y * left.width + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        if (left.data[offset + channel] !== right.data[offset + channel]) {
          changed += 1;
          break;
        }
      }
    }
  }
  return changed;
}

function partBounds(
  avatar: AvatarPackage,
  partId: string,
  state: AvatarRenderState,
) {
  const pixels = renderedPart(avatar, partId, state);
  let left = pixels.width;
  let right = -1;
  let top = pixels.height;
  let bottom = -1;
  for (let offset = 0; offset < pixels.data.length; offset += 4) {
    if (pixels.data[offset + 3] === 0) continue;
    const index = offset / 4;
    const x = index % pixels.width;
    const y = Math.floor(index / pixels.width);
    left = Math.min(left, x);
    right = Math.max(right, x);
    top = Math.min(top, y);
    bottom = Math.max(bottom, y);
  }
  return { width: right - left + 1, height: bottom - top + 1 };
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
      expect(new Set(avatar.identity.inferred).size).toBe(
        avatar.identity.inferred.length,
      );
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

  it.each(names)(
    "authors organic eyes and facial geometry for %s",
    async (name) => {
      const avatar = await readExample(name);
      const eyes = avatar.parts.find((part) => part.id === "eyes");
      expect(eyes).toBeDefined();
      expect(
        eyes?.primitives.some(
          (primitive) =>
            primitive.type === "rect" &&
            primitive.width === 9 &&
            primitive.height === 7,
        ),
      ).toBe(false);

      for (const expression of AVATAR_EXPRESSIONS.slice(1)) {
        const overrides = avatar.expressions[expression];
        expect(overrides.mouth?.primitives?.length).toBeGreaterThan(0);
        expect(overrides.brows?.primitives?.length).toBeGreaterThan(0);
        expect(
          (overrides.lids?.primitives?.length ?? 0) +
            (overrides.eyes?.primitives?.length ?? 0),
        ).toBeGreaterThan(0);
      }
      expect(avatar.mouths.X.mouth?.hidden).not.toBe(true);
    },
  );

  it.each(names)(
    "separates every expression in native face and mouth regions for %s",
    async (name) => {
      const avatar = await readExample(name);
      for (const expression of AVATAR_EXPRESSIONS.slice(1)) {
        const expressionState = {
          ...neutralState,
          mouth: "X",
          expression,
        } as const;
        const neutral = { ...neutralState, mouth: "X" } as const;
        expect(
          regionalDifference(avatar, neutral, expressionState, faceRegion),
          `${name}/${expression} face`,
        ).toBeGreaterThanOrEqual(24);
        expect(
          regionalDifference(avatar, neutral, expressionState, mouthRegion),
          `${name}/${expression} mouth`,
        ).toBeGreaterThanOrEqual(6);
      }
    },
  );

  it.each(names)(
    "separates every viseme by at least 18 native mouth pixels for %s",
    async (name) => {
      const avatar = await readExample(name);
      for (let left = 0; left < AVATAR_MOUTHS.length; left += 1) {
        for (let right = left + 1; right < AVATAR_MOUTHS.length; right += 1) {
          const leftMouth = AVATAR_MOUTHS[left];
          const rightMouth = AVATAR_MOUTHS[right];
          expect(
            regionalDifference(
              avatar,
              { ...neutralState, mouth: leftMouth },
              { ...neutralState, mouth: rightMouth },
              mouthRegion,
            ),
            `${name}/${leftMouth}/${rightMouth}`,
          ).toBeGreaterThanOrEqual(18);
        }
      }
    },
  );

  it("authors different companion and expert viseme geometry", async () => {
    const companion = await readExample("companion");
    const expert = await readExample("expert");
    for (const mouth of AVATAR_MOUTHS.filter((mouth) => mouth !== "X")) {
      expect(companion.mouths[mouth]).not.toEqual(expert.mouths[mouth]);
    }
    expect(companion.mouths.X).toEqual({});
    expect(expert.mouths.X).toEqual({});
  });

  it.each(names)(
    "redesigns arm, forearm and hand geometry in every non-neutral pose of %s",
    async (name) => {
      const avatar = await readExample(name);
      for (const pose of AVATAR_POSES.slice(1)) {
        for (const side of ["left", "right"] as const) {
          for (const part of ["arm", "forearm", "hand"] as const) {
            expect(
              avatar.poses[pose][`${part}.${side}`]?.primitives?.length,
              `${name}/${pose}/${part}.${side}`,
            ).toBeGreaterThan(0);
          }
        }
        expect(
          regionalDifference(
            avatar,
            neutralState,
            { ...neutralState, pose },
            { x: 0, y: 35, width: 96, height: 50 },
          ),
          `${name}/${pose} body`,
        ).toBeGreaterThanOrEqual(120);
      }
      const pointingWidths = (["left", "right"] as const).map(
        (side) =>
          partBounds(avatar, `hand.${side}`, {
            ...neutralState,
            pose: "pointing",
          }).width,
      );
      expect(Math.max(...pointingWidths)).toBeGreaterThanOrEqual(14);
    },
  );
});

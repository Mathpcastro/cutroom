import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { AvatarPackage, AvatarPrimitive } from "../src/shared/avatar";
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

function avatarWithPrimitives(primitives: AvatarPrimitive[]): AvatarPackage {
  const avatar = avatarFixture();
  avatar.parts = [{ id: "test", primitives }];
  return avatar;
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

describe("native avatar pixel renderer", () => {
  it("returns identical full-viewport RGBA bytes for repeated renders", () => {
    const avatar = avatarFixture();
    const first = renderAvatarPixels(avatar, neutralState);
    const second = renderAvatarPixels(avatar, neutralState, "full");

    expect(first.width).toBe(96);
    expect(first.height).toBe(96);
    expect(first.data).toBeInstanceOf(Uint8ClampedArray);
    expect(first.data).toHaveLength(96 * 96 * 4);
    expect(Buffer.from(first.data).equals(Buffer.from(second.data))).toBe(true);
  });

  it("uses only palette RGB values, binary alpha and at most 32 fixture colors", () => {
    const avatar = avatarFixture();
    const pixels = renderAvatarPixels(avatar, neutralState);
    const palette = new Set(
      Object.values(avatar.palette).map((color) =>
        color.slice(0, 7).toLowerCase(),
      ),
    );
    const colors = new Set<string>();

    for (let offset = 0; offset < pixels.data.length; offset += 4) {
      const [red, green, blue, alpha] = pixels.data.subarray(
        offset,
        offset + 4,
      );
      expect([0, 255]).toContain(alpha);
      if (alpha === 0) {
        expect([red, green, blue]).toEqual([0, 0, 0]);
        continue;
      }
      const color = `#${[red, green, blue]
        .map((channel) => channel.toString(16).padStart(2, "0"))
        .join("")}`;
      expect(palette.has(color)).toBe(true);
      colors.add(color);
    }

    expect(colors.size).toBeGreaterThan(0);
    expect(colors.size).toBeLessThanOrEqual(32);
  });

  it("renders the portrait viewport at 64 by 64 pixels", () => {
    const pixels = renderAvatarPixels(
      avatarFixture(),
      neutralState,
      "portrait",
    );

    expect(pixels.width).toBe(64);
    expect(pixels.height).toBe(64);
    expect(pixels.data).toHaveLength(64 * 64 * 4);
  });

  it("fills rect, run and matrix primitives on exact integer pixels", () => {
    const rect = renderAvatarPixels(
      avatarWithPrimitives([
        { type: "rect", x: 2, y: 3, width: 3, height: 2, color: "shirt" },
      ]),
      neutralState,
    );
    expect(pixel(rect, 2, 3)).toEqual(rgba("#2878b5"));
    expect(pixel(rect, 4, 4)).toEqual(rgba("#2878b5"));
    expect(pixel(rect, 5, 4)).toEqual([0, 0, 0, 0]);
    expect(pixel(rect, 4, 5)).toEqual([0, 0, 0, 0]);

    const run = renderAvatarPixels(
      avatarWithPrimitives([
        { type: "run", x: 4, y: 5, length: 3, color: "accent" },
      ]),
      neutralState,
    );
    expect(pixel(run, 3, 5)).toEqual([0, 0, 0, 0]);
    expect(pixel(run, 4, 5)).toEqual(rgba("#f4c95d"));
    expect(pixel(run, 6, 5)).toEqual(rgba("#f4c95d"));
    expect(pixel(run, 7, 5)).toEqual([0, 0, 0, 0]);

    const matrix = renderAvatarPixels(
      avatarWithPrimitives([
        {
          type: "matrix",
          x: 1,
          y: 1,
          rows: [
            ["hair", null],
            ["hair.light", "eye"],
          ],
        },
      ]),
      neutralState,
    );
    expect(pixel(matrix, 1, 1)).toEqual(rgba("#3b2545"));
    expect(pixel(matrix, 2, 1)).toEqual([0, 0, 0, 0]);
    expect(pixel(matrix, 1, 2)).toEqual(rgba("#65405f"));
    expect(pixel(matrix, 2, 2)).toEqual(rgba("#ffffff"));
  });

  it("scanline-fills polygons deterministically with vertex tie-breaking", () => {
    const points = [
      { x: 1, y: 1 },
      { x: 6, y: 1 },
      { x: 1, y: 6 },
    ];
    const polygon = renderAvatarPixels(
      avatarWithPrimitives([{ type: "polygon", points, color: "accent" }]),
      neutralState,
    );
    const reversed = renderAvatarPixels(
      avatarWithPrimitives([
        { type: "polygon", points: [...points].reverse(), color: "accent" },
      ]),
      neutralState,
    );

    const rows = [1, 2, 3, 4, 5].map((y) =>
      Array.from({ length: 6 }, (_, x) =>
        pixel(polygon, x, y)[3] === 255 ? "#" : ".",
      ).join(""),
    );
    expect(rows).toEqual([".#####", ".####.", ".###..", ".##...", ".#...."]);
    expect(pixel(polygon, 1, 6)).toEqual([0, 0, 0, 0]);
    expect(Buffer.from(polygon.data).equals(Buffer.from(reversed.data))).toBe(
      true,
    );
  });

  it("orders layers by zIndex and breaks ties by original part index", () => {
    type LayeredPart = AvatarPackage["parts"][number] & { zIndex?: number };
    const layer = (id: string, color: string, zIndex: number): LayeredPart => ({
      id,
      zIndex,
      primitives: [{ type: "rect", x: 0, y: 0, width: 1, height: 1, color }],
    });
    const avatar = avatarFixture();
    avatar.parts = [layer("top", "accent", 10), layer("bottom", "shirt", 0)];
    expect(pixel(renderAvatarPixels(avatar, neutralState), 0, 0)).toEqual(
      rgba("#f4c95d"),
    );

    avatar.parts = [layer("first", "shirt", 5), layer("second", "accent", 5)];
    expect(pixel(renderAvatarPixels(avatar, neutralState), 0, 0)).toEqual(
      rgba("#f4c95d"),
    );

    avatar.parts = [layer("first", "accent", 5), layer("second", "shirt", 5)];
    expect(pixel(renderAvatarPixels(avatar, neutralState), 0, 0)).toEqual(
      rgba("#2878b5"),
    );
  });

  it("clamps every primitive to the canvas without out-of-bounds writes", () => {
    const pixels = renderAvatarPixels(
      avatarWithPrimitives([
        { type: "rect", x: -2, y: -1, width: 4, height: 3, color: "shirt" },
        { type: "run", x: -1, y: 3, length: 3, color: "accent" },
        {
          type: "matrix",
          x: -1,
          y: 4,
          rows: [["hair", "hair.light"]],
        },
        {
          type: "polygon",
          points: [
            { x: -3, y: 5 },
            { x: 3, y: 5 },
            { x: 3, y: 8 },
            { x: -3, y: 8 },
          ],
          color: "shoe",
        },
        { type: "rect", x: 95, y: 95, width: 10, height: 10, color: "eye" },
      ]),
      neutralState,
    );

    expect(pixel(pixels, 0, 0)).toEqual(rgba("#2878b5"));
    expect(pixel(pixels, 1, 1)).toEqual(rgba("#2878b5"));
    expect(pixel(pixels, 2, 1)).toEqual([0, 0, 0, 0]);
    expect(pixel(pixels, 0, 3)).toEqual(rgba("#f4c95d"));
    expect(pixel(pixels, 1, 3)).toEqual(rgba("#f4c95d"));
    expect(pixel(pixels, 0, 4)).toEqual(rgba("#65405f"));
    expect(pixel(pixels, 2, 7)).toEqual(rgba("#25223a"));
    expect(pixel(pixels, 3, 7)).toEqual([0, 0, 0, 0]);
    expect(pixel(pixels, 95, 95)).toEqual(rgba("#ffffff"));
    expect(pixels.data).toHaveLength(96 * 96 * 4);
  });

  it("returns repeatable SHA-256 hashes through an awaited Web Crypto call", async () => {
    const avatar = avatarFixture();
    const pending = avatarPixelHash(avatar, neutralState);
    expect(pending).toBeInstanceOf(Promise);

    const first = await pending;
    const second = await avatarPixelHash(avatar, neutralState, "full");
    const expected = createHash("sha256").update(first.data).digest("hex");

    expect(first.hash).toBe(expected);
    expect(first.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(second.hash).toBe(first.hash);
    expect(first.width).toBe(96);
    expect(first.height).toBe(96);
    expect(Buffer.from(first.data).equals(Buffer.from(second.data))).toBe(true);
  });
});

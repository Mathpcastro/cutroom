import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  parseAvatar,
  type AvatarPackage,
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

type TestPoint = { x: number; y: number };

function polygonPixels(points: TestPoint[]): AvatarPixels {
  return renderAvatarPixels(
    avatarWithPrimitives([{ type: "polygon", points, color: "accent" }]),
    neutralState,
  );
}

function bigIntPolygonOracle(points: TestPoint[]): AvatarPixels {
  const width = 96;
  const height = 96;
  const data = new Uint8ClampedArray(width * height * 4);
  const vertices = points.map(({ x, y }) => ({ x: BigInt(x), y: BigInt(y) }));
  const first = vertices[0];
  const second = vertices.find(
    (point) => point.x !== first.x || point.y !== first.y,
  );
  if (!second) return { width, height, data };
  const directionX = second.x - first.x;
  const directionY = second.y - first.y;
  const collinear = vertices.every(
    (point) =>
      directionX * (point.y - first.y) - directionY * (point.x - first.x) ===
      0n,
  );
  if (collinear) return { width, height, data };

  for (let y = 0; y < height; y += 1) {
    const scan = 2n * BigInt(y) + 1n;
    const intersections: {
      numerator: bigint;
      denominator: bigint;
      edge: number;
    }[] = [];
    for (let index = 0; index < vertices.length; index += 1) {
      const start = vertices[index];
      const end = vertices[(index + 1) % vertices.length];
      if (start.y === end.y) continue;
      const minimumY = 2n * (start.y < end.y ? start.y : end.y);
      const maximumY = 2n * (start.y > end.y ? start.y : end.y);
      if (scan < minimumY || scan >= maximumY) continue;

      let denominator = 2n * (end.y - start.y);
      let numerator =
        start.x * denominator + (scan - 2n * start.y) * (end.x - start.x);
      if (denominator < 0n) {
        numerator = -numerator;
        denominator = -denominator;
      }
      intersections.push({ numerator, denominator, edge: index });
    }
    intersections.sort((left, right) => {
      const leftProduct = left.numerator * right.denominator;
      const rightProduct = right.numerator * left.denominator;
      if (leftProduct < rightProduct) return -1;
      if (leftProduct > rightProduct) return 1;
      return left.edge - right.edge;
    });

    for (let index = 0; index + 1 < intersections.length; index += 2) {
      const left = intersections[index];
      const right = intersections[index + 1];
      for (let x = 0; x < width; x += 1) {
        const center = 2n * BigInt(x) + 1n;
        if (center * left.denominator < 2n * left.numerator) continue;
        if (center * right.denominator > 2n * right.numerator) continue;
        const offset = (y * width + x) * 4;
        data[offset] = 244;
        data[offset + 1] = 201;
        data[offset + 2] = 93;
        data[offset + 3] = 255;
      }
    }
  }
  return { width, height, data };
}

function expectBigIntOracle(points: TestPoint[], label: string): void {
  const actual = polygonPixels(points);
  const expected = bigIntPolygonOracle(points);
  expect(
    Buffer.from(actual.data).equals(Buffer.from(expected.data)),
    label,
  ).toBe(true);
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function expectPolygonRows(
  pixels: AvatarPixels,
  rows: string[],
  originX = 0,
  originY = 0,
): void {
  for (const [rowIndex, row] of rows.entries()) {
    for (const [columnIndex, cell] of [...row].entries()) {
      const x = originX + columnIndex;
      const y = originY + rowIndex;
      expect(pixel(pixels, x, y), `pixel ${x},${y}`).toEqual(
        cell === "#" ? rgba("#f4c95d") : [0, 0, 0, 0],
      );
    }
  }
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

  describe("integer polygon scanlines", () => {
    it("fills triangles deterministically with vertex tie-breaking", () => {
      const points = [
        { x: 1, y: 1 },
        { x: 6, y: 1 },
        { x: 1, y: 6 },
      ];
      const polygon = polygonPixels(points);
      const reversed = polygonPixels([...points].reverse());

      expectPolygonRows(
        polygon,
        [".#####", ".####.", ".###..", ".##...", ".#...."],
        0,
        1,
      );
      expect(pixel(polygon, 1, 6)).toEqual([0, 0, 0, 0]);
      expect(Buffer.from(polygon.data).equals(Buffer.from(reversed.data))).toBe(
        true,
      );
    });

    it("normalizes negative edge denominators without changing triangle bytes", () => {
      const points = [
        { x: 1, y: 1 },
        { x: 1, y: 6 },
        { x: 6, y: 6 },
      ];
      const polygon = polygonPixels(points);
      const reversed = polygonPixels([...points].reverse());

      expectPolygonRows(
        polygon,
        [".#....", ".##...", ".###..", ".####.", ".#####"],
        0,
        1,
      );
      expect(Buffer.from(polygon.data).equals(Buffer.from(reversed.data))).toBe(
        true,
      );
    });

    it("fills concave polygons and skips horizontal edges exactly", () => {
      const polygon = polygonPixels([
        { x: 1, y: 1 },
        { x: 5, y: 1 },
        { x: 5, y: 3 },
        { x: 3, y: 3 },
        { x: 3, y: 5 },
        { x: 1, y: 5 },
      ]);

      expectPolygonRows(
        polygon,
        [".####.", ".####.", ".##...", ".##...", "......"],
        0,
        1,
      );
    });

    it("keeps shared, collinear and repeated vertices deterministic", () => {
      const polygon = polygonPixels([
        { x: 1, y: 1 },
        { x: 3, y: 1 },
        { x: 6, y: 1 },
        { x: 6, y: 1 },
        { x: 1, y: 6 },
        { x: 1, y: 6 },
      ]);

      expectPolygonRows(
        polygon,
        [".#####", ".####.", ".###..", ".##...", ".#...."],
        0,
        1,
      );
    });

    it("clips negative coordinates while preserving exact RGBA bytes", () => {
      const polygon = polygonPixels([
        { x: -3, y: -2 },
        { x: 2, y: -2 },
        { x: 2, y: 3 },
        { x: -3, y: 3 },
      ]);

      expectPolygonRows(polygon, ["##..", "##..", "##..", "...."]);
    });

    it("keeps rational products safe at the schema coordinate limits", () => {
      const polygon = polygonPixels([
        { x: -4096, y: -4096 },
        { x: 4096, y: -4096 },
        { x: 4096, y: 4096 },
        { x: -4096, y: 4096 },
      ]);
      const expected = rgba("#f4c95d");

      expect(
        polygon.data.every((channel, index) => channel === expected[index % 4]),
      ).toBe(true);
    });

    it("matches the BigInt rational oracle on deterministic full canvases", () => {
      const cases: [string, TestPoint[]][] = [
        [
          "triangle",
          [
            { x: 1, y: 1 },
            { x: 6, y: 1 },
            { x: 1, y: 6 },
          ],
        ],
        [
          "concave",
          [
            { x: 1, y: 1 },
            { x: 5, y: 1 },
            { x: 5, y: 3 },
            { x: 3, y: 3 },
            { x: 3, y: 5 },
            { x: 1, y: 5 },
          ],
        ],
        [
          "negative",
          [
            { x: -3, y: -2 },
            { x: 2, y: -2 },
            { x: 2, y: 3 },
            { x: -3, y: 3 },
          ],
        ],
        [
          "shared vertices",
          [
            { x: 1, y: 1 },
            { x: 3, y: 1 },
            { x: 6, y: 1 },
            { x: 6, y: 1 },
            { x: 1, y: 6 },
            { x: 1, y: 6 },
          ],
        ],
        [
          "coordinate limits",
          [
            { x: -4096, y: -4096 },
            { x: 4096, y: -4096 },
            { x: 4096, y: 4096 },
            { x: -4096, y: 4096 },
          ],
        ],
      ];

      for (const [name, points] of cases) {
        expectBigIntOracle(points, name);
      }
    });

    it("matches the BigInt rational oracle on seeded random full canvases", () => {
      const random = seededRandom(0x5eed1234);
      for (let caseIndex = 0; caseIndex < 16; caseIndex += 1) {
        const pointCount = 3 + Math.floor(random() * 6);
        const points = Array.from({ length: pointCount }, () => ({
          x: Math.floor(random() * 25) - 8,
          y: Math.floor(random() * 25) - 8,
        }));
        expectBigIntOracle(points, `seeded polygon ${caseIndex}`);
      }
    });

    it("preserves the 17-pixel even-odd fill of a self-intersecting bow-tie", () => {
      const points = [
        { x: 1, y: 1 },
        { x: 6, y: 6 },
        { x: 1, y: 6 },
        { x: 6, y: 1 },
      ];
      const polygon = polygonPixels(points);

      expectPolygonRows(
        polygon,
        [".#####", "..###.", "...#..", "..###.", ".#####"],
        0,
        1,
      );
      let painted = 0;
      for (let offset = 3; offset < polygon.data.length; offset += 4) {
        if (polygon.data[offset] === 255) painted += 1;
      }
      expect(painted).toBe(17);
      expectBigIntOracle(points, "bow-tie");
    });

    it.each([
      [
        "collinear diagonal",
        [
          { x: 1, y: 1 },
          { x: 5, y: 5 },
          { x: 3, y: 3 },
        ],
      ],
      [
        "repeated diagonal",
        [
          { x: 1, y: 1 },
          { x: 5, y: 5 },
          { x: 1, y: 1 },
          { x: 5, y: 5 },
          { x: 3, y: 3 },
        ],
      ],
      [
        "horizontal",
        [
          { x: 1, y: 3 },
          { x: 5, y: 3 },
          { x: 3, y: 3 },
        ],
      ],
      [
        "vertical",
        [
          { x: 3, y: 1 },
          { x: 3, y: 5 },
          { x: 3, y: 3 },
        ],
      ],
    ] as [string, TestPoint[]][])(
      "produces zero pixels for %s polygons with zero signed area",
      (_name, points) => {
        expect(
          polygonPixels(points).data.every((channel) => channel === 0),
        ).toBe(true);
      },
    );
  });

  it("parses and renders a valid package with explicit zIndex bounds", () => {
    const candidate = avatarFixture();
    candidate.parts[0].zIndex = 4096;
    candidate.parts[1].zIndex = -4096;

    const avatar = parseAvatar(candidate);
    expect(avatar.parts.slice(0, 2).map((part) => part.zIndex)).toEqual([
      4096, -4096,
    ]);
    expect(pixel(renderAvatarPixels(avatar, neutralState), 31, 43)).toEqual(
      rgba("#2878b5"),
    );
  });

  it("orders layers by zIndex and breaks ties by original part index", () => {
    const layer = (
      id: string,
      color: string,
      zIndex: number,
    ): AvatarPackage["parts"][number] => ({
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

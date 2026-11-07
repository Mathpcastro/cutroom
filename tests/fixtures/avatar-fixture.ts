import type { AvatarPackage } from "../../src/shared/avatar";

const mouthMatrix = (rows: (string | null)[][]) => [
  {
    type: "matrix" as const,
    x: 39,
    y: 34,
    rows,
  },
];

const fixture: AvatarPackage = {
  schemaVersion: 1,
  id: "videosell-presenter",
  revision: 1,
  canvas: {
    full: 96,
    portrait: 64,
    baseline: 90,
  },
  identity: {
    anchors: {
      head: { x: 48, y: 28 },
      "eye.left": { x: 40, y: 27 },
      "eye.right": { x: 55, y: 27 },
      mouth: { x: 48, y: 36 },
      "hand.left": { x: 21, y: 70 },
      "hand.right": { x: 74, y: 70 },
      baseline: { x: 48, y: 90 },
    },
    inferred: ["symmetric-face", "two-handed", "front-facing"],
  },
  artBible: {
    light: "top-left",
    outline: "outline",
    notes: [
      "Integer pixels only; do not anti-alias geometry.",
      "Use the semantic palette and preserve the silhouette at portrait size.",
    ],
  },
  palette: {
    outline: "#19152a",
    skin: "#f2b28c",
    "skin.shadow": "#d9896a",
    hair: "#3b2545",
    "hair.light": "#65405f",
    eye: "#ffffff",
    pupil: "#172038",
    brow: "#3b2545",
    mouth: "#7f3148",
    tongue: "#e76f51",
    shirt: "#2878b5",
    "shirt.light": "#48a9c5",
    sleeve: "#23618f",
    accent: "#f4c95d",
    shoe: "#25223a",
    cheek: "#e9957f",
  },
  parts: [
    {
      id: "body",
      primitives: [
        { type: "rect", x: 31, y: 43, width: 34, height: 39, color: "shirt" },
        {
          type: "polygon",
          points: [
            { x: 31, y: 76 },
            { x: 65, y: 76 },
            { x: 69, y: 90 },
            { x: 27, y: 90 },
          ],
          color: "shoe",
        },
        { type: "run", x: 35, y: 46, length: 25, color: "shirt.light" },
      ],
    },
    {
      id: "head",
      parent: "body",
      primitives: [
        { type: "rect", x: 29, y: 12, width: 38, height: 32, color: "outline" },
        { type: "rect", x: 31, y: 14, width: 34, height: 28, color: "skin" },
        { type: "run", x: 34, y: 40, length: 27, color: "skin.shadow" },
      ],
    },
    {
      id: "hair.back",
      parent: "head",
      primitives: [
        { type: "rect", x: 27, y: 11, width: 42, height: 10, color: "hair" },
        { type: "run", x: 28, y: 20, length: 5, color: "hair" },
        { type: "run", x: 64, y: 20, length: 4, color: "hair" },
      ],
    },
    {
      id: "hair.front",
      parent: "head",
      primitives: [
        {
          type: "matrix",
          x: 30,
          y: 12,
          rows: [
            ["hair", "hair", "hair.light", "hair.light", "hair", "hair"],
            ["hair", "hair.light", "hair.light", "hair", "hair", null],
            ["hair", "hair", null, null, null, null],
          ],
        },
      ],
    },
    {
      id: "eyes",
      parent: "head",
      primitives: [
        { type: "rect", x: 36, y: 25, width: 8, height: 5, color: "eye" },
        { type: "rect", x: 52, y: 25, width: 8, height: 5, color: "eye" },
      ],
    },
    {
      id: "pupils",
      parent: "eyes",
      primitives: [
        { type: "run", x: 39, y: 27, length: 3, color: "pupil" },
        { type: "run", x: 55, y: 27, length: 3, color: "pupil" },
      ],
    },
    {
      id: "brows",
      parent: "head",
      primitives: [
        { type: "run", x: 36, y: 22, length: 8, color: "brow" },
        { type: "run", x: 52, y: 22, length: 8, color: "brow" },
      ],
    },
    {
      id: "lids",
      parent: "eyes",
      primitives: [
        { type: "run", x: 36, y: 24, length: 8, color: "skin.shadow" },
        { type: "run", x: 52, y: 24, length: 8, color: "skin.shadow" },
      ],
    },
    {
      id: "nose",
      parent: "head",
      primitives: [
        {
          type: "polygon",
          points: [
            { x: 47, y: 28 },
            { x: 45, y: 33 },
            { x: 50, y: 33 },
          ],
          color: "skin.shadow",
        },
      ],
    },
    {
      id: "mouth",
      parent: "head",
      primitives: mouthMatrix([
        ["mouth", "mouth", "mouth", "mouth"],
        [null, "mouth", "mouth", null],
      ]),
    },
    {
      id: "ears",
      parent: "head",
      primitives: [
        {
          type: "rect",
          x: 27,
          y: 26,
          width: 4,
          height: 8,
          color: "skin.shadow",
        },
        { type: "rect", x: 65, y: 26, width: 4, height: 8, color: "skin" },
      ],
    },
    {
      id: "arm.left",
      parent: "body",
      primitives: [
        { type: "rect", x: 23, y: 45, width: 8, height: 19, color: "sleeve" },
      ],
    },
    {
      id: "arm.right",
      parent: "body",
      primitives: [
        { type: "rect", x: 65, y: 45, width: 8, height: 19, color: "sleeve" },
      ],
    },
    {
      id: "forearm.left",
      parent: "arm.left",
      primitives: [
        {
          type: "rect",
          x: 20,
          y: 60,
          width: 7,
          height: 12,
          color: "skin.shadow",
        },
      ],
    },
    {
      id: "forearm.right",
      parent: "arm.right",
      primitives: [
        { type: "rect", x: 70, y: 60, width: 7, height: 12, color: "skin" },
      ],
    },
    {
      id: "hand.left",
      parent: "forearm.left",
      primitives: [
        {
          type: "rect",
          x: 18,
          y: 69,
          width: 9,
          height: 7,
          color: "skin.shadow",
        },
      ],
    },
    {
      id: "hand.right",
      parent: "forearm.right",
      primitives: [
        { type: "rect", x: 70, y: 69, width: 9, height: 7, color: "skin" },
      ],
    },
    {
      id: "accessory",
      parent: "body",
      primitives: [
        {
          type: "polygon",
          points: [
            { x: 46, y: 45 },
            { x: 52, y: 45 },
            { x: 49, y: 54 },
          ],
          color: "accent",
        },
        { type: "rect", x: 47, y: 54, width: 4, height: 8, color: "accent" },
      ],
    },
  ],
  poses: {
    neutral: {},
    explaining: {
      "forearm.left": { dx: -3, dy: -4 },
      "hand.left": { dx: -3, dy: -4 },
    },
    pointing: {
      "arm.right": { dx: 3, dy: -5 },
      "forearm.right": { dx: 7, dy: -9 },
      "hand.right": { dx: 9, dy: -10 },
    },
    surprised: {
      head: { dy: -2 },
      brows: { dy: -2 },
      "arm.left": { dx: -2, dy: -2 },
      "arm.right": { dx: 2, dy: -2 },
    },
    celebrating: {
      "arm.left": { dx: -4, dy: -12 },
      "arm.right": { dx: 4, dy: -12 },
      "forearm.left": { dx: -6, dy: -18 },
      "forearm.right": { dx: 6, dy: -18 },
      "hand.left": { dx: -6, dy: -20 },
      "hand.right": { dx: 6, dy: -20 },
    },
  },
  expressions: {
    neutral: {},
    happy: {
      mouth: {
        primitives: mouthMatrix([
          [null, "mouth", "mouth", null],
          ["mouth", "tongue", "tongue", "mouth"],
        ]),
      },
      lids: { dy: 1 },
    },
    thinking: {
      pupils: { dx: 2, dy: 1 },
      brows: { dx: 1 },
      mouth: { dx: 1 },
    },
    surprised: {
      eyes: { dy: -1 },
      pupils: { dy: -1 },
      mouth: {
        primitives: mouthMatrix([
          [null, "mouth", "mouth", null],
          ["mouth", "mouth", "mouth", "mouth"],
          [null, "mouth", "mouth", null],
        ]),
      },
    },
    serious: {
      brows: { dy: 1 },
      lids: { dy: 1 },
      mouth: {
        primitives: mouthMatrix([["mouth", "mouth", "mouth", "mouth"]]),
      },
    },
    confident: {
      head: { dx: 1 },
      brows: { dx: 1 },
      mouth: {
        primitives: mouthMatrix([
          ["mouth", "mouth", "mouth", null],
          [null, "mouth", "mouth", "mouth"],
        ]),
      },
    },
  },
  mouths: {
    A: {
      mouth: {
        primitives: mouthMatrix([
          ["mouth", "mouth", "mouth", "mouth"],
          ["mouth", "tongue", "tongue", "mouth"],
        ]),
      },
    },
    B: {
      mouth: {
        primitives: mouthMatrix([
          [null, "mouth", "mouth", null],
          ["mouth", "mouth", "mouth", "mouth"],
          [null, "mouth", "mouth", null],
        ]),
      },
    },
    C: {
      mouth: {
        primitives: mouthMatrix([
          ["mouth", "mouth", "mouth", null],
          [null, "mouth", "mouth", "mouth"],
        ]),
      },
    },
    D: {
      mouth: {
        primitives: mouthMatrix([
          [null, null, "mouth", "mouth"],
          [null, "mouth", "mouth", "mouth"],
          [null, null, "mouth", "mouth"],
        ]),
      },
    },
    E: {
      mouth: {
        primitives: mouthMatrix([
          ["mouth", "mouth", "mouth", "mouth"],
          [null, "tongue", "tongue", null],
        ]),
      },
    },
    F: {
      mouth: {
        primitives: mouthMatrix([
          ["mouth", "mouth", "mouth", "mouth"],
          ["mouth", "eye", "eye", "mouth"],
          ["mouth", "mouth", "mouth", "mouth"],
        ]),
      },
    },
    X: { mouth: { hidden: true } },
  },
};

export function avatarFixture(): AvatarPackage {
  return structuredClone(fixture);
}

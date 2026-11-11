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

  it("pins the fixture canonical JSON and SHA-256 golden values", () => {
    const avatar = avatarFixture();
    expect(canonicalAvatar(avatar)).toBe(
      `{"artBible":{"light":"top-left","notes":["Integer pixels only; do not anti-alias geometry.","Use the semantic palette and preserve the silhouette at portrait size."],"outline":"outline"},"canvas":{"baseline":90,"full":96,"portrait":64},"expressions":{"confident":{"brows":{"dx":1},"head":{"dx":1},"mouth":{"primitives":[{"rows":[["mouth","mouth","mouth",null],[null,"mouth","mouth","mouth"]],"type":"matrix","x":39,"y":34}]}},"happy":{"lids":{"dy":1},"mouth":{"primitives":[{"rows":[[null,"mouth","mouth",null],["mouth","tongue","tongue","mouth"]],"type":"matrix","x":39,"y":34}]}},"neutral":{},"serious":{"brows":{"dy":1},"lids":{"dy":1},"mouth":{"primitives":[{"rows":[["mouth","mouth","mouth","mouth"]],"type":"matrix","x":39,"y":34}]}},"surprised":{"eyes":{"dy":-1},"mouth":{"primitives":[{"rows":[[null,"mouth","mouth",null],["mouth","mouth","mouth","mouth"],[null,"mouth","mouth",null]],"type":"matrix","x":39,"y":34}]},"pupils":{"dy":-1}},"thinking":{"brows":{"dx":1},"mouth":{"dx":1},"pupils":{"dx":2,"dy":1}}},"id":"videosell-presenter","identity":{"anchors":{"baseline":{"x":48,"y":90},"eye.left":{"x":40,"y":27},"eye.right":{"x":55,"y":27},"hand.left":{"x":21,"y":70},"hand.right":{"x":74,"y":70},"head":{"x":48,"y":28},"mouth":{"x":48,"y":36}},"inferred":["symmetric-face","two-handed","front-facing"]},"mouths":{"A":{"mouth":{"primitives":[{"rows":[["mouth","mouth","mouth","mouth"],["mouth","tongue","tongue","mouth"]],"type":"matrix","x":39,"y":34}]}},"B":{"mouth":{"primitives":[{"rows":[[null,"mouth","mouth",null],["mouth","mouth","mouth","mouth"],[null,"mouth","mouth",null]],"type":"matrix","x":39,"y":34}]}},"C":{"mouth":{"primitives":[{"rows":[["mouth","mouth","mouth",null],[null,"mouth","mouth","mouth"]],"type":"matrix","x":39,"y":34}]}},"D":{"mouth":{"primitives":[{"rows":[[null,null,"mouth","mouth"],[null,"mouth","mouth","mouth"],[null,null,"mouth","mouth"]],"type":"matrix","x":39,"y":34}]}},"E":{"mouth":{"primitives":[{"rows":[["mouth","mouth","mouth","mouth"],[null,"tongue","tongue",null]],"type":"matrix","x":39,"y":34}]}},"F":{"mouth":{"primitives":[{"rows":[["mouth","mouth","mouth","mouth"],["mouth","eye","eye","mouth"],["mouth","mouth","mouth","mouth"]],"type":"matrix","x":39,"y":34}]}},"X":{"mouth":{"hidden":true}}},"palette":{"accent":"#f4c95d","brow":"#3b2545","cheek":"#e9957f","eye":"#ffffff","hair":"#3b2545","hair.light":"#65405f","mouth":"#7f3148","outline":"#19152a","pupil":"#172038","shirt":"#2878b5","shirt.light":"#48a9c5","shoe":"#25223a","skin":"#f2b28c","skin.shadow":"#d9896a","sleeve":"#23618f","tongue":"#e76f51"},"parts":[{"id":"body","primitives":[{"color":"shirt","height":39,"type":"rect","width":34,"x":31,"y":43},{"color":"shoe","points":[{"x":31,"y":76},{"x":65,"y":76},{"x":69,"y":90},{"x":27,"y":90}],"type":"polygon"},{"color":"shirt.light","length":25,"type":"run","x":35,"y":46}]},{"id":"head","parent":"body","primitives":[{"color":"outline","height":32,"type":"rect","width":38,"x":29,"y":12},{"color":"skin","height":28,"type":"rect","width":34,"x":31,"y":14},{"color":"skin.shadow","length":27,"type":"run","x":34,"y":40}]},{"id":"hair.back","parent":"head","primitives":[{"color":"hair","height":10,"type":"rect","width":42,"x":27,"y":11},{"color":"hair","length":5,"type":"run","x":28,"y":20},{"color":"hair","length":4,"type":"run","x":64,"y":20}]},{"id":"hair.front","parent":"head","primitives":[{"rows":[["hair","hair","hair.light","hair.light","hair","hair"],["hair","hair.light","hair.light","hair","hair",null],["hair","hair",null,null,null,null]],"type":"matrix","x":30,"y":12}]},{"id":"eyes","parent":"head","primitives":[{"color":"eye","height":5,"type":"rect","width":8,"x":36,"y":25},{"color":"eye","height":5,"type":"rect","width":8,"x":52,"y":25}]},{"id":"pupils","parent":"eyes","primitives":[{"color":"pupil","length":3,"type":"run","x":39,"y":27},{"color":"pupil","length":3,"type":"run","x":55,"y":27}]},{"id":"brows","parent":"head","primitives":[{"color":"brow","length":8,"type":"run","x":36,"y":22},{"color":"brow","length":8,"type":"run","x":52,"y":22}]},{"id":"lids","parent":"eyes","primitives":[{"color":"skin.shadow","length":8,"type":"run","x":36,"y":24},{"color":"skin.shadow","length":8,"type":"run","x":52,"y":24}]},{"id":"nose","parent":"head","primitives":[{"color":"skin.shadow","points":[{"x":47,"y":28},{"x":45,"y":33},{"x":50,"y":33}],"type":"polygon"}]},{"id":"mouth","parent":"head","primitives":[{"rows":[["mouth","mouth","mouth","mouth"],[null,"mouth","mouth",null]],"type":"matrix","x":39,"y":34}]},{"id":"ears","parent":"head","primitives":[{"color":"skin.shadow","height":8,"type":"rect","width":4,"x":27,"y":26},{"color":"skin","height":8,"type":"rect","width":4,"x":65,"y":26}]},{"id":"arm.left","parent":"body","primitives":[{"color":"sleeve","height":19,"type":"rect","width":8,"x":23,"y":45}]},{"id":"arm.right","parent":"body","primitives":[{"color":"sleeve","height":19,"type":"rect","width":8,"x":65,"y":45}]},{"id":"forearm.left","parent":"arm.left","primitives":[{"color":"skin.shadow","height":12,"type":"rect","width":7,"x":20,"y":60}]},{"id":"forearm.right","parent":"arm.right","primitives":[{"color":"skin","height":12,"type":"rect","width":7,"x":70,"y":60}]},{"id":"hand.left","parent":"forearm.left","primitives":[{"color":"skin.shadow","height":7,"type":"rect","width":9,"x":18,"y":69}]},{"id":"hand.right","parent":"forearm.right","primitives":[{"color":"skin","height":7,"type":"rect","width":9,"x":70,"y":69}]},{"id":"accessory","parent":"body","primitives":[{"color":"accent","points":[{"x":46,"y":45},{"x":52,"y":45},{"x":49,"y":54}],"type":"polygon"},{"color":"accent","height":8,"type":"rect","width":4,"x":47,"y":54}]}],"poses":{"celebrating":{"arm.left":{"dx":-4,"dy":-12},"arm.right":{"dx":4,"dy":-12},"forearm.left":{"dx":-6,"dy":-18},"forearm.right":{"dx":6,"dy":-18},"hand.left":{"dx":-6,"dy":-20},"hand.right":{"dx":6,"dy":-20}},"explaining":{"forearm.left":{"dx":-3,"dy":-4},"hand.left":{"dx":-3,"dy":-4}},"neutral":{},"pointing":{"arm.right":{"dx":3,"dy":-5},"forearm.right":{"dx":7,"dy":-9},"hand.right":{"dx":9,"dy":-10}},"surprised":{"arm.left":{"dx":-2,"dy":-2},"arm.right":{"dx":2,"dy":-2},"brows":{"dy":-2},"head":{"dy":-2}}},"revision":1,"schemaVersion":1}`,
    );
    expect(avatarHash(avatar)).toBe(
      "9cb2f3ab4a2b69fb7069abb500aae1e9061ddaaa3fa7f80c52be35614758a2d6",
    );
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

  const stateErrorCases: {
    name: string;
    mutate: (avatar: AvatarPackage) => void;
    path: (string | number)[];
  }[] = [
    {
      name: "poses",
      mutate: (avatar) => {
        avatar.poses.explaining["forearm.left"] = {
          primitives: [
            { type: "rect", x: 0, y: 0, width: 1, height: 1, color: "missing" },
          ],
        };
      },
      path: ["poses", "explaining", "forearm.left", "primitives", 0, "color"],
    },
    {
      name: "expressions",
      mutate: (avatar) => {
        avatar.expressions.happy.mouth = {
          primitives: [
            { type: "rect", x: 0, y: 0, width: 1, height: 1, color: "missing" },
          ],
        };
      },
      path: ["expressions", "happy", "mouth", "primitives", 0, "color"],
    },
    {
      name: "mouths",
      mutate: (avatar) => {
        avatar.mouths.A.mouth = {
          primitives: [{ type: "matrix", x: 0, y: 0, rows: [["missing"]] }],
        };
      },
      path: ["mouths", "A", "mouth", "primitives", 0, "rows", 0, 0],
    },
  ];

  it.each(stateErrorCases)(
    "reports precise $name state error paths",
    ({ mutate, path }) => {
      const avatar = avatarFixture();
      mutate(avatar);
      let issues: { path: (string | number)[] }[] = [];
      try {
        parseAvatar(avatar);
      } catch (error) {
        issues = (error as { issues: { path: (string | number)[] }[] }).issues;
      }

      expect(issues).toEqual(
        expect.arrayContaining([expect.objectContaining({ path })]),
      );
    },
  );

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

  it("keeps zIndex absent when omitted", () => {
    const parsed = parseAvatar(avatarFixture());
    expect(parsed.parts.every((part) => !("zIndex" in part))).toBe(true);
  });

  it.each([-4097, 4097, 1.5])("rejects invalid part zIndex %s", (zIndex) => {
    const avatar = avatarFixture();
    part(avatar, "head").zIndex = zIndex;
    expect(() => parseAvatar(avatar)).toThrow();
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

  it("rejects oversize JSON before structural validation", () => {
    const input = { invalid: "á".repeat(140_000) };
    expect(Buffer.byteLength(JSON.stringify(input), "utf8")).toBeGreaterThan(
      256 * 1024,
    );
    expect(() => parseAvatar(input)).toThrow(
      "Avatar JSON exceeds the 256 KiB input limit.",
    );
  });

  const extremeCases: {
    name: string;
    mutate: (avatar: AvatarPackage) => void;
  }[] = [
    {
      name: "rect coordinate",
      mutate: (avatar) => {
        (part(avatar, "body").primitives[0] as { x: number }).x = 4097;
      },
    },
    {
      name: "rect dimension",
      mutate: (avatar) => {
        (part(avatar, "body").primitives[0] as { width: number }).width = 4097;
      },
    },
    {
      name: "polygon coordinate",
      mutate: (avatar) => {
        (
          part(avatar, "nose").primitives[0] as { points: { y: number }[] }
        ).points[0].y = -4097;
      },
    },
    {
      name: "polygon point count",
      mutate: (avatar) => {
        (
          part(avatar, "nose").primitives[0] as {
            points: { x: number; y: number }[];
          }
        ).points = Array.from({ length: 257 }, () => ({ x: 0, y: 0 }));
      },
    },
    {
      name: "matrix height",
      mutate: (avatar) => {
        (
          part(avatar, "hair.front").primitives[0] as {
            rows: (string | null)[][];
          }
        ).rows = Array.from({ length: 97 }, () => [null]);
      },
    },
    {
      name: "matrix width",
      mutate: (avatar) => {
        (
          part(avatar, "hair.front").primitives[0] as {
            rows: (string | null)[][];
          }
        ).rows = [Array.from({ length: 97 }, () => null)];
      },
    },
    {
      name: "anchor count",
      mutate: (avatar) => {
        for (let index = 0; index < 58; index += 1) {
          avatar.identity.anchors[`anchor.${index}`] = { x: 0, y: 0 };
        }
      },
    },
    {
      name: "inferred count",
      mutate: (avatar) => {
        avatar.identity.inferred = Array.from(
          { length: 65 },
          (_, index) => `inference-${index}`,
        );
      },
    },
    {
      name: "state offset",
      mutate: (avatar) => {
        avatar.poses.neutral.head = { dx: 4097 };
      },
    },
  ];

  it.each(extremeCases)("rejects extreme $name", ({ mutate }) => {
    const avatar = avatarFixture();
    mutate(avatar);
    expect(() => parseAvatar(avatar)).toThrow();
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

  it("protects zIndex changes on unauthorized parts", () => {
    const next = avatarFixture();
    part(next, "head").zIndex = 12;

    expect(() => reviseAvatar(avatarFixture(), next, ["body"])).toThrow(
      /head|allowed/i,
    );
    expect(reviseAvatar(avatarFixture(), next, ["head"])).toEqual(next);
  });

  it("allows moving an authorized part without authorizing index shifts", () => {
    const next = avatarFixture();
    const headIndex = next.parts.findIndex(({ id }) => id === "head");
    const [head] = next.parts.splice(headIndex, 1);
    next.parts.push(head);

    expect(reviseAvatar(avatarFixture(), next, ["head"])).toEqual(next);
  });

  it("rejects changing the relative order of two unauthorized parts", () => {
    const next = avatarFixture();
    const eyesIndex = next.parts.findIndex(({ id }) => id === "eyes");
    const mouthIndex = next.parts.findIndex(({ id }) => id === "mouth");
    [next.parts[eyesIndex], next.parts[mouthIndex]] = [
      next.parts[mouthIndex],
      next.parts[eyesIndex],
    ];

    expect(() => reviseAvatar(avatarFixture(), next, ["head"])).toThrow(
      /order|eyes|mouth/i,
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

  describe.each([
    ["empty", [] as string[]],
    ["valid", ["head", "arm.left"]],
  ])("with %s allowedPartIds", (_authorization, allowedPartIds) => {
    it.each([
      [
        "identity.inferred",
        (avatar: AvatarPackage) => {
          avatar.identity.inferred = ["different-inference"];
        },
      ],
      [
        "artBible.light",
        (avatar: AvatarPackage) => {
          avatar.artBible.light = "top-right";
        },
      ],
      [
        "artBible.outline",
        (avatar: AvatarPackage) => {
          avatar.artBible.outline = "hair";
        },
      ],
      [
        "artBible.notes",
        (avatar: AvatarPackage) => {
          avatar.artBible.notes = ["Different visual direction."];
        },
      ],
    ])("preserves %s", (_field, mutate) => {
      const next = avatarFixture();
      mutate(next);
      expect(() => reviseAvatar(avatarFixture(), next, allowedPartIds)).toThrow(
        /preserv|protected|revision/i,
      );
    });
  });
});

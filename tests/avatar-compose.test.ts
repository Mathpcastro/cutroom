import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ACCESSORIES, AVATAR_BASES, DEFAULT_CHOICE, composeAvatar, ramp, type AvatarBaseId } from "../src/shared/avatar-compose";
import { parseAvatar } from "../src/shared/avatar";
import { renderAvatarPixels } from "../resources/avatar-engine/avatar-engine.js";

const bases = Object.fromEntries(AVATAR_BASES.map((b) => [b, JSON.parse(readFileSync(`resources/avatar-engine/examples/${b}.json`, "utf8"))])) as Record<AvatarBaseId, unknown>;

describe("avatar customizer (layers over the authored bases)", () => {
  it("every face × hair × outfit × accessory mix is a valid package that renders in every pose", () => {
    let n = 0;
    for (const face of AVATAR_BASES) for (const hair of AVATAR_BASES) for (const outfit of AVATAR_BASES) for (const accessory of Object.keys(ACCESSORIES) as (keyof typeof ACCESSORIES)[]) {
      const pkg = composeAvatar(bases, { ...DEFAULT_CHOICE, face, hair, outfit, accessory, skin: n % 5 }, "mix");
      const avatar = parseAvatar(pkg);
      for (const pose of ["neutral", "explaining", "pointing", "surprised", "celebrating"] as const) {
        const px = renderAvatarPixels(avatar, { pose, expression: "happy", mouth: "A", blink: 0, frame: 3 });
        expect(px.width).toBeGreaterThan(0);
      }
      n++;
    }
    expect(n).toBe(81);
  });
  it("recolours skin, hair and outfit through the palette and keeps one accessory", () => {
    const pkg = composeAvatar(bases, { ...DEFAULT_CHOICE, accessory: "glasses", hairColor: "#C9502E", outfitColor: "#2F6B4F", skin: 4 }, "x");
    expect(pkg.palette.hair).toBe("#C9502E");
    expect(pkg.palette.cloth).toBe("#2F6B4F");
    expect(pkg.palette.skin).toBe("#6B4128");
    expect(pkg.parts.filter((p) => p.id.startsWith("accessory.")).map((p) => p.id)).toEqual(["accessory.glasses"]);
    expect(ramp("#385579").deep).toMatch(/^#[0-9A-F]{6}$/);
  });
});

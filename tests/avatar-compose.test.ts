import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ACCESSORIES, AVATAR_BASES, DEFAULT_CHOICE, FACIAL_HAIR, HAIR_STYLES, OUTFITS, composeAvatar, ramp, type AvatarBaseId, type AvatarChoice, type FacialHair, type HairStyle, type Outfit } from "../src/shared/avatar-compose";
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

describe("avatar kit v2", () => {
  const dir = "resources/avatar-engine/examples/";
  const kitBases = Object.fromEntries(["strategist", "companion", "expert"].map((n) => [n, JSON.parse(readFileSync(dir + n + ".json", "utf8"))])) as Record<AvatarBaseId, unknown>;
  const poses = ["neutral", "explaining", "pointing", "surprised", "celebrating"];
  const renders = (choice: AvatarChoice) => {
    const avatar = parseAvatar(composeAvatar(kitBases, choice, "kit-test"));
    for (const pose of poses) renderAvatarPixels(avatar, { pose, expression: "surprised", mouth: "E", blink: 1, frame: 5 } as never);
    return avatar;
  };

  it("every hair style fits every face; every outfit every body; beards, lashes and the cap render in every pose", () => {
    for (const face of AVATAR_BASES) {
      for (const hair of Object.keys(HAIR_STYLES) as HairStyle[]) renders({ ...DEFAULT_CHOICE, face, hair });
      for (const facial of Object.keys(FACIAL_HAIR) as FacialHair[]) renders({ ...DEFAULT_CHOICE, face, facial, lashes: true, hat: "bone" });
    }
    for (const outfit of AVATAR_BASES) for (const top of Object.keys(OUTFITS) as Outfit[]) renders({ ...DEFAULT_CHOICE, outfit, top });
  }, 120_000);

  it("draws the new pieces as their own parts, recolours trousers and whitens the lab coat", () => {
    const avatar = renders({ ...DEFAULT_CHOICE, hair: "longo", facial: "cheia", lashes: true, hat: "bone", top: "jaleco", outfitColor: "#B23A48", pantsColor: "#C9B79C" }) as unknown as { parts: { id: string }[]; palette: Record<string, string> };
    expect(avatar.parts.map((p) => p.id)).toEqual(expect.arrayContaining(["beard", "lashes", "hat", "outfit", "outfit.legs", "pants"]));
    expect(avatar.palette.pants).toBe("#C9B79C");
    expect(avatar.palette.cloth).toBe("#EEF0F2");
    expect(avatar.palette.detail).toBe("#B23A48");
  });

  it("keeps avatars saved before the kit working (base hair, no new fields)", () => {
    const old = { face: "companion", hair: "expert", outfit: "strategist", accessory: "glasses", skin: 3, hairColor: "#453B56", outfitColor: "#385579", accentColor: "#E7B85C" } as AvatarChoice;
    const avatar = renders(old) as unknown as { parts: { id: string }[] };
    expect(avatar.parts.some((p) => p.id === "beard" || p.id === "outfit")).toBe(false);
  });
});

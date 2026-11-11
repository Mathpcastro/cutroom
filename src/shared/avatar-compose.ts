/**
 * Avatar customizer: the three authored bases share the same parts and palette tokens, so an avatar is a
 * mix of layers (face/body from one base, hair from another, outfit from a third, an optional accessory)
 * plus recolouring through the palette. Same layer model as the open-source LPC character generator,
 * applied to our own art (no third-party assets, the rig and animation keep working).
 */

export const AVATAR_BASES = ["strategist", "companion", "expert"] as const;
export type AvatarBaseId = (typeof AVATAR_BASES)[number];
export const BASE_LABEL: Record<AvatarBaseId, string> = { strategist: "Estrategista", companion: "Parceira", expert: "Especialista" };

export const ACCESSORIES = { none: "Nenhum", headphones: "Fone", glasses: "Óculos" } as const;
export type AccessoryId = keyof typeof ACCESSORIES;
const ACCESSORY_SOURCE: Record<Exclude<AccessoryId, "none">, { base: AvatarBaseId; part: string }> = {
  headphones: { base: "companion", part: "accessory.headphones" },
  glasses: { base: "expert", part: "accessory.glasses" },
};

/** Skin tones: light / base / shadow / deep. */
export const SKIN_TONES = [
  ["#FFE3CC", "#F2C4A0", "#D59B78", "#A86B55"],
  ["#FFD7B5", "#E9AE86", "#C77D62", "#925047"],
  ["#E8B48C", "#C98B62", "#9E6444", "#6E412E"],
  ["#B97E58", "#91603F", "#6B432B", "#47291B"],
  ["#8A5A3C", "#6B4128", "#4E2C1A", "#331A0F"],
] as const;

export const HAIR_COLORS = ["#2A2230", "#453B56", "#6B4428", "#A8743A", "#E0B867", "#C9502E", "#9AA0AA", "#7C5CFF"] as const;
export const OUTFIT_COLORS = ["#385579", "#2F6B4F", "#7C5CFF", "#B23A48", "#2A2A33", "#C98A2B", "#E8E6E1", "#1F7A8C"] as const;

export interface AvatarChoice {
  face: AvatarBaseId;
  hair: AvatarBaseId;
  outfit: AvatarBaseId;
  accessory: AccessoryId;
  skin: number;
  hairColor: string;
  outfitColor: string;
  accentColor: string;
}

export const DEFAULT_CHOICE: AvatarChoice = { face: "strategist", hair: "strategist", outfit: "strategist", accessory: "none", skin: 1, hairColor: "#453B56", outfitColor: "#385579", accentColor: "#E7B85C" };

const OUTFIT_PARTS = ["body", "arm.left", "arm.right", "forearm.left", "forearm.right"];
const HAIR_PARTS = ["hair.back", "hair.front"];

const hex = (h: string) => /^#[0-9a-f]{6}$/i.test(h) ? h : "#888888";
function shade(color: string, amount: number) {
  const n = parseInt(hex(color).slice(1), 16);
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(amount >= 0 ? v + (255 - v) * amount : v * (1 + amount))));
  const r = ch((n >> 16) & 255), g = ch((n >> 8) & 255), b = ch(n & 255);
  return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase();
}
/** light / base / shadow / deep from one colour. */
export const ramp = (c: string) => ({ light: shade(c, 0.32), base: hex(c).toUpperCase(), shadow: shade(c, -0.28), deep: shade(c, -0.5) });

type Part = { id: string; zIndex?: number } & Record<string, unknown>;
type Pkg = { id: string; palette: Record<string, string>; parts: Part[] } & Record<string, unknown>;

/** Builds a package from the bases. Pure: the same choice always gives the same pixels. */
export function composeAvatar(bases: Record<AvatarBaseId, unknown>, choice: AvatarChoice, id: string): Pkg {
  const base = (b: AvatarBaseId) => bases[b] as Pkg;
  const face = structuredClone(base(choice.face));
  const pick = (from: AvatarBaseId, ids: string[]) => base(from).parts.filter((p) => ids.includes(p.id)).map((p) => structuredClone(p));
  const swap = (ids: string[], from: AvatarBaseId) => {
    const replacement = new Map(pick(from, ids).map((p) => [p.id, p]));
    face.parts = face.parts.map((p) => replacement.get(p.id) ?? p);
  };
  swap(HAIR_PARTS, choice.hair);
  swap(OUTFIT_PARTS, choice.outfit);
  // Accessories: drop the face base's own, add the chosen one (face accessories only; they follow the head).
  face.parts = face.parts.filter((p) => !p.id.startsWith("accessory."));
  if (choice.accessory !== "none") {
    const src = ACCESSORY_SOURCE[choice.accessory];
    face.parts.push(...pick(src.base, [src.part]));
  }
  face.parts.sort((a, b) => (Number(a.zIndex ?? 0) - Number(b.zIndex ?? 0)));
  // Poses, expressions and mouths may move parts by id: drop references to parts that are gone and
  // bring the chosen accessory's own movements from the base it came from.
  const present = new Set(face.parts.map((p) => p.id));
  for (const group of ["poses", "expressions", "mouths"] as const) {
    const states = face[group] as Record<string, Record<string, unknown>> | undefined;
    if (!states || typeof states !== "object") continue;
    for (const [name, state] of Object.entries(states)) {
      if (!state || typeof state !== "object") continue;
      for (const key of Object.keys(state)) if (key.includes(".") && key.startsWith("accessory.") && !present.has(key)) delete state[key];
      if (choice.accessory !== "none") {
        const src = ACCESSORY_SOURCE[choice.accessory];
        const own = (base(src.base)[group] as Record<string, Record<string, unknown>> | undefined)?.[name]?.[src.part];
        if (own !== undefined) state[src.part] = structuredClone(own);
      }
    }
  }
  const skin = SKIN_TONES[Math.max(0, Math.min(SKIN_TONES.length - 1, choice.skin))];
  const hair = ramp(choice.hairColor), cloth = ramp(choice.outfitColor), accent = ramp(choice.accentColor);
  face.palette = {
    ...face.palette,
    "skin.light": skin[0], skin: skin[1], "skin.shadow": skin[2], "skin.deep": skin[3],
    "hair.light": hair.light, hair: hair.base, "hair.shadow": hair.shadow, "hair.deep": hair.deep,
    "cloth.light": cloth.light, cloth: cloth.base, "cloth.shadow": cloth.shadow, "cloth.deep": cloth.deep,
    "accent.light": accent.light, accent: accent.base, "accent.shadow": accent.shadow,
  };
  face.id = id;
  return face;
}

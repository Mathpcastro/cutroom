/**
 * Avatar kit v2: hair styles, facial hair, lashes, a cap, outfits and trousers drawn as engine parts.
 * Shapes are authored in coordinates normalised to the face base's head (u: 0 left → 1 right,
 * v: 0 top of the head → 1 chin) and to its torso, so every piece fits every face and animates with
 * every pose (parts are parented to the head or the body).
 */

type Pt = { x: number; y: number };
type Prim =
  | { type: "polygon"; points: Pt[]; color: string }
  | { type: "rect"; x: number; y: number; width: number; height: number; color: string }
  | { type: "run"; x: number; y: number; length: number; color: string };
export interface KitPart { id: string; parent: string; zIndex: number; primitives: Prim[] }

export const HAIR_STYLES = {
  strategist: "Estrategista",
  companion: "Cacheado",
  expert: "Especialista",
  curto: "Curto",
  lateral: "Lateral",
  topete: "Topete",
  raspado: "Raspado",
  careca: "Careca",
  moicano: "Moicano",
  franja: "Franja",
  chanel: "Chanel",
  longo: "Longo liso",
  ondulado: "Longo ondulado",
  rabo: "Rabo de cavalo",
  coque: "Coque",
  blackpower: "Black power",
  trancas: "Tranças",
} as const;
export type HairStyle = keyof typeof HAIR_STYLES;
export const BASE_HAIR = ["strategist", "companion", "expert"] as const;

export const FACIAL_HAIR = { none: "Sem barba", bigode: "Bigode", cavanhaque: "Cavanhaque", curta: "Barba curta", cheia: "Barba cheia" } as const;
export type FacialHair = keyof typeof FACIAL_HAIR;

export const OUTFITS = {
  base: "Do corpo escolhido",
  camiseta: "Camiseta",
  camisa: "Camisa social",
  blazer: "Blazer e gravata",
  moletom: "Moletom",
  vestido: "Vestido",
  jaleco: "Jaleco",
  avental: "Avental",
} as const;
export type Outfit = keyof typeof OUTFITS;

export const HATS = { none: "Nenhum", bone: "Boné" } as const;
export type Hat = keyof typeof HATS;

export interface Box { x0: number; x1: number; y0: number; y1: number }
type N = [number, number];

const bbox = (points: Pt[]): Box => ({
  x0: Math.min(...points.map((p) => p.x)), x1: Math.max(...points.map((p) => p.x)),
  y0: Math.min(...points.map((p) => p.y)), y1: Math.max(...points.map((p) => p.y)),
});
const at = (b: Box) => ([u, v]: N): Pt => ({ x: Math.round(b.x0 + u * (b.x1 - b.x0)), y: Math.round(b.y0 + v * (b.y1 - b.y0)) });
function dedupe(points: Pt[]) {
  return points.filter((p, i) => i === 0 || p.x !== points[i - 1].x || p.y !== points[i - 1].y);
}
function poly(b: Box, color: string, pts: N[]): Prim[] {
  const points = dedupe(pts.map(at(b)));
  return points.length >= 3 ? [{ type: "polygon", points, color }] : [];
}
/** The same outline shrunk toward its centre (a lighter inner tone). */
function inset(pts: N[], f: number, dv = 0): N[] {
  const cu = pts.reduce((s, p) => s + p[0], 0) / pts.length, cv = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  return pts.map(([u, v]) => [cu + (u - cu) * f, cv + (v - cv) * f + dv]);
}
function ellipse(cu: number, cv: number, ru: number, rv: number, n = 16): N[] {
  return Array.from({ length: n }, (_, i) => [cu + ru * Math.cos((i / n) * Math.PI * 2), cv + rv * Math.sin((i / n) * Math.PI * 2)] as N);
}
/** Three tones: deep outline shape, main colour inset, a highlight. */
function toned(b: Box, outer: N[], highlight?: N[], f = 0.9): Prim[] {
  return [...poly(b, "hair.deep", outer), ...poly(b, "hair", inset(outer, f, 0.01)), ...(highlight ? poly(b, "hair.light", highlight) : [])];
}

const CAP_TOP: N[] = [[-0.02, 0.42], [-0.04, 0.18], [0.1, 0], [0.3, -0.1], [0.6, -0.11], [0.86, -0.03], [1.03, 0.15], [1.03, 0.42], [0.95, 0.3], [0.9, 0.18], [0.7, 0.14], [0.45, 0.17], [0.22, 0.15], [0.08, 0.24], [0.04, 0.38]];
const SLICK: N[] = [[-0.02, 0.4], [-0.03, 0.15], [0.12, -0.02], [0.5, -0.1], [0.88, -0.02], [1.03, 0.15], [1.02, 0.4], [0.95, 0.25], [0.8, 0.12], [0.5, 0.08], [0.2, 0.12], [0.05, 0.25]];
const LONG_BACK: N[] = [[-0.12, 0.15], [-0.05, -0.06], [0.5, -0.13], [1.05, -0.06], [1.12, 0.15], [1.13, 1.6], [0.98, 1.7], [0.86, 1.56], [0.84, 0.85], [0.16, 0.85], [0.14, 1.56], [0.02, 1.7], [-0.13, 1.6]];
const PARTED: N[] = [[-0.07, 0.95], [-0.06, 0.15], [0.15, -0.05], [0.45, -0.08], [0.5, 0.02], [0.55, -0.08], [0.85, -0.05], [1.06, 0.15], [1.07, 0.95], [0.95, 0.7], [0.92, 0.3], [0.7, 0.12], [0.5, 0.1], [0.3, 0.12], [0.08, 0.3], [0.05, 0.7]];
const wavy = (pts: N[], amp: number): N[] => pts.flatMap(([u, v], i) => {
  const next = pts[(i + 1) % pts.length];
  if (Math.abs(next[1] - v) < 0.3) return [[u, v]] as N[];
  return [[u, v], [(u + next[0]) / 2 + (i % 2 ? amp : -amp), (v + next[1]) / 2]] as N[];
});

/** hair.back (behind the head) and hair.front (over it) for a style. Base styles keep the authored art. */
export function hairParts(style: HairStyle, head: Box): { back: Prim[]; front: Prim[] } {
  const b = head;
  switch (style) {
    case "curto":
      return { back: [], front: toned(b, CAP_TOP, [[0.3, 0], [0.5, -0.04], [0.66, -0.02], [0.5, 0.03], [0.36, 0.05]]) };
    case "lateral":
      return { back: [], front: toned(b, [[-0.03, 0.45], [-0.04, 0.15], [0.1, -0.03], [0.4, -0.1], [0.75, -0.08], [1.03, 0.1], [1.04, 0.38], [0.9, 0.2], [0.6, 0.1], [0.35, 0.18], [0.15, 0.32], [0.06, 0.45]], [[0.45, -0.05], [0.7, -0.04], [0.55, 0.02]]) };
    case "topete":
      return { back: [], front: [...toned(b, CAP_TOP), ...poly(b, "hair.deep", [[0.22, 0.04], [0.32, -0.3], [0.62, -0.34], [0.84, -0.18], [0.86, 0.04]]), ...poly(b, "hair", [[0.3, 0.02], [0.38, -0.24], [0.6, -0.27], [0.77, -0.15], [0.78, 0.02]]), ...poly(b, "hair.light", [[0.42, -0.2], [0.6, -0.23], [0.68, -0.16], [0.52, -0.15]])] };
    case "raspado":
      return { back: [], front: poly(b, "hair.shadow", [[-0.01, 0.33], [0, 0.14], [0.15, -0.02], [0.5, -0.07], [0.85, -0.02], [1, 0.14], [1.01, 0.33], [0.94, 0.2], [0.75, 0.08], [0.5, 0.06], [0.25, 0.08], [0.06, 0.2]]) };
    case "careca":
      return { back: [], front: [] };
    case "moicano":
      return { back: [], front: [...poly(b, "hair.deep", [[0.38, 0.1], [0.4, -0.3], [0.6, -0.32], [0.62, 0.1]]), ...poly(b, "hair", [[0.42, 0.06], [0.44, -0.25], [0.56, -0.27], [0.58, 0.06]]), ...poly(b, "hair.light", [[0.45, -0.2], [0.5, -0.24], [0.5, -0.1]])] };
    case "franja": {
      const back: N[] = [[-0.1, 0.2], [0, -0.05], [0.5, -0.12], [1, -0.05], [1.1, 0.2], [1.1, 0.75], [0.9, 0.7], [0.1, 0.7], [-0.1, 0.75]];
      const front: N[] = [[-0.04, 0.5], [-0.05, 0.15], [0.12, -0.04], [0.5, -0.1], [0.88, -0.04], [1.05, 0.15], [1.04, 0.5], [0.92, 0.36], [0.7, 0.34], [0.5, 0.37], [0.3, 0.34], [0.1, 0.36]];
      return { back: toned(b, back), front: toned(b, front, [[0.25, 0.02], [0.55, -0.04], [0.4, 0.06]]) };
    }
    case "chanel": {
      const back: N[] = [[-0.14, 0.15], [-0.05, -0.05], [0.5, -0.12], [1.05, -0.05], [1.14, 0.15], [1.16, 0.95], [1, 1.02], [0.92, 0.9], [0.08, 0.9], [0, 1.02], [-0.16, 0.95]];
      const front: N[] = [[-0.06, 0.6], [-0.05, 0.15], [0.15, -0.04], [0.62, -0.1], [0.95, 0], [1.06, 0.2], [1.06, 0.62], [0.96, 0.5], [0.92, 0.28], [0.7, 0.16], [0.45, 0.2], [0.2, 0.3], [0.08, 0.45]];
      return { back: toned(b, back), front: toned(b, front, [[0.55, -0.04], [0.85, 0.04], [0.7, 0.08]]) };
    }
    case "longo":
      return { back: [...toned(b, LONG_BACK, undefined, 0.94), ...poly(b, "hair.light", [[1.0, 0.5], [1.06, 0.5], [1.07, 1.5], [1.02, 1.5]])], front: toned(b, PARTED, [[0.2, 0.0], [0.42, -0.04], [0.3, 0.06]]) };
    case "ondulado":
      return { back: toned(b, wavy(LONG_BACK, 0.06), undefined, 0.94), front: toned(b, wavy(PARTED, 0.04), [[0.6, -0.04], [0.82, 0.0], [0.7, 0.06]]) };
    case "rabo":
      return { back: [...toned(b, [[0.82, 0.05], [1.05, -0.08], [1.26, 0.1], [1.32, 0.6], [1.22, 1.15], [1.1, 0.92], [1.14, 0.4], [1.0, 0.2]]), ...poly(b, "accent", [[0.95, 0.02], [1.08, -0.04], [1.12, 0.08], [1.0, 0.12]])], front: toned(b, SLICK, [[0.3, 0.0], [0.6, -0.05], [0.45, 0.04]]) };
    case "coque":
      return { back: [...toned(b, ellipse(0.5, -0.2, 0.24, 0.2)), ...poly(b, "accent", [[0.36, -0.02], [0.64, -0.02], [0.62, 0.04], [0.38, 0.04]])], front: toned(b, SLICK, [[0.3, 0.0], [0.6, -0.05], [0.45, 0.04]]) };
    case "blackpower": {
      const dots: Prim[] = [];
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2, p = at(b)([0.5 + 0.5 * Math.cos(a), 0.16 + 0.44 * Math.sin(a)]);
        dots.push({ type: "run", x: p.x, y: p.y, length: 2, color: i % 2 ? "hair.light" : "hair.shadow" });
      }
      return { back: [...toned(b, ellipse(0.5, 0.16, 0.66, 0.56, 20), undefined, 0.92), ...dots], front: toned(b, [[-0.02, 0.35], [0, 0.12], [0.2, 0], [0.5, -0.04], [0.8, 0], [1, 0.12], [1.02, 0.35], [0.92, 0.18], [0.5, 0.1], [0.08, 0.18]]) };
    }
    case "trancas": {
      const bands: Prim[] = [];
      for (let k = 0; k < 9; k++) {
        const v = 0.9 + k * 0.1;
        bands.push(...poly(b, "hair.shadow", [[-0.18, v], [0.15, v], [0.15, v + 0.03], [-0.18, v + 0.03]]), ...poly(b, "hair.shadow", [[0.85, v], [1.19, v], [1.19, v + 0.03], [0.85, v + 0.03]]));
      }
      return { back: [...toned(b, LONG_BACK, undefined, 0.94), ...bands], front: toned(b, PARTED) };
    }
    default:
      return { back: [], front: [] };
  }
}

/** Beard/moustache over the lower face (under the mouth layer, so the mouth still talks). */
export function facialHairPart(kind: FacialHair, head: Box): KitPart | null {
  const b = head;
  const moustache = poly(b, "hair", [[0.3, 0.72], [0.5, 0.67], [0.7, 0.72], [0.68, 0.77], [0.5, 0.74], [0.32, 0.77]]);
  let prims: Prim[] = [];
  if (kind === "bigode") prims = [...poly(b, "hair.deep", [[0.28, 0.73], [0.5, 0.66], [0.72, 0.73], [0.7, 0.79], [0.5, 0.75], [0.3, 0.79]]), ...moustache];
  else if (kind === "cavanhaque") prims = [...moustache, ...poly(b, "hair.deep", [[0.38, 0.86], [0.62, 0.86], [0.6, 1.04], [0.4, 1.04]]), ...poly(b, "hair", [[0.42, 0.88], [0.58, 0.88], [0.56, 1.0], [0.44, 1.0]])];
  else if (kind === "curta") prims = [...poly(b, "hair.shadow", [[0, 0.45], [0.06, 0.45], [0.12, 0.72], [0.3, 0.9], [0.5, 0.93], [0.7, 0.9], [0.88, 0.72], [0.94, 0.45], [1, 0.45], [0.98, 0.8], [0.8, 0.98], [0.5, 1.04], [0.2, 0.98], [0.02, 0.8]]), ...moustache];
  else if (kind === "cheia") {
    const outer: N[] = [[-0.02, 0.42], [0.06, 0.42], [0.12, 0.68], [0.3, 0.84], [0.5, 0.86], [0.7, 0.84], [0.88, 0.68], [0.94, 0.42], [1.02, 0.42], [1, 0.85], [0.85, 1.08], [0.5, 1.18], [0.15, 1.08], [0, 0.85]];
    prims = [...poly(b, "hair.deep", outer), ...poly(b, "hair", inset(outer, 0.86, 0.03)), ...moustache];
  }
  return prims.length ? { id: "beard", parent: "head", zIndex: 25, primitives: prims } : null;
}

/** Outer-corner lashes on both eyes. */
export function lashesPart(eyeLeft: Pt, eyeRight: Pt): KitPart {
  return {
    id: "lashes", parent: "head", zIndex: 31,
    primitives: [
      { type: "run", x: eyeLeft.x - 5, y: eyeLeft.y - 3, length: 3, color: "outline" },
      { type: "run", x: eyeLeft.x - 6, y: eyeLeft.y - 4, length: 1, color: "outline" },
      { type: "run", x: eyeRight.x + 3, y: eyeRight.y - 3, length: 3, color: "outline" },
      { type: "run", x: eyeRight.x + 6, y: eyeRight.y - 4, length: 1, color: "outline" },
    ],
  };
}

export function hatPart(kind: Hat, head: Box): KitPart | null {
  if (kind !== "bone") return null;
  const b = head;
  return {
    id: "hat", parent: "head", zIndex: 26,
    primitives: [
      ...poly(b, "outline", [[-0.06, 0.32], [-0.04, 0.05], [0.18, -0.15], [0.5, -0.2], [0.82, -0.15], [1.04, 0.05], [1.06, 0.32]]),
      ...poly(b, "accent", [[-0.02, 0.28], [0, 0.06], [0.2, -0.11], [0.5, -0.16], [0.8, -0.11], [1, 0.06], [1.02, 0.28]]),
      ...poly(b, "accent.light", [[0.15, -0.05], [0.4, -0.13], [0.3, 0.0]]),
      ...poly(b, "outline", [[-0.08, 0.24], [1.08, 0.24], [1.3, 0.33], [1.06, 0.38], [-0.08, 0.34]]),
      ...poly(b, "accent.shadow", [[-0.05, 0.26], [1.06, 0.26], [1.22, 0.33], [1.04, 0.35], [-0.05, 0.32]]),
      ...poly(b, "accent.shadow", [[0.46, -0.21], [0.54, -0.21], [0.54, -0.16], [0.46, -0.16]]),
    ],
  };
}

/**
 * Outfit layer over the torso of the outfit base (and skirt/coat tails over the legs). `torso` is
 * the body's torso outline polygon; arms keep the base sleeves, coloured with the same cloth tokens.
 */
export function outfitParts(kind: Outfit, torsoOutline: Pt[]): KitPart[] {
  if (kind === "base") return [];
  const t = bbox(torsoOutline), b = t;
  const shape: Prim[] = [{ type: "polygon", points: torsoOutline, color: "outline" }];
  const fillPts = torsoOutline.map((p) => ({ x: Math.round(t.x0 + (p.x - t.x0) * 0.92 + (t.x1 - t.x0) * 0.04), y: Math.round(t.y0 + (p.y - t.y0) * 0.94 + 1) }));
  const fill: Prim[] = [
    { type: "polygon", points: fillPts, color: kind === "jaleco" ? "cloth" : "cloth" },
    ...poly(b, "cloth.light", [[0.12, 0.08], [0.32, 0.06], [0.24, 0.9], [0.12, 0.9], [0.05, 0.3]]),
    ...poly(b, "cloth.shadow", [[0.72, 0.06], [0.92, 0.12], [0.88, 0.9], [0.74, 0.9]]),
  ];
  const neck = poly(b, "skin", [[0.4, -0.01], [0.6, -0.01], [0.57, 0.12], [0.5, 0.16], [0.43, 0.12]]);
  const parts: Prim[] = [...shape, ...fill];
  const legs: Prim[] = [];
  const legTop = t.y1 - 2;
  switch (kind) {
    case "camiseta":
      parts.push(...neck, ...poly(b, "cloth.deep", [[0.38, -0.01], [0.62, -0.01], [0.6, 0.04], [0.4, 0.04]]), ...poly(b, "accent", [[0.56, 0.3], [0.7, 0.3], [0.7, 0.42], [0.56, 0.42]]));
      break;
    case "camisa":
      parts.push(...neck,
        ...poly(b, "detail.light", [[0.34, -0.02], [0.5, 0.12], [0.42, 0.22]]), ...poly(b, "detail.light", [[0.66, -0.02], [0.5, 0.12], [0.58, 0.22]]),
        ...poly(b, "cloth.deep", [[0.49, 0.12], [0.51, 0.12], [0.51, 1], [0.49, 1]]),
        { type: "run", ...at(b)([0.53, 0.35]), length: 1, color: "metal" }, { type: "run", ...at(b)([0.53, 0.55]), length: 1, color: "metal" }, { type: "run", ...at(b)([0.53, 0.75]), length: 1, color: "metal" },
        ...poly(b, "cloth.shadow", [[0.6, 0.3], [0.76, 0.3], [0.76, 0.44], [0.6, 0.44]]));
      break;
    case "blazer":
      parts.push(...poly(b, "detail.light", [[0.38, -0.01], [0.62, -0.01], [0.5, 0.58]]),
        ...poly(b, "accent.shadow", [[0.46, 0.04], [0.54, 0.04], [0.56, 0.46], [0.5, 0.54], [0.44, 0.46]]), ...poly(b, "accent", [[0.47, 0.06], [0.53, 0.06], [0.54, 0.42], [0.5, 0.48], [0.46, 0.42]]),
        ...poly(b, "cloth.deep", [[0.36, -0.01], [0.46, 0.05], [0.45, 0.52], [0.3, 0.24]]), ...poly(b, "cloth.deep", [[0.64, -0.01], [0.54, 0.05], [0.55, 0.52], [0.7, 0.24]]),
        { type: "run", ...at(b)([0.5, 0.66]), length: 1, color: "metal" }, { type: "run", ...at(b)([0.5, 0.8]), length: 1, color: "metal" });
      break;
    case "moletom":
      parts.push(...poly(b, "cloth.shadow", [[0.26, -0.06], [0.74, -0.06], [0.7, 0.14], [0.5, 0.2], [0.3, 0.14]]), ...poly(b, "skin", [[0.4, -0.04], [0.6, -0.04], [0.57, 0.09], [0.5, 0.12], [0.43, 0.09]]),
        ...poly(b, "detail.light", [[0.43, 0.14], [0.45, 0.14], [0.45, 0.38], [0.43, 0.38]]), ...poly(b, "detail.light", [[0.55, 0.14], [0.57, 0.14], [0.57, 0.38], [0.55, 0.38]]),
        ...poly(b, "cloth.shadow", [[0.24, 0.6], [0.76, 0.6], [0.8, 0.9], [0.2, 0.9]]));
      break;
    case "vestido":
      parts.push(...poly(b, "skin", [[0.4, -0.01], [0.6, -0.01], [0.5, 0.2]]), ...poly(b, "accent", [[0.1, 0.62], [0.9, 0.62], [0.9, 0.68], [0.1, 0.68]]));
      legs.push(
        { type: "polygon", points: [{ x: t.x0 + 2, y: legTop - 3 }, { x: t.x1 - 2, y: legTop - 3 }, { x: t.x1 + 5, y: 81 }, { x: t.x0 - 5, y: 81 }], color: "outline" },
        { type: "polygon", points: [{ x: t.x0 + 3, y: legTop - 2 }, { x: t.x1 - 3, y: legTop - 2 }, { x: t.x1 + 3, y: 79 }, { x: t.x0 - 3, y: 79 }], color: "cloth" },
        { type: "polygon", points: [{ x: Math.round((t.x0 + t.x1) / 2) + 6, y: legTop - 2 }, { x: t.x1 - 3, y: legTop - 2 }, { x: t.x1 + 3, y: 79 }, { x: Math.round((t.x0 + t.x1) / 2) + 9, y: 79 }], color: "cloth.shadow" },
      );
      break;
    case "jaleco":
      parts.push(...poly(b, "detail", [[0.38, -0.01], [0.62, -0.01], [0.5, 0.5]]), ...poly(b, "cloth.deep", [[0.49, 0.48], [0.51, 0.48], [0.51, 1], [0.49, 1]]),
        ...poly(b, "cloth.shadow", [[0.18, 0.62], [0.36, 0.62], [0.36, 0.74], [0.18, 0.74]]), ...poly(b, "cloth.shadow", [[0.64, 0.3], [0.8, 0.3], [0.8, 0.4], [0.64, 0.4]]), ...poly(b, "accent", [[0.68, 0.24], [0.7, 0.24], [0.7, 0.34], [0.68, 0.34]]));
      legs.push(
        { type: "polygon", points: [{ x: t.x0 + 1, y: legTop - 2 }, { x: Math.round((t.x0 + t.x1) / 2) - 1, y: legTop - 2 }, { x: Math.round((t.x0 + t.x1) / 2) - 3, y: 81 }, { x: t.x0 - 2, y: 81 }], color: "cloth.shadow" },
        { type: "polygon", points: [{ x: Math.round((t.x0 + t.x1) / 2) + 1, y: legTop - 2 }, { x: t.x1 - 1, y: legTop - 2 }, { x: t.x1 + 2, y: 81 }, { x: Math.round((t.x0 + t.x1) / 2) + 3, y: 81 }], color: "cloth" },
      );
      break;
    case "avental":
      parts.push(...neck, ...poly(b, "accent.shadow", [[0.3, 0.16], [0.7, 0.16], [0.74, 1.02], [0.26, 1.02]]), ...poly(b, "accent", [[0.32, 0.18], [0.68, 0.18], [0.71, 1], [0.29, 1]]),
        ...poly(b, "accent.shadow", [[0.3, 0.0], [0.34, 0.0], [0.36, 0.18], [0.32, 0.18]]), ...poly(b, "accent.shadow", [[0.66, 0.0], [0.7, 0.0], [0.68, 0.18], [0.64, 0.18]]),
        ...poly(b, "accent.shadow", [[0.38, 0.5], [0.62, 0.5], [0.62, 0.66], [0.38, 0.66]]));
      legs.push({ type: "polygon", points: [{ x: Math.round(t.x0 + (t.x1 - t.x0) * 0.27), y: legTop - 2 }, { x: Math.round(t.x0 + (t.x1 - t.x0) * 0.73), y: legTop - 2 }, { x: Math.round(t.x0 + (t.x1 - t.x0) * 0.75), y: 80 }, { x: Math.round(t.x0 + (t.x1 - t.x0) * 0.25), y: 80 }], color: "accent" });
      break;
  }
  const out: KitPart[] = [{ id: "outfit", parent: "body", zIndex: 12, primitives: parts }];
  if (legs.length) out.push({ id: "outfit.legs", parent: "body", zIndex: 13, primitives: legs });
  return out;
}

/** Trousers: the base's leg shapes, recoloured with their own tokens (or skin under a dress). */
export function pantsPart(body: { primitives: Prim[] }, under: "pants" | "skin"): KitPart {
  const map: Record<string, string> = under === "skin"
    ? { "cloth.deep": "skin.shadow", "cloth.shadow": "skin.shadow", cloth: "skin" }
    : { "cloth.deep": "pants.deep", "cloth.shadow": "pants.shadow", cloth: "pants" };
  const legs = body.primitives.filter((p): p is Extract<Prim, { type: "polygon" }> => p.type === "polygon" && p.points.every((q) => q.y >= 66) && p.color in map && p.points.some((q) => q.y <= 70));
  return { id: "pants", parent: "body", zIndex: 11, primitives: legs.map((p) => ({ ...p, color: map[p.color] })) };
}

export { bbox as kitBox };

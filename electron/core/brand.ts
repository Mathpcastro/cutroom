import { existsSync } from "node:fs";
import { readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { runProcess } from "./process";

/** The user's brand, applied to every script, scene and caption. Stored in `<userData>/brand.json`. */
export interface Brand {
  name: string;
  handle?: string;
  /** What the business sells, to whom, offer, tone (free text or the Carrossell "Contexto da Marca"). */
  context: string;
  /** Visual rules (Carrossell "Design Kit" or written by hand). */
  designKit?: string;
  palette: { accent: string; ink: string; paper: string; soft?: string };
  fonts?: { heading?: string; body?: string };
  /** data:image/png|jpeg|webp|svg+xml;base64 — at most ~1.5 MB. */
  logo?: string;
  website?: string;
  source: "carrossell" | "manual";
  profileId?: string;
  updatedAt: string;
}

export const BRAND_FONTS = ["Barlow", "Montserrat", "Anton", "Lora", "Oswald", "Caveat"];
const HEX = /^#[0-9a-f]{6}$/i;
const fail = (message: string): never => {
  throw new Error(message);
};
const text = (v: unknown, label: string, max: number, required = false) => {
  if (v === undefined || v === "") return required ? fail(`${label} é obrigatório.`) : undefined;
  return typeof v === "string" && v.length <= max ? v.trim() : fail(`${label} inválido.`);
};

export function validateBrand(value: unknown): Brand {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("Marca inválida.");
  const b = value as Record<string, unknown>;
  const palette = (b.palette ?? {}) as Record<string, unknown>;
  for (const key of ["accent", "ink", "paper"])
    if (typeof palette[key] !== "string" || !HEX.test(palette[key] as string))
      fail(`Cor ${key} da marca inválida (use #RRGGBB).`);
  if (palette.soft !== undefined && (typeof palette.soft !== "string" || !HEX.test(palette.soft)))
    fail("Cor soft da marca inválida.");
  const fonts = (b.fonts ?? {}) as Record<string, unknown>;
  for (const key of ["heading", "body"])
    if (fonts[key] !== undefined && !BRAND_FONTS.includes(fonts[key] as string))
      fail(`Fonte ${key} indisponível. Use: ${BRAND_FONTS.join(", ")}.`);
  if (
    b.logo !== undefined &&
    (typeof b.logo !== "string" ||
      b.logo.length > 2_000_000 ||
      !/^data:image\/(png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(b.logo))
  )
    fail("Logo inválido: use PNG, JPG, WebP ou SVG de até 1,5 MB.");
  if (!["carrossell", "manual"].includes(b.source as string)) fail("Origem da marca inválida.");
  return {
    name: text(b.name, "Nome da marca", 200, true)!,
    handle: text(b.handle, "Perfil", 100),
    context: text(b.context, "Contexto da marca", 60000, true)!,
    designKit: text(b.designKit, "Design Kit", 60000),
    palette: {
      accent: palette.accent as string,
      ink: palette.ink as string,
      paper: palette.paper as string,
      ...(palette.soft ? { soft: palette.soft as string } : {}),
    },
    ...(fonts.heading || fonts.body ? { fonts: fonts as Brand["fonts"] } : {}),
    ...(b.logo ? { logo: b.logo as string } : {}),
    website: text(b.website, "Site", 2000),
    source: b.source as Brand["source"],
    profileId: text(b.profileId, "Perfil do Carrossell", 200),
    updatedAt: new Date().toISOString(),
  };
}

export class BrandStore {
  private file: string;
  constructor(userDir: string) {
    this.file = join(userDir, "brand.json");
  }
  async get(): Promise<Brand | undefined> {
    try {
      return validateBrand(JSON.parse(await readFile(this.file, "utf8")));
    } catch {
      return;
    }
  }
  async set(value: unknown): Promise<Brand> {
    const brand = validateBrand(value);
    const partial = `${this.file}.partial`;
    await writeFile(partial, JSON.stringify(brand, null, 2), "utf8");
    await rename(partial, this.file);
    return brand;
  }
}

/** Carrossell executable + CLI script inside its app.asar (what its `carrossell` shim runs). */
export function carrossellCommand(): { exe: string; script: string } | undefined {
  const installs =
    process.platform === "win32"
      ? [
          join(process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "Programs", "Carrossell"),
        ].map((dir) => ({ exe: join(dir, "Carrossell.exe"), resources: join(dir, "resources") }))
      : ["/Applications", join(homedir(), "Applications")].map((dir) => ({
          exe: join(dir, "Carrossell.app", "Contents", "MacOS", "Carrossell"),
          resources: join(dir, "Carrossell.app", "Contents", "Resources"),
        }));
  const found = installs.find((i) => existsSync(i.exe) && existsSync(join(i.resources, "app.asar")));
  return found && { exe: found.exe, script: join(found.resources, "app.asar", "cli", "carrossell.mjs") };
}

async function carrossell(args: string[], signal?: AbortSignal): Promise<unknown> {
  const command = carrossellCommand();
  if (!command)
    throw new Error("Não encontrei o Carrossell instalado neste computador. Preencha a marca à mão.");
  // No shell: the executable runs the CLI as Node, and the arguments are literals or validated ids.
  const stdout = await runProcess(command.exe, [command.script, ...args], {
    signal,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
  });
  try {
    return JSON.parse(stdout);
  } catch {
    throw new Error("O Carrossell não respondeu com a marca. Abra o Carrossell e tente de novo.");
  }
}

export async function carrossellProfiles(signal?: AbortSignal) {
  const data = (await carrossell(["perfis"], signal)) as {
    active?: string;
    profiles?: { id: string; name: string }[];
  };
  return {
    active: data.active,
    profiles: (data.profiles ?? []).map(({ id, name }) => ({ id, name })),
  };
}

/** Maps `carrossell marca` output to a CutRoom brand. */
export function brandFromCarrossell(data: Record<string, any>): Brand {
  const profile = data.profile ?? {},
    info = data.brandInfo ?? {},
    palette = info.palette ?? {};
  if (!String(profile.brandContext ?? "").trim())
    fail("Este perfil do Carrossell ainda não tem o Contexto da Marca aprovado.");
  return validateBrand({
    name: profile.brand || info.name || data.drafts?.brandName || "Minha marca",
    handle: info.handle || data.media?.handle || undefined,
    context: profile.brandContext,
    designKit: profile.designKit || undefined,
    palette: {
      accent: HEX.test(palette.accent ?? "") ? palette.accent : "#ff6b0b",
      ink: HEX.test(palette.ink ?? "") ? palette.ink : "#151515",
      paper: HEX.test(palette.paper ?? "") ? palette.paper : "#ffffff",
      ...(HEX.test(palette.soft ?? "") ? { soft: palette.soft } : {}),
    },
    logo:
      typeof info.avatar === "string" && /^data:image\/(png|jpeg|webp);base64,/.test(info.avatar) && info.avatar.length < 2_000_000
        ? info.avatar
        : undefined,
    source: "carrossell",
    profileId: data.profileId || undefined,
  });
}

export async function importCarrossellBrand(profileId?: string, signal?: AbortSignal) {
  if (profileId !== undefined && !/^[\w-]{1,100}$/.test(profileId)) fail("Perfil inválido.");
  const data = (await carrossell(["marca", ...(profileId ? ["--perfil", profileId] : [])], signal)) as Record<string, any>;
  return brandFromCarrossell(data);
}

import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { z } from "zod";
import { assertProfileId } from "../../src/shared/profile";

/**
 * Brand library (was "Provas da marca"): what the user wants the videos to use and to look like.
 * - photo / screenshot / recording: real media the video may show;
 * - result / testimonial: proofs (a file is optional);
 * - style: a visual reference the videos should resemble (never shown in the video);
 * - rules.json: plain-language rules the AI follows on every video.
 */
const extensions = new Set([".png", ".jpg", ".jpeg", ".webp", ".mp4"]);
export const BRAND_KINDS = ["photo", "screenshot", "recording", "testimonial", "result", "style"] as const;
const proofSchema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).default(""),
  kind: z.enum(BRAND_KINDS),
  extension: z.enum([".png", ".jpg", ".jpeg", ".webp", ".mp4"]).optional(),
  createdAt: z.string().optional(),
});
export type BrandProof = z.infer<typeof proofSchema> & { visual?: boolean };
const rulesSchema = z.object({ rules: z.array(z.string().trim().min(1).max(300)).max(30) });

/** A file the video can show (styles guide the look but never appear). */
export const isVisual = (p: Pick<BrandProof, "kind" | "extension">) => !!p.extension && p.kind !== "style";

/** "foto-produto_final.JPG" → "Foto produto final" */
export function titleFromName(file: string) {
  const name = basename(file).replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  return (name ? name[0].toUpperCase() + name.slice(1) : "Arquivo").slice(0, 120);
}

export class BrandProofStore {
  constructor(private userDir: string) {}

  private dir(profileId: string) {
    return join(this.userDir, "brand-proofs", assertProfileId(profileId));
  }

  async list(profileId: string): Promise<BrandProof[]> {
    const dir = this.dir(profileId);
    const files = await readdir(dir).catch((error) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
    const records: BrandProof[] = [];
    for (const file of files.filter((name) => /^[0-9a-f-]{36}\.json$/i.test(name))) {
      const entry = proofSchema.safeParse(JSON.parse(await readFile(join(dir, file), "utf8")));
      if (entry.success) records.push({ ...entry.data, visual: isVisual(entry.data) });
    }
    return records.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  }

  async add(profileId: string, metadata: { title?: string; description?: string; kind: BrandProof["kind"] }, source?: string) {
    const id = randomUUID();
    const extension = source ? extname(source).toLowerCase() : undefined;
    if (source) {
      const file = await stat(source);
      if (!extension || !extensions.has(extension) || !file.isFile() || file.size > 60 * 1024 * 1024)
        throw new Error("Selecione uma imagem (PNG, JPG, WebP) ou um MP4 de até 60 MB.");
    }
    if (metadata.kind === "recording" && extension !== ".mp4") throw new Error("Gravação precisa ser um MP4.");
    if ((metadata.kind === "photo" || metadata.kind === "screenshot" || metadata.kind === "style") && (!extension || extension === ".mp4"))
      throw new Error("Selecione uma imagem.");
    const record = proofSchema.parse({
      ...metadata,
      title: metadata.title?.trim() || (source ? titleFromName(source) : ""),
      id,
      extension,
      createdAt: new Date().toISOString(),
    });
    const dir = this.dir(profileId);
    await mkdir(dir, { recursive: true });
    if (source && extension) await copyFile(source, join(dir, id + extension));
    const manifest = join(dir, id + ".json");
    await writeFile(manifest + ".partial", JSON.stringify(record), "utf8");
    await rename(manifest + ".partial", manifest);
    return { ...record, visual: isVisual(record) };
  }

  async update(profileId: string, id: string, patch: { title?: string; description?: string; kind?: BrandProof["kind"] }) {
    const current = (await this.list(profileId)).find((p) => p.id === id);
    if (!current) throw new Error("Item não encontrado.");
    const { visual: _v, ...base } = current;
    const next = proofSchema.parse({ ...base, ...patch });
    const manifest = join(this.dir(profileId), id + ".json");
    await writeFile(manifest + ".partial", JSON.stringify(next), "utf8");
    await rename(manifest + ".partial", manifest);
    return { ...next, visual: isVisual(next) };
  }

  async remove(profileId: string, id: string) {
    const current = (await this.list(profileId)).find((p) => p.id === id);
    if (!current) return { removed: false };
    await rm(join(this.dir(profileId), id + ".json"), { force: true });
    if (current.extension) await rm(join(this.dir(profileId), id + current.extension), { force: true });
    return { removed: true };
  }

  async asset(profileId: string, proofId: string) {
    const proof = (await this.list(profileId)).find((item) => item.id === proofId);
    if (!proof?.extension) throw new Error("Este item não tem um arquivo anexado.");
    return { proof, path: join(this.dir(profileId), proof.id + proof.extension) };
  }

  async rules(profileId: string) {
    try {
      return rulesSchema.parse(JSON.parse(await readFile(join(this.dir(profileId), "rules.json"), "utf8"))).rules;
    } catch {
      return [];
    }
  }

  async setRules(profileId: string, rules: string[]) {
    const clean = rulesSchema.parse({ rules: rules.map((r) => r.trim()).filter(Boolean) });
    const dir = this.dir(profileId);
    await mkdir(dir, { recursive: true });
    const file = join(dir, "rules.json");
    await writeFile(file + ".partial", JSON.stringify(clean), "utf8");
    await rename(file + ".partial", file);
    return clean.rules;
  }
}

import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { z } from "zod";
import { assertProfileId } from "../../src/shared/profile";

const extensions = new Set([".png", ".jpg", ".jpeg", ".webp", ".mp4"]);
const proofSchema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(500),
  kind: z.enum(["screenshot", "recording", "testimonial", "result"]),
  extension: z.enum([".png", ".jpg", ".jpeg", ".webp", ".mp4"]).optional(),
});
export type BrandProof = z.infer<typeof proofSchema>;

export class BrandProofStore {
  constructor(private userDir: string) {}

  private dir(profileId: string) {
    return join(this.userDir, "brand-proofs", assertProfileId(profileId));
  }

  async list(profileId: string) {
    const dir = this.dir(profileId);
    const files = await readdir(dir).catch((error) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
    const records: BrandProof[] = [];
    for (const file of files.filter((name) => /^[0-9a-f-]{36}\.json$/i.test(name))) {
      const entry = proofSchema.safeParse(JSON.parse(await readFile(join(dir, file), "utf8")));
      if (entry.success) records.push(entry.data);
    }
    return records;
  }

  async add(profileId: string, metadata: Pick<BrandProof, "title" | "description" | "kind">, source?: string) {
    const id = randomUUID();
    const extension = source ? extname(source).toLowerCase() : undefined;
    if (source) {
      const file = await stat(source);
      if (!extension || !extensions.has(extension) || !file.isFile() || file.size > 60 * 1024 * 1024)
        throw new Error("Selecione uma imagem ou um MP4 de até 60 MB.");
    }
    if ((metadata.kind === "recording" && extension !== ".mp4") ||
      (metadata.kind === "screenshot" && (!extension || extension === ".mp4")))
      throw new Error("Selecione um arquivo compatível com o tipo de prova.");
    const record = proofSchema.parse({ ...metadata, id, extension });
    const dir = this.dir(profileId);
    await mkdir(dir, { recursive: true });
    if (source && extension) await copyFile(source, join(dir, id + extension));
    const manifest = join(dir, id + ".json");
    await writeFile(manifest + ".partial", JSON.stringify(record), "utf8");
    await rename(manifest + ".partial", manifest);
    return record;
  }

  async asset(profileId: string, proofId: string) {
    const proof = (await this.list(profileId)).find((item) => item.id === proofId);
    if (!proof?.extension) throw new Error("Esta prova não tem um arquivo anexado.");
    return { proof, path: join(this.dir(profileId), proof.id + proof.extension) };
  }
}


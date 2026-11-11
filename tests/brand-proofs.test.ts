import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BrandProofStore } from "../electron/core/brand-proofs";

describe("Brand proof library", () => {
  it("keeps copies inside the owning profile and blocks traversal", async () => {
    const dir = await mkdtemp(join(tmpdir(), "brand-proofs-test-"));
    try {
      const store = new BrandProofStore(dir);
      const image = join(dir, "original.png");
      await writeFile(image, "image fixture");
      const record = await store.add("profile-a", {
        kind: "screenshot", title: "Real product screen", description: "Shows order status",
      }, image);
      await rm(image);
      const asset = await store.asset("profile-a", record.id);
      expect(await readFile(asset.path, "utf8")).toBe("image fixture");
      expect(await store.list("profile-b")).toEqual([]);
      await expect(store.asset("profile-b", record.id)).rejects.toThrow();
      await expect(store.list("../profile-a")).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});


describe("Biblioteca da marca", () => {
  it("adds files with titles from the name, keeps style out of the video, stores rules and removes items", async () => {
    const { BrandProofStore, titleFromName } = await import("../electron/core/brand-proofs");
    const { promises: fsp } = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const dir = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "brand-lib-")));
    const photo = path.join(dir, "foto-produto_final.png");
    await fsp.writeFile(photo, Buffer.from("89504e470d0a1a0a", "hex"));
    const store = new BrandProofStore(dir);
    const added = await store.add("perfil", { kind: "photo" }, photo);
    expect(added.title).toBe("Foto produto final");
    expect(added.visual).toBe(true);
    const style = await store.add("perfil", { kind: "style", description: "tons pastel" }, photo);
    expect(style.visual).toBe(false);
    await expect(store.add("perfil", { kind: "photo" })).rejects.toThrow(/imagem/);
    expect(await store.setRules("perfil", ["  nunca prometer resultado ", "", "terminar com o link"])).toEqual(["nunca prometer resultado", "terminar com o link"]);
    expect(await store.rules("perfil")).toHaveLength(2);
    await store.remove("perfil", style.id);
    expect((await store.list("perfil")).map((i) => i.kind)).toEqual(["photo"]);
    expect(titleFromName("C:/x/Print-da_tela.JPG")).toBe("Print da tela");
    await fsp.rm(dir, { recursive: true, force: true });
  });
});

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


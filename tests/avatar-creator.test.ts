import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLocalAvatarStarters } from "../electron/core/avatar-creator";
import { AvatarService } from "../electron/core/avatar-service";
import { AvatarStore } from "../electron/core/avatar-store";
import {
  analyzeReferenceWithConsent,
  referenceRemoteName,
  replaceAvatarPartColor,
  visionModels,
} from "../src/components/studio/AvatarCreator";
import { avatarHash, parseAvatar, reviseAvatar } from "../src/shared/avatar";
import type { Connection } from "../src/shared/types";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function realService() {
  const root = await mkdtemp(join(tmpdir(), "avatar-creator-test-"));
  roots.push(root);
  return new AvatarService({
    store: new AvatarStore(root),
    renderer: async () => {
      throw new Error("Render não é necessário neste teste.");
    },
  });
}

const connection: Connection = {
  status: "connected",
  provider: "anthropic",
  models: [
    { id: "text-only", name: "Modelo texto", supportsVision: false },
    { id: "vision-real", name: "Claude Sonnet real", supportsVision: true },
  ],
};

describe("AvatarCreator local starters", () => {
  it("clones the three authored bases through the real service with distinct real hashes", async () => {
    const service = await realService();
    const examplesDir = resolve("resources/avatar-engine/examples");
    const before = await readFile(join(examplesDir, "strategist.json"), "utf8");
    const created = await createLocalAvatarStarters({
      service,
      examplesDir,
      avatarId: "avatar-local-test",
      description: "Apresentador técnico, direto e cordial",
    });

    expect(created.candidates).toHaveLength(3);
    expect(created.candidates.map((candidate) => candidate.baseId)).toEqual([
      "strategist",
      "companion",
      "expert",
    ]);
    expect(new Set(created.candidates.map((candidate) => candidate.hash)).size).toBe(3);
    expect(created.candidates.every((candidate) => candidate.avatarId === "avatar-local-test")).toBe(true);
    expect(created.description).toBe("Apresentador técnico, direto e cordial");
    expect((await service.getCandidate("avatar-local-test", created.candidates[0].candidateId)).description)
      .toBe("Apresentador técnico, direto e cordial");
    expect(await readFile(join(examplesDir, "strategist.json"), "utf8")).toBe(before);
  }, 30_000);

  it("rejects invalid IDs and empty descriptions before touching the service", async () => {
    const service = { createCandidates: vi.fn() };
    for (const input of [
      { avatarId: "../escape", description: "Descrição" },
      { avatarId: "avatar-valid", description: "   " },
    ]) {
      await expect(createLocalAvatarStarters({
        service,
        examplesDir: resolve("resources/avatar-engine/examples"),
        ...input,
      })).rejects.toThrow();
    }
    expect(service.createCandidates).not.toHaveBeenCalled();
  });
});

describe("AvatarCreator part-only editing", () => {
  it("recolors only the authorized part without rewriting palette, identity or other parts", async () => {
    const original = parseAvatar(JSON.parse(await readFile(
      resolve("resources/avatar-engine/examples/strategist.json"), "utf8",
    )));
    const next = replaceAvatarPartColor(original, "mouth", "mouth", "accent");

    expect(next).not.toBe(original);
    expect(next.palette).toEqual(original.palette);
    expect(next.identity).toEqual(original.identity);
    expect(next.parts.find((part) => part.id === "mouth")?.primitives)
      .not.toEqual(original.parts.find((part) => part.id === "mouth")?.primitives);
    for (const part of original.parts.filter((part) => part.id !== "mouth")) {
      expect(next.parts.find((candidate) => candidate.id === part.id)).toEqual(part);
    }
    expect(avatarHash(next)).not.toBe(avatarHash(original));
    expect(() => reviseAvatar(original, next, ["mouth"])).not.toThrow();
    expect(() => reviseAvatar(original, next, ["head"])).toThrow(/without|allowedPartIds/i);
  });
});

describe("AvatarCreator reference privacy", () => {
  it("never calls the provider without explicit consent and names the real remote provider/model", async () => {
    const analyze = vi.fn(async (input: { providerId: string; prompt: string }) => input);
    await expect(analyzeReferenceWithConsent({
      connection,
      modelId: "vision-real",
      consent: false,
      prompt: "Descreva os traços visíveis",
    }, analyze)).rejects.toThrow(/consentimento/i);
    expect(analyze).not.toHaveBeenCalled();

    await expect(analyzeReferenceWithConsent({
      connection,
      modelId: "vision-real",
      consent: true,
      prompt: "Descreva os traços visíveis",
    }, analyze)).resolves.toEqual({
      providerId: "vision-real",
      prompt: "Descreva os traços visíveis",
    });
    expect(analyze).toHaveBeenCalledTimes(1);
    expect(referenceRemoteName(connection, "vision-real")).toBe(
      "Claude API · Claude Sonnet real (vision-real)",
    );
  });

  it("filters out models without supportsVision while leaving the local flow independent", () => {
    expect(visionModels(connection).map((model) => model.id)).toEqual(["vision-real"]);
    expect(visionModels({ ...connection, models: [] })).toEqual([]);
    expect(referenceRemoteName({ ...connection, models: [] }, "")).toBe("Nenhum modelo remoto com visão conectado");
  });
});

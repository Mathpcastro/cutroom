import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AvatarStore } from "../electron/core/avatar-store";
import {
  AvatarVision,
  type AvatarVisionProvider,
} from "../electron/core/avatar-vision";
import {
  createAvatarToolDispatcher,
  type AvatarToolService,
} from "../electron/core/avatar-mcp";
import { avatarFixture } from "./fixtures/avatar-fixture";

const roots: string[] = [];
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function setup(provider?: AvatarVisionProvider) {
  const root = await mkdtemp(join(tmpdir(), "avatar-vision-"));
  roots.push(root);
  const source = join(root, "source.png");
  await writeFile(source, PNG);
  const store = new AvatarStore(join(root, "avatars"));
  const asset = await store.importReference({
    avatarId: "videosell-presenter",
    path: source,
  });
  const analyze = vi.fn(async (_request: any) => ({
    identityAnchors: { head: { x: 48, y: 28 }, "eye.left": { x: 40, y: 27 } },
    inferredFields: [
      {
        field: "hair.back",
        value: "occluded",
        reason: "A parte posterior não aparece na referência.",
      },
      {
        field: "hand.left",
        value: "ambiguous",
        reason: "A mão está parcialmente oculta.",
      },
    ],
  }));
  const selected = provider ?? {
    id: "vision-model",
    supportsVision: true,
    analyze,
  };
  const vision = new AvatarVision({
    store,
    provider: (providerId) =>
      selected.id === providerId ? selected : undefined,
  });
  return { root, store, asset, analyze, vision, selected };
}

describe("bounded avatar reference vision", () => {
  it("sends only the imported image to the selected vision model and validates structured anchors", async () => {
    const { asset, analyze, vision } = await setup();
    await expect(
      vision.analyzeReference({
        avatarId: asset.avatarId,
        assetId: asset.assetId,
        providerId: "vision-model",
        prompt: "Extraia as âncoras",
      }),
    ).resolves.toEqual({
      avatarId: asset.avatarId,
      assetId: asset.assetId,
      providerId: "vision-model",
      identityAnchors: { head: { x: 48, y: 28 }, "eye.left": { x: 40, y: 27 } },
      inferredFields: [
        {
          field: "hair.back",
          value: "occluded",
          reason: "A parte posterior não aparece na referência.",
        },
        {
          field: "hand.left",
          value: "ambiguous",
          reason: "A mão está parcialmente oculta.",
        },
      ],
    });
    expect(analyze).toHaveBeenCalledTimes(1);
    const request = analyze.mock.calls[0][0];
    expect(request.image).toEqual({
      mimeType: "image/png",
      data: PNG.toString("base64"),
    });
    expect(request.prompt).toContain("Extraia as âncoras");
    expect(request.prompt).toContain("inferredFields");
    expect(request.prompt).not.toContain(PNG.toString("base64"));
    expect(request).not.toHaveProperty("package");
  });

  it("rejects missing and text-only providers without reading or sending the image", async () => {
    const missing = await setup();
    await expect(
      missing.vision.analyzeReference({
        avatarId: missing.asset.avatarId,
        assetId: missing.asset.assetId,
        providerId: "unknown",
        prompt: "Analise",
      }),
    ).rejects.toThrow(/provider|modelo|visão/i);
    expect(missing.analyze).not.toHaveBeenCalled();

    const analyze = vi.fn();
    const textOnly = await setup({
      id: "text-only",
      supportsVision: false,
      analyze,
    });
    await expect(
      textOnly.vision.analyzeReference({
        avatarId: textOnly.asset.avatarId,
        assetId: textOnly.asset.assetId,
        providerId: "text-only",
        prompt: "Analise",
      }),
    ).rejects.toThrow(/visão|imagem/i);
    expect(analyze).not.toHaveBeenCalled();
  });

  it("rejects malformed responses and never assembles an avatar package outside the schema", async () => {
    const analyze = vi.fn(async (): Promise<any> => ({
      identityAnchors: { head: { x: "unknown" } },
      inferredFields: [],
    }));
    const { asset, vision } = await setup({
      id: "vision-model",
      supportsVision: true,
      analyze,
    });
    await expect(
      vision.analyzeReference({
        avatarId: asset.avatarId,
        assetId: asset.assetId,
        providerId: "vision-model",
        prompt: "Analise",
      }),
    ).rejects.toThrow(/resposta|inválida/i);

    analyze.mockResolvedValue({
      ...avatarFixture(),
      identityAnchors: {},
      inferredFields: [],
    });
    await expect(
      vision.analyzeReference({
        avatarId: asset.avatarId,
        assetId: asset.assetId,
        providerId: "vision-model",
        prompt: "Analise",
      }),
    ).rejects.toThrow(/resposta|inválida/i);
  });

  it("sanitizes credentials, bearer tokens and image data from provider errors", async () => {
    const secret = "sk-avatar-secret-123";
    const analyze = vi.fn(async () => {
      throw new Error(
        `${secret} Bearer private-token api_key=another-secret data:image/png;base64,${PNG.toString("base64")}`,
      );
    });
    const { asset, vision } = await setup({
      id: "vision-model",
      supportsVision: true,
      analyze,
    });
    const failure = (await vision
      .analyzeReference({
        avatarId: asset.avatarId,
        assetId: asset.assetId,
        providerId: "vision-model",
        prompt: "Analise",
      })
      .catch((error: Error) => error)) as Error;
    expect(failure).toBeInstanceOf(Error);
    expect(failure.message).not.toContain(secret);
    expect(failure.message).not.toContain("private-token");
    expect(failure.message).not.toContain("another-secret");
    expect(failure.message).not.toContain(PNG.toString("base64"));
    expect(failure.message).not.toContain("data:image");
  });

  it("makes zero provider calls during import and deterministic local MCP operations", async () => {
    const { store, asset, analyze, vision } = await setup();
    const service: AvatarToolService = {
      getContract: vi.fn(() => ({})),
      createCandidate: vi.fn(async () => ({})),
      renderRevision: vi.fn(async () => ({})),
      validateRevision: vi.fn(async () => ({ ok: true })),
      reviewCandidate: vi.fn(async () => ({})),
      selectCandidate: vi.fn(async () => ({})),
      revisePart: vi.fn(async () => ({})),
      saveRevision: vi.fn(async () => ({})),
      compareRevisions: vi.fn(async () => ({})),
      cancel: vi.fn(() => false),
    };
    const call = createAvatarToolDispatcher({
      service,
      store,
      vision,
      render: {
        engineDir: "/engine",
        runner: async () => ({ worker: "/worker", browser: "/browser" }),
      },
    });
    const avatar = avatarFixture();
    await call("avatar_get_contract", {});
    await call("avatar_create_candidate", { package: avatar });
    await call("avatar_render", {
      avatarId: avatar.id,
      revision: 1,
      sheets: ["neutral", "silhouette"],
    });
    await call("avatar_validate", { avatarId: avatar.id, revision: 1 });
    await call("avatar_revise_part", {
      avatarId: avatar.id,
      revision: 1,
      allowedPartIds: ["mouth"],
      package: avatar,
    });
    await call("avatar_cancel", { jobId: "missing" });
    const source = join(asset.path, "..", "..", "..", "..", "second.png");
    await writeFile(source, PNG);
    await call("avatar_import_reference", {
      avatarId: avatar.id,
      path: source,
    });
    expect(analyze).not.toHaveBeenCalled();
    expect(service.createCandidate).toHaveBeenCalledTimes(1);
    expect(service.renderRevision).toHaveBeenCalledTimes(1);
    expect(service.validateRevision).toHaveBeenCalledTimes(1);
    expect(await readFile(asset.path)).toEqual(PNG);
  });
});

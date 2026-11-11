import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  realpath,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { afterEach, describe, expect, it, vi, type TestContext } from "vitest";
import { AVATAR_TOOLS } from "../electron/core/avatar-tool-defs";
import {
  createAvatarToolDispatcher,
  type AvatarToolService,
} from "../electron/core/avatar-mcp";
import type {
  AvatarRenderOptions,
  AvatarRenderResult,
} from "../electron/core/avatar-render";
import { AvatarService } from "../electron/core/avatar-service";
import { AvatarStore } from "../electron/core/avatar-store";
import { EDITOR_TOOLS, toolResultContent } from "../electron/core/codex";
import { DesktopMcpServer } from "../electron/core/desktop-mcp";
import { avatarFixture } from "./fixtures/avatar-fixture";

const roots: string[] = [];
const servers: DesktopMcpServer[] = [];

afterEach(async () => {
  servers.splice(0).forEach((server) => server.close());
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function tempRoot() {
  // Real path: on Windows runners tmpdir() may be an 8.3 short name (RUNNER~1) and the store resolves it.
  const root = await realpath(await mkdtemp(join(tmpdir(), "avatar-mcp-")));
  roots.push(root);
  return root;
}

const names = [
  "avatar_get_contract",
  "avatar_create_candidate",
  "avatar_render",
  "avatar_validate",
  "avatar_review",
  "avatar_select_candidate",
  "avatar_revise_part",
  "avatar_save_revision",
  "avatar_compare_revisions",
  "avatar_cancel",
  "avatar_import_reference",
  "avatar_analyze_reference",
] as const;

function fakeService(): AvatarToolService {
  const selected = {
    avatarId: "videosell-presenter",
    candidateId: "candidate-1",
    revision: 1,
  };
  return {
    getContract: vi.fn(() => ({ schemaVersion: 1 })),
    createCandidate: vi.fn(async (input) => ({
      avatarId: "videosell-presenter",
      input,
      candidates: [],
    })),
    renderRevision: vi.fn(async (input) => ({
      ...input,
      complete: true,
      files: [],
      manifest: [],
      imageUrl: "data:image/jpeg;base64,/9g=",
    })),
    validateRevision: vi.fn(async (input) => ({ ok: true, input })),
    reviewCandidate: vi.fn(async (input) => input),
    selectCandidate: vi.fn(async (avatarId, candidateId) => ({
      ...selected,
      avatarId,
      candidateId,
    })),
    revisePart: vi.fn(async (input) => ({
      ...selected,
      input,
      changedPartIds: [],
    })),
    saveRevision: vi.fn(async (input) => ({ ...selected, ...input })),
    compareRevisions: vi.fn(async (input) => input),
    cancel: vi.fn(() => true),
  };
}

function dispatcher(
  service = fakeService(),
  store?: AvatarStore,
  vision?: { analyzeReference(input: any): Promise<any> },
) {
  return createAvatarToolDispatcher({
    service,
    store: store ?? ({ importReference: vi.fn() } as unknown as AvatarStore),
    vision: vision ?? { analyzeReference: async (input) => input },
    render: {
      engineDir: "/avatar-engine",
      runner: async () => ({ worker: "/worker", browser: "/browser" }),
    },
  });
}

const rubric = {
  identity: 20,
  silhouette: 15,
  pixelCraft: 15,
  palette: 15,
  expressions: 15,
  rig: 15,
  export: 5,
};

describe("avatar MCP contract", () => {
  it("registers exactly twelve unique strict tools through the shared editor list", () => {
    expect(AVATAR_TOOLS.map((tool) => tool.name)).toEqual(names);
    expect(
      EDITOR_TOOLS.filter((tool) => tool.name.startsWith("avatar_")).map(
        (tool) => tool.name,
      ),
    ).toEqual(names);
    expect(new Set(EDITOR_TOOLS.map((tool) => tool.name)).size).toBe(
      EDITOR_TOOLS.length,
    );
    for (const tool of AVATAR_TOOLS) {
      expect(tool.inputSchema).toMatchObject({
        type: "object",
        additionalProperties: false,
      });
      expect(tool.inputSchema.required).toEqual(expect.any(Array));
      expect(tool.inputSchema.properties).not.toHaveProperty("destination");
    }
    const byName: Record<string, any> = Object.fromEntries(
      AVATAR_TOOLS.map((tool) => [tool.name, tool.inputSchema]),
    );
    expect(byName.avatar_create_candidate.required).toEqual(["package"]);
    expect(byName.avatar_create_candidate.properties).toHaveProperty(
      "referenceAssetId",
    );
    expect(byName.avatar_revise_part.required).toEqual([
      "avatarId",
      "revision",
      "allowedPartIds",
      "package",
    ]);
    expect(byName.avatar_render.required).toEqual([
      "avatarId",
      "revision",
      "sheets",
    ]);
    expect(byName.avatar_render.properties.sheets.items.enum).toEqual([
      "neutral",
      "silhouette",
      "grayscale",
      "backgrounds",
      "expressions",
      "mouths",
      "motion",
    ]);
    expect(byName.avatar_import_reference.required).toEqual([
      "avatarId",
      "path",
    ]);
    expect(byName.avatar_analyze_reference.required).toEqual([
      "avatarId",
      "assetId",
      "providerId",
      "prompt",
    ]);
    expect(byName.avatar_review.properties.rubric.required).toEqual(
      Object.keys(rubric),
    );
    expect(byName.avatar_review.properties.rubric.additionalProperties).toBe(
      false,
    );
  });

  it("maps every MCP call to the shared service, store or bounded vision adapter", async () => {
    const service = fakeService();
    const store = {
      importReference: vi.fn(async (input) => input),
    } as unknown as AvatarStore;
    const vision = { analyzeReference: vi.fn(async (input) => input) };
    const call = dispatcher(service, store, vision);
    const avatar = avatarFixture();

    await call("avatar_get_contract", {});
    await call("avatar_create_candidate", {
      avatarId: avatar.id,
      package: avatar,
    });
    await call("avatar_render", {
      avatarId: avatar.id,
      revision: 2,
      sheets: ["neutral", "motion"],
    });
    await call("avatar_validate", { avatarId: avatar.id, revision: 2 });
    await call("avatar_review", {
      avatarId: avatar.id,
      candidateId: "candidate-1",
      rubric,
      evidence: ["native.png"],
      manualApproved: true,
    });
    await call("avatar_select_candidate", {
      avatarId: avatar.id,
      candidateId: "candidate-1",
    });
    await call("avatar_revise_part", {
      avatarId: avatar.id,
      revision: 2,
      allowedPartIds: ["mouth"],
      package: avatar,
    });
    await call("avatar_save_revision", {
      avatarId: avatar.id,
      candidateId: "candidate-1",
    });
    await call("avatar_compare_revisions", {
      avatarId: avatar.id,
      leftRevision: 1,
      rightRevision: 2,
    });
    await expect(call("avatar_cancel", { jobId: "render-1" })).resolves.toBe(
      true,
    );
    await call("avatar_import_reference", {
      avatarId: avatar.id,
      path: "C:\\reference.png",
    });
    await call("avatar_analyze_reference", {
      avatarId: avatar.id,
      assetId: "reference-1-png",
      providerId: "vision-model",
      prompt: "Analise",
    });

    expect(service.getContract).toHaveBeenCalledWith();
    expect(service.createCandidate).toHaveBeenCalledWith({
      description: "Candidato criado via MCP",
      package: avatar,
    });
    expect(service.renderRevision).toHaveBeenCalledWith({
      avatarId: avatar.id,
      revision: 2,
      sheets: ["neutral", "motion"],
      engineDir: "/avatar-engine",
      runner: { worker: "/worker", browser: "/browser" },
    });
    expect(service.validateRevision).toHaveBeenCalledWith({
      avatarId: avatar.id,
      revision: 2,
    });
    expect(service.reviewCandidate).toHaveBeenCalledWith({
      avatarId: avatar.id,
      candidateId: "candidate-1",
      rubric,
      evidence: ["native.png"],
      manualApproved: true,
    });
    expect(service.selectCandidate).toHaveBeenCalledWith(
      avatar.id,
      "candidate-1",
    );
    expect(service.revisePart).toHaveBeenCalledWith({
      avatarId: avatar.id,
      revision: 2,
      allowedPartIds: ["mouth"],
      package: avatar,
    });
    expect(service.saveRevision).toHaveBeenCalledWith({
      avatarId: avatar.id,
      candidateId: "candidate-1",
    });
    expect(service.compareRevisions).toHaveBeenCalledWith({
      avatarId: avatar.id,
      leftRevision: 1,
      rightRevision: 2,
    });
    expect(service.cancel).toHaveBeenCalledWith("render-1");
    expect(store.importReference).toHaveBeenCalledWith({
      avatarId: avatar.id,
      path: "C:\\reference.png",
    });
    expect(vision.analyzeReference).toHaveBeenCalledWith({
      avatarId: avatar.id,
      assetId: "reference-1-png",
      providerId: "vision-model",
      prompt: "Analise",
    });
  });

  it("rejects unknown fields, arbitrary destinations, ID mismatches and oversized packages before dispatch", async () => {
    const service = fakeService();
    const call = dispatcher(service);
    const avatar = avatarFixture();
    await expect(
      call("avatar_import_reference", {
        avatarId: avatar.id,
        path: "/tmp/a.png",
        destination: "/tmp/out",
      } as never),
    ).rejects.toThrow();
    await expect(
      call("avatar_get_contract", { path: "/tmp/a.png" } as never),
    ).rejects.toThrow();
    await expect(
      call("avatar_create_candidate", {
        avatarId: "another-avatar",
        package: avatar,
      }),
    ).rejects.toThrow(/avatarId/i);
    const oversized = avatarFixture();
    oversized.artBible.notes = ["x".repeat(270_000)];
    expect(Buffer.byteLength(JSON.stringify(oversized))).toBeLessThan(
      1_000_000,
    );
    await expect(
      call("avatar_create_candidate", { package: oversized }),
    ).rejects.toThrow(/256|tamanho|limite/i);
    expect(service.createCandidate).not.toHaveBeenCalled();
    expect(service.renderRevision).not.toHaveBeenCalled();
  });

  it("returns one host-owned JPEG plus native PNG paths and pixel hashes", async () => {
    const service = fakeService();
    const png = "C:\\avatar\\revisions\\1\\neutral.png";
    service.renderRevision = vi.fn(async () => ({
      complete: true,
      files: [
        {
          sheet: "neutral",
          png,
          hash: "a".repeat(64),
          contentHash: "b".repeat(64),
        },
      ],
      hashes: { neutral: "a".repeat(64) },
      manifest: [{ path: png, pixelHash: "a".repeat(64) }],
      networkRequests: [],
      errors: [],
      imageUrl: "data:image/jpeg;base64,/9g=",
    }));
    const result = await dispatcher(service)("avatar_render", {
      avatarId: "videosell-presenter",
      revision: 1,
      sheets: ["neutral"],
    });
    expect(result).toMatchObject({
      networkRequests: [],
      files: [{ png, hash: "a".repeat(64) }],
    });
    const content = toolResultContent(result);
    expect(content.filter((item) => item.type === "inputImage")).toHaveLength(
      1,
    );
    expect(content[0]).toMatchObject({ type: "inputText" });
    const text = content[0].type === "inputText" ? content[0].text : "";
    expect(text).toContain(png.replaceAll("\\", "\\\\"));
    expect(text).not.toContain("imageUrl");
  });

  it("keeps the authenticated loopback request limit at 1 MiB", async () => {
    const dir = await tempRoot();
    const server = new DesktopMcpServer(async () => ({}), dir);
    servers.push(server);
    const url = await server.start();
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${server.token}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "avatar_create_candidate",
          arguments: { package: { data: "x".repeat(1_000_100) } },
        },
      }),
    });
    expect(response.status).toBe(413);
  });

  it("cancels a blocked real render concurrently through authenticated Desktop MCP", async () => {
    const root = await tempRoot();
    let rejectRenderer!: (error: unknown) => void;
    let rendererSignal: AbortSignal | undefined;
    const renderer = vi.fn(
      (options: AvatarRenderOptions & { signal: AbortSignal }) =>
        new Promise<AvatarRenderResult>((_resolve, reject) => {
          rejectRenderer = reject;
          rendererSignal = options.signal;
          const abort = () =>
            reject(options.signal.reason ?? new Error("Render cancelado."));
          if (options.signal.aborted) abort();
          else options.signal.addEventListener("abort", abort, { once: true });
        }),
    );
    const store = new AvatarStore(join(root, "avatars"));
    const service = new AvatarService({ store, renderer });
    const created = await service.createCandidate({
      description: "Cancelamento MCP",
      package: avatarFixture(),
    });
    const selected = await service.selectCandidate(
      created.avatarId,
      created.candidates[0].candidateId,
    );
    const call = createAvatarToolDispatcher({
      service,
      store,
      vision: { analyzeReference: async () => ({}) },
      render: {
        engineDir: "/engine",
        runner: async () => ({ worker: "/worker", browser: "/browser" }),
      },
    });
    const contract = (await call("avatar_get_contract", {})) as any;
    const sheets = ["motion", "neutral"];
    const jobId = `render-${createHash("sha256")
      .update(
        JSON.stringify({
          avatarId: created.avatarId,
          revision: selected.revision,
          sheets: [...sheets].sort(),
        }),
        "utf8",
      )
      .digest("hex")
      .slice(0, 56)}`;

    const server = new DesktopMcpServer(call, root);
    servers.push(server);
    const url = await server.start();
    let requestId = 0;
    const rpc = async (name: string, args: Record<string, unknown>) => {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${server.token}`,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: ++requestId,
          method: "tools/call",
          params: { name, arguments: args },
        }),
      });
      return (await response.json()) as any;
    };
    const renderResponse = rpc("avatar_render", {
      avatarId: created.avatarId,
      revision: selected.revision,
      sheets,
    });
    await vi.waitFor(() => expect(renderer).toHaveBeenCalledTimes(1));

    const cancelResponse = rpc("avatar_cancel", { jobId });
    const respondedBeforeRenderFinished = await Promise.race([
      cancelResponse.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 150)),
    ]);
    if (!respondedBeforeRenderFinished) {
      // Let the RED case finish without waiting for Vitest's timeout.
      rejectRenderer(new Error("Renderer liberado após o RED."));
      await renderResponse;
      await cancelResponse;
    }
    expect(respondedBeforeRenderFinished).toBe(true);
    expect((await cancelResponse).result).toMatchObject({
      content: [{ type: "text", text: "true" }],
    });
    const rendered = await renderResponse;
    expect(rendered.result).toMatchObject({ isError: true });
    expect(rendered.result.content[0].text).toContain(jobId);
    expect(rendered.result.content[0].text).toMatch(/cancelado/i);
    expect(rendererSignal?.aborted).toBe(true);

    expect(contract.renderJobId.formula).toBe(
      "render- + sha256(JSON.stringify({ avatarId, revision, sheets: [...new Set(sheets ?? proofSheets)].sort() })).hex().slice(0, 56)",
    );
    const unrelated = await rpc("avatar_get_contract", {});
    expect(unrelated.result.isError).toBeFalsy();
    expect(JSON.parse(unrelated.result.content[0].text).schemaVersion).toBe(1);
  }, 20_000);
});

describe("avatar reference import", () => {
  const formats = [
    {
      extension: "png",
      mimeType: "image/png",
      bytes: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
        "base64",
      ),
    },
    {
      extension: "jpg",
      mimeType: "image/jpeg",
      bytes: Buffer.from([
        0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 0xff, 0xd9,
      ]),
    },
    {
      extension: "webp",
      mimeType: "image/webp",
      bytes: Buffer.from(
        "UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA",
        "base64",
      ),
    },
  ];

  it.each(formats)(
    "imports a real $extension into generated contained asset storage",
    async ({ extension, mimeType, bytes }) => {
      const root = await tempRoot();
      const source = join(root, `caller-controlled-name.${extension}`);
      await writeFile(source, bytes);
      const store = new AvatarStore(join(root, "avatars"));
      const result = (await dispatcher(fakeService(), store)(
        "avatar_import_reference",
        { avatarId: "videosell-presenter", path: source },
      )) as any;
      expect(result).toMatchObject({
        avatarId: "videosell-presenter",
        mimeType,
        size: bytes.length,
      });
      expect(result.assetId).toMatch(/^reference-/);
      expect(result.path).not.toBe(source);
      expect(
        relative(
          join(root, "avatars", "videosell-presenter", "assets"),
          result.path,
        ),
      ).not.toMatch(/^\.\./);
      expect(result.path).not.toContain("caller-controlled-name");
      expect(await readFile(result.path)).toEqual(bytes);
    },
  );

  it("rejects relative paths, false extensions, invalid signatures and large files", async () => {
    const root = await tempRoot();
    const store = new AvatarStore(join(root, "avatars"));
    const call = dispatcher(fakeService(), store);
    const png = join(root, "reference.png");
    await writeFile(png, formats[0].bytes);
    await expect(
      call("avatar_import_reference", {
        avatarId: "videosell-presenter",
        // A literal relative path: relative(cwd, png) returns an absolute path when the project and the
        // temp folder are on different drives (D: and C: on the GitHub Windows runner).
        path: join("referencias", "reference.png"),
      }),
    ).rejects.toThrow(/absolut/i);
    await expect(
      call("avatar_import_reference", {
        avatarId: "videosell-presenter",
        path: join(root, "reference.gif"),
      }),
    ).rejects.toThrow(/formato|PNG|JPEG|WebP/i);
    const falseExtension = join(root, "false.png");
    await writeFile(falseExtension, "not an image");
    await expect(
      call("avatar_import_reference", {
        avatarId: "videosell-presenter",
        path: falseExtension,
      }),
    ).rejects.toThrow(/assinatura|conteúdo|formato/i);
    const disguised = join(root, "disguised.png");
    await writeFile(disguised, formats[1].bytes);
    await expect(
      call("avatar_import_reference", {
        avatarId: "videosell-presenter",
        path: disguised,
      }),
    ).rejects.toThrow(/extens|coer/i);
    const large = join(root, "large.webp");
    await writeFile(
      large,
      Buffer.concat([formats[2].bytes, Buffer.alloc(10 * 1024 * 1024 + 1)]),
    );
    await expect(
      call("avatar_import_reference", {
        avatarId: "videosell-presenter",
        path: large,
      }),
    ).rejects.toThrow(/grande|limite|tamanho/i);
  });

  it("rejects traversal and a redirected assets destination", async (context: TestContext) => {
    const root = await tempRoot();
    const source = join(root, "reference.png");
    await writeFile(source, formats[0].bytes);
    const store = new AvatarStore(join(root, "avatars"));
    const call = dispatcher(fakeService(), store);
    await expect(
      call("avatar_import_reference", {
        avatarId: "../escape",
        path: source,
      } as never),
    ).rejects.toThrow();
    await expect(
      call("avatar_import_reference", {
        avatarId: "videosell-presenter",
        path: source,
        name: "../escape",
      } as never),
    ).rejects.toThrow();

    const avatarDir = join(root, "avatars", "videosell-presenter");
    const outside = join(root, "outside");
    await mkdir(avatarDir, { recursive: true });
    await mkdir(outside);
    try {
      await symlink(
        outside,
        join(avatarDir, "assets"),
        process.platform === "win32" ? "junction" : "dir",
      );
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (["EPERM", "EACCES", "ENOSYS"].includes(code ?? ""))
        context.skip(`Redirecionamento indisponível: ${code}`);
      throw error;
    }
    await expect(
      call("avatar_import_reference", {
        avatarId: "videosell-presenter",
        path: source,
      }),
    ).rejects.toThrow(/redirecionamento|symlink|conten|destino/i);
    expect(await readFile(source)).toEqual(formats[0].bytes);
  });
});

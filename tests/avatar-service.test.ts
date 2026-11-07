import { dirname, join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type {
  AvatarRenderOptions,
  AvatarRenderResult,
} from "../electron/core/avatar-render";
import { AvatarService } from "../electron/core/avatar-service";
import {
  avatarHash,
  canonicalAvatar,
  type AvatarPackage,
} from "../src/shared/avatar";
import { avatarFixture } from "./fixtures/avatar-fixture";

interface StoredCandidate {
  avatarId: string;
  candidateId: string;
  avatar: AvatarPackage;
  hash: string;
  path: string;
}

interface StoredRevision extends StoredCandidate {
  revision: number;
  bytes: string;
}

class FakeAvatarStore {
  readonly candidates = new Map<string, StoredCandidate>();
  readonly revisions = new Map<string, StoredRevision>();
  readonly metadata = new Map<string, unknown>();
  private readonly selections = new Map<string, string>();
  private nextCandidate = 1;

  private candidateKey(avatarId: string, candidateId: string) {
    return `${avatarId}/${candidateId}`;
  }

  private revisionKey(avatarId: string, revision: number) {
    return `${avatarId}/${revision}`;
  }

  private requireCandidate(avatarId: string, candidateId: string) {
    const candidate = this.candidates.get(
      this.candidateKey(avatarId, candidateId),
    );
    if (!candidate) throw new Error(`Candidato ${candidateId} não encontrado.`);
    return candidate;
  }

  async createCandidate(input: unknown) {
    const avatar = structuredClone(input as AvatarPackage);
    const avatarId = avatar.id;
    const candidateId = `candidate-${this.nextCandidate++}`;
    const candidate: StoredCandidate = {
      avatarId,
      candidateId,
      avatar,
      hash: avatarHash(avatar),
      path: join(
        "/fake-store",
        avatarId,
        "candidates",
        candidateId,
        "avatar.json",
      ),
    };
    this.candidates.set(this.candidateKey(avatarId, candidateId), candidate);
    return { avatarId, candidateId, hash: candidate.hash };
  }

  async loadCandidate(avatarId: string, candidateId: string) {
    const candidate = this.requireCandidate(avatarId, candidateId);
    return {
      avatar: structuredClone(candidate.avatar),
      hash: candidate.hash,
      path: candidate.path,
    };
  }

  async selectCandidate(avatarId: string, candidateId: string) {
    this.requireCandidate(avatarId, candidateId);
    this.selections.set(avatarId, candidateId);
  }

  async saveRevision(avatarId: string, candidateId: string) {
    if (this.selections.get(avatarId) !== candidateId) {
      throw new Error("Candidato não selecionado para este avatar.");
    }
    const candidate = this.requireCandidate(avatarId, candidateId);
    const existing = [...this.revisions.values()].find(
      (revision) =>
        revision.avatarId === avatarId &&
        revision.candidateId === candidateId &&
        revision.hash === candidate.hash,
    );
    if (existing) {
      return {
        revision: existing.revision,
        hash: existing.hash,
        path: existing.path,
      };
    }

    const revision =
      Math.max(
        0,
        ...[...this.revisions.values()]
          .filter((item) => item.avatarId === avatarId)
          .map((item) => item.revision),
      ) + 1;
    const stored: StoredRevision = {
      ...candidate,
      avatar: structuredClone(candidate.avatar),
      revision,
      bytes: canonicalAvatar(candidate.avatar),
      path: join(
        "/fake-store",
        avatarId,
        "revisions",
        String(revision),
        "avatar.json",
      ),
    };
    this.revisions.set(this.revisionKey(avatarId, revision), stored);
    return { revision, hash: stored.hash, path: stored.path };
  }

  async loadRevision(avatarId: string, revision: number) {
    const stored = this.revisions.get(this.revisionKey(avatarId, revision));
    if (!stored) throw new Error(`Revisão ${revision} não encontrada.`);
    return {
      avatar: structuredClone(stored.avatar),
      hash: stored.hash,
      path: stored.path,
    };
  }

  async readMetadata(avatarId: string, key: string) {
    const value = this.metadata.get(`${avatarId}/${key}`);
    return value === undefined ? undefined : structuredClone(value);
  }

  async writeMetadata(avatarId: string, key: string, value: unknown) {
    this.metadata.set(`${avatarId}/${key}`, structuredClone(value));
  }
}

function packages(): AvatarPackage[] {
  return ["strategist", "companion", "expert"].map((role) => {
    const avatar = avatarFixture();
    avatar.artBible.notes = [...avatar.artBible.notes, role];
    return avatar;
  });
}

function validRubric() {
  return {
    identity: 18,
    silhouette: 14,
    pixelCraft: 14,
    palette: 14,
    expressions: 14,
    rig: 14,
    export: 5,
  };
}

function changedMouth(avatar: AvatarPackage) {
  const changed = structuredClone(avatar);
  changed.mouths.X.mouth = { hidden: false };
  return changed;
}

function changedHair(avatar: AvatarPackage) {
  const changed = structuredClone(avatar);
  const hair = changed.parts.find((part) => part.id === "hair.front");
  if (!hair || hair.primitives[0].type !== "matrix") {
    throw new Error("Fixture hair matrix not found.");
  }
  hair.primitives[0].x += 1;
  return changed;
}

function renderResult(): AvatarRenderResult {
  return {
    complete: true,
    files: [],
    hashes: {},
    errors: [],
    networkRequests: [],
  };
}

function setup(
  renderer: (
    options: AvatarRenderOptions & { signal: AbortSignal },
  ) => Promise<AvatarRenderResult> = async () => renderResult(),
) {
  const store = new FakeAvatarStore();
  const service = new AvatarService({ store, renderer });
  return { service, store };
}

async function createThree(service: AvatarService) {
  return service.createCandidates({
    description: "Mascote de um SaaS financeiro",
    packages: packages(),
  });
}

async function review(
  service: AvatarService,
  avatarId: string,
  candidateId: string,
  // Deliberately exercise runtime rejection of malformed model scores.
  rubric: any = validRubric(),
  manualApproved?: boolean,
) {
  return service.reviewCandidate({
    avatarId,
    candidateId,
    rubric,
    evidence: ["neutral.png", "expressions.png"],
    ...(manualApproved === undefined ? {} : { manualApproved }),
  });
}

describe("AvatarService", { timeout: 60_000 }, () => {
  it("orchestrates the base flow through one validation and storage path", async () => {
    const { service } = setup();
    const created = await createThree(service);

    expect(created.candidates).toHaveLength(3);
    expect(new Set(created.candidates.map((c) => c.hash)).size).toBe(3);
    expect(created.candidates.every((c) => c.quality.ok)).toBe(true);

    const selected = await service.selectCandidate(
      created.avatarId,
      created.candidates[0].candidateId,
    );
    await expect(
      service.revisePart({
        avatarId: created.avatarId,
        revision: selected.revision,
        allowedPartIds: ["mouth"],
        package: changedHair(packages()[0]),
      }),
    ).rejects.toThrow(/não autorizada/);

    const reviewed = await review(
      service,
      created.avatarId,
      created.candidates[0].candidateId,
    );
    expect(reviewed.total).toBe(93);
  });

  it("uses the same parsing, quality and hashing path for createCandidate", async () => {
    const { service, store } = setup();
    const avatar = packages()[0];
    const created = await service.createCandidate({
      description: "Singular",
      package: avatar,
    });

    expect(created.candidates).toHaveLength(1);
    expect(created.candidates[0]).toMatchObject({
      avatarId: avatar.id,
      hash: avatarHash(avatar),
      quality: { ok: true, findings: [] },
    });
    expect(store.candidates).toHaveLength(1);
    expect((await service.validatePackage(avatar)).hash).toBe(
      created.candidates[0].hash,
    );
  });

  it("rejects duplicate or invalid batch packages before saving any candidate", async () => {
    const { service, store } = setup();
    const [first, second] = packages();
    await expect(
      service.createCandidates({
        description: "Duplicados",
        packages: [first, second, structuredClone(first)],
      }),
    ).rejects.toThrow(/duplicado/i);

    const invalid = packages()[2];
    invalid.parts[0].primitives[0] = {
      type: "rect",
      x: 95,
      y: 43,
      width: 2,
      height: 39,
      color: "shirt",
    };
    await expect(
      service.createCandidates({
        description: "Inválido",
        packages: [first, second, invalid],
      }),
    ).rejects.toThrow(/body|OUT_OF_BOUNDS/);
    expect(store.candidates.size).toBe(0);
  });

  it("requires exactly three distinct packages in createCandidates", async () => {
    const { service, store } = setup();
    await expect(
      service.createCandidates({
        description: "Incompleto",
        packages: packages().slice(0, 2),
      }),
    ).rejects.toThrow(/três|3/i);
    expect(store.candidates.size).toBe(0);
  });

  it("selects the exact persisted candidate and freezes only its anchors", async () => {
    const { service } = setup();
    const input = packages();
    input[0].identity.anchors.head.x = 47;
    input[1].identity.anchors.head.x = 51;
    const created = await service.createCandidates({
      description: "Âncoras",
      packages: input,
    });

    const first = await service.selectCandidate(
      created.avatarId,
      created.candidates[0].candidateId,
    );
    const second = await service.selectCandidate(
      created.avatarId,
      created.candidates[1].candidateId,
    );

    expect(first.identityAnchors).toEqual(input[0].identity.anchors);
    expect(second.identityAnchors).toEqual(input[1].identity.anchors);
    expect(second.identityAnchors).not.toEqual(first.identityAnchors);
    expect(second.revision).not.toBe(first.revision);
  });

  it("accepts an authorized part revision and records its quality report", async () => {
    const { service } = setup();
    const created = await createThree(service);
    const selected = await service.selectCandidate(
      created.avatarId,
      created.candidates[0].candidateId,
    );

    const revised = await service.revisePart({
      avatarId: created.avatarId,
      revision: selected.revision,
      allowedPartIds: ["mouth"],
      package: changedMouth(packages()[0]),
    });

    expect(revised.hash).not.toBe(selected.hash);
    expect(revised.changedPartIds).toEqual(["mouth"]);
    expect(revised.quality.ok).toBe(true);
    expect(revised.correctionRounds).toBe(1);
    const persisted = await service.getCandidate(
      created.avatarId,
      revised.candidateId,
    );
    expect(persisted.lastRevisionResult).toMatchObject({
      ok: true,
      allowedPartIds: ["mouth"],
      changedPartIds: ["mouth"],
    });
  });

  it("rejects changes to identity anchors as unauthorized", async () => {
    const { service, store } = setup();
    const created = await createThree(service);
    const selected = await service.selectCandidate(
      created.avatarId,
      created.candidates[0].candidateId,
    );
    const changed = packages()[0];
    changed.identity.anchors.head.x += 1;

    await expect(
      service.revisePart({
        avatarId: created.avatarId,
        revision: selected.revision,
        allowedPartIds: ["mouth"],
        package: changed,
      }),
    ).rejects.toThrow(/não autorizada/);
    expect(store.revisions.size).toBe(1);
  });

  it("requires explicit non-empty allowedPartIds", async () => {
    const { service } = setup();
    const created = await createThree(service);
    const selected = await service.selectCandidate(
      created.avatarId,
      created.candidates[0].candidateId,
    );

    await expect(
      service.revisePart({
        avatarId: created.avatarId,
        revision: selected.revision,
        allowedPartIds: [],
        package: changedMouth(packages()[0]),
      }),
    ).rejects.toThrow(/allowedPartIds/);
  });

  it("preserves the last approved bytes and records failed revision quality", async () => {
    const { service, store } = setup();
    const created = await createThree(service);
    const selected = await service.selectCandidate(
      created.avatarId,
      created.candidates[0].candidateId,
    );
    const before = store.revisions.get(
      `${created.avatarId}/${selected.revision}`,
    )?.bytes;

    await expect(
      service.revisePart({
        avatarId: created.avatarId,
        revision: selected.revision,
        allowedPartIds: ["mouth"],
        package: changedHair(packages()[0]),
      }),
    ).rejects.toThrow(/não autorizada/);
    await expect(
      service.revisePart({
        avatarId: created.avatarId,
        revision: selected.revision,
        allowedPartIds: ["mouth"],
        package: { schemaVersion: 2 },
      }),
    ).rejects.toThrow(/SCHEMA_INVALID|parte|pacote/i);

    expect(store.revisions.size).toBe(1);
    expect(
      store.revisions.get(`${created.avatarId}/${selected.revision}`)?.bytes,
    ).toBe(before);
    const candidate = await service.getCandidate(
      created.avatarId,
      created.candidates[0].candidateId,
    );
    expect(candidate.lastRevisionResult).toMatchObject({
      ok: false,
      quality: { ok: false },
    });
  });

  it("saveRevision is idempotent and cannot overwrite the good snapshot", async () => {
    const { service, store } = setup();
    const created = await createThree(service);
    const selected = await service.selectCandidate(
      created.avatarId,
      created.candidates[0].candidateId,
    );
    const before = store.revisions.get(
      `${created.avatarId}/${selected.revision}`,
    )?.bytes;

    await expect(
      service.saveRevision({
        avatarId: created.avatarId,
        candidateId: created.candidates[0].candidateId,
      }),
    ).resolves.toMatchObject({
      revision: selected.revision,
      hash: selected.hash,
      quality: { ok: true },
    });
    expect(store.revisions.size).toBe(1);
    expect(
      store.revisions.get(`${created.avatarId}/${selected.revision}`)?.bytes,
    ).toBe(before);
  });

  it("keeps the best reviewed candidate through worse, invalid and tied results", async () => {
    const { service } = setup();
    const created = await createThree(service);
    const [best, worse, tied] = created.candidates;
    await review(service, created.avatarId, best.candidateId);
    await review(service, created.avatarId, worse.candidateId, {
      ...validRubric(),
      identity: 10,
    });

    await expect(
      service.createCandidate({
        description: "Inválido posterior",
        package: { ...packages()[0], id: best.avatarId, unexpected: true },
      }),
    ).rejects.toThrow();
    await review(service, created.avatarId, tied.candidateId);

    expect(
      (await service.getBestCandidate(created.avatarId))?.candidateId,
    ).toBe(best.candidateId);
    expect(
      (await service.getCandidate(created.avatarId, tied.candidateId)).review,
    ).toMatchObject({
      total: 93,
      evidence: ["neutral.png", "expressions.png"],
    });
  });

  it("requires real proof-sheet evidence and rejects arbitrary paths", async () => {
    const { service } = setup();
    const created = await createThree(service);
    const candidate = created.candidates[0];

    await expect(
      service.reviewCandidate({
        avatarId: created.avatarId,
        candidateId: candidate.candidateId,
        rubric: validRubric(),
        evidence: [],
      }),
    ).rejects.toThrow(/evidência/i);
    for (const evidence of [
      ["../outside.png"],
      ["/tmp/outside.png"],
      ["random.txt"],
      ["neutral.jpg"],
    ]) {
      await expect(
        service.reviewCandidate({
          avatarId: created.avatarId,
          candidateId: candidate.candidateId,
          rubric: validRubric(),
          evidence,
        }),
      ).rejects.toThrow(/evidência|artefato/i);
    }
    expect(await service.getBestCandidate(created.avatarId)).toBeUndefined();
  });

  it("validates rubric keys, integer types, bounds and the 100-point total", async () => {
    const { service } = setup();
    const created = await createThree(service);
    const candidate = created.candidates[0];
    const invalidRubrics = [
      { ...validRubric(), identity: 21 },
      { ...validRubric(), silhouette: -1 },
      { ...validRubric(), pixelCraft: 1.5 },
      { ...validRubric(), palette: "14" },
      { ...validRubric(), export: 6 },
      { ...validRubric(), extra: 1 },
    ];

    for (const rubric of invalidRubrics) {
      await expect(
        review(service, created.avatarId, candidate.candidateId, rubric),
      ).rejects.toThrow(/rubrica|score|pontuação|identity|export/i);
    }
    await expect(
      review(service, created.avatarId, candidate.candidateId, {
        identity: 20,
        silhouette: 15,
        pixelCraft: 15,
        palette: 15,
        expressions: 15,
        rig: 15,
        export: 5,
      }),
    ).resolves.toMatchObject({ total: 100 });
  });

  it("stops after three correction rounds", async () => {
    const { service } = setup();
    const created = await createThree(service);
    let revision = (
      await service.selectCandidate(
        created.avatarId,
        created.candidates[0].candidateId,
      )
    ).revision;

    for (let round = 1; round <= 3; round += 1) {
      revision = (
        await service.revisePart({
          avatarId: created.avatarId,
          revision,
          allowedPartIds: ["mouth"],
          package: changedMouth(packages()[0]),
        })
      ).revision;
    }
    await expect(
      service.revisePart({
        avatarId: created.avatarId,
        revision,
        allowedPartIds: ["mouth"],
        package: changedMouth(packages()[0]),
      }),
    ).rejects.toThrow(/três|3|rodadas/i);
  });

  it("stops corrections immediately after explicit manual approval, not score alone", async () => {
    const { service } = setup();
    const created = await createThree(service);
    const selected = await service.selectCandidate(
      created.avatarId,
      created.candidates[0].candidateId,
    );
    const revised = await service.revisePart({
      avatarId: created.avatarId,
      revision: selected.revision,
      allowedPartIds: ["mouth"],
      package: changedMouth(packages()[0]),
    });

    await expect(
      review(service, created.avatarId, revised.candidateId),
    ).resolves.toMatchObject({ total: 93, manualApproved: false });
    await review(
      service,
      created.avatarId,
      revised.candidateId,
      validRubric(),
      true,
    );
    await expect(
      service.revisePart({
        avatarId: created.avatarId,
        revision: revised.revision,
        allowedPartIds: ["mouth"],
        package: changedMouth(packages()[0]),
      }),
    ).rejects.toThrow(/aprova/i);
  });

  it("compares persisted hashes, anchors, changed parts and quality reports", async () => {
    const { service } = setup();
    const created = await createThree(service);
    const first = await service.selectCandidate(
      created.avatarId,
      created.candidates[0].candidateId,
    );
    const revised = await service.revisePart({
      avatarId: created.avatarId,
      revision: first.revision,
      allowedPartIds: ["mouth"],
      package: changedMouth(packages()[0]),
    });

    const comparison = await service.compareRevisions({
      avatarId: created.avatarId,
      leftRevision: first.revision,
      rightRevision: revised.revision,
    });
    expect(comparison).toMatchObject({
      leftHash: first.hash,
      rightHash: revised.hash,
      hashesEqual: false,
      anchorsEqual: true,
      changedPartIds: ["mouth"],
      quality: {
        left: { ok: true },
        right: { ok: true },
      },
    });
  });

  it("compares anchors from different selected candidates without mixing them", async () => {
    const { service } = setup();
    const input = packages();
    input[1].identity.anchors.head.x += 2;
    const created = await service.createCandidates({
      description: "Comparação de âncoras",
      packages: input,
    });
    const first = await service.selectCandidate(
      created.avatarId,
      created.candidates[0].candidateId,
    );
    const second = await service.selectCandidate(
      created.avatarId,
      created.candidates[1].candidateId,
    );

    const comparison = await service.compareRevisions({
      avatarId: created.avatarId,
      leftRevision: first.revision,
      rightRevision: second.revision,
    });
    expect(comparison.anchorsEqual).toBe(false);
    expect(comparison.changedPartIds).toEqual([]);
  });

  it("validates and renders persisted revisions through the shared adapters", async () => {
    const renderer = vi.fn(async () => renderResult());
    const { service } = setup(renderer);
    const created = await createThree(service);
    const selected = await service.selectCandidate(
      created.avatarId,
      created.candidates[0].candidateId,
    );

    await expect(
      service.validateRevision({
        avatarId: created.avatarId,
        revision: selected.revision,
      }),
    ).resolves.toMatchObject({ ok: true, hash: selected.hash });
    await expect(
      service.renderRevision({
        jobId: "render-one",
        avatarId: created.avatarId,
        revision: selected.revision,
        engineDir: "/engine",
        runner: { worker: "/worker", browser: "/browser" },
        sheets: ["neutral"],
      }),
    ).resolves.toMatchObject({ jobId: "render-one", complete: true });

    expect(renderer).toHaveBeenCalledWith(
      expect.objectContaining({
        revisionDir: dirname(selected.path),
        engineDir: "/engine",
        sheets: ["neutral"],
        signal: expect.any(AbortSignal),
      }),
    );
    expect(service.cancel("render-one")).toBe(false);
  });

  it("cancels only the requested render job and preserves prior revisions", async () => {
    const renderers: Array<{
      options: AvatarRenderOptions & { signal: AbortSignal };
      resolve: (result: AvatarRenderResult) => void;
      reject: (error: unknown) => void;
    }> = [];
    const renderer = vi.fn(
      (options: AvatarRenderOptions & { signal: AbortSignal }) =>
        new Promise<AvatarRenderResult>((resolve, reject) => {
          renderers.push({ options, resolve, reject });
          const abort = () =>
            reject(options.signal.reason ?? new Error("Render cancelado."));
          if (options.signal.aborted) abort();
          else options.signal.addEventListener("abort", abort, { once: true });
        }),
    );
    const { service, store } = setup(renderer);
    const created = await createThree(service);
    const selected = await service.selectCandidate(
      created.avatarId,
      created.candidates[0].candidateId,
    );
    const bytes = store.revisions.get(
      `${created.avatarId}/${selected.revision}`,
    )?.bytes;
    const common = {
      avatarId: created.avatarId,
      revision: selected.revision,
      engineDir: "/engine",
      runner: { worker: "/worker", browser: "/browser" },
    };
    const first = service.renderRevision({ ...common, jobId: "job-one" });
    const second = service.renderRevision({ ...common, jobId: "job-two" });
    const firstRejection = expect(first).rejects.toThrow(/cancel/i);
    await vi.waitFor(() => expect(renderers).toHaveLength(2));

    expect(service.cancel("job-one")).toBe(true);
    await firstRejection;
    expect(renderers[0].options.signal.aborted).toBe(true);
    expect(renderers[1].options.signal.aborted).toBe(false);

    renderers[1].resolve(renderResult());
    const secondResult = await second;
    expect(secondResult.jobId).toBe("job-two");
    expect(renderers[1].options.signal.aborted).toBe(false);
    expect(service.cancel("job-one")).toBe(false);
    expect(service.cancel("job-two")).toBe(false);
    expect(
      store.revisions.get(`${created.avatarId}/${selected.revision}`)?.bytes,
    ).toBe(bytes);
  });
});

import { createHash } from "node:crypto";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import {
  AVATAR_PROOF_SHEETS,
  type AvatarRenderOptions,
  type AvatarRenderResult,
  type AvatarSheetArtifact,
} from "../electron/core/avatar-render";
import { AvatarService } from "../electron/core/avatar-service";
import { AvatarStore } from "../electron/core/avatar-store";
import { type AvatarPackage } from "../src/shared/avatar";
import { avatarFixture } from "./fixtures/avatar-fixture";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

class ConsistencyStore extends AvatarStore {
  afterMetadataRead:
    | ((avatarId: string, key: string, value: unknown) => Promise<void>)
    | undefined;
  beforeMetadataWrite:
    | ((avatarId: string, key: string, value: unknown) => Promise<void>)
    | undefined;
  afterSaveRevision:
    ((avatarId: string, candidateId: string) => Promise<void>) | undefined;
  afterArtifactRead: ((path: string) => Promise<void>) | undefined;
  exclusiveFinished: (() => void) | undefined;
  failMetadataWrites = 0;

  override async runExclusive<T>(
    avatarId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const finished = this.exclusiveFinished;
    this.exclusiveFinished = undefined;
    const pending = super.runExclusive(avatarId, operation);
    if (!finished) return pending;
    try {
      return await pending;
    } finally {
      finished();
    }
  }

  override async readMetadata(avatarId: string, key: string) {
    const value = await super.readMetadata(avatarId, key);
    const hook = this.afterMetadataRead;
    this.afterMetadataRead = undefined;
    if (hook) await hook(avatarId, key, value);
    return value;
  }

  override async writeMetadata(avatarId: string, key: string, value: unknown) {
    const hook = this.beforeMetadataWrite;
    this.beforeMetadataWrite = undefined;
    if (hook) await hook(avatarId, key, value);
    if (key === "avatar-service" && this.failMetadataWrites > 0) {
      this.failMetadataWrites -= 1;
      throw new Error("Falha de metadata simulada.");
    }
    await super.writeMetadata(avatarId, key, value);
  }

  override async readRevisionArtifact(
    avatarId: string,
    revision: number,
    path: string,
  ) {
    const artifact = await super.readRevisionArtifact(avatarId, revision, path);
    const hook = this.afterArtifactRead;
    this.afterArtifactRead = undefined;
    if (hook) await hook(artifact.path);
    return artifact;
  }

  override async saveRevision(avatarId: string, candidateId: string) {
    const saved = await super.saveRevision(avatarId, candidateId);
    const hook = this.afterSaveRevision;
    this.afterSaveRevision = undefined;
    if (hook) await hook(avatarId, candidateId);
    return saved;
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

const FAKE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

async function renderResult(
  options: AvatarRenderOptions & { signal: AbortSignal },
): Promise<AvatarRenderResult> {
  const sheets = options.sheets ?? AVATAR_PROOF_SHEETS;
  const output = join(options.revisionDir, ".renders", "consistency");
  await mkdir(output, { recursive: true });
  const files: AvatarSheetArtifact[] = [];
  for (const sheet of sheets) {
    const png = join(output, `${sheet}.png`);
    const jpeg = join(output, `${sheet}.jpg`);
    await writeFile(png, FAKE_PNG);
    await writeFile(jpeg, FAKE_PNG);
    files.push({
      sheet,
      png,
      jpeg,
      width: 1,
      height: 1,
      nativeWidth: 1,
      nativeHeight: 1,
      hash: createHash("sha256")
        .update(`${options.revisionDir}:${sheet}`)
        .digest("hex"),
      contentHash: createHash("sha256").update(FAKE_PNG).digest("hex"),
    });
  }
  return {
    complete: true,
    files,
    hashes: Object.fromEntries(files.map((file) => [file.sheet, file.hash])),
    errors: [],
    networkRequests: [],
  };
}

async function renderResultWithReview(
  options: AvatarRenderOptions & { signal: AbortSignal },
): Promise<AvatarRenderResult> {
  const result = await renderResult(options);
  const path = join(
    options.revisionDir,
    ".renders",
    "consistency",
    "review.jpg",
  );
  await writeFile(path, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  return { ...result, reviewJpeg: { path, width: 1, height: 1 } };
}

async function setup(
  renderer: (
    options: AvatarRenderOptions & { signal: AbortSignal },
  ) => Promise<AvatarRenderResult> = renderResult,
) {
  const template = await candidateTemplate();
  const root = await mkdtemp(join(tmpdir(), "avatar-consistency-"));
  roots.push(root);
  await cp(template.root, root, { recursive: true });
  const store = new ConsistencyStore(root);
  const service = new AvatarService({ store, renderer });
  createdByService.set(service, structuredClone(template.created));
  return { root, store, service };
}

const createdByService = new WeakMap<
  AvatarService,
  Awaited<ReturnType<AvatarService["createCandidates"]>>
>();

let template:
  | Promise<{
      root: string;
      created: Awaited<ReturnType<AvatarService["createCandidates"]>>;
    }>
  | undefined;

function candidateTemplate() {
  template ??= (async () => {
    const root = await mkdtemp(join(tmpdir(), "avatar-consistency-template-"));
    const store = new ConsistencyStore(root);
    const service = new AvatarService({ store, renderer: renderResult });
    const created = await service.createCandidates({
      description: "Mascote de um SaaS financeiro",
      packages: packages(),
    });
    return { root, created };
  })();
  return template;
}

afterAll(async () => {
  if (!template) return;
  const { root } = await template;
  await rm(root, { recursive: true, force: true });
});

async function createThree(service: AvatarService) {
  const cached = createdByService.get(service);
  if (cached) return structuredClone(cached);
  return service.createCandidates({
    description: "Mascote de um SaaS financeiro",
    packages: packages(),
  });
}

let renderJob = 0;

async function render(
  service: AvatarService,
  avatarId: string,
  revision: number,
  sheets: AvatarRenderOptions["sheets"] = ["neutral"],
) {
  return service.renderRevision({
    jobId: `consistency-render-${++renderJob}`,
    avatarId,
    revision,
    engineDir: "/engine",
    runner: { worker: "/worker", browser: "/browser" },
    sheets,
  });
}

async function prepareReview(
  service: AvatarService,
  avatarId: string,
  candidateId: string,
) {
  const selected = await service.selectCandidate(avatarId, candidateId);
  const rendered = await render(service, avatarId, selected.revision);
  return {
    selected,
    evidence: rendered.files.map((file) => file.png),
  };
}

async function readRawState(store: AvatarStore, avatarId: string) {
  return structuredClone(
    (await store.readMetadata(avatarId, "avatar-service")) as any,
  );
}

describe("AvatarService consistency", { timeout: 60_000 }, () => {
  it("serializes approve and revise across service instances without losing either decision", async () => {
    const { root, store, service } = await setup();
    const created = await createThree(service);
    const candidate = created.candidates[0];
    const { selected, evidence } = await prepareReview(
      service,
      created.avatarId,
      candidate.candidateId,
    );
    const reviewRead = deferred();
    const releaseReview = deferred();
    store.afterMetadataRead = async (_avatarId, key) => {
      if (key !== "avatar-service") return;
      reviewRead.resolve();
      await Promise.race([releaseReview.promise, delay(100)]);
    };

    const approving = new AvatarService({ store, renderer: renderResult })
      .reviewCandidate({
        avatarId: created.avatarId,
        candidateId: candidate.candidateId,
        rubric: validRubric(),
        evidence,
        manualApproved: true,
      })
      .then(
        (value) => ({ status: "fulfilled" as const, value }),
        (reason) => ({ status: "rejected" as const, reason }),
      );
    await reviewRead.promise;
    const revising = new AvatarService({
      store: new ConsistencyStore(root),
      renderer: renderResult,
    })
      .revisePart({
        avatarId: created.avatarId,
        revision: selected.revision,
        allowedPartIds: ["mouth"],
        package: changedMouth(packages()[0]),
      })
      .then(
        (value) => ({ status: "fulfilled" as const, value }),
        (reason) => ({ status: "rejected" as const, reason }),
      );
    await delay(20);
    releaseReview.resolve();
    const [approval, revision] = await Promise.all([approving, revising]);

    expect(approval.status).toBe("fulfilled");
    expect(revision.status).toBe("rejected");
    expect(
      (await service.getCandidate(created.avatarId, candidate.candidateId))
        .manualApproved,
    ).toBe(true);
    await expect(
      service.validateRevision({
        avatarId: created.avatarId,
        revision: selected.revision,
      }),
    ).resolves.toMatchObject({ hash: selected.hash });
  });

  it("serializes two reviews so both candidate records survive", async () => {
    const { store, service } = await setup();
    const created = await createThree(service);
    const [first, second] = created.candidates;
    const firstProof = await prepareReview(
      service,
      created.avatarId,
      first.candidateId,
    );
    const secondProof = await prepareReview(
      service,
      created.avatarId,
      second.candidateId,
    );
    const reviewRead = deferred();
    const releaseReview = deferred();
    store.afterMetadataRead = async (_avatarId, key) => {
      if (key !== "avatar-service") return;
      reviewRead.resolve();
      await Promise.race([releaseReview.promise, delay(100)]);
    };
    const other = new AvatarService({ store, renderer: renderResult });

    const firstReview = service.reviewCandidate({
      avatarId: created.avatarId,
      candidateId: first.candidateId,
      rubric: validRubric(),
      evidence: firstProof.evidence,
    });
    await reviewRead.promise;
    const secondReview = other.reviewCandidate({
      avatarId: created.avatarId,
      candidateId: second.candidateId,
      rubric: { ...validRubric(), identity: 10 },
      evidence: secondProof.evidence,
    });
    await delay(20);
    releaseReview.resolve();
    await Promise.all([firstReview, secondReview]);

    await expect(
      service.getCandidate(created.avatarId, first.candidateId),
    ).resolves.toMatchObject({ review: { total: 93 } });
    await expect(
      service.getCandidate(created.avatarId, second.candidateId),
    ).resolves.toMatchObject({ review: { total: 85 } });
  });

  it("serializes renders of one avatar and merges their manifests", async () => {
    const rendererStarted = deferred();
    const releaseRenderer = deferred();
    let calls = 0;
    const renderer = vi.fn(
      async (options: AvatarRenderOptions & { signal: AbortSignal }) => {
        calls += 1;
        if (calls === 1) {
          rendererStarted.resolve();
          await releaseRenderer.promise;
        }
        return renderResult(options);
      },
    );
    const { service } = await setup(renderer);
    const created = await createThree(service);
    const selected = await service.selectCandidate(
      created.avatarId,
      created.candidates[0].candidateId,
    );
    const first = render(service, created.avatarId, selected.revision, [
      "neutral",
    ]);
    await rendererStarted.promise;
    const second = render(service, created.avatarId, selected.revision, [
      "expressions",
    ]);
    await delay(30);
    const callsWhileFirstWasBlocked = renderer.mock.calls.length;
    releaseRenderer.resolve();
    await Promise.all([first, second]);
    expect(callsWhileFirstWasBlocked).toBe(1);

    const state = await readRawState((service as any).store, created.avatarId);
    expect(
      state.revisions[String(selected.revision)].artifacts.map(
        (artifact: any) => artifact.sheet,
      ),
    ).toEqual(["neutral", "expressions"]);
  });

  it("cancels a queued render without waiting for the active render", async () => {
    const rendererStarted = deferred();
    const releaseRenderer = deferred();
    let calls = 0;
    const renderer = async (
      options: AvatarRenderOptions & { signal: AbortSignal },
    ) => {
      calls += 1;
      if (calls === 1) {
        rendererStarted.resolve();
        await releaseRenderer.promise;
      }
      options.signal.throwIfAborted();
      return renderResult(options);
    };
    const { service } = await setup(renderer);
    const created = await createThree(service);
    const selected = await service.selectCandidate(
      created.avatarId,
      created.candidates[0].candidateId,
    );
    const first = render(service, created.avatarId, selected.revision);
    await rendererStarted.promise;
    const second = render(service, created.avatarId, selected.revision);
    const secondRejection = expect(second).rejects.toThrow(/cancel/i);

    expect(service.cancel(`consistency-render-${renderJob}`)).toBe(true);
    const rejectedBeforeRelease = await Promise.race([
      secondRejection.then(() => true),
      delay(100).then(() => false),
    ]);
    releaseRenderer.resolve();
    await secondRejection;
    await expect(first).resolves.toMatchObject({ complete: true });
    expect(rejectedBeforeRelease).toBe(true);
    expect(calls).toBe(1);
  });

  it.each(["png", "jpeg", "review", "readState", "writeState"] as const)(
    "rolls back final render persistence when cancelled at the %s barrier",
    async (barrier) => {
      const reached = deferred();
      const release = deferred();
      const finished = deferred();
      let store!: ConsistencyStore;
      let armReadStateBarrier = false;
      const hold = async () => {
        reached.resolve();
        await release.promise;
      };
      const holdArtifact = async (path: string) => {
        const matches =
          (barrier === "png" && path.endsWith("expressions.png")) ||
          (barrier === "jpeg" && path.endsWith("expressions.jpg")) ||
          (barrier === "review" && path.endsWith("review.jpg"));
        if (matches) await hold();
        else store.afterArtifactRead = holdArtifact;
      };
      const renderer = async (
        options: AvatarRenderOptions & { signal: AbortSignal },
      ) => {
        const result =
          barrier === "review"
            ? await renderResultWithReview(options)
            : await renderResult(options);
        if (barrier === "readState" && armReadStateBarrier) {
          store.afterMetadataRead = async (_avatarId, key) => {
            if (key === "avatar-service") await hold();
          };
        }
        return result;
      };
      const setupResult = await setup(renderer);
      store = setupResult.store;
      const { service } = setupResult;
      const created = await createThree(service);
      const candidate = created.candidates[0];
      const { selected, evidence } = await prepareReview(
        service,
        created.avatarId,
        candidate.candidateId,
      );
      await service.reviewCandidate({
        avatarId: created.avatarId,
        candidateId: candidate.candidateId,
        rubric: validRubric(),
        evidence,
      });
      const before = await readRawState(store, created.avatarId);
      expect(
        before.revisions[String(selected.revision)].artifacts,
      ).toHaveLength(1);
      expect(before.candidates[candidate.candidateId].review.evidence).toEqual(
        evidence,
      );

      if (["png", "jpeg", "review"].includes(barrier)) {
        store.afterArtifactRead = holdArtifact;
      } else if (barrier === "writeState") {
        store.beforeMetadataWrite = async (_avatarId, key) => {
          if (key === "avatar-service") await hold();
        };
      } else {
        armReadStateBarrier = true;
      }
      store.exclusiveFinished = finished.resolve;
      const jobId = `consistency-cancel-${barrier}`;
      const attempt = service.renderRevision({
        jobId,
        avatarId: created.avatarId,
        revision: selected.revision,
        engineDir: "/engine",
        runner: { worker: "/worker", browser: "/browser" },
        sheets: ["expressions"],
      });
      const rejection = expect(attempt).rejects.toMatchObject({
        name: "AbortError",
      });
      await reached.promise;
      expect(service.cancel(jobId)).toBe(true);
      await rejection;
      release.resolve();
      await finished.promise;

      expect(await readRawState(store, created.avatarId)).toEqual(before);
    },
  );

  it("does not block renders of different avatars", async () => {
    const rendererStarted = deferred();
    const releaseRenderer = deferred();
    let calls = 0;
    const renderer = async (
      options: AvatarRenderOptions & { signal: AbortSignal },
    ) => {
      calls += 1;
      if (calls === 1) {
        rendererStarted.resolve();
        await releaseRenderer.promise;
      }
      return renderResult(options);
    };
    const { service } = await setup(renderer);
    const firstAvatar = await createThree(service);
    const secondPackage = packages()[0];
    secondPackage.id = "videosell-presenter-two";
    const secondAvatar = await service.createCandidate({
      description: "Avatar independente",
      package: secondPackage,
    });
    const first = await service.selectCandidate(
      firstAvatar.avatarId,
      firstAvatar.candidates[0].candidateId,
    );
    const second = await service.selectCandidate(
      secondAvatar.avatarId,
      secondAvatar.candidates[0].candidateId,
    );

    const blocked = render(service, firstAvatar.avatarId, first.revision);
    await rendererStarted.promise;
    const independent = render(service, secondAvatar.avatarId, second.revision);
    await delay(30);
    const ranInParallel = calls === 2;
    releaseRenderer.resolve();
    await Promise.all([blocked, independent]);
    expect(ranInParallel).toBe(true);
  });

  it("serializes select and save so selection and revision metadata converge", async () => {
    const { store, service } = await setup();
    const created = await createThree(service);
    const [first, second] = created.candidates;
    await service.selectCandidate(created.avatarId, first.candidateId);
    const selectionRead = deferred();
    const releaseSelection = deferred();
    store.afterMetadataRead = async (_avatarId, key) => {
      if (key !== "avatar-service") return;
      selectionRead.resolve();
      await Promise.race([releaseSelection.promise, delay(100)]);
    };
    const other = new AvatarService({ store, renderer: renderResult });

    const selecting = service.selectCandidate(
      created.avatarId,
      second.candidateId,
    );
    await selectionRead.promise;
    const saving = other
      .saveRevision({
        avatarId: created.avatarId,
        candidateId: second.candidateId,
      })
      .then(
        (value) => ({ status: "fulfilled" as const, value }),
        (reason) => ({ status: "rejected" as const, reason }),
      );
    await delay(20);
    releaseSelection.resolve();
    const selected = await selecting;
    const saved = await saving;

    expect(saved.status).toBe("fulfilled");
    if (saved.status === "fulfilled") {
      expect(saved.value.revision).toBe(selected.revision);
    }
    expect(
      JSON.parse(
        await readFile(
          join(storeRoot(store), created.avatarId, "selection.json"),
          "utf8",
        ),
      ).candidateId,
    ).toBe(second.candidateId);
  });

  it.each(["select", "revise"] as const)(
    "recovers %s when failure happens after store approval",
    async (operation) => {
      const { root, store, service } = await setup();
      const created = await createThree(service);
      const [original, second] = created.candidates;
      const selected = await service.selectCandidate(
        created.avatarId,
        original.candidateId,
      );
      const goodBytes = await readFile(selected.path, "utf8");
      store.afterSaveRevision = async () => {
        throw new Error("Falha posterior à aprovação simulada.");
      };
      let targetId = second.candidateId;
      const attempt =
        operation === "select"
          ? service.selectCandidate(created.avatarId, second.candidateId)
          : service.revisePart({
              avatarId: created.avatarId,
              revision: selected.revision,
              allowedPartIds: ["mouth"],
              package: changedMouth(packages()[0]),
            });
      await expect(attempt).rejects.toThrow(/posterior à aprovação/);
      if (operation === "revise") {
        const candidateRoot = join(root, created.avatarId, "candidates");
        targetId = (await readdir(candidateRoot)).find(
          (id) =>
            !created.candidates.some(
              (candidate) => candidate.candidateId === id,
            ),
        )!;
        expect(targetId).toBeDefined();
      }

      const reopened = new AvatarService({
        store: new ConsistencyStore(root),
        renderer: renderResult,
      });
      const recovered = await reopened.getCandidate(created.avatarId, targetId);
      expect(recovered.revision).toBe(2);
      expect(
        JSON.parse(
          await readFile(
            join(root, created.avatarId, "selection.json"),
            "utf8",
          ),
        ).candidateId,
      ).toBe(targetId);
      await expect(readFile(selected.path, "utf8")).resolves.toBe(goodBytes);
    },
  );

  it.each(["select", "revise"] as const)(
    "recovers %s when final metadata write fails",
    async (operation) => {
      const { root, store, service } = await setup();
      const created = await createThree(service);
      const [original, second] = created.candidates;
      const selected = await service.selectCandidate(
        created.avatarId,
        original.candidateId,
      );
      const goodBytes = await readFile(selected.path, "utf8");
      store.failMetadataWrites = 1;
      let targetId = second.candidateId;
      const attempt =
        operation === "select"
          ? service.selectCandidate(created.avatarId, second.candidateId)
          : service.revisePart({
              avatarId: created.avatarId,
              revision: selected.revision,
              allowedPartIds: ["mouth"],
              package: changedMouth(packages()[0]),
            });
      await expect(attempt).rejects.toThrow(/metadata simulada/);
      if (operation === "revise") {
        targetId = (
          await readdir(join(root, created.avatarId, "candidates"))
        ).find(
          (id) =>
            !created.candidates.some(
              (candidate) => candidate.candidateId === id,
            ),
        )!;
      }

      const reopened = new AvatarService({
        store: new ConsistencyStore(root),
        renderer: renderResult,
      });
      const recovered = await reopened.getCandidate(created.avatarId, targetId);
      expect(recovered.revision).toBe(2);
      await expect(readFile(selected.path, "utf8")).resolves.toBe(goodBytes);
    },
  );

  it("recovers saveRevision metadata without changing an orphan approval into best", async () => {
    const { root, store, service } = await setup();
    const created = await createThree(service);
    const [first, second] = created.candidates;
    const firstProof = await prepareReview(
      service,
      created.avatarId,
      first.candidateId,
    );
    await service.reviewCandidate({
      avatarId: created.avatarId,
      candidateId: first.candidateId,
      rubric: validRubric(),
      evidence: firstProof.evidence,
    });
    await store.selectCandidate(created.avatarId, second.candidateId);
    store.failMetadataWrites = 1;
    await expect(
      service.saveRevision({
        avatarId: created.avatarId,
        candidateId: second.candidateId,
      }),
    ).rejects.toThrow(/metadata simulada/);

    const reopened = new AvatarService({
      store: new ConsistencyStore(root),
      renderer: renderResult,
    });
    await expect(
      reopened.getBestCandidate(created.avatarId),
    ).resolves.toMatchObject({ candidateId: first.candidateId });
    const recovered = await reopened.getCandidate(
      created.avatarId,
      second.candidateId,
    );
    expect(recovered.revision).toBe(2);
    expect(recovered.review).toBeUndefined();
  });

  it("recomputes an adulterated numeric total instead of promoting it", async () => {
    const { store, service } = await setup();
    const created = await createThree(service);
    const [first, second] = created.candidates;
    const firstProof = await prepareReview(
      service,
      created.avatarId,
      first.candidateId,
    );
    await service.reviewCandidate({
      avatarId: created.avatarId,
      candidateId: first.candidateId,
      rubric: validRubric(),
      evidence: firstProof.evidence,
    });
    const secondProof = await prepareReview(
      service,
      created.avatarId,
      second.candidateId,
    );
    await service.reviewCandidate({
      avatarId: created.avatarId,
      candidateId: second.candidateId,
      rubric: { ...validRubric(), identity: 10 },
      evidence: secondProof.evidence,
    });
    const state = await readRawState(store, created.avatarId);
    state.candidates[second.candidateId].review.total = 999;
    state.bestCandidateId = second.candidateId;
    await store.writeMetadata(created.avatarId, "avatar-service", state);

    await expect(
      service.getBestCandidate(created.avatarId),
    ).resolves.toMatchObject({ candidateId: first.candidateId });
    const repaired = await readRawState(store, created.avatarId);
    expect(repaired.candidates[second.candidateId].review.total).toBe(85);
    expect(
      Number.isFinite(repaired.candidates[second.candidateId].review.total),
    ).toBe(true);
  });

  it.each([
    [
      "non-numeric total",
      (state: any, id: string) => {
        state.candidates[id].review.total = "999";
      },
    ],
    [
      "out-of-range rubric",
      (state: any, id: string) => {
        state.candidates[id].review.rubric.identity = 21;
      },
    ],
    [
      "divergent candidate binding",
      (state: any, id: string) => {
        state.candidates[id].review.candidateId = "candidate-other";
      },
    ],
    [
      "ineligible evidence",
      (state: any, id: string) => {
        state.candidates[id].review.evidence = ["unregistered.png"];
      },
    ],
    [
      "invalid quality",
      (state: any, id: string) => {
        state.candidates[id].quality.ok = "true";
      },
    ],
  ])("rejects corrupted metadata: %s", async (_label, corrupt) => {
    const { store, service } = await setup();
    const created = await createThree(service);
    const candidate = created.candidates[0];
    const { evidence } = await prepareReview(
      service,
      created.avatarId,
      candidate.candidateId,
    );
    await service.reviewCandidate({
      avatarId: created.avatarId,
      candidateId: candidate.candidateId,
      rubric: validRubric(),
      evidence,
    });
    const state = await readRawState(store, created.avatarId);
    corrupt(state, candidate.candidateId);
    await store.writeMetadata(created.avatarId, "avatar-service", state);

    await expect(service.getBestCandidate(created.avatarId)).rejects.toThrow(
      /metadata|metadados|rubrica|score|candidate|candidato|evidência|quality/i,
    );
  });

  it("detects replacement between evidence validation and metadata commit and rolls back", async () => {
    const { store, service } = await setup();
    const created = await createThree(service);
    const candidate = created.candidates[0];
    const { evidence } = await prepareReview(
      service,
      created.avatarId,
      candidate.candidateId,
    );
    store.beforeMetadataWrite = async (_avatarId, key) => {
      if (key === "avatar-service") await writeFile(evidence[0], "adulterado");
    };

    await expect(
      service.reviewCandidate({
        avatarId: created.avatarId,
        candidateId: candidate.candidateId,
        rubric: validRubric(),
        evidence,
        manualApproved: true,
      }),
    ).rejects.toThrow(/integridade|adulter/i);
    await expect(
      service.getBestCandidate(created.avatarId),
    ).resolves.toBeUndefined();
    expect(
      (await service.getCandidate(created.avatarId, candidate.candidateId))
        .manualApproved,
    ).toBe(false);
  });

  it("rejects evidence adulterated after review on reads and later revisions", async () => {
    const { service } = await setup();
    const created = await createThree(service);
    const candidate = created.candidates[0];
    const { selected, evidence } = await prepareReview(
      service,
      created.avatarId,
      candidate.candidateId,
    );
    await service.reviewCandidate({
      avatarId: created.avatarId,
      candidateId: candidate.candidateId,
      rubric: validRubric(),
      evidence,
    });
    await writeFile(evidence[0], "adulterado");

    await expect(service.getBestCandidate(created.avatarId)).rejects.toThrow(
      /integridade|adulter/i,
    );
    await expect(
      service.revisePart({
        avatarId: created.avatarId,
        revision: selected.revision,
        allowedPartIds: ["mouth"],
        package: changedMouth(packages()[0]),
      }),
    ).rejects.toThrow(/integridade|adulter/i);
  });
});

function storeRoot(store: AvatarStore): string {
  return (store as any).root;
}

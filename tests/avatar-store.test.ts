import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { afterEach, describe, expect, it, type TestContext } from "vitest";
import { AvatarStore } from "../electron/core/avatar-store";
import { avatarHash, canonicalAvatar } from "../src/shared/avatar";
import { avatarFixture } from "./fixtures/avatar-fixture";

const roots: string[] = [];

async function temporaryRoot() {
  const root = await mkdtemp(join(tmpdir(), "avatar-store-"));
  roots.push(root);
  return root;
}

async function makeDirectoryRedirect(
  target: string,
  link: string,
  context: TestContext,
) {
  await mkdir(dirname(link), { recursive: true });
  try {
    await symlink(
      target,
      link,
      process.platform === "win32" ? "junction" : "dir",
    );
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EPERM" || code === "EACCES" || code === "ENOSYS") {
      context.skip(`O SO não permite criar o redirecionamento: ${code}.`);
      return false;
    }
    throw error;
  }
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

class FailingRenameStore extends AvatarStore {
  failSelectionRename = false;
  failRevisionRename = false;
  failApprovalRename = false;
  failWrite = false;
  failSync = false;
  failSecondRevisionDirectorySync = false;
  failSecondRevisionsRootSync = false;
  syncedDirectories: string[] = [];
  private revisionDirectorySyncs = 0;
  private revisionsRootSyncs = 0;

  protected override async rename(source: string, target: string) {
    const shouldFail =
      (this.failSelectionRename && target.endsWith("selection.json")) ||
      (this.failRevisionRename && target.includes(`${sep}revisions${sep}`)) ||
      (this.failApprovalRename && target.endsWith("approval.json"));
    if (shouldFail) {
      this.failSelectionRename = false;
      this.failRevisionRename = false;
      this.failApprovalRename = false;
      throw new Error("Falha de rename simulada.");
    }
    await super.rename(source, target);
  }

  protected override async writeFile(handle: FileHandle, contents: string) {
    if (this.failWrite) {
      this.failWrite = false;
      throw new Error("Falha de writeFile simulada.");
    }
    await super.writeFile(handle, contents);
  }

  protected override async sync(handle: FileHandle) {
    if (this.failSync) {
      this.failSync = false;
      throw new Error("Falha de fsync simulada.");
    }
    await super.sync(handle);
  }

  protected override async syncDirectory(path: string) {
    this.syncedDirectories.push(path);
    if (
      this.failSecondRevisionDirectorySync &&
      path.endsWith(`${sep}revisions${sep}2`)
    ) {
      this.revisionDirectorySyncs += 1;
      if (this.revisionDirectorySyncs === 2) {
        this.failSecondRevisionDirectorySync = false;
        throw new Error("Falha de fsync de diretório simulada.");
      }
    }
    if (this.failSecondRevisionsRootSync && path.endsWith(`${sep}revisions`)) {
      this.revisionsRootSyncs += 1;
      if (this.revisionsRootSyncs === 2) {
        this.failSecondRevisionsRootSync = false;
        throw new Error("Falha transitória de fsync do diretório pai.");
      }
    }
    await super.syncDirectory(path);
  }
}

class CoordinatedSelectionStore extends AvatarStore {
  afterSelectionRename: (() => Promise<void>) | undefined;
  beforeSelectionWrite: (() => Promise<void>) | undefined;

  protected override async rename(source: string, target: string) {
    await super.rename(source, target);
    const hook = this.afterSelectionRename;
    this.afterSelectionRename = undefined;
    if (hook && target.endsWith("selection.json")) await hook();
  }

  protected override async writeFile(handle: FileHandle, contents: string) {
    const hook = this.beforeSelectionWrite;
    this.beforeSelectionWrite = undefined;
    if (hook) await hook();
    await super.writeFile(handle, contents);
  }
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("AvatarStore", () => {
  it("creates, selects, approves and reloads a candidate without duplicating revisions", async () => {
    const root = await temporaryRoot();
    const store = new AvatarStore(root);
    const candidate = await store.createCandidate(avatarFixture());
    await store.selectCandidate(candidate.avatarId, candidate.candidateId);
    const approved = await store.saveRevision(
      candidate.avatarId,
      candidate.candidateId,
    );
    await expect(
      store.saveRevision(candidate.avatarId, "invalid-candidate"),
    ).rejects.toThrow();
    expect(
      (await store.loadRevision(candidate.avatarId, approved.revision)).hash,
    ).toBe(approved.hash);
    await expect(store.loadRevision("../outside", 1)).rejects.toThrow(
      /inválido/,
    );

    expect(candidate.avatarId).toBe(avatarFixture().id);
    expect(candidate.candidateId).toMatch(/^candidate-[a-f0-9-]{36}$/);
    expect(candidate.hash).toBe(avatarHash(avatarFixture()));
    expect(approved.revision).toBe(1);
    expect(approved.path).toBe(
      join(root, candidate.avatarId, "revisions", "1", "avatar.json"),
    );
    await expect(
      store.saveRevision(candidate.avatarId, candidate.candidateId),
    ).resolves.toEqual(approved);
    expect(await store.listRevisions(candidate.avatarId)).toEqual([
      { revision: 1, hash: approved.hash, approved: true },
    ]);
  });

  it("loads an exact candidate and recovers namespaced metadata across instances", async () => {
    const root = await temporaryRoot();
    const store = new AvatarStore(root);
    const candidate = await store.createCandidate(avatarFixture());
    const metadata = {
      candidates: {
        [candidate.candidateId]: {
          quality: { ok: true, findings: [], hashes: { neutral: "abc" } },
          correctionRounds: 2,
        },
      },
    };

    await store.writeMetadata(candidate.avatarId, "avatar-service", metadata);

    const reopened = new AvatarStore(root);
    await expect(
      reopened.loadCandidate(candidate.avatarId, candidate.candidateId),
    ).resolves.toEqual({
      avatar: avatarFixture(),
      hash: candidate.hash,
      path: join(
        root,
        candidate.avatarId,
        "candidates",
        candidate.candidateId,
        "avatar.json",
      ),
    });
    await expect(
      reopened.readMetadata(candidate.avatarId, "avatar-service"),
    ).resolves.toEqual(metadata);
    await expect(
      reopened.readMetadata(candidate.avatarId, "missing"),
    ).resolves.toBeUndefined();
    await expect(
      reopened.writeMetadata(candidate.avatarId, "../outside", {}),
    ).rejects.toThrow(/inválido/);
  });

  it("persists selection across instances and rejects a different or missing candidate", async () => {
    const root = await temporaryRoot();
    const store = new AvatarStore(root);
    const first = await store.createCandidate(avatarFixture());
    const changed = avatarFixture();
    changed.artBible.notes = ["Second candidate."];
    const second = await store.createCandidate(changed);
    await store.selectCandidate(first.avatarId, first.candidateId);

    const reopened = new AvatarStore(root);
    await expect(
      reopened.saveRevision(second.avatarId, second.candidateId),
    ).rejects.toThrow(/selecionado|selection/i);
    await expect(
      reopened.selectCandidate(first.avatarId, "missing-candidate"),
    ).rejects.toThrow(/encontrad|exist/i);
    await expect(
      reopened.selectCandidate("missing-avatar", first.candidateId),
    ).rejects.toThrow(/encontrad|exist/i);

    const approved = await reopened.saveRevision(
      first.avatarId,
      first.candidateId,
    );
    expect(approved.hash).toBe(first.hash);
  });

  it("validates candidate files during selection and preserves the previous selection", async () => {
    const root = await temporaryRoot();
    const store = new AvatarStore(root);
    const first = await store.createCandidate(avatarFixture());
    const second = await store.createCandidate(avatarFixture());
    await store.selectCandidate(first.avatarId, first.candidateId);
    await writeFile(
      join(
        root,
        first.avatarId,
        "candidates",
        second.candidateId,
        "avatar.json",
      ),
      JSON.stringify({ schemaVersion: 2 }),
      "utf8",
    );

    await expect(
      store.selectCandidate(second.avatarId, second.candidateId),
    ).rejects.toThrow();
    await expect(
      store.saveRevision(second.avatarId, second.candidateId),
    ).rejects.toThrow(/selecionado|selection/i);
    await expect(
      store.saveRevision(first.avatarId, first.candidateId),
    ).resolves.toMatchObject({ revision: 1, hash: first.hash });
  });

  it("keeps prior snapshots byte-for-byte immutable when a different candidate is approved", async () => {
    const root = await temporaryRoot();
    const store = new AvatarStore(root);
    const first = await store.createCandidate(avatarFixture());
    await store.selectCandidate(first.avatarId, first.candidateId);
    const approved = await store.saveRevision(
      first.avatarId,
      first.candidateId,
    );
    const before = await readFile(approved.path, "utf8");

    const changed = avatarFixture();
    changed.artBible.notes = ["A new immutable revision."];
    const second = await store.createCandidate(changed);
    await store.selectCandidate(second.avatarId, second.candidateId);
    const next = await store.saveRevision(second.avatarId, second.candidateId);

    expect(next.revision).toBe(2);
    expect(next.hash).toBe(second.hash);
    expect(await readFile(approved.path, "utf8")).toBe(before);
    expect((await store.loadRevision(first.avatarId, 1)).hash).toBe(
      approved.hash,
    );
    expect((await store.loadRevision(first.avatarId, 2)).hash).toBe(next.hash);
  });

  it("lists revisions numerically and never exposes partial or incomplete snapshots as approved", async () => {
    const root = await temporaryRoot();
    const store = new AvatarStore(root);
    const first = await store.createCandidate(avatarFixture());
    await store.selectCandidate(first.avatarId, first.candidateId);
    const one = await store.saveRevision(first.avatarId, first.candidateId);
    const changed = avatarFixture();
    changed.artBible.notes = ["Revision two."];
    const second = await store.createCandidate(changed);
    await store.selectCandidate(second.avatarId, second.candidateId);
    const two = await store.saveRevision(second.avatarId, second.candidateId);

    const incomplete = join(root, first.avatarId, "revisions", "10");
    await mkdir(incomplete, { recursive: true });
    await writeFile(
      join(incomplete, "avatar.json"),
      canonicalAvatar(avatarFixture()),
      "utf8",
    );
    const partial = join(root, first.avatarId, "revisions", "3");
    await mkdir(partial, { recursive: true });
    await writeFile(
      join(partial, "avatar.json.partial"),
      canonicalAvatar(avatarFixture()),
      "utf8",
    );

    expect(await store.listRevisions(first.avatarId)).toEqual([
      { revision: 1, hash: one.hash, approved: true },
      { revision: 2, hash: two.hash, approved: true },
      { revision: 10, hash: avatarHash(avatarFixture()), approved: false },
    ]);
  });

  it("rejects traversal, separators, absolute IDs and invalid revision numbers", async () => {
    const root = await temporaryRoot();
    const store = new AvatarStore(root);
    const candidate = await store.createCandidate(avatarFixture());

    for (const id of [
      "../outside",
      "nested/id",
      "nested\\id",
      "/absolute",
      "C:\\absolute",
      ".",
      "..",
      "",
    ]) {
      await expect(store.loadRevision(id, 1)).rejects.toThrow(/inválido/);
      await expect(
        store.selectCandidate(candidate.avatarId, id),
      ).rejects.toThrow(/inválido/);
    }
    for (const revision of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(
        store.loadRevision(candidate.avatarId, revision),
      ).rejects.toThrow(/inválida/);
    }
    await expect(store.loadRevision(candidate.avatarId, 999)).rejects.toThrow(
      /encontrad|exist/i,
    );
  });

  it("does not persist invalid packages or alter the last good revision", async () => {
    const root = await temporaryRoot();
    const store = new AvatarStore(root);
    const candidate = await store.createCandidate(avatarFixture());
    await store.selectCandidate(candidate.avatarId, candidate.candidateId);
    const approved = await store.saveRevision(
      candidate.avatarId,
      candidate.candidateId,
    );
    const before = await readFile(approved.path, "utf8");
    const invalid = avatarFixture() as ReturnType<typeof avatarFixture> & {
      unexpected?: boolean;
    };
    invalid.unexpected = true;

    await expect(store.createCandidate(invalid)).rejects.toThrow();
    expect(await readFile(approved.path, "utf8")).toBe(before);
    expect(await store.listRevisions(candidate.avatarId)).toEqual([
      { revision: 1, hash: approved.hash, approved: true },
    ]);
    expect(
      await readdir(join(root, candidate.avatarId, "candidates")),
    ).toHaveLength(1);
  });

  it("cleans a failed revision rename and recovers without touching the last good snapshot", async () => {
    const root = await temporaryRoot();
    const store = new AvatarStore(root);
    const first = await store.createCandidate(avatarFixture());
    await store.selectCandidate(first.avatarId, first.candidateId);
    const approved = await store.saveRevision(
      first.avatarId,
      first.candidateId,
    );
    const before = await readFile(approved.path, "utf8");
    const changed = avatarFixture();
    changed.artBible.notes = ["Recovered revision."];
    const second = await store.createCandidate(changed);
    await store.selectCandidate(second.avatarId, second.candidateId);

    const failing = new FailingRenameStore(root);
    failing.failRevisionRename = true;
    await expect(
      failing.saveRevision(second.avatarId, second.candidateId),
    ).rejects.toThrow("Falha de rename simulada.");
    expect(await store.listRevisions(first.avatarId)).toEqual([
      { revision: 1, hash: approved.hash, approved: true },
    ]);
    expect(await readFile(approved.path, "utf8")).toBe(before);
    await expect(
      access(join(root, first.avatarId, "revisions", "2")),
    ).rejects.toThrow();

    const recovered = await new AvatarStore(root).saveRevision(
      second.avatarId,
      second.candidateId,
    );
    expect(recovered.revision).toBe(2);
    expect(await store.listRevisions(first.avatarId)).toEqual([
      { revision: 1, hash: approved.hash, approved: true },
      { revision: 2, hash: recovered.hash, approved: true },
    ]);
  });

  it("keeps the prior selected candidate recoverable when its selection rename fails", async () => {
    const root = await temporaryRoot();
    const store = new FailingRenameStore(root);
    const first = await store.createCandidate(avatarFixture());
    const second = await store.createCandidate(avatarFixture());
    await store.selectCandidate(first.avatarId, first.candidateId);
    store.failSelectionRename = true;

    await expect(
      store.selectCandidate(second.avatarId, second.candidateId),
    ).rejects.toThrow("Falha de rename simulada.");
    await expect(
      new AvatarStore(root).saveRevision(second.avatarId, second.candidateId),
    ).rejects.toThrow(/selecionado|selection/i);
    await expect(
      new AvatarStore(root).saveRevision(first.avatarId, first.candidateId),
    ).resolves.toMatchObject({ revision: 1, hash: first.hash });
  });

  it("serializes concurrent approvals of the same candidate across store instances", async () => {
    const root = await temporaryRoot();
    const store = new AvatarStore(root);
    const candidate = await store.createCandidate(avatarFixture());
    await store.selectCandidate(candidate.avatarId, candidate.candidateId);

    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        new AvatarStore(root).saveRevision(
          candidate.avatarId,
          candidate.candidateId,
        ),
      ),
    );
    const expected = {
      revision: 1,
      hash: candidate.hash,
      path: join(root, candidate.avatarId, "revisions", "1", "avatar.json"),
    };
    expect(results).toEqual(Array.from({ length: 6 }, () => expected));
    expect(await store.listRevisions(candidate.avatarId)).toEqual([
      { revision: 1, hash: candidate.hash, approved: true },
    ]);
  });

  it("rejects and then concurrently recovers a snapshot whose approval rename failed", async () => {
    const root = await temporaryRoot();
    const store = new AvatarStore(root);
    const first = await store.createCandidate(avatarFixture());
    await store.selectCandidate(first.avatarId, first.candidateId);
    const approved = await store.saveRevision(
      first.avatarId,
      first.candidateId,
    );
    const approvedBytes = await readFile(approved.path, "utf8");
    const changed = avatarFixture();
    changed.artBible.notes = ["Approval rename recovery."];
    const second = await store.createCandidate(changed);
    await store.selectCandidate(second.avatarId, second.candidateId);

    const failing = new FailingRenameStore(root);
    failing.failApprovalRename = true;
    await expect(
      failing.saveRevision(second.avatarId, second.candidateId),
    ).rejects.toThrow("Falha de rename simulada.");

    const pendingPath = join(
      root,
      second.avatarId,
      "revisions",
      "2",
      "avatar.json",
    );
    const pendingBytes = await readFile(pendingPath, "utf8");
    await expect(store.loadRevision(second.avatarId, 2)).rejects.toThrow(
      /aprova|approval/i,
    );
    expect(await store.listRevisions(second.avatarId)).toEqual([
      { revision: 1, hash: first.hash, approved: true },
      { revision: 2, hash: second.hash, approved: false },
    ]);
    expect(await readFile(approved.path, "utf8")).toBe(approvedBytes);
    await expect(
      access(
        `${pendingPath.replace(/avatar\.json$/, "approval.json")}.partial`,
      ),
    ).rejects.toThrow();

    const recovered = await Promise.all(
      Array.from({ length: 6 }, () =>
        new AvatarStore(root).saveRevision(second.avatarId, second.candidateId),
      ),
    );
    const expected = { revision: 2, hash: second.hash, path: pendingPath };
    expect(recovered).toEqual(Array.from({ length: 6 }, () => expected));
    expect((await store.loadRevision(second.avatarId, 2)).hash).toBe(
      second.hash,
    );
    expect(await store.listRevisions(second.avatarId)).toEqual([
      { revision: 1, hash: first.hash, approved: true },
      { revision: 2, hash: second.hash, approved: true },
    ]);
    expect(await readFile(pendingPath, "utf8")).toBe(pendingBytes);
    expect(await readFile(approved.path, "utf8")).toBe(approvedBytes);
  });

  it.each(["write", "sync"] as const)(
    "preserves selection and the last approved snapshot after revision %s failure",
    async (kind) => {
      const root = await temporaryRoot();
      const store = new AvatarStore(root);
      const first = await store.createCandidate(avatarFixture());
      await store.selectCandidate(first.avatarId, first.candidateId);
      const approved = await store.saveRevision(
        first.avatarId,
        first.candidateId,
      );
      const approvedBytes = await readFile(approved.path, "utf8");
      const changed = avatarFixture();
      changed.artBible.notes = [`Revision ${kind} failure.`];
      const second = await store.createCandidate(changed);
      await store.selectCandidate(second.avatarId, second.candidateId);
      const selectionPath = join(root, second.avatarId, "selection.json");
      const selectionBytes = await readFile(selectionPath, "utf8");

      const failing = new FailingRenameStore(root);
      if (kind === "write") failing.failWrite = true;
      else failing.failSync = true;
      await expect(
        failing.saveRevision(second.avatarId, second.candidateId),
      ).rejects.toThrow(
        kind === "write"
          ? "Falha de writeFile simulada."
          : "Falha de fsync simulada.",
      );

      expect(await readFile(selectionPath, "utf8")).toBe(selectionBytes);
      expect(await readFile(approved.path, "utf8")).toBe(approvedBytes);
      expect(await store.listRevisions(second.avatarId)).toEqual([
        { revision: 1, hash: first.hash, approved: true },
      ]);
      await expect(
        access(join(root, second.avatarId, "revisions", "2")),
      ).rejects.toThrow();

      const recovered = await new AvatarStore(root).saveRevision(
        second.avatarId,
        second.candidateId,
      );
      expect(recovered.revision).toBe(2);
      expect(await store.listRevisions(second.avatarId)).toEqual([
        { revision: 1, hash: first.hash, approved: true },
        { revision: 2, hash: second.hash, approved: true },
      ]);
      expect(await readFile(approved.path, "utf8")).toBe(approvedBytes);
    },
  );

  it.each(["write", "sync"] as const)(
    "keeps selection and approved bytes intact after selection %s failure",
    async (kind) => {
      const root = await temporaryRoot();
      const store = new AvatarStore(root);
      const first = await store.createCandidate(avatarFixture());
      const second = await store.createCandidate(avatarFixture());
      await store.selectCandidate(first.avatarId, first.candidateId);
      const approved = await store.saveRevision(
        first.avatarId,
        first.candidateId,
      );
      const approvedBytes = await readFile(approved.path, "utf8");
      const selectionPath = join(root, first.avatarId, "selection.json");
      const selectionBytes = await readFile(selectionPath, "utf8");

      const failing = new FailingRenameStore(root);
      if (kind === "write") failing.failWrite = true;
      else failing.failSync = true;
      await expect(
        failing.selectCandidate(second.avatarId, second.candidateId),
      ).rejects.toThrow(
        kind === "write"
          ? "Falha de writeFile simulada."
          : "Falha de fsync simulada.",
      );

      expect(await readFile(selectionPath, "utf8")).toBe(selectionBytes);
      expect(await readFile(approved.path, "utf8")).toBe(approvedBytes);
      await expect(access(`${selectionPath}.partial`)).rejects.toThrow();
      expect(await store.listRevisions(first.avatarId)).toEqual([
        { revision: 1, hash: first.hash, approved: true },
      ]);
      await expect(
        new AvatarStore(root).saveRevision(first.avatarId, first.candidateId),
      ).resolves.toEqual(approved);

      await new AvatarStore(root).selectCandidate(
        second.avatarId,
        second.candidateId,
      );
      const recovered = await new AvatarStore(root).saveRevision(
        second.avatarId,
        second.candidateId,
      );
      expect(recovered.revision).toBe(2);
      expect(await readFile(approved.path, "utf8")).toBe(approvedBytes);
    },
  );

  it("rejects an avatar directory redirected outside the real root without creating external files", async (context) => {
    const root = await temporaryRoot();
    const outside = await temporaryRoot();
    const fixture = avatarFixture();
    if (
      !(await makeDirectoryRedirect(outside, join(root, fixture.id), context))
    ) {
      return;
    }

    await expect(
      new AvatarStore(root).createCandidate(fixture),
    ).rejects.toThrow(/fora|redire/i);
    expect(await readdir(outside)).toEqual([]);
  });

  it("rejects a candidates directory redirected outside the real root", async (context) => {
    const root = await temporaryRoot();
    const outside = await temporaryRoot();
    const fixture = avatarFixture();
    const candidateId = "candidate-external";
    await mkdir(join(outside, candidateId), { recursive: true });
    await writeFile(
      join(outside, candidateId, "avatar.json"),
      canonicalAvatar(fixture),
      "utf8",
    );
    if (
      !(await makeDirectoryRedirect(
        outside,
        join(root, fixture.id, "candidates"),
        context,
      ))
    ) {
      return;
    }

    const store = new AvatarStore(root);
    await expect(
      store.selectCandidate(fixture.id, candidateId),
    ).rejects.toThrow(/fora|redire/i);
    await expect(
      access(join(root, fixture.id, "selection.json")),
    ).rejects.toThrow();
  });

  it("rejects a revisions directory redirected outside the real root without exposing its snapshot", async (context) => {
    const root = await temporaryRoot();
    const outside = await temporaryRoot();
    const store = new AvatarStore(root);
    const candidate = await store.createCandidate(avatarFixture());
    await mkdir(join(outside, "1"), { recursive: true });
    const externalSnapshot = join(outside, "1", "avatar.json");
    await writeFile(externalSnapshot, canonicalAvatar(avatarFixture()), "utf8");
    await writeFile(
      join(outside, "1", "approval.json"),
      JSON.stringify({
        candidateId: candidate.candidateId,
        hash: candidate.hash,
        revision: 1,
      }),
      "utf8",
    );
    if (
      !(await makeDirectoryRedirect(
        outside,
        join(root, candidate.avatarId, "revisions"),
        context,
      ))
    ) {
      return;
    }
    const externalBytes = await readFile(externalSnapshot, "utf8");

    await expect(store.loadRevision(candidate.avatarId, 1)).rejects.toThrow(
      /fora|redire/i,
    );
    expect(await readFile(externalSnapshot, "utf8")).toBe(externalBytes);
  });

  it("does not remove an external partial file through a redirected avatar directory", async (context) => {
    const root = await temporaryRoot();
    const outside = await temporaryRoot();
    const fixture = avatarFixture();
    const candidateId = "candidate-external";
    await mkdir(join(outside, "candidates", candidateId), { recursive: true });
    await writeFile(
      join(outside, "candidates", candidateId, "avatar.json"),
      canonicalAvatar(fixture),
      "utf8",
    );
    const externalPartial = join(outside, "selection.json.partial");
    await writeFile(externalPartial, "outro-processo", "utf8");
    if (
      !(await makeDirectoryRedirect(outside, join(root, fixture.id), context))
    ) {
      return;
    }

    await expect(
      new AvatarStore(root).selectCandidate(fixture.id, candidateId),
    ).rejects.toThrow(/fora|redire/i);
    expect(await readFile(externalPartial, "utf8")).toBe("outro-processo");
    await expect(access(join(outside, "selection.json"))).rejects.toThrow();
  });

  it.skipIf(process.platform !== "win32")(
    "serializes concurrent saves through Windows drive-letter root aliases",
    async () => {
      const root = await temporaryRoot();
      const store = new AvatarStore(root);
      const candidate = await store.createCandidate(avatarFixture());
      await store.selectCandidate(candidate.avatarId, candidate.candidateId);
      const alias = root.startsWith("C:")
        ? `c:${root.slice(2)}`
        : root.startsWith("c:")
          ? `C:${root.slice(2)}`
          : root;

      const results = await Promise.all(
        Array.from({ length: 6 }, (_, index) =>
          new AvatarStore(index % 2 === 0 ? root : alias).saveRevision(
            candidate.avatarId,
            candidate.candidateId,
          ),
        ),
      );
      expect(new Set(results.map((result) => result.revision))).toEqual(
        new Set([1]),
      );
      expect(new Set(results.map((result) => result.path))).toHaveLength(1);
      expect(await store.listRevisions(candidate.avatarId)).toEqual([
        { revision: 1, hash: candidate.hash, approved: true },
      ]);
    },
  );

  it("preserves a pre-existing selection partial owned by another operation", async () => {
    const root = await temporaryRoot();
    const store = new AvatarStore(root);
    const candidate = await store.createCandidate(avatarFixture());
    const partial = join(root, candidate.avatarId, "selection.json.partial");
    await writeFile(partial, "outro-processo", "utf8");

    await expect(
      store.selectCandidate(candidate.avatarId, candidate.candidateId),
    ).rejects.toThrow();
    expect(await readFile(partial, "utf8")).toBe("outro-processo");
    await expect(
      access(join(root, candidate.avatarId, "selection.json")),
    ).rejects.toThrow();
  });

  it("syncs revision directories and recovers a pending snapshot after directory fsync failure", async () => {
    const root = await temporaryRoot();
    const store = new AvatarStore(root);
    const first = await store.createCandidate(avatarFixture());
    await store.selectCandidate(first.avatarId, first.candidateId);
    const approved = await store.saveRevision(
      first.avatarId,
      first.candidateId,
    );
    const approvedBytes = await readFile(approved.path, "utf8");
    const changed = avatarFixture();
    changed.artBible.notes = ["Directory sync recovery."];
    const second = await store.createCandidate(changed);
    await store.selectCandidate(second.avatarId, second.candidateId);
    const selectionBytes = await readFile(
      join(root, second.avatarId, "selection.json"),
      "utf8",
    );

    const failing = new FailingRenameStore(root);
    failing.failSecondRevisionDirectorySync = true;
    await expect(
      failing.saveRevision(second.avatarId, second.candidateId),
    ).rejects.toThrow("Falha de fsync de diretório simulada.");

    const revisionDirectory = join(root, second.avatarId, "revisions", "2");
    const pendingPath = join(revisionDirectory, "avatar.json");
    const pendingBytes = await readFile(pendingPath, "utf8");
    expect(failing.syncedDirectories).toContain(revisionDirectory);
    await expect(store.loadRevision(second.avatarId, 2)).rejects.toThrow(
      /aprova|approval/i,
    );
    expect(await store.listRevisions(second.avatarId)).toEqual([
      { revision: 1, hash: first.hash, approved: true },
      { revision: 2, hash: second.hash, approved: false },
    ]);
    await expect(
      access(join(revisionDirectory, "approval.json")),
    ).rejects.toThrow();
    await expect(access(`${pendingPath}.partial`)).rejects.toThrow();
    expect(await readFile(approved.path, "utf8")).toBe(approvedBytes);

    const recovered = await new AvatarStore(root).saveRevision(
      second.avatarId,
      second.candidateId,
    );
    expect(recovered).toEqual({
      revision: 2,
      hash: second.hash,
      path: pendingPath,
    });
    expect(await readFile(pendingPath, "utf8")).toBe(pendingBytes);
    expect(await readFile(approved.path, "utf8")).toBe(approvedBytes);
    expect(
      await readFile(join(root, second.avatarId, "selection.json"), "utf8"),
    ).toBe(selectionBytes);
    expect(await store.listRevisions(second.avatarId)).toEqual([
      { revision: 1, hash: first.hash, approved: true },
      { revision: 2, hash: second.hash, approved: true },
    ]);
  });

  it("does not remove another instance's partial after a successful selection rename", async () => {
    const root = await temporaryRoot();
    const store = new AvatarStore(root);
    const first = await store.createCandidate(avatarFixture());
    const changed = avatarFixture();
    changed.artBible.notes = ["Second selection owner."];
    const second = await store.createCandidate(changed);
    const bPartialCreated = deferred();
    const finishB = deferred();
    const a = new CoordinatedSelectionStore(root);
    const b = new CoordinatedSelectionStore(root);
    let bSelection!: Promise<void>;

    b.beforeSelectionWrite = async () => {
      bPartialCreated.resolve();
      await finishB.promise;
    };
    a.afterSelectionRename = async () => {
      bSelection = b.selectCandidate(second.avatarId, second.candidateId);
      await bPartialCreated.promise;
    };

    await a.selectCandidate(first.avatarId, first.candidateId);
    finishB.resolve();
    await bSelection;

    const selection = JSON.parse(
      await readFile(join(root, first.avatarId, "selection.json"), "utf8"),
    );
    expect(selection.candidateId).toBe(second.candidateId);
    await expect(
      access(join(root, first.avatarId, "selection.json.partial")),
    ).rejects.toThrow();
  });

  it("retries initialization on the same instance after a transient root failure", async () => {
    const parent = await temporaryRoot();
    const root = join(parent, "avatar-root");
    await writeFile(root, "not-a-directory", "utf8");
    const store = new AvatarStore(root);

    const initial = await Promise.allSettled([
      store.createCandidate(avatarFixture()),
      store.createCandidate(avatarFixture()),
    ]);
    expect(initial.map((result) => result.status)).toEqual([
      "rejected",
      "rejected",
    ]);

    await rm(root);
    await mkdir(root);
    const candidates = await Promise.all(
      Array.from({ length: 4 }, () => store.createCandidate(avatarFixture())),
    );
    expect(
      new Set(candidates.map((candidate) => candidate.candidateId)),
    ).toHaveLength(4);
    expect(
      await readdir(join(root, avatarFixture().id, "candidates")),
    ).toHaveLength(4);
  });

  it("cleans an empty new revision when parent directory sync fails and reuses its number", async () => {
    const root = await temporaryRoot();
    const store = new AvatarStore(root);
    const first = await store.createCandidate(avatarFixture());
    await store.selectCandidate(first.avatarId, first.candidateId);
    const approved = await store.saveRevision(
      first.avatarId,
      first.candidateId,
    );
    const approvedBytes = await readFile(approved.path, "utf8");
    const changed = avatarFixture();
    changed.artBible.notes = ["Parent directory sync retry."];
    const second = await store.createCandidate(changed);
    await store.selectCandidate(second.avatarId, second.candidateId);
    const revisionDirectory = join(root, second.avatarId, "revisions", "2");

    const failing = new FailingRenameStore(root);
    failing.failSecondRevisionsRootSync = true;
    await expect(
      failing.saveRevision(second.avatarId, second.candidateId),
    ).rejects.toThrow("Falha transitória de fsync do diretório pai.");
    await expect(access(revisionDirectory)).rejects.toThrow();
    expect(await store.listRevisions(second.avatarId)).toEqual([
      { revision: 1, hash: first.hash, approved: true },
    ]);
    expect(await readFile(approved.path, "utf8")).toBe(approvedBytes);

    const recovered = await new AvatarStore(root).saveRevision(
      second.avatarId,
      second.candidateId,
    );
    expect(recovered.revision).toBe(2);
    expect(recovered.path).toBe(join(revisionDirectory, "avatar.json"));
    expect(await store.listRevisions(second.avatarId)).toEqual([
      { revision: 1, hash: first.hash, approved: true },
      { revision: 2, hash: second.hash, approved: true },
    ]);
    expect(await readFile(approved.path, "utf8")).toBe(approvedBytes);
  });
});

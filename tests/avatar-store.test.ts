import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AvatarStore } from "../electron/core/avatar-store";
import { avatarHash, canonicalAvatar } from "../src/shared/avatar";
import { avatarFixture } from "./fixtures/avatar-fixture";

const roots: string[] = [];

async function temporaryRoot() {
  const root = await mkdtemp(join(tmpdir(), "avatar-store-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

class FailingRenameStore extends AvatarStore {
  failSelectionRename = false;
  failRevisionRename = false;

  protected override async rename(source: string, target: string) {
    const shouldFail =
      (this.failSelectionRename && target.endsWith("selection.json")) ||
      (this.failRevisionRename && target.includes(`${sep}revisions${sep}`));
    if (shouldFail) {
      this.failSelectionRename = false;
      this.failRevisionRename = false;
      throw new Error("Falha de rename simulada.");
    }
    await super.rename(source, target);
  }
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
});

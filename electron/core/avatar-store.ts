import { randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename as fsRename,
  rm,
  rmdir,
} from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import {
  avatarHash,
  canonicalAvatar,
  parseAvatar,
  type AvatarPackage,
} from "../../src/shared/avatar";

interface Selection {
  candidateId: string;
  hash: string;
}

interface Approval extends Selection {
  revision: number;
}

const ID_PATTERN = /^[A-Za-z][A-Za-z0-9._-]{0,63}$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;

function assertId(value: unknown, label: string): string {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) {
    throw new Error(`${label} inválido.`);
  }
  return value;
}

function assertRevision(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    (value as number) < 1
  ) {
    throw new Error("Revisão inválida.");
  }
  return value as number;
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

export class AvatarStore {
  private static readonly approvalQueues = new Map<string, Promise<void>>();

  private root: string;
  private initialization: Promise<void> | undefined;

  constructor(root: string) {
    this.root = resolve(root);
  }

  private async initializeRoot(): Promise<void> {
    if (!this.initialization) {
      this.initialization = (async () => {
        await mkdir(this.root, { recursive: true });
        this.root = await realpath(this.root);
      })();
    }
    const initialization = this.initialization;
    try {
      await initialization;
    } catch (error) {
      if (this.initialization === initialization) {
        this.initialization = undefined;
      }
      throw error;
    }
  }

  private async withApprovalLock<T>(
    avatarId: string,
    candidateId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    await this.initializeRoot();
    const lockRoot =
      process.platform === "win32" ? this.root.toLowerCase() : this.root;
    const key = `${lockRoot}\0${avatarId}\0${candidateId}`;
    const previous = AvatarStore.approvalQueues.get(key) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => current);
    AvatarStore.approvalQueues.set(key, tail);

    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (AvatarStore.approvalQueues.get(key) === tail) {
        AvatarStore.approvalQueues.delete(key);
      }
    }
  }

  async createCandidate(
    input: unknown,
  ): Promise<{ avatarId: string; candidateId: string; hash: string }> {
    const avatar = parseAvatar(input);
    const avatarId = assertId(avatar.id, "Avatar ID");
    const candidateId = `candidate-${randomUUID()}`;
    const canonical = canonicalAvatar(avatar);
    const hash = avatarHash(avatar);
    await this.initializeRoot();
    await this.writeAtomic(
      this.candidatePath(avatarId, candidateId),
      canonical,
    );
    return { avatarId, candidateId, hash };
  }

  async loadCandidate(
    avatarId: string,
    candidateId: string,
  ): Promise<{ avatar: AvatarPackage; hash: string; path: string }> {
    await this.initializeRoot();
    const candidate = await this.readCandidate(avatarId, candidateId);
    return {
      ...candidate,
      path: this.candidatePath(avatarId, candidateId),
    };
  }

  private metadataPath(avatarId: string, key: string): string {
    const path = resolve(
      this.avatarPath(avatarId),
      "metadata",
      `${assertId(key, "Metadata key")}.json`,
    );
    this.assertInsideRoot(path);
    return path;
  }

  async readMetadata(avatarId: string, key: string): Promise<unknown> {
    await this.initializeRoot();
    const path = this.metadataPath(avatarId, key);
    await this.assertContained(path);
    try {
      return JSON.parse(await readFile(path, "utf8")) as unknown;
    } catch (error) {
      if (isMissing(error)) return undefined;
      throw error;
    }
  }

  async writeMetadata(
    avatarId: string,
    key: string,
    value: unknown,
  ): Promise<void> {
    const contents = JSON.stringify(value);
    if (contents === undefined) {
      throw new Error("Metadata de avatar deve ser serializável em JSON.");
    }
    await this.writeAtomic(this.metadataPath(avatarId, key), contents);
  }

  async selectCandidate(avatarId: string, candidateId: string): Promise<void> {
    await this.initializeRoot();
    const candidate = await this.readCandidate(avatarId, candidateId);
    const selection: Selection = {
      candidateId: assertId(candidateId, "Candidate ID"),
      hash: candidate.hash,
    };
    await this.writeAtomic(
      this.selectionPath(avatarId),
      JSON.stringify(selection),
    );
  }

  async saveRevision(
    avatarId: string,
    candidateId: string,
  ): Promise<{ revision: number; hash: string; path: string }> {
    const validAvatarId = assertId(avatarId, "Avatar ID");
    const validCandidateId = assertId(candidateId, "Candidate ID");
    return this.withApprovalLock(validAvatarId, validCandidateId, () =>
      this.saveRevisionLocked(validAvatarId, validCandidateId),
    );
  }

  private async saveRevisionLocked(
    validAvatarId: string,
    validCandidateId: string,
  ): Promise<{ revision: number; hash: string; path: string }> {
    const selection = await this.readSelection(validAvatarId);
    if (selection.candidateId !== validCandidateId) {
      throw new Error("Candidato não selecionado para este avatar.");
    }
    const candidate = await this.readCandidate(validAvatarId, validCandidateId);
    if (candidate.hash !== selection.hash) {
      throw new Error("Candidato selecionado foi alterado.");
    }

    const existing = await this.findApproval(
      validAvatarId,
      validCandidateId,
      candidate.hash,
    );
    if (existing) return existing;

    const pending = await this.findPendingRevision(
      validAvatarId,
      candidate.hash,
    );
    if (pending !== undefined) {
      const approval: Approval = {
        candidateId: validCandidateId,
        hash: candidate.hash,
        revision: pending,
      };
      await this.writeAtomic(
        this.approvalPath(validAvatarId, pending),
        JSON.stringify(approval),
      );
      return {
        revision: pending,
        hash: candidate.hash,
        path: this.revisionPath(validAvatarId, pending),
      };
    }

    const revisionsRoot = this.revisionsPath(validAvatarId);
    await this.assertContained(revisionsRoot);
    await mkdir(revisionsRoot, { recursive: true });
    await this.assertContained(revisionsRoot);
    await this.syncDirectoryChain(revisionsRoot);
    const used = await this.revisionNumbers(validAvatarId);
    let revision = used.length ? Math.max(...used) + 1 : 1;
    let revisionDirectory: string;
    for (;;) {
      revisionDirectory = resolve(revisionsRoot, String(revision));
      await this.assertContained(revisionDirectory);
      try {
        await mkdir(revisionDirectory);
        await this.assertContained(revisionDirectory);
        break;
      } catch (error) {
        if (
          typeof error !== "object" ||
          error === null ||
          !("code" in error) ||
          error.code !== "EEXIST"
        ) {
          throw error;
        }
        revision += 1;
      }
    }

    const path = this.revisionPath(validAvatarId, revision);
    const approval: Approval = {
      candidateId: validCandidateId,
      hash: candidate.hash,
      revision,
    };
    try {
      await this.syncDirectory(revisionsRoot);
      await this.writeAtomic(path, canonicalAvatar(candidate.avatar));
      await this.writeAtomic(
        this.approvalPath(validAvatarId, revision),
        JSON.stringify(approval),
      );
      return { revision, hash: candidate.hash, path };
    } catch (error) {
      // Only an empty directory created by this attempt can be removed. A
      // completed avatar.json is retained as an incomplete, unapproved snapshot.
      await this.assertContained(revisionDirectory)
        .then(() => rmdir(revisionDirectory))
        .catch(() => undefined);
      throw error;
    }
  }

  async loadRevision(
    avatarId: string,
    revision: number,
  ): Promise<{ avatar: AvatarPackage; hash: string; path: string }> {
    await this.initializeRoot();
    const path = this.revisionPath(avatarId, revision);
    try {
      const { avatar, hash } = await this.readAvatar(path);
      if (!(await this.hasIntegralApproval(avatarId, revision, hash))) {
        throw new Error(`Revisão ${revision} sem aprovação íntegra.`);
      }
      return { avatar, hash, path };
    } catch (error) {
      if (isMissing(error)) {
        throw new Error(`Revisão ${revision} não encontrada.`);
      }
      throw error;
    }
  }

  async listRevisions(
    avatarId: string,
  ): Promise<Array<{ revision: number; hash: string; approved: boolean }>> {
    const revisions = await this.revisionNumbers(avatarId);
    const result: Array<{
      revision: number;
      hash: string;
      approved: boolean;
    }> = [];
    for (const revision of revisions) {
      try {
        const { hash } = await this.readAvatar(
          this.revisionPath(avatarId, revision),
        );
        result.push({
          revision,
          hash,
          approved: await this.hasIntegralApproval(avatarId, revision, hash),
        });
      } catch {
        // Invalid or partial snapshots are not approved revision records.
      }
    }
    return result;
  }

  protected async rename(source: string, target: string): Promise<void> {
    await fsRename(source, target);
  }

  protected async writeFile(
    handle: Awaited<ReturnType<typeof open>>,
    contents: string,
  ): Promise<void> {
    await handle.writeFile(contents, "utf8");
  }

  protected async sync(
    handle: Awaited<ReturnType<typeof open>>,
  ): Promise<void> {
    await handle.sync();
  }

  protected async syncDirectory(path: string): Promise<void> {
    if (process.platform === "win32") return;
    const handle = await open(path, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  private async syncDirectoryChain(path: string): Promise<void> {
    this.assertInsideRoot(path);
    const directories = [this.root];
    let current = this.root;
    for (const component of relative(this.root, path)
      .split(sep)
      .filter(Boolean)) {
      current = resolve(current, component);
      await this.assertContained(current);
      directories.push(current);
    }
    for (const directory of directories) {
      await this.syncDirectory(directory);
    }
  }

  private avatarPath(avatarId: string): string {
    const path = resolve(this.root, assertId(avatarId, "Avatar ID"));
    this.assertInsideRoot(path);
    return path;
  }

  private candidatePath(avatarId: string, candidateId: string): string {
    const path = resolve(
      this.avatarPath(avatarId),
      "candidates",
      assertId(candidateId, "Candidate ID"),
      "avatar.json",
    );
    this.assertInsideRoot(path);
    return path;
  }

  private selectionPath(avatarId: string): string {
    const path = resolve(this.avatarPath(avatarId), "selection.json");
    this.assertInsideRoot(path);
    return path;
  }

  private revisionsPath(avatarId: string): string {
    const path = resolve(this.avatarPath(avatarId), "revisions");
    this.assertInsideRoot(path);
    return path;
  }

  private revisionPath(avatarId: string, revision: number): string {
    const path = resolve(
      this.revisionsPath(avatarId),
      String(assertRevision(revision)),
      "avatar.json",
    );
    this.assertInsideRoot(path);
    return path;
  }

  private approvalPath(avatarId: string, revision: number): string {
    const path = resolve(
      this.revisionsPath(avatarId),
      String(assertRevision(revision)),
      "approval.json",
    );
    this.assertInsideRoot(path);
    return path;
  }

  private pathForComparison(path: string): string {
    const resolved = resolve(path);
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  }

  private isWithinRoot(path: string): boolean {
    const root = this.pathForComparison(this.root);
    const candidate = this.pathForComparison(path);
    const prefix = root.endsWith(sep) ? root : `${root}${sep}`;
    return candidate === root || candidate.startsWith(prefix);
  }

  private assertInsideRoot(path: string): void {
    if (
      this.pathForComparison(path) === this.pathForComparison(this.root) ||
      !this.isWithinRoot(path)
    ) {
      throw new Error("Caminho inválido fora do armazenamento de avatares.");
    }
  }

  private async assertContained(path: string): Promise<void> {
    this.assertInsideRoot(path);
    let current = this.root;
    for (const component of relative(this.root, path)
      .split(sep)
      .filter(Boolean)) {
      current = resolve(current, component);
      try {
        const actual = await realpath(current);
        if (!this.isWithinRoot(actual)) {
          throw new Error(
            "Caminho inválido: redirecionamento para fora do armazenamento.",
          );
        }
      } catch (error) {
        if (isMissing(error)) return;
        throw error;
      }
    }
  }

  private async readAvatar(
    path: string,
  ): Promise<{ avatar: AvatarPackage; hash: string }> {
    await this.assertContained(path);
    const avatar = parseAvatar(JSON.parse(await readFile(path, "utf8")));
    return { avatar, hash: avatarHash(avatar) };
  }

  private async readCandidate(
    avatarId: string,
    candidateId: string,
  ): Promise<{ avatar: AvatarPackage; hash: string }> {
    const path = this.candidatePath(avatarId, candidateId);
    try {
      const candidate = await this.readAvatar(path);
      if (candidate.avatar.id !== avatarId) {
        throw new Error("Candidate ID inválido para o avatar informado.");
      }
      return candidate;
    } catch (error) {
      if (isMissing(error)) {
        throw new Error(`Candidato ${candidateId} não encontrado.`);
      }
      throw error;
    }
  }

  private async readSelection(avatarId: string): Promise<Selection> {
    let value: unknown;
    const path = this.selectionPath(avatarId);
    await this.assertContained(path);
    try {
      value = JSON.parse(await readFile(path, "utf8"));
    } catch (error) {
      if (isMissing(error)) {
        throw new Error("Nenhum candidato selecionado para este avatar.");
      }
      throw error;
    }
    if (
      typeof value !== "object" ||
      value === null ||
      !("candidateId" in value) ||
      !("hash" in value) ||
      typeof value.hash !== "string" ||
      !HASH_PATTERN.test(value.hash)
    ) {
      throw new Error("Seleção de candidato inválida.");
    }
    return {
      candidateId: assertId(value.candidateId, "Candidate ID"),
      hash: value.hash,
    };
  }

  private async readApproval(
    avatarId: string,
    revision: number,
  ): Promise<Approval | undefined> {
    const path = this.approvalPath(avatarId, revision);
    await this.assertContained(path);
    try {
      const value: unknown = JSON.parse(await readFile(path, "utf8"));
      if (
        typeof value !== "object" ||
        value === null ||
        !("candidateId" in value) ||
        !("hash" in value) ||
        !("revision" in value) ||
        typeof value.hash !== "string" ||
        !HASH_PATTERN.test(value.hash)
      ) {
        return undefined;
      }
      return {
        candidateId: assertId(value.candidateId, "Candidate ID"),
        hash: value.hash,
        revision: assertRevision(value.revision),
      };
    } catch {
      return undefined;
    }
  }

  private async hasIntegralApproval(
    avatarId: string,
    revision: number,
    hash: string,
  ): Promise<boolean> {
    const approval = await this.readApproval(avatarId, revision);
    if (approval?.revision !== revision || approval.hash !== hash) return false;
    try {
      const candidate = await this.readCandidate(
        avatarId,
        approval.candidateId,
      );
      return candidate.hash === hash;
    } catch {
      return false;
    }
  }

  private async findPendingRevision(
    avatarId: string,
    hash: string,
  ): Promise<number | undefined> {
    for (const revision of await this.revisionNumbers(avatarId)) {
      if (await this.readApproval(avatarId, revision)) continue;
      try {
        const snapshot = await this.readAvatar(
          this.revisionPath(avatarId, revision),
        );
        if (snapshot.hash === hash) return revision;
      } catch {
        // Partial or damaged snapshots are not recoverable approvals.
      }
    }
    return undefined;
  }

  private async findApproval(
    avatarId: string,
    candidateId: string,
    hash: string,
  ): Promise<{ revision: number; hash: string; path: string } | undefined> {
    for (const revision of await this.revisionNumbers(avatarId)) {
      const approval = await this.readApproval(avatarId, revision);
      if (
        approval?.candidateId !== candidateId ||
        approval.hash !== hash ||
        approval.revision !== revision
      ) {
        continue;
      }
      const path = this.revisionPath(avatarId, revision);
      try {
        const snapshot = await this.readAvatar(path);
        if (
          snapshot.hash === hash &&
          (await this.hasIntegralApproval(avatarId, revision, hash))
        ) {
          return { revision, hash, path };
        }
      } catch {
        // A damaged approval is not a valid idempotent result.
      }
    }
    return undefined;
  }

  private async revisionNumbers(avatarId: string): Promise<number[]> {
    await this.initializeRoot();
    const path = this.revisionsPath(avatarId);
    await this.assertContained(path);
    let entries;
    try {
      entries = await readdir(path, {
        withFileTypes: true,
      });
    } catch (error) {
      if (isMissing(error)) return [];
      throw error;
    }
    return entries
      .filter(
        (entry) => entry.isDirectory() && /^[1-9][0-9]*$/.test(entry.name),
      )
      .map((entry) => Number(entry.name))
      .filter((revision) => Number.isSafeInteger(revision))
      .sort((left, right) => left - right);
  }

  private async writeAtomic(path: string, contents: string): Promise<void> {
    await this.initializeRoot();
    await this.assertContained(path);
    await mkdir(dirname(path), { recursive: true });
    await this.assertContained(path);
    await this.syncDirectoryChain(dirname(path));
    const partial = `${path}.partial`;
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    let created = false;
    try {
      handle = await open(partial, "wx");
      created = true;
      await this.writeFile(handle, contents);
      await this.sync(handle);
      await handle.close();
      handle = undefined;
      await this.rename(partial, path);
      created = false;
      await this.syncDirectory(dirname(path));
    } finally {
      if (handle) await handle.close().catch(() => undefined);
      if (created) {
        await this.assertContained(partial)
          .then(() => rm(partial, { force: true }))
          .catch(() => undefined);
      }
    }
  }
}

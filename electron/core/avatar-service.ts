import { randomUUID } from "node:crypto";
import { basename, dirname } from "node:path";
import {
  AVATAR_EXPRESSIONS,
  AVATAR_MOUTHS,
  AVATAR_POSES,
  avatarHash,
  parseAvatar,
  type AvatarPackage,
  type AvatarPoint,
} from "../../src/shared/avatar";
import {
  validateAvatarPackage,
  type AvatarQualityReport,
} from "../../src/shared/avatar-quality";
import type { AvatarRenderOptions, AvatarRenderResult } from "./avatar-render";

const METADATA_KEY = "avatar-service";
const MAX_CORRECTION_ROUNDS = 3;
const ALLOWED_EVIDENCE = new Set([
  "neutral.png",
  "expressions.png",
  "mouths.png",
]);
const JOB_ID = /^[A-Za-z][A-Za-z0-9._-]{0,63}$/;

export const AVATAR_RUBRIC_LIMITS = {
  identity: 20,
  silhouette: 15,
  pixelCraft: 15,
  palette: 15,
  expressions: 15,
  rig: 15,
  export: 5,
} as const;

export type AvatarRubric = Record<keyof typeof AVATAR_RUBRIC_LIMITS, number>;
export type AvatarEvidence = string[];

export interface AvatarRevisionResult {
  ok: boolean;
  previousRevision: number;
  previousHash: string;
  allowedPartIds: string[];
  changedPartIds: string[];
  correctionRounds: number;
  quality: AvatarQualityReport;
}

export interface AvatarReviewRecord {
  avatarId: string;
  candidateId: string;
  rubric: AvatarRubric;
  evidence: AvatarEvidence;
  total: number;
}

export interface AvatarCandidate {
  avatarId: string;
  candidateId: string;
  hash: string;
  description: string;
  quality: AvatarQualityReport;
  correctionRounds: number;
  manualApproved: boolean;
  rootCandidateId: string;
  parentCandidateId?: string;
  revision?: number;
  identityAnchors?: Record<string, AvatarPoint>;
  review?: AvatarReviewRecord;
  lastRevisionResult?: AvatarRevisionResult;
}

export interface AvatarSelectedCandidate extends AvatarCandidate {
  revision: number;
  identityAnchors: Record<string, AvatarPoint>;
  path: string;
}

export interface AvatarRevisedCandidate extends AvatarSelectedCandidate {
  changedPartIds: string[];
}

export interface AvatarValidationResult {
  ok: boolean;
  quality: AvatarQualityReport;
  avatar?: AvatarPackage;
  hash?: string;
}

interface CandidateReference {
  avatarId: string;
  candidateId: string;
  hash: string;
}

interface LoadedAvatar {
  avatar: AvatarPackage;
  hash: string;
  path: string;
}

interface SavedRevision {
  revision: number;
  hash: string;
  path: string;
}

export interface AvatarServiceStore {
  createCandidate(input: unknown): Promise<CandidateReference>;
  loadCandidate(avatarId: string, candidateId: string): Promise<LoadedAvatar>;
  selectCandidate(avatarId: string, candidateId: string): Promise<void>;
  saveRevision(avatarId: string, candidateId: string): Promise<SavedRevision>;
  loadRevision(avatarId: string, revision: number): Promise<LoadedAvatar>;
  readMetadata(avatarId: string, key: string): Promise<unknown>;
  writeMetadata(avatarId: string, key: string, value: unknown): Promise<void>;
}

export type AvatarRenderer = (
  options: Omit<AvatarRenderOptions, "signal"> & { signal: AbortSignal },
) => Promise<AvatarRenderResult>;

export interface AvatarServiceAdapters {
  store: AvatarServiceStore;
  renderer: AvatarRenderer;
}

export interface CreateCandidatesInput {
  /** Model-owned description metadata; never used to generate a package. */
  description: string;
  packages: readonly unknown[];
}

export interface CreateCandidateInput {
  description: string;
  package: unknown;
}

export interface CreatedCandidates {
  avatarId: string;
  description: string;
  candidates: AvatarCandidate[];
}

export interface RevisePartInput {
  avatarId: string;
  revision: number;
  allowedPartIds: string[];
  package: unknown;
}

export interface ReviewCandidateInput {
  avatarId: string;
  candidateId: string;
  rubric: AvatarRubric;
  evidence: AvatarEvidence;
  /** Manual approval is only set by this explicit flag, never by the score. */
  manualApproved?: boolean;
}

export interface ReviewedCandidate extends AvatarReviewRecord {
  bestCandidateId: string;
  manualApproved: boolean;
}

export interface RenderRevisionInput extends Omit<
  AvatarRenderOptions,
  "revisionDir" | "signal"
> {
  avatarId: string;
  revision: number;
  jobId?: string;
}

interface RevisionState {
  candidateId: string;
  quality: AvatarQualityReport;
  result?: AvatarRevisionResult;
  artifacts?: string[];
}

interface AvatarServiceState {
  version: 1;
  candidates: Record<string, AvatarCandidate>;
  bestCandidateId?: string;
  revisions: Record<string, RevisionState>;
}

function emptyState(): AvatarServiceState {
  return { version: 1, candidates: {}, revisions: {} };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, child]) => [key, canonicalValue(child)]),
    );
  }
  return value;
}

function sameValue(left: unknown, right: unknown): boolean {
  return (
    JSON.stringify(canonicalValue(left)) ===
    JSON.stringify(canonicalValue(right))
  );
}

function partSnapshot(avatar: AvatarPackage, partId: string): unknown {
  return {
    part: avatar.parts.find((part) => part.id === partId),
    poses: Object.fromEntries(
      AVATAR_POSES.map((pose) => [pose, avatar.poses[pose][partId]]),
    ),
    expressions: Object.fromEntries(
      AVATAR_EXPRESSIONS.map((expression) => [
        expression,
        avatar.expressions[expression][partId],
      ]),
    ),
    mouths: Object.fromEntries(
      AVATAR_MOUTHS.map((mouth) => [mouth, avatar.mouths[mouth][partId]]),
    ),
  };
}

function changedPartIds(before: AvatarPackage, after: AvatarPackage): string[] {
  const ids = [
    ...new Set([
      ...before.parts.map((part) => part.id),
      ...after.parts.map((part) => part.id),
    ]),
  ];
  return ids.filter(
    (id) => !sameValue(partSnapshot(before, id), partSnapshot(after, id)),
  );
}

function qualityError(
  operation: "Candidato" | "Revisão" | "Pacote",
  quality: AvatarQualityReport,
): Error {
  const unauthorized = quality.findings.some(
    (finding) =>
      finding.code === "UNAUTHORIZED_PART_CHANGE" ||
      finding.code === "IDENTITY_CHANGED",
  );
  const details = quality.findings
    .map(
      (finding) =>
        `parte "${finding.partId ?? "pacote"}": ${finding.code}: ${finding.message}`,
    )
    .join("; ");
  const status = unauthorized ? "não autorizada" : "rejeitado";
  return new Error(
    `${operation} ${status}${details ? ` — ${details}` : " pelos quality gates"}.`,
  );
}

function assertDescription(value: unknown): asserts value is string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Description deve ser metadata textual não vazia.");
  }
}

function parseState(value: unknown): AvatarServiceState {
  if (value === undefined) return emptyState();
  if (
    typeof value !== "object" ||
    value === null ||
    !("version" in value) ||
    value.version !== 1 ||
    !("candidates" in value) ||
    typeof value.candidates !== "object" ||
    value.candidates === null ||
    !("revisions" in value) ||
    typeof value.revisions !== "object" ||
    value.revisions === null
  ) {
    throw new Error("Metadados do AvatarService inválidos.");
  }
  return clone(value as AvatarServiceState);
}

function validateRubric(value: unknown): {
  rubric: AvatarRubric;
  total: number;
} {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Rubrica inválida: objeto obrigatório.");
  }
  const expected = Object.keys(AVATAR_RUBRIC_LIMITS).sort();
  const actual = Object.keys(value).sort();
  if (!sameValue(actual, expected)) {
    throw new Error("Rubrica inválida: categorias obrigatórias e sem extras.");
  }
  const rubric = {} as AvatarRubric;
  let total = 0;
  for (const key of expected) {
    const category = key as keyof typeof AVATAR_RUBRIC_LIMITS;
    const score = (value as Record<string, unknown>)[category];
    if (
      typeof score !== "number" ||
      !Number.isInteger(score) ||
      score < 0 ||
      score > AVATAR_RUBRIC_LIMITS[category]
    ) {
      throw new Error(
        `Score inválido em ${category}: inteiro entre 0 e ${AVATAR_RUBRIC_LIMITS[category]}.`,
      );
    }
    rubric[category] = score;
    total += score;
  }
  if (total > 100) throw new Error("Pontuação total da rubrica excede 100.");
  return { rubric, total };
}

function validateEvidence(rubric: AvatarRubric, evidence: unknown): string[] {
  const aestheticScore =
    rubric.identity +
    rubric.silhouette +
    rubric.pixelCraft +
    rubric.palette +
    rubric.expressions;
  if (
    !Array.isArray(evidence) ||
    evidence.some((item) => typeof item !== "string")
  ) {
    throw new Error("Evidência visual deve ser uma lista de artefatos.");
  }
  if (aestheticScore > 0 && evidence.length === 0) {
    throw new Error("Evidência visual obrigatória para scores estéticos.");
  }
  for (const artifact of evidence) {
    if (!ALLOWED_EVIDENCE.has(artifact)) {
      throw new Error(
        `Evidência não referencia um artefato permitido: ${artifact}.`,
      );
    }
  }
  return [...evidence];
}

export class AvatarService {
  private readonly store: AvatarServiceStore;
  private readonly renderer: AvatarRenderer;
  private readonly renderJobs = new Map<string, AbortController>();

  constructor(adapters: AvatarServiceAdapters) {
    this.store = adapters.store;
    this.renderer = adapters.renderer;
  }

  validatePackage(
    input: unknown,
    context: { previous?: AvatarPackage; allowedPartIds?: string[] } = {},
  ): AvatarValidationResult {
    const quality = validateAvatarPackage(input, context);
    if (!quality.ok) return { ok: false, quality };
    const avatar = parseAvatar(input);
    return { ok: true, quality, avatar, hash: avatarHash(avatar) };
  }

  async createCandidates(
    input: CreateCandidatesInput,
  ): Promise<CreatedCandidates> {
    assertDescription(input.description);
    if (!Array.isArray(input.packages) || input.packages.length !== 3) {
      throw new Error(
        "createCandidates exige exatamente três pacotes autoria do modelo.",
      );
    }
    return this.create(input.description, input.packages);
  }

  async createCandidate(
    input: CreateCandidateInput,
  ): Promise<CreatedCandidates> {
    assertDescription(input.description);
    return this.create(input.description, [input.package]);
  }

  private async create(
    description: string,
    packages: readonly unknown[],
  ): Promise<CreatedCandidates> {
    const prepared = packages.map((input) => {
      const validation = this.validatePackage(input);
      if (!validation.ok || !validation.avatar || !validation.hash) {
        throw qualityError("Candidato", validation.quality);
      }
      return validation as Required<AvatarValidationResult>;
    });
    const avatarId = prepared[0].avatar.id;
    if (prepared.some((candidate) => candidate.avatar.id !== avatarId)) {
      throw new Error(
        "Todos os candidatos do lote devem pertencer ao mesmo avatar.",
      );
    }
    const hashes = new Set<string>();
    for (const candidate of prepared) {
      if (hashes.has(candidate.hash)) {
        throw new Error(`Candidato duplicado no lote: ${candidate.hash}.`);
      }
      hashes.add(candidate.hash);
    }

    const state = await this.readState(avatarId);
    const created: AvatarCandidate[] = [];
    for (const candidate of prepared) {
      const reference = await this.store.createCandidate(candidate.avatar);
      if (
        reference.avatarId !== avatarId ||
        reference.hash !== candidate.hash
      ) {
        throw new Error("Store divergiu do hash ou avatar validado.");
      }
      const record: AvatarCandidate = {
        ...reference,
        description,
        quality: candidate.quality,
        correctionRounds: 0,
        manualApproved: false,
        rootCandidateId: reference.candidateId,
      };
      state.candidates[reference.candidateId] = record;
      created.push(clone(record));
    }
    await this.writeState(avatarId, state);
    return { avatarId, description, candidates: created };
  }

  async selectCandidate(
    avatarId: string,
    candidateId: string,
  ): Promise<AvatarSelectedCandidate> {
    const state = await this.readState(avatarId);
    const candidate = this.requireCandidate(state, candidateId);
    const validation = await this.validateStoredCandidate(avatarId, candidate);
    await this.store.selectCandidate(avatarId, candidateId);
    const saved = await this.store.saveRevision(avatarId, candidateId);
    candidate.revision = saved.revision;
    candidate.identityAnchors = clone(validation.avatar.identity.anchors);
    candidate.quality = validation.quality;
    state.revisions[String(saved.revision)] = {
      candidateId,
      quality: validation.quality,
      artifacts: state.revisions[String(saved.revision)]?.artifacts,
    };
    await this.writeState(avatarId, state);
    return {
      ...clone(candidate),
      revision: saved.revision,
      identityAnchors: clone(validation.avatar.identity.anchors),
      path: saved.path,
    };
  }

  async saveRevision(input: {
    avatarId: string;
    candidateId: string;
  }): Promise<AvatarSelectedCandidate> {
    const { avatarId, candidateId } = input;
    const state = await this.readState(avatarId);
    const candidate = this.requireCandidate(state, candidateId);
    const validation = await this.validateStoredCandidate(avatarId, candidate);
    const saved = await this.store.saveRevision(avatarId, candidateId);
    candidate.revision = saved.revision;
    candidate.identityAnchors ??= clone(validation.avatar.identity.anchors);
    candidate.quality = validation.quality;
    state.revisions[String(saved.revision)] = {
      candidateId,
      quality: validation.quality,
      result: state.revisions[String(saved.revision)]?.result,
      artifacts: state.revisions[String(saved.revision)]?.artifacts,
    };
    await this.writeState(avatarId, state);
    return {
      ...clone(candidate),
      revision: saved.revision,
      identityAnchors: clone(candidate.identityAnchors),
      path: saved.path,
    };
  }

  async revisePart(input: RevisePartInput): Promise<AvatarRevisedCandidate> {
    const { avatarId, revision, package: nextPackage } = input;
    const state = await this.readState(avatarId);
    const revisionState = state.revisions[String(revision)];
    if (!revisionState) throw new Error(`Revisão ${revision} não gerenciada.`);
    const candidate = this.requireCandidate(state, revisionState.candidateId);
    const previous = await this.store.loadRevision(avatarId, revision);
    this.assertAllowedPartIds(input.allowedPartIds, previous.avatar);

    const lineage = Object.values(state.candidates).filter(
      (item) => item.rootCandidateId === candidate.rootCandidateId,
    );
    if (lineage.some((item) => item.manualApproved)) {
      throw new Error("Correções bloqueadas após aprovação manual explícita.");
    }
    const rounds = Math.max(...lineage.map((item) => item.correctionRounds));
    if (rounds >= MAX_CORRECTION_ROUNDS) {
      throw new Error(
        "Limite de três rodadas de correção por candidato atingido.",
      );
    }

    const validation = this.validatePackage(nextPackage, {
      previous: previous.avatar,
      allowedPartIds: input.allowedPartIds,
    });
    const changed = validation.avatar
      ? changedPartIds(previous.avatar, validation.avatar)
      : [];
    const result: AvatarRevisionResult = {
      ok: validation.ok,
      previousRevision: revision,
      previousHash: previous.hash,
      allowedPartIds: [...input.allowedPartIds],
      changedPartIds: changed,
      correctionRounds: rounds + 1,
      quality: validation.quality,
    };
    if (!validation.ok || !validation.avatar || !validation.hash) {
      candidate.correctionRounds = rounds + 1;
      candidate.lastRevisionResult = result;
      await this.writeState(avatarId, state);
      throw qualityError("Revisão", validation.quality);
    }

    const reference = await this.store.createCandidate(validation.avatar);
    if (reference.hash !== validation.hash || reference.avatarId !== avatarId) {
      throw new Error("Store divergiu do hash ou avatar validado.");
    }
    await this.store.selectCandidate(avatarId, reference.candidateId);
    const saved = await this.store.saveRevision(
      avatarId,
      reference.candidateId,
    );
    const revised: AvatarCandidate = {
      ...reference,
      description: candidate.description,
      quality: validation.quality,
      correctionRounds: rounds + 1,
      manualApproved: false,
      rootCandidateId: candidate.rootCandidateId,
      parentCandidateId: candidate.candidateId,
      revision: saved.revision,
      identityAnchors: clone(previous.avatar.identity.anchors),
      lastRevisionResult: result,
    };
    state.candidates[reference.candidateId] = revised;
    state.revisions[String(saved.revision)] = {
      candidateId: reference.candidateId,
      quality: validation.quality,
      result,
    };
    await this.writeState(avatarId, state);
    return {
      ...clone(revised),
      revision: saved.revision,
      identityAnchors: clone(previous.avatar.identity.anchors),
      path: saved.path,
      changedPartIds: changed,
    };
  }

  async reviewCandidate(
    input: ReviewCandidateInput,
  ): Promise<ReviewedCandidate> {
    const { avatarId, candidateId } = input;
    if (
      input.manualApproved !== undefined &&
      typeof input.manualApproved !== "boolean"
    ) {
      throw new Error(
        "Aprovação manual deve ser um parâmetro booleano explícito.",
      );
    }
    const { rubric, total } = validateRubric(input.rubric);
    const evidence = validateEvidence(rubric, input.evidence);
    const state = await this.readState(avatarId);
    const candidate = this.requireCandidate(state, candidateId);
    await this.validateStoredCandidate(avatarId, candidate);
    const review: AvatarReviewRecord = {
      avatarId,
      candidateId,
      rubric,
      evidence,
      total,
    };
    candidate.review = review;
    if (input.manualApproved === true) candidate.manualApproved = true;

    if (!state.bestCandidateId) {
      state.bestCandidateId = candidateId;
    } else {
      const best = this.requireCandidate(state, state.bestCandidateId);
      if (!best.review || total > best.review.total) {
        state.bestCandidateId = candidateId;
      }
      // Ties deliberately keep the incumbent, making review order deterministic.
    }
    await this.writeState(avatarId, state);
    return {
      ...clone(review),
      bestCandidateId: state.bestCandidateId,
      manualApproved: candidate.manualApproved,
    };
  }

  async getCandidate(
    avatarId: string,
    candidateId: string,
  ): Promise<AvatarCandidate> {
    const state = await this.readState(avatarId);
    return clone(this.requireCandidate(state, candidateId));
  }

  async getBestCandidate(
    avatarId: string,
  ): Promise<AvatarCandidate | undefined> {
    const state = await this.readState(avatarId);
    return state.bestCandidateId
      ? clone(this.requireCandidate(state, state.bestCandidateId))
      : undefined;
  }

  async validateRevision(input: {
    avatarId: string;
    revision: number;
  }): Promise<AvatarValidationResult> {
    const loaded = await this.store.loadRevision(
      input.avatarId,
      input.revision,
    );
    const validation = this.validatePackage(loaded.avatar);
    if (
      !validation.ok ||
      validation.hash !== loaded.hash ||
      !validation.avatar ||
      !validation.hash
    ) {
      throw qualityError("Revisão", validation.quality);
    }
    return validation;
  }

  async compareRevisions(input: {
    avatarId: string;
    leftRevision: number;
    rightRevision: number;
  }): Promise<{
    avatarId: string;
    leftRevision: number;
    rightRevision: number;
    leftHash: string;
    rightHash: string;
    hashesEqual: boolean;
    anchorsEqual: boolean;
    identityAnchors: {
      left: Record<string, AvatarPoint>;
      right: Record<string, AvatarPoint>;
    };
    changedPartIds: string[];
    quality: { left: AvatarQualityReport; right: AvatarQualityReport };
  }> {
    const left = await this.store.loadRevision(
      input.avatarId,
      input.leftRevision,
    );
    const right = await this.store.loadRevision(
      input.avatarId,
      input.rightRevision,
    );
    const leftValidation = this.validatePackage(left.avatar);
    const rightValidation = this.validatePackage(right.avatar);
    if (
      !leftValidation.ok ||
      !rightValidation.ok ||
      leftValidation.hash !== left.hash ||
      rightValidation.hash !== right.hash
    ) {
      throw new Error(
        "Não é possível comparar revisões com schema ou qualidade inválidos.",
      );
    }
    const state = await this.readState(input.avatarId);
    const leftQuality =
      state.revisions[String(input.leftRevision)]?.quality ??
      leftValidation.quality;
    const rightQuality =
      state.revisions[String(input.rightRevision)]?.quality ??
      rightValidation.quality;
    return {
      avatarId: input.avatarId,
      leftRevision: input.leftRevision,
      rightRevision: input.rightRevision,
      leftHash: left.hash,
      rightHash: right.hash,
      hashesEqual: left.hash === right.hash,
      anchorsEqual: sameValue(
        left.avatar.identity.anchors,
        right.avatar.identity.anchors,
      ),
      identityAnchors: {
        left: clone(left.avatar.identity.anchors),
        right: clone(right.avatar.identity.anchors),
      },
      changedPartIds: changedPartIds(left.avatar, right.avatar),
      quality: { left: clone(leftQuality), right: clone(rightQuality) },
    };
  }

  async renderRevision(
    input: RenderRevisionInput,
  ): Promise<AvatarRenderResult & { jobId: string }> {
    const jobId = input.jobId ?? `render-${randomUUID()}`;
    if (!JOB_ID.test(jobId)) throw new Error("Render jobId inválido.");
    if (this.renderJobs.has(jobId)) {
      throw new Error(`Render job ${jobId} já está ativo.`);
    }
    const controller = new AbortController();
    this.renderJobs.set(jobId, controller);
    try {
      const loaded = await this.store.loadRevision(
        input.avatarId,
        input.revision,
      );
      controller.signal.throwIfAborted();
      const validation = this.validatePackage(loaded.avatar);
      if (!validation.ok || validation.hash !== loaded.hash) {
        throw qualityError("Revisão", validation.quality);
      }
      const result = await this.renderer({
        revisionDir: dirname(loaded.path),
        engineDir: input.engineDir,
        runner: input.runner,
        sheets: input.sheets,
        signal: controller.signal,
      });
      controller.signal.throwIfAborted();

      const state = await this.readState(input.avatarId);
      const revisionState = state.revisions[String(input.revision)];
      if (revisionState) {
        revisionState.artifacts = result.files.map((file) =>
          basename(file.png),
        );
        await this.writeState(input.avatarId, state);
      }
      return { jobId, ...result };
    } finally {
      if (this.renderJobs.get(jobId) === controller) {
        this.renderJobs.delete(jobId);
      }
    }
  }

  cancel(jobId: string): boolean {
    const controller = this.renderJobs.get(jobId);
    if (!controller) return false;
    controller.abort(new Error(`Render job ${jobId} cancelado.`));
    return true;
  }

  private assertAllowedPartIds(
    allowedPartIds: unknown,
    previous: AvatarPackage,
  ): asserts allowedPartIds is string[] {
    if (
      !Array.isArray(allowedPartIds) ||
      allowedPartIds.length === 0 ||
      allowedPartIds.some((id) => typeof id !== "string" || !id)
    ) {
      throw new Error(
        "allowedPartIds obrigatório e não vazio para revisar partes.",
      );
    }
    const allowed = new Set(allowedPartIds);
    if (allowed.size !== allowedPartIds.length) {
      throw new Error("allowedPartIds não pode conter IDs duplicados.");
    }
    const parts = new Set(previous.parts.map((part) => part.id));
    for (const id of allowed) {
      if (!parts.has(id)) {
        throw new Error(`allowedPartIds contém parte desconhecida: ${id}.`);
      }
    }
  }

  private async validateStoredCandidate(
    avatarId: string,
    candidate: AvatarCandidate,
  ): Promise<Required<AvatarValidationResult>> {
    const loaded = await this.store.loadCandidate(
      avatarId,
      candidate.candidateId,
    );
    // Candidates are immutable. Reuse their persisted gate report after proving
    // that the exact approved bytes still produce the persisted hash.
    const avatar = parseAvatar(loaded.avatar);
    const hash = avatarHash(avatar);
    if (
      !candidate.quality.ok ||
      hash !== candidate.hash ||
      loaded.hash !== hash
    ) {
      throw new Error("Candidato persistido diverge do candidato aprovado.");
    }
    return { ok: true, quality: clone(candidate.quality), avatar, hash };
  }

  private requireCandidate(
    state: AvatarServiceState,
    candidateId: string,
  ): AvatarCandidate {
    const candidate = state.candidates[candidateId];
    if (!candidate) throw new Error(`Candidato ${candidateId} não gerenciado.`);
    return candidate;
  }

  private async readState(avatarId: string): Promise<AvatarServiceState> {
    return parseState(await this.store.readMetadata(avatarId, METADATA_KEY));
  }

  private async writeState(
    avatarId: string,
    state: AvatarServiceState,
  ): Promise<void> {
    await this.store.writeMetadata(avatarId, METADATA_KEY, state);
  }
}

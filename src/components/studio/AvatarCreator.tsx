import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Camera, Check, LoaderCircle, ShieldCheck } from "lucide-react";
import type {
  AvatarPackage,
  AvatarPartState,
  AvatarPrimitive,
} from "../../shared/avatar";
import type { StudioProfile, StudioProfilePatch } from "../../shared/profile";
import { PROVIDER_LABELS } from "../../shared/providers";
import type {
  AppSnapshot,
  AvatarCreatorAPI,
  Connection,
} from "../../shared/types";
import type { AvatarProofSheet } from "../../../electron/core/avatar-render";
import type { AvatarCandidate } from "../../../electron/core/avatar-service";
import type { AvatarReferenceAnalysis } from "../../../electron/core/avatar-vision";
import { AvatarCanvas } from "./AvatarCanvas";
import { AvatarPartsPanel } from "./AvatarPartsPanel";
import { AvatarReviewPanel } from "./AvatarReviewPanel";

const PROOF_SHEETS: AvatarProofSheet[] = [
  "neutral",
  "silhouette",
  "grayscale",
  "backgrounds",
  "expressions",
  "mouths",
  "motion",
];
const ZERO_RUBRIC = {
  identity: 0,
  silhouette: 0,
  pixelCraft: 0,
  palette: 0,
  expressions: 0,
  rig: 0,
  export: 0,
};

type LoadedRevision = Awaited<ReturnType<AvatarCreatorAPI["getRevision"]>>;
type RenderedRevision = Awaited<ReturnType<AvatarCreatorAPI["render"]>>;
type Starters = Awaited<ReturnType<AvatarCreatorAPI["createStarters"]>>;
type RevisionSummary = Awaited<ReturnType<AvatarCreatorAPI["listRevisions"]>>[number];
type RemoteAnalysis = AvatarReferenceAnalysis & {
  avatarId: string;
  assetId: string;
  providerId: string;
};

interface ConsentAnalysisInput {
  connection: Connection;
  modelId: string;
  consent: boolean;
  prompt: string;
}

export function visionModels(connection: Connection): Connection["models"] {
  if (connection.status !== "connected" || !connection.provider) return [];
  return connection.models.filter((model) => model.supportsVision === true);
}

export function referenceRemoteName(connection: Connection, modelId: string): string {
  const model = visionModels(connection).find((candidate) => candidate.id === modelId);
  if (!model || !connection.provider) return "Nenhum modelo remoto com visão conectado";
  return `${PROVIDER_LABELS[connection.provider]} · ${model.name} (${model.id})`;
}

export async function analyzeReferenceWithConsent<T>(
  input: ConsentAnalysisInput,
  analyze: (request: { providerId: string; prompt: string }) => Promise<T>,
): Promise<T> {
  if (!input.consent) {
    throw new Error("A análise remota exige consentimento explícito do usuário.");
  }
  const model = visionModels(input.connection).find(
    (candidate) => candidate.id === input.modelId,
  );
  if (!model) throw new Error("Selecione um modelo remoto conectado com supportsVision.");
  const prompt = input.prompt.trim();
  if (!prompt) throw new Error("Descreva o objetivo da análise visual.");
  return analyze({ providerId: model.id, prompt });
}

function recolorPrimitives(
  primitives: AvatarPrimitive[],
  fromToken: string,
  toToken: string,
): { primitives: AvatarPrimitive[]; changed: number } {
  let changed = 0;
  const next = primitives.map((primitive): AvatarPrimitive => {
    if (primitive.type === "matrix") {
      return {
        ...primitive,
        rows: primitive.rows.map((row) => row.map((color) => {
          if (color !== fromToken) return color;
          changed += 1;
          return toToken;
        })),
      };
    }
    if (primitive.color !== fromToken) return { ...primitive };
    changed += 1;
    return { ...primitive, color: toToken };
  });
  return { primitives: next, changed };
}

/** Clone-first, part-scoped recolor. Protected package data is never rewritten. */
export function replaceAvatarPartColor(
  avatar: AvatarPackage,
  partId: string,
  fromToken: string,
  toToken: string,
): AvatarPackage {
  if (!avatar.parts.some((part) => part.id === partId)) {
    throw new Error(`Parte de avatar desconhecida: ${partId}.`);
  }
  if (!avatar.palette[fromToken] || !avatar.palette[toToken]) {
    throw new Error("As cores de origem e destino devem pertencer à paleta existente.");
  }
  if (fromToken === toToken) throw new Error("Escolha uma cor de destino diferente.");
  const next = structuredClone(avatar);
  let changed = 0;
  const part = next.parts.find((candidate) => candidate.id === partId)!;
  const recolored = recolorPrimitives(part.primitives, fromToken, toToken);
  part.primitives = recolored.primitives;
  changed += recolored.changed;

  const groups = [next.poses, next.expressions, next.mouths];
  for (const group of groups) {
    for (const states of Object.values(group)) {
      const state: AvatarPartState | undefined = states[partId];
      if (!state?.primitives) continue;
      const override = recolorPrimitives(state.primitives, fromToken, toToken);
      state.primitives = override.primitives;
      changed += override.changed;
    }
  }
  if (changed === 0) throw new Error(`A parte ${partId} não usa a cor ${fromToken}.`);
  return next;
}

async function readRenderedRevision(
  api: AvatarCreatorAPI,
  avatarId: string,
  revision: number,
  onJob: (jobId: string) => void,
): Promise<{
  loaded: LoadedRevision;
  rendered: RenderedRevision;
  revisions: RevisionSummary[];
}> {
  const loaded = await api.getRevision({ avatarId, revision });
  const jobId = await api.renderJobId({ avatarId, revision, sheets: PROOF_SHEETS });
  onJob(jobId);
  try {
    const rendered = await api.render({ avatarId, revision, sheets: PROOF_SHEETS });
    const revisions = await api.listRevisions({ avatarId });
    return { loaded, rendered, revisions };
  } finally {
    onJob("");
  }
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

function newAvatarId(): string {
  return `avatar-${crypto.randomUUID()}`;
}

interface AvatarCreatorProps {
  profile: StudioProfile;
  onProfileChange(profile: StudioProfile): void;
  onBack(): void;
}

export function AvatarCreator({ profile, onProfileChange, onBack }: AvatarCreatorProps) {
  const api = window.cutroom?.avatarCreator;
  const defaultAvatar = profile.defaultAvatar;
  const [avatarId, setAvatarId] = useState(defaultAvatar?.avatarId ?? newAvatarId);
  const [description, setDescription] = useState("");
  const [starters, setStarters] = useState<Starters>();
  const [loaded, setLoaded] = useState<LoadedRevision>();
  const [rendered, setRendered] = useState<RenderedRevision>();
  const [revisions, setRevisions] = useState<RevisionSummary[]>([]);
  const [activeTab, setActiveTab] = useState<"appearance" | "expressions" | "voice" | "brand">("appearance");
  const [sheet, setSheet] = useState<AvatarProofSheet>("neutral");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [activeJob, setActiveJob] = useState("");
  const [connection, setConnection] = useState<Connection>({ status: "disconnected", models: [] });
  const [modelId, setModelId] = useState("");
  const [consent, setConsent] = useState(false);
  const [referencePreview, setReferencePreview] = useState("");
  const [referenceAsset, setReferenceAsset] = useState<{ assetId: string }>();
  const [analysis, setAnalysis] = useState<RemoteAnalysis>();
  const [analysisPrompt, setAnalysisPrompt] = useState(
    "Descreva somente os traços visíveis e marque como incerto tudo que estiver oculto ou ambíguo.",
  );
  const [voiceId, setVoiceId] = useState(profile.voice.voiceId);
  const [personality, setPersonality] = useState(profile.personality.description);
  const [presentation, setPresentation] = useState(profile.personality.presentation);
  const [brandName, setBrandName] = useState(profile.brand.name);
  const [accent, setAccent] = useState(profile.brand.accent);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const models = visionModels(connection);

  useEffect(() => {
    if (!defaultAvatar) descriptionRef.current?.focus();
  }, [defaultAvatar]);

  useEffect(() => {
    if (!window.cutroom) return;
    let active = true;
    void window.cutroom.request<AppSnapshot>("getState").then((snapshot) => {
      if (!active) return;
      setConnection(snapshot.connection);
      const first = snapshot.connection.models.find((model) => model.supportsVision === true);
      setModelId((current) => current || first?.id || "");
    }).catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const applyRendered = useCallback((result: {
    loaded: LoadedRevision;
    rendered: RenderedRevision;
    revisions: RevisionSummary[];
  }) => {
    setLoaded(result.loaded);
    setRendered(result.rendered);
    setRevisions(result.revisions);
    setDescription(result.loaded.candidate.description);
  }, []);

  useEffect(() => {
    if (!api || !defaultAvatar) return;
    let active = true;
    setAvatarId(defaultAvatar.avatarId);
    setBusy("Abrindo a revisão salva…");
    setError("");
    void readRenderedRevision(
      api,
      defaultAvatar.avatarId,
      defaultAvatar.revision,
      (jobId) => {
        if (active) setActiveJob(jobId);
      },
    ).then((result) => {
      if (active) applyRendered(result);
    }).catch((reason) => {
      if (active) setError(errorMessage(reason));
    }).finally(() => {
      if (active) setBusy("");
    });
    return () => {
      active = false;
    };
  }, [api, applyRendered, defaultAvatar?.avatarId, defaultAvatar?.revision]);

  const createStarters = async () => {
    if (!api) return;
    setBusy("Criando os três pontos de partida locais…");
    setError("");
    setNotice("");
    try {
      const result = await api.createStarters({ avatarId, description: description.trim() });
      setStarters(result);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy("");
    }
  };

  const selectStarter = async (candidate: AvatarCandidate) => {
    if (!api) return;
    setBusy("Salvando a seleção e renderizando evidências reais…");
    setError("");
    setNotice("");
    try {
      const selected = await api.selectCandidate({
        avatarId,
        candidateId: candidate.candidateId,
      });
      const result = await readRenderedRevision(api, avatarId, selected.revision, setActiveJob);
      applyRendered(result);
      setStarters(undefined);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy("");
    }
  };

  const openRevision = async (revision: number) => {
    if (!api || revision === loaded?.revision) return;
    setBusy("Abrindo a revisão selecionada…");
    setError("");
    setNotice("");
    try {
      applyRendered(await readRenderedRevision(api, avatarId, revision, setActiveJob));
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy("");
    }
  };

  const revisePart = async (partId: string, fromToken: string, toToken: string) => {
    if (!api || !loaded) return;
    setBusy(`Aplicando somente à parte ${partId}…`);
    setError("");
    setNotice("");
    try {
      const nextPackage = replaceAvatarPartColor(loaded.package, partId, fromToken, toToken);
      const revised = await api.revisePart({
        avatarId,
        revision: loaded.revision,
        allowedPartIds: [partId],
        package: nextPackage,
      });
      const result = await readRenderedRevision(api, avatarId, revised.revision, setActiveJob);
      applyRendered(result);
      setNotice(`Revisão ${revised.revision} criada; somente ${partId} foi alterada.`);
    } catch (reason) {
      // Do not clear the last good revision or its evidence on a rejected edit.
      setError(errorMessage(reason));
    } finally {
      setBusy("");
    }
  };

  const approve = async () => {
    if (!api || !loaded || !rendered) return;
    setBusy("Registrando sua aprovação manual…");
    setError("");
    setNotice("");
    try {
      await api.review({
        avatarId,
        candidateId: loaded.candidate.candidateId,
        rubric: ZERO_RUBRIC,
        evidence: rendered.manifest.map((artifact) => artifact.path),
        manualApproved: true,
      });
      const candidate = await api.getCandidate({
        avatarId,
        candidateId: loaded.candidate.candidateId,
      });
      setLoaded((current) => current ? { ...current, candidate } : current);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy("");
    }
  };

  const updateProfile = async (patch: StudioProfilePatch, message: string) => {
    if (!window.cutroom) return;
    setBusy("Salvando no perfil…");
    setError("");
    try {
      const next = await window.cutroom.studioProfiles.update(profile.id, patch);
      onProfileChange(next);
      setNotice(message);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy("");
    }
  };

  const finalize = async () => {
    if (!api || !window.cutroom || !loaded || !rendered) return;
    setBusy("Finalizando a revisão e vinculando ao perfil…");
    setError("");
    setNotice("");
    try {
      const saved = await api.saveRevision({
        avatarId,
        candidateId: loaded.candidate.candidateId,
      });
      if (saved.revision !== loaded.revision || saved.hash !== loaded.hash) {
        throw new Error("A revisão final divergiu da revisão renderizada.");
      }
      const next = await window.cutroom.studioProfiles.update(profile.id, {
        defaultAvatar: { avatarId, revision: saved.revision, hash: saved.hash },
      });
      onProfileChange(next);
      setNotice("Avatar salvo no perfil");
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy("");
    }
  };

  const importReference = async (file: File | undefined) => {
    if (!file || !api || !window.cutroom) return;
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") setReferencePreview(reader.result);
    }, { once: true });
    reader.readAsDataURL(file);
    setReferenceAsset(undefined);
    setAnalysis(undefined);
    setError("");
    setBusy("Importando uma cópia local da referência…");
    try {
      const path = window.cutroom.pathForFile?.(file);
      if (!path) throw new Error("O caminho local da foto não está disponível.");
      const asset = await api.importReference({ avatarId, path });
      setReferenceAsset(asset);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy("");
    }
  };

  const analyzeReference = async () => {
    if (!api || !referenceAsset) return;
    setBusy(`Analisando com ${referenceRemoteName(connection, modelId)}…`);
    setError("");
    try {
      const result = await analyzeReferenceWithConsent(
        { connection, modelId, consent, prompt: analysisPrompt },
        ({ providerId, prompt }) => api.analyzeReference({
          avatarId,
          assetId: referenceAsset.assetId,
          providerId,
          prompt,
        }),
      );
      setAnalysis(result);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy("");
    }
  };

  const cancelRender = async () => {
    if (!api || !activeJob) return;
    await api.cancel(activeJob);
  };

  const neutralManifest = rendered?.manifest.find((artifact) => artifact.sheet === "neutral");
  const neutralArtifact = rendered?.files.find((artifact) => artifact.sheet === "neutral");
  const sheetManifest = rendered?.manifest.find((artifact) => artifact.sheet === sheet);
  const sheetArtifact = rendered?.files.find((artifact) => artifact.sheet === sheet);

  if (!api) {
    return <p className="avatar-error" role="alert">O criador de avatares precisa do aplicativo desktop.</p>;
  }

  return (
    <div className="avatar-creator" data-avatar-id={avatarId} aria-busy={Boolean(busy)}>
      <header className="avatar-creator-header">
        <button type="button" className="studio-back-button" onClick={onBack}>
          <ArrowLeft size={15} /> Voltar ao início
        </button>
        <div>
          <span className="studio-eyebrow">AVATAR DO PERFIL</span>
          <h1>Criar meu avatar</h1>
          <p>Três bases autorais locais servem como ponto de partida. A arte inicial não é gerada por IA.</p>
        </div>
        <div className="avatar-profile-chip">
          <ShieldCheck size={17} />
          <span>Perfil ativo<strong>{profile.name}</strong></span>
        </div>
      </header>

      {busy && (
        <div className="avatar-busy" role="status">
          <LoaderCircle size={16} className="spin" /> <span>{busy}</span>
          {activeJob && <button type="button" onClick={() => void cancelRender()}>Cancelar render</button>}
        </div>
      )}
      {error && <div className="avatar-error" role="alert">{error}</div>}
      {notice && !loaded && <div className="avatar-saved" role="status">{notice}</div>}

      {!loaded && (
        <section className="avatar-start" aria-labelledby="avatar-start-title">
          <div className="avatar-start-form">
            <span className="avatar-step">01 · INTENÇÃO E REFERÊNCIA</span>
            <h2 id="avatar-start-title">Como esse avatar deve apresentar?</h2>
            <label className="avatar-field">
              Descrição do avatar
              <textarea
                ref={descriptionRef}
                value={description}
                maxLength={4096}
                disabled={Boolean(busy)}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Ex.: engenheiro cordial que explica produtos com clareza"
                rows={4}
              />
            </label>
            <label className="avatar-file-field">
              <Camera size={18} />
              <span>Foto de referência (opcional)</span>
              <input
                aria-label="Foto de referência (opcional)"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                disabled={Boolean(busy)}
                onChange={(event) => void importReference(event.target.files?.[0])}
              />
            </label>
            <p className="avatar-privacy">A prévia e a importação são locais e imediatas. Nenhuma foto é enviada automaticamente.</p>
            {referencePreview && (
              <div className="avatar-reference-preview">
                <img src={referencePreview} alt="Prévia local da referência" />
                <div>
                  <strong>{referenceAsset ? "Cópia local importada" : "Prévia local"}</strong>
                  <span>{referenceRemoteName(connection, modelId)}</span>
                </div>
              </div>
            )}
            {referencePreview && (
              <div className="avatar-remote-consent">
                <label className="avatar-field">
                  Modelo remoto com visão
                  <select
                    value={modelId}
                    disabled={!models.length || Boolean(busy)}
                    onChange={(event) => setModelId(event.target.value)}
                  >
                    {!models.length && <option value="">Sem modelo com visão disponível</option>}
                    {models.map((model) => <option key={model.id} value={model.id}>{model.name} ({model.id})</option>)}
                  </select>
                </label>
                <label className="avatar-field">
                  Instrução para análise visual
                  <textarea rows={2} value={analysisPrompt} onChange={(event) => setAnalysisPrompt(event.target.value)} />
                </label>
                <label className="avatar-consent-check">
                  <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
                  Autorizo enviar esta foto somente ao provider/modelo remoto nomeado acima.
                </label>
                <button
                  type="button"
                  className="studio-secondary-button"
                  disabled={!referenceAsset || !models.length || !consent || Boolean(busy)}
                  onClick={() => void analyzeReference()}
                >
                  Analisar foto remotamente
                </button>
              </div>
            )}
            {analysis && (
              <div className="avatar-analysis-result">
                <strong>Análise remota recebida; nenhum pacote foi gerado pelo provider.</strong>
                <span>{Object.keys(analysis.identityAnchors).length} âncoras e {analysis.inferredFields.length} campos inferidos.</span>
              </div>
            )}
            <button
              type="button"
              className="studio-primary-button avatar-create-starters"
              disabled={!description.trim() || Boolean(busy)}
              onClick={() => void createStarters()}
            >
              Criar três pontos de partida
            </button>
          </div>
          <aside className="avatar-local-explainer">
            <span>ORIGEM TRANSPARENTE</span>
            <h2>Você escolhe a base.<br />O rig permanece real.</h2>
            <p>Os três pacotes já existem no aplicativo e são clonados para um novo avatar. A descrição é registrada como metadata, não usada para inventar uma arte.</p>
            <ul>
              <li><Check size={14} /> hashes distintos e verificáveis</li>
              <li><Check size={14} /> identidade congelada após a seleção</li>
              <li><Check size={14} /> provas renderizadas pelo AvatarEngine</li>
            </ul>
          </aside>
        </section>
      )}

      {!loaded && starters && (
        <section className="avatar-starters" aria-labelledby="avatar-starters-title">
          <div className="avatar-section-title">
            <span className="avatar-step">02 · ESCOLHA UMA BASE</span>
            <h2 id="avatar-starters-title">Três candidatos autorais reais</h2>
            <p>A seleção salva a primeira revisão imutável e congela os âncoras de identidade.</p>
          </div>
          <div className="avatar-candidate-grid">
            {starters.candidates.map((candidate, index) => (
              <article className="avatar-candidate" data-hash={candidate.hash} key={candidate.candidateId}>
                <span className="avatar-candidate-index">0{index + 1}</span>
                <h3>{candidate.title}</h3>
                <p>{candidate.summary}</p>
                <code title={candidate.hash}>{candidate.hash.slice(0, 16)}…</code>
                <span className="avatar-candidate-quality">
                  {candidate.quality.ok ? "Quality gates aprovados" : `${candidate.quality.findings.length} findings`}
                </span>
                <button
                  type="button"
                  className="studio-primary-button"
                  disabled={Boolean(busy)}
                  onClick={() => void selectStarter(candidate)}
                >
                  Selecionar {candidate.title}
                </button>
              </article>
            ))}
          </div>
        </section>
      )}

      {loaded && rendered && (
        <section className="avatar-editor">
          <div className="avatar-editor-toolbar">
            <div>
              <span className="avatar-step">REVISÃO {loaded.revision}</span>
              <code title={loaded.hash}>{loaded.hash}</code>
            </div>
            <label>
              Revisão salva
              <select
                aria-label="Revisão salva"
                value={loaded.revision}
                disabled={Boolean(busy)}
                onChange={(event) => void openRevision(Number(event.target.value))}
              >
                {revisions.map((revision) => (
                  <option key={revision.revision} value={revision.revision}>
                    Revisão {revision.revision}{revision.approved ? " · aprovada" : ""}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="avatar-tabs" role="tablist" aria-label="Áreas do avatar">
            {([
              ["appearance", "Aparência"],
              ["expressions", "Expressões e poses"],
              ["voice", "Voz e personalidade"],
              ["brand", "Marca"],
            ] as const).map(([id, label]) => (
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === id}
                className={activeTab === id ? "active" : ""}
                key={id}
                onClick={() => setActiveTab(id)}
              >
                {label}
              </button>
            ))}
          </div>

          {activeTab === "appearance" && neutralManifest && neutralArtifact && (
            <div className="avatar-appearance-grid" role="tabpanel">
              <div className="avatar-stage-panel">
                <div className="avatar-stage-label"><span>PNG NATIVO · ESCALA INTEIRA</span><strong>neutral</strong></div>
                <AvatarCanvas
                  api={api}
                  avatarId={avatarId}
                  revision={loaded.revision}
                  sheet="neutral"
                  path={neutralManifest.path}
                  artifact={neutralArtifact}
                  alt="Avatar renderizado pelo AvatarEngine"
                  compact
                />
              </div>
              <AvatarPartsPanel avatar={loaded.package} busy={Boolean(busy)} onApply={(part, from, to) => void revisePart(part, from, to)} />
            </div>
          )}

          {activeTab === "expressions" && sheetManifest && sheetArtifact && (
            <div className="avatar-proof-workspace" role="tabpanel">
              <div className="avatar-sheet-picker" aria-label="Folhas de prova">
                {PROOF_SHEETS.map((proofSheet) => (
                  <button
                    type="button"
                    className={sheet === proofSheet ? "active" : ""}
                    key={proofSheet}
                    onClick={() => setSheet(proofSheet)}
                  >
                    {proofSheet}
                  </button>
                ))}
              </div>
              <AvatarCanvas
                api={api}
                avatarId={avatarId}
                revision={loaded.revision}
                sheet={sheet}
                path={sheetManifest.path}
                artifact={sheetArtifact}
                alt={`Folha ${sheet} do AvatarEngine`}
              />
            </div>
          )}

          {activeTab === "voice" && (
            <div className="avatar-profile-settings" role="tabpanel">
              <div className="avatar-panel-heading"><span>PERFIL, NÃO PACOTE VISUAL</span><h2>Voz e personalidade</h2></div>
              <p>Estas preferências são salvas no perfil. Nenhuma credencial ou prévia de áudio fictícia é criada aqui.</p>
              <label className="avatar-field">Voice ID<input value={voiceId} onChange={(event) => setVoiceId(event.target.value)} /></label>
              <label className="avatar-field">Personalidade<textarea rows={4} value={personality} onChange={(event) => setPersonality(event.target.value)} /></label>
              <label className="avatar-field">Estilo de apresentação<textarea rows={4} value={presentation} onChange={(event) => setPresentation(event.target.value)} /></label>
              <button
                type="button"
                className="studio-primary-button"
                disabled={Boolean(busy) || !voiceId.trim()}
                onClick={() => void updateProfile({
                  voice: { voiceId: voiceId.trim() },
                  personality: { description: personality, presentation },
                }, "Voz e personalidade salvas no perfil")}
              >Salvar voz e personalidade</button>
            </div>
          )}

          {activeTab === "brand" && (
            <div className="avatar-profile-settings" role="tabpanel">
              <div className="avatar-panel-heading"><span>IDENTIDADE DO PERFIL</span><h2>Marca</h2></div>
              <p>A marca do perfil não reescreve a paleta protegida do avatar.</p>
              <label className="avatar-field">Nome da marca<input value={brandName} onChange={(event) => setBrandName(event.target.value)} /></label>
              <label className="avatar-field avatar-color-field">Cor de destaque<input type="color" value={accent} onChange={(event) => setAccent(event.target.value)} /><code>{accent}</code></label>
              <button
                type="button"
                className="studio-primary-button"
                disabled={Boolean(busy) || !brandName.trim()}
                onClick={() => void updateProfile({ brand: { name: brandName.trim(), accent } }, "Marca salva no perfil")}
              >Salvar marca</button>
            </div>
          )}

          <AvatarReviewPanel
            candidate={loaded.candidate}
            rendered={rendered}
            busy={Boolean(busy)}
            savedMessage={notice}
            onApprove={() => void approve()}
            onFinalize={() => void finalize()}
          />
        </section>
      )}
    </div>
  );
}

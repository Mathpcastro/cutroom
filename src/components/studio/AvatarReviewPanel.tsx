import type {
  AvatarCandidate,
  AvatarRenderedRevision,
} from "../../../electron/core/avatar-service";

const rubricLabels = [
  ["identity", "Identidade"],
  ["silhouette", "Silhueta"],
  ["pixelCraft", "Pixel craft"],
  ["palette", "Paleta"],
  ["expressions", "Expressões"],
  ["rig", "Rig"],
  ["export", "Exportação"],
] as const;

interface AvatarReviewPanelProps {
  candidate: AvatarCandidate;
  rendered: AvatarRenderedRevision;
  busy: boolean;
  savedMessage: string;
  onApprove(): void;
  onFinalize(): void;
}

export function AvatarReviewPanel({
  candidate,
  rendered,
  busy,
  savedMessage,
  onApprove,
  onFinalize,
}: AvatarReviewPanelProps) {
  const approvedAt = candidate.approvedByUserAt;
  const canFinalize = candidate.quality.ok || candidate.manualApproved;
  return (
    <section className="avatar-review-panel" aria-labelledby="avatar-review-title">
      <div className="avatar-panel-heading">
        <span>REVISÃO E EVIDÊNCIAS</span>
        <h2 id="avatar-review-title">Aprovação consciente</h2>
      </div>
      <div className={`avatar-quality ${candidate.quality.ok ? "is-ok" : "has-findings"}`}>
        <strong>{candidate.quality.ok ? "Quality gates aprovados" : "Quality gates exigem revisão"}</strong>
        {candidate.quality.findings.length === 0
          ? <span>Nenhum finding estrutural.</span>
          : (
            <ul>
              {candidate.quality.findings.map((finding, index) => (
                <li key={`${finding.code}-${finding.partId ?? "package"}-${index}`}>
                  <code>{finding.code}</code> {finding.message}
                </li>
              ))}
            </ul>
          )}
      </div>
      <p className="avatar-network">Rede externa durante o render: {rendered.networkRequests.length}</p>
      <dl className="avatar-hashes">
        <div><dt>Avatar</dt><dd>{candidate.hash}</dd></div>
        {rendered.manifest.map((artifact) => (
          <div key={artifact.signature}>
            <dt>{artifact.sheet}</dt>
            <dd>{artifact.pixelHash}</dd>
          </div>
        ))}
      </dl>
      <div className="avatar-rubric" aria-label="Rubrica manual">
        {rubricLabels.map(([key, label]) => (
          <div key={key}>
            <span>{label}</span>
            <strong>{candidate.review?.rubric[key] ?? 0}</strong>
            <small>{(candidate.review?.rubric[key] ?? 0) === 0 ? "não avaliado" : "avaliado"}</small>
          </div>
        ))}
      </div>
      <p className="avatar-review-note">Zero significa “não avaliado”; a aprovação não é calculada pelo score.</p>
      <div className="avatar-review-actions">
        <button
          type="button"
          className="studio-secondary-button"
          disabled={busy || candidate.manualApproved || rendered.manifest.length === 0}
          onClick={onApprove}
        >
          {candidate.manualApproved ? "Aprovação manual confirmada" : "Confirmar aprovação manual"}
        </button>
        <button
          type="button"
          className="studio-primary-button"
          disabled={busy || !canFinalize || rendered.manifest.length === 0}
          onClick={onFinalize}
        >
          Finalizar e salvar no perfil
        </button>
      </div>
      {approvedAt && (
        <p className="avatar-approved" role="status">
          Aprovado pelo usuário em {new Date(approvedAt).toLocaleString("pt-BR")}
        </p>
      )}
      {savedMessage && <p className="avatar-saved" role="status">{savedMessage}</p>}
    </section>
  );
}

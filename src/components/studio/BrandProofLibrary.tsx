import { useEffect, useState } from "react";
import type { BrandProof } from "../../../electron/core/brand-proofs";
import { studioRequest } from "./salesReels";

const kinds = { screenshot: "Print", recording: "Gravação", testimonial: "Depoimento", result: "Resultado" } as const;

export function BrandProofLibrary({ profileId }: { profileId: string }) {
  const [proofs, setProofs] = useState<BrandProof[]>([]);
  const [kind, setKind] = useState<BrandProof["kind"]>("screenshot");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [attachment, setAttachment] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    studioRequest<BrandProof[]>("listBrandProofs", { profileId }).then(
      (next) => { if (active) setProofs(next); },
      (reason) => { if (active) setError(String(reason)); },
    );
    return () => { active = false; };
  }, [profileId]);

  async function add(event: React.FormEvent) {
    event.preventDefault();
    if (!confirmed || busy) return;
    setBusy(true);
    setError("");
    try {
      const proof = await studioRequest<BrandProof | null>("addBrandProof", {
        profileId, title, description, kind, confirmed,
        attach: attachment || kind === "recording" || kind === "screenshot",
      });
      if (proof) {
        setProofs((current) => [...current, proof]);
        setTitle(""); setDescription(""); setConfirmed(false); setAttachment(false);
      }
    } catch (reason) { setError(String(reason)); }
    finally { setBusy(false); }
  }

  return <div className="studio-workspace reel-workbench">
    <header><h1>Provas da marca</h1><p>Guarde materiais reais deste perfil para usar como referência no Radar.</p></header>
    <form className="reel-form-card" onSubmit={(event) => void add(event)}>
      <label className="reel-field">Tipo<select value={kind} disabled={busy} onChange={(event) => setKind(event.target.value as BrandProof["kind"])}>
        {Object.entries(kinds).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      <label className="reel-field">Título<input value={title} disabled={busy} maxLength={120} required onChange={(event) => setTitle(event.target.value)} /></label>
      <label className="reel-field">O que esta prova demonstra?<textarea value={description} disabled={busy} maxLength={500} rows={3} required onChange={(event) => setDescription(event.target.value)} /></label>
      {(kind === "testimonial" || kind === "result") && <p><label><input type="checkbox" checked={attachment} disabled={busy} onChange={(event) => setAttachment(event.target.checked)} /> Anexar imagem ou MP4</label></p>}
      <p><label><input type="checkbox" checked={confirmed} disabled={busy} onChange={(event) => setConfirmed(event.target.checked)} /> Confirmo que posso usar este material e que a descrição é fiel à prova.</label></p>
      <button className="studio-primary-button" type="submit" disabled={busy || !confirmed || !title.trim() || !description.trim()}>{busy ? "Salvando…" : "Guardar prova"}</button>
    </form>
    {error && <p className="reel-error" role="alert">{error}</p>}
    <div className="radar-grid">{proofs.map((proof) => <article className="reel-form-card" key={proof.id}>
      <span className="radar-angle">{kinds[proof.kind]}</span><h2>{proof.title}</h2><p>{proof.description}</p>
      {proof.extension && <p className="reel-hint">Arquivo {proof.extension.slice(1).toUpperCase()} guardado</p>}
    </article>)}</div>
  </div>;
}



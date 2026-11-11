import { useEffect, useMemo, useState } from "react";
import type { AvatarPackage } from "../../shared/avatar";

interface AvatarPartsPanelProps {
  avatar: AvatarPackage;
  busy: boolean;
  onApply(partId: string, fromToken: string, toToken: string): void;
}

export function AvatarPartsPanel({ avatar, busy, onApply }: AvatarPartsPanelProps) {
  const [partId, setPartId] = useState(
    avatar.parts.some((part) => part.id === "mouth") ? "mouth" : avatar.parts[0]?.id ?? "",
  );
  const palette = useMemo(() => Object.keys(avatar.palette), [avatar.palette]);
  const [fromToken, setFromToken] = useState("mouth");
  const [toToken, setToToken] = useState("accent");

  useEffect(() => {
    if (!avatar.parts.some((part) => part.id === partId)) {
      setPartId(avatar.parts[0]?.id ?? "");
    }
  }, [avatar.parts, partId]);

  useEffect(() => {
    if (!palette.includes(fromToken)) setFromToken(palette[0] ?? "");
    if (!palette.includes(toToken)) setToToken(palette[1] ?? palette[0] ?? "");
  }, [fromToken, palette, toToken]);

  return (
    <section className="avatar-parts-panel" aria-labelledby="avatar-parts-title">
      <div className="avatar-panel-heading">
        <span>EDIÇÃO RESTRITA</span>
        <h2 id="avatar-parts-title">Ajuste uma parte</h2>
      </div>
      <p>Somente os pixels desta parte mudam. Identidade e paleta permanecem protegidas.</p>
      <div className="avatar-part-fields">
        <label>
          Parte
          <select aria-label="Parte" value={partId} disabled={busy} onChange={(event) => setPartId(event.target.value)}>
            {avatar.parts.map((part) => <option key={part.id} value={part.id}>{part.id}</option>)}
          </select>
        </label>
        <label>
          Cor atual
          <select aria-label="Cor atual" value={fromToken} disabled={busy} onChange={(event) => setFromToken(event.target.value)}>
            {palette.map((token) => <option key={token} value={token}>{token}</option>)}
          </select>
        </label>
        <label>
          Nova cor da paleta
          <select aria-label="Nova cor da paleta" value={toToken} disabled={busy} onChange={(event) => setToToken(event.target.value)}>
            {palette.map((token) => <option key={token} value={token}>{token}</option>)}
          </select>
        </label>
      </div>
      <button
        type="button"
        className="studio-secondary-button"
        disabled={busy || !partId || !fromToken || !toToken || fromToken === toToken}
        onClick={() => onApply(partId, fromToken, toToken)}
      >
        Aplicar à parte
      </button>
    </section>
  );
}

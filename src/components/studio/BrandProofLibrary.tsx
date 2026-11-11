import { useCallback, useEffect, useState } from "react";
import { Film, ImagePlus, Plus, Trash2, X } from "lucide-react";
import type { BrandProof } from "../../../electron/core/brand-proofs";
import { studioRequest } from "./salesReels";
import { t } from "./studioLanguage";

/**
 * Biblioteca da marca: the photos and prints the videos use, proofs, visual references for the look,
 * and rules the AI follows on every video. Adding is one click (several files at once).
 */

type Kind = BrandProof["kind"];
const TABS: { id: "media" | "proofs" | "style" | "rules"; label: string; hint: string; kinds: Kind[]; add?: { kind: Kind; label: string }[] }[] = [
  { id: "media", label: "Fotos e prints", hint: "Fotos do produto, suas, da equipe e prints do app. Os vídeos podem mostrar estes arquivos.", kinds: ["photo", "screenshot", "recording"],
    add: [{ kind: "photo", label: "Adicionar fotos" }, { kind: "screenshot", label: "Adicionar prints" }, { kind: "recording", label: "Adicionar gravação (MP4)" }] },
  { id: "proofs", label: "Provas", hint: "Resultados e depoimentos reais. A IA usa como prova nos vídeos e nunca inventa números.", kinds: ["result", "testimonial"],
    add: [{ kind: "result", label: "Adicionar resultado" }, { kind: "testimonial", label: "Adicionar depoimento" }] },
  { id: "style", label: "Estilo", hint: "Imagens de como você quer que os seus vídeos se pareçam (cores, clima, tipo de cena). Não aparecem nos vídeos: servem de referência.", kinds: ["style"],
    add: [{ kind: "style", label: "Adicionar referências" }] },
  { id: "rules", label: "Regras para a IA", hint: "Regras que a IA segue em todo vídeo. Ex.: nunca prometer resultado; sempre terminar com o link da bio.", kinds: [] },
];
const KIND_LABEL: Record<Kind, string> = { photo: "Foto", screenshot: "Print", recording: "Gravação", testimonial: "Depoimento", result: "Resultado", style: "Estilo" };

function Preview({ profileId, item }: { profileId: string; item: BrandProof }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    if (!item.extension) return;
    let alive = true;
    studioRequest<{ url: string }>("brandItemPreview", { profileId, id: item.id }).then(({ url }) => alive && setSrc(url), () => undefined);
    return () => { alive = false; };
  }, [profileId, item.id, item.extension]);
  if (!item.extension) return <span className="lib-thumb empty">{t(KIND_LABEL[item.kind])}</span>;
  if (item.extension === ".mp4") return <span className="lib-thumb">{src ? <video src={`${src}#t=1`} muted preload="metadata" /> : null}<Film size={14} className="lib-thumb-badge" /></span>;
  return <span className="lib-thumb">{src ? <img src={src} alt="" /> : null}</span>;
}

export function BrandProofLibrary({ profileId }: { profileId: string }) {
  const [items, setItems] = useState<BrandProof[]>([]);
  const [rules, setRules] = useState<string[]>([]);
  const [newRule, setNewRule] = useState("");
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("media");
  const [editing, setEditing] = useState<BrandProof | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      const [list, r] = await Promise.all([studioRequest<BrandProof[]>("listBrandProofs", { profileId }), studioRequest<{ rules: string[] }>("brandRules", { profileId })]);
      setItems(list);
      setRules(r.rules);
    } catch (reason) {
      setError(String(reason));
    }
  }, [profileId]);
  useEffect(() => { void load(); }, [load]);

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try { await work(); await load(); } catch (reason) { setError(reason instanceof Error ? reason.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(reason)); } finally { setBusy(false); }
  };
  const current = TABS.find((x) => x.id === tab)!;
  const shown = items.filter((i) => current.kinds.includes(i.kind));
  const saveRules = (next: string[]) => run(() => studioRequest("setBrandRules", { profileId, rules: next }));

  return (
    <div className="library">
      <header className="library-head">
        <h1>{t("Biblioteca da marca")}</h1>
        <p>{t("Tudo o que a IA usa para fazer vídeos com a sua cara.")}</p>
      </header>
      <div className="reels-tabs" role="tablist">
        {TABS.map((x) => (
          <button key={x.id} type="button" role="tab" aria-selected={tab === x.id} onClick={() => setTab(x.id)}>
            {t(x.label)} <small>{x.id === "rules" ? rules.length : items.filter((i) => x.kinds.includes(i.kind)).length}</small>
          </button>
        ))}
      </div>
      <p className="library-hint">{t(current.hint)}</p>
      {error && <p className="reel-error" role="alert">{error}</p>}

      {tab !== "rules" ? (
        <>
          <div className="reel-action-row">
            {current.add?.map((a, i) => (
              <button key={a.kind} type="button" className={i === 0 ? "studio-primary-button" : "studio-secondary-button"} disabled={busy}
                onClick={() => void run(() => studioRequest("addBrandFiles", { profileId, kind: a.kind }))}>
                <ImagePlus size={14} /> {t(a.label)}
              </button>
            ))}
          </div>
          {shown.length ? (
            <div className="lib-grid">
              {shown.map((item) => (
                <button key={item.id} type="button" className="lib-card" onClick={() => setEditing(item)} title={item.description || item.title}>
                  <Preview profileId={profileId} item={item} />
                  <span className="lib-card-text"><strong>{item.title}</strong><small>{t(KIND_LABEL[item.kind])}{item.description ? ` · ${item.description}` : ""}</small></span>
                </button>
              ))}
            </div>
          ) : (
            <div className="radar-empty"><p>{t("Nada aqui ainda. Adicione arquivos: você pode escolher vários de uma vez.")}</p></div>
          )}
          <p className="reel-hint">{t("Use só materiais que você tem direito de usar. Tudo fica neste computador.")}</p>
        </>
      ) : (
        <div className="lib-rules">
          <ol>
            {rules.map((rule, i) => (
              <li key={i}>
                <span>{rule}</span>
                <button type="button" aria-label={t("Remover regra")} disabled={busy} onClick={() => void saveRules(rules.filter((_, j) => j !== i))}><X size={14} /></button>
              </li>
            ))}
          </ol>
          <form className="lib-rule-add" onSubmit={(e) => { e.preventDefault(); if (newRule.trim()) { void saveRules([...rules, newRule.trim()]); setNewRule(""); } }}>
            <input value={newRule} maxLength={300} placeholder={t("Ex.: falar sempre em primeira pessoa")} onChange={(e) => setNewRule(e.target.value)} />
            <button type="submit" className="studio-primary-button" disabled={busy || !newRule.trim()}><Plus size={14} /> {t("Adicionar regra")}</button>
          </form>
        </div>
      )}

      {editing && (
        <div className="studio-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setEditing(null); }}>
          <form className="ai-connect" onSubmit={(e) => { e.preventDefault(); void run(async () => { await studioRequest("updateBrandItem", { profileId, id: editing.id, title: editing.title, description: editing.description, kind: editing.kind }); setEditing(null); }); }}>
            <header><strong>{t("Editar item")}</strong><button type="button" aria-label={t("Fechar")} onClick={() => setEditing(null)}><X size={16} /></button></header>
            <Preview profileId={profileId} item={editing} />
            <label className="reel-field">{t("Nome")}<input value={editing.title} maxLength={120} onChange={(e) => setEditing({ ...editing, title: e.target.value })} /></label>
            <label className="reel-field">{t("O que mostra (ajuda a IA a escolher quando usar)")}<textarea rows={3} value={editing.description} maxLength={500} onChange={(e) => setEditing({ ...editing, description: e.target.value })} /></label>
            <label className="reel-field">{t("Tipo")}
              <select value={editing.kind} onChange={(e) => setEditing({ ...editing, kind: e.target.value as Kind })}>
                {(Object.keys(KIND_LABEL) as Kind[]).map((k) => <option key={k} value={k}>{t(KIND_LABEL[k])}</option>)}
              </select>
            </label>
            <div className="reel-action-row">
              <button type="submit" className="studio-primary-button" disabled={busy}>{t("Salvar")}</button>
              <button type="button" className="studio-danger-button" disabled={busy} onClick={() => void run(async () => { await studioRequest("removeBrandItem", { profileId, id: editing.id }); setEditing(null); })}><Trash2 size={13} /> {t("Remover")}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

import type { ReelDraft, ReelOrigin } from "./ReelCreator";
import { findReelByExport } from "./reelRecords";
import { t, getStudioLanguage } from "./studioLanguage";
import { useEffect, useState } from "react";
import type { InstagramAnalytics, ReelInsights } from "../../shared/instagramAnalytics";
import { interactions } from "../../shared/instagramAnalytics";
import type { StudioProfile } from "../../shared/profile";
import type { InstagramState } from "./InstagramActions";
import { studioRequest, type SalesPlan } from "./salesReels";

const cacheKey = (profileId: string) => "videosell.instagram.analytics." + profileId;
export function cachedInstagramAnalytics(profileId: string): InstagramAnalytics | undefined {
  try {
    const value = JSON.parse(localStorage.getItem(cacheKey(profileId)) ?? "null");
    return value && typeof value.accountId === "string" && Array.isArray(value.reels) ? value : undefined;
  } catch { return undefined; }
}

export function topReelReferences(analytics: InstagramAnalytics | undefined): ReelInsights[] {
  return analytics?.reels.filter((item) => (interactions(item) ?? 0) > 0 && item.caption.trim()).slice(0, 3) ?? [];
}

const number = (value: number | null) => value === null ? "—" : value.toLocaleString(getStudioLanguage());

type Conversion = { clicks?: number; trials?: number; demos?: number };
const conversionFields = { clicks: "Cliques", trials: "Testes iniciados", demos: "Pedidos de demo" } as const;

function ConversionForm({ value, onSave }: { value?: Conversion; onSave: (value: Conversion) => void }) {
  const [draft, setDraft] = useState(value ?? {});
  return <details className="reel-options"><summary>Conversões medidas fora do Instagram</summary>
    <form onSubmit={(event) => { event.preventDefault(); onSave(draft); }}>
      <p className="reel-hint">Registre somente números que você consegue atribuir a este Reel.</p>
      {(Object.keys(conversionFields) as (keyof Conversion)[]).map((key) =>
        <label className="reel-field" key={key}>{conversionFields[key]}
          <input type="number" min={0} max={999999999} step={1} value={draft[key] ?? ""}
            onChange={(event) => setDraft({ ...draft, [key]: event.target.value === "" ? undefined : Number(event.target.value) })} />
        </label>)}
      <button type="submit" className="studio-secondary-button">Salvar conversões</button>
    </form>
  </details>;
}

function localConversions(profileId: string): Record<string, Conversion> {
  try { return JSON.parse(localStorage.getItem("videosell.conversions." + profileId) ?? "{}") ?? {}; }
  catch { return {}; }
}

export function InstagramAnalyticsPage({ profile, onConnect, onCreate }: {
  profile: StudioProfile;
  onConnect: () => void;
  onCreate: (brief: string, origin?: ReelOrigin, basePlan?: SalesPlan, baseDraft?: ReelDraft) => void;
}) {
  const [snapshot, setSnapshot] = useState(() => cachedInstagramAnalytics(profile.id));
  const [account, setAccount] = useState(snapshot?.accountId ?? profile.instagram.connectionId ?? "");
  const [settings, setSettings] = useState<InstagramState>();
  const [conversions, setConversions] = useState(() => localConversions(profile.id));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    studioRequest<InstagramState>("getPublishSettings").then(
      (value) => { if (active) setSettings(value); },
      (reason) => { if (active) setError(String(reason)); },
    );
    return () => { active = false; };
  }, []);
  async function refresh() {
    setBusy(true);
    setError("");
    try {
      const result = await studioRequest<InstagramAnalytics>("getInstagramAnalytics", { account });
      localStorage.setItem(cacheKey(profile.id), JSON.stringify(result));
      setSnapshot(result);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }
  const selected = settings?.accounts.some((entry) => entry.id === account);
  const shown = snapshot?.accountId === account ? snapshot : undefined;
  const publications = new Map(
    (settings?.publicationLinks ?? settings?.history ?? []).filter((entry) => shown && (
      entry.accountId ? entry.accountId === shown.accountId :
      entry.username.replace(/^@/, "").toLowerCase() === shown.username.replace(/^@/, "").toLowerCase()
    )).map((entry) => [entry.mediaId, findReelByExport(profile.id, entry.video)]),
  );
  return <div className="studio-workspace reel-workbench">
    <header><h1>{t("Instagram Analytics")}</h1><p>{t("Descubra quais Reels geraram mais interações e teste novas versões dos melhores ângulos.")}</p></header>
    <section className="reel-form-card">
      <label className="reel-field">{t("Conta para este perfil")}
        <select value={selected ? account : ""} disabled={busy || !settings?.accounts.length} onChange={(e) => {
          setAccount(e.target.value);
          setError("");
        }}>
          <option value="">{t("Selecione uma conta")}</option>
          {settings?.accounts.map((entry) => <option key={entry.id} value={entry.id}>@{entry.username}</option>)}
        </select>
      </label>
      <div className="reel-action-row">
        <button className="studio-primary-button" disabled={busy || !selected} onClick={() => void refresh()}>{busy ? t("Buscando Insights…") : t("Atualizar Insights")}</button>
        {settings && !settings.accounts.length && <button className="studio-secondary-button" onClick={onConnect}>{t("Conectar Instagram")}</button>}
      </div>
      {error && <p role="alert" className="reel-error">{error}</p>}
      {shown && <p className="reel-hint">{t("Dados de")} @{shown.username} · {t("Atualizado em")} {new Date(shown.updatedAt).toLocaleString(getStudioLanguage())}</p>}
    </section>
    {shown && <section className="reel-form-card">
      <h2>{t("Reels dos últimos 30 dias")}</h2>
      <p>{t("Ordenados pela soma de curtidas, comentários, salvamentos e compartilhamentos disponíveis.")}</p>
      {shown.partial && <p className="reel-hint">{t("O Instagram não disponibilizou todos os números. O traço indica dado indisponível e o ranking pode mudar.")}</p>}
      {shown.limited && <p className="reel-hint">{t("A amostra é limitada a até 20 Reels recentes.")}</p>}
      {!shown.reels.length && <p>{t("Nenhum Reel foi encontrado nesse período.")}</p>}
      <div className="radar-grid">{shown.reels.map((reel) => {
        const source = publications.get(reel.id);
        const origin = source?.draft.origin;
        const originalId = origin?.instagramAccountId === shown.accountId ? origin.instagramMediaId :
          [...publications].find(([, linked]) => origin?.parentFilmId && linked?.filmId === origin.parentFilmId)?.[0];
        const original = originalId && originalId !== reel.id ? shown.reels.find((entry) => entry.id === originalId) : undefined;
        const conversionKey = shown.accountId + ":" + reel.id;
        const originalConversions = original ? conversions[shown.accountId + ":" + original.id] : undefined;
        const currentConversions = conversions[conversionKey];
        return <article key={conversionKey} className="reel-form-card">
        <h3>{reel.caption ? reel.caption.slice(0, 110) : t("Reel sem legenda")}</h3>
        {source && <p className="reel-hint">{source.draft.origin?.ideaTitle ?? source.plan?.title ?? source.draft.objective}</p>}
        <p><strong>{number(interactions(reel))}</strong> {t("interações disponíveis")}</p>
        <p className="reel-hint">{t("Alcance")} {number(reel.reach)} · Curtidas {number(reel.likes)} · Comentários {number(reel.comments)} · Salvos {number(reel.saves)} · Compartilhamentos {number(reel.shares)}</p>
        {original && <div className="reel-hint">
          <strong>Original × variação</strong>
          <p>Interações disponíveis: {number(interactions(original))} × {number(interactions(reel))}</p>
          <p>Os Reels podem ter períodos de exposição diferentes.</p>
          {(Object.keys(conversionFields) as (keyof Conversion)[]).map((key) =>
            (originalConversions?.[key] !== undefined || currentConversions?.[key] !== undefined) &&
            <p key={key}>{conversionFields[key]}: {number(originalConversions?.[key] ?? null)} × {number(currentConversions?.[key] ?? null)}</p>)}
        </div>}
        <ConversionForm value={currentConversions} onSave={(value) => {
          const next = { ...conversions, [conversionKey]: value };
          try {
            localStorage.setItem("videosell.conversions." + profile.id, JSON.stringify(next));
            setConversions(next);
            setError("");
          } catch { setError("Não foi possível salvar as conversões."); }
        }} />
        <div className="reel-action-row">
          {reel.permalink && <button className="studio-secondary-button" onClick={() => void studioRequest("openInstagramPost", { permalink: reel.permalink }).catch((reason) => setError(String(reason)))}>{t("Ver Reel")}</button>}
          <button className="studio-primary-button" disabled={!source?.plan && !reel.caption.trim()} onClick={() => onCreate(
            (source?.plan
              ? "Teste outro gancho para este Reel. Preserve a demonstração, a prova e a chamada final."
              : "Crie uma variação comercial deste Reel. Preserve o ângulo e teste um gancho diferente. Use o texto abaixo apenas como referência, sem copiar a legenda.") + "\n\n" + reel.caption,
            { ...source?.draft.origin, parentFilmId: source?.filmId, instagramMediaId: reel.id, instagramAccountId: shown.accountId },
            source?.plan, source?.draft,
          )}>{source?.plan ? "Testar outro gancho" : t("Criar variação")}</button>
        </div>
      </article>;
      })}</div>
    </section>}
  </div>;
}


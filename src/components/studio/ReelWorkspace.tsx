import type { ReelOrigin } from "./ReelCreator";
import { ConnectInstagramCard } from "./InstagramConnect";
import { t, getStudioLanguage } from "./studioLanguage";
import { useEffect, useState } from "react";
import type { StudioProfile } from "../../shared/profile";
import { suggestSalesIdeas, studioRequest, type SalesIdea } from "./salesReels";
import { cachedInstagramAnalytics, topReelReferences } from "./InstagramAnalyticsPage";
import { PilotDrafts, queuePilotIdea } from "./ReelPilot";
import { pendingReviews } from "./reelRecords";
import { ExportedVideoPlayer, InstagramActions, type ExportedVideo, type InstagramState } from "./InstagramActions";

function useLoad<T>(method: string) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState("");
  async function reload() {
    try {
      setData(await studioRequest<T>(method));
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }
  useEffect(() => { void reload(); }, [method]);
  return { data, error, reload };
}

export function Radar({ profile, onCreate, onAnalytics }: { profile: StudioProfile; onCreate: (brief: string, origin?: ReelOrigin) => void; onAnalytics: () => void }) {
  const key = `videosell.radar.${profile.id}`;
  const [ideas, setIdeas] = useState<SalesIdea[]>(() => {
    try { return JSON.parse(localStorage.getItem(key) ?? "[]"); } catch { return []; }
  });
  const [focus, setFocus] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const analytics = cachedInstagramAnalytics(profile.id);
  const references = topReelReferences(analytics);
  async function search(useInsights = false) {
    setBusy(true);
    setError("");
    try {
      if (useInsights) {
        const settings = await studioRequest<InstagramState>("getPublishSettings");
        if (!analytics || !settings.accounts.some((entry) => entry.id === analytics.accountId))
          throw new Error("A conta das referências está desconectada. Atualize os Insights no Analytics.");
      }
      const result = await suggestSalesIdeas(profile, focus, useInsights ? references : []);
      const next = [...result.ideas, ...ideas].slice(0, 40);
      setIdeas(next);
      localStorage.setItem(key, JSON.stringify(next));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="reel-workbench studio-workspace">
      <header><h1>{t("Radar de pautas")}</h1><p>{t("Ideias para atrair compradores, responder objeções e mostrar provas.")}</p></header>
      <section className="reel-form-card">
        <label className="reel-field">{t("Qual assunto você quer explorar?")}
          <textarea rows={2} maxLength={1000} value={focus} onChange={(e) => setFocus(e.target.value)}
            placeholder={t("Opcional. Ex.: Quem ainda controla pedidos numa planilha.")} />
        </label>
        <div className="reel-action-row">
          <button className="studio-primary-button" disabled={busy} onClick={() => void search()}>{busy ? t("Buscando pautas…") : t("Gerar sugestões")}</button>
          <button className="studio-secondary-button" disabled={busy || !references.length} onClick={() => void search(true)}>{t("Gerar a partir dos melhores Reels")}</button>
          <button className="studio-secondary-button" onClick={onAnalytics}>{t("Ver Analytics")}</button>
        </div>
        <p className="reel-hint">{references.length ? `${references.length} Reels de @${analytics?.username} disponíveis para inspirar variações.` : t("Atualize os Insights de uma conta para usar o desempenho no Radar.")}</p>
      </section>
      {error && <p className="reel-error" role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <div className="radar-grid">{ideas.map((idea, i) => <article key={`${idea.title}-${i}`} className="reel-form-card">
        <span className="radar-angle">{t(idea.angle)}{idea.stage && " · " + t(idea.stage)}</span><h2>{idea.title}</h2>
        <p>{idea.hook}</p><p className="reel-hint"><strong>{t("Prova a mostrar")}</strong> · {idea.proof}</p>
        {idea.cta && <p className="reel-hint"><strong>{t("Próxima ação")}</strong> · {idea.cta}</p>}
        <div className="reel-action-row">
          <button className="studio-secondary-button" onClick={() => onCreate(idea.brief, { ideaId: idea.brief, ideaTitle: idea.title })}>{t("Usar esta pauta")}</button>
          <button className="studio-secondary-button" onClick={() => {
            try {
              setNotice(queuePilotIdea(profile.id, idea) ? "Pauta adicionada à rotina de criação." : "Essa pauta já está na rotina.");
              setError("");
            } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
          }}>{t("Colocar na rotina")}</button>
        </div>
      </article>)}</div>
    </div>
  );
}

export function VideoLibrary({ onConnect }: { onConnect: () => void }) {
  const list = useLoad<{ videos: ExportedVideo[] }>("listVideos");
  const [selected, setSelected] = useState("");
  const video = list.data?.videos.find((entry) => entry.path === selected);
  return <div className="studio-workspace reel-workbench">
    <header><h1>{t("Vídeos exportados")}</h1><p>{t("Assista, encontre o arquivo e escolha o próximo destino do Reel.")}</p></header>
    {list.error && <p role="alert">{list.error}</p>}
    {!list.data && !list.error && <p>{t("Carregando vídeos…")}</p>}
    {list.data?.videos.length === 0 && <p>{t("Os MP4s aparecem aqui depois da exportação.")}</p>}
    <div className="reel-collection">{list.data?.videos.map((entry) =>
      <button key={entry.path} className="studio-secondary-button" aria-pressed={entry.path === selected} onClick={() => setSelected(entry.path)}>{entry.name}</button>)}</div>
    {video && <section key={video.path} className="reel-library-player">
      <ExportedVideoPlayer path={video.path} />
      <button className="studio-secondary-button" onClick={() => void studioRequest("revealVideo", { path: video.path }).catch(() => list.reload())}>{t("Mostrar arquivo")}</button>
      <InstagramActions video={video.path} initialCaption="" onConnect={onConnect} />
    </section>}
  </div>;
}

const date = (value: string) => new Date(value).toLocaleString(getStudioLanguage(), { dateStyle: "short", timeStyle: "short" });
const name = (path: string) => path.split(/[\\/]/).at(-1);
const scheduledLabels: Record<string, string> = { scheduled: t("Agendado"), publishing: t("Publicando"), failed: t("Falhou"), late: t("Precisa de atenção"), published: t("Publicado") };

export function ReelRoutine({ onConnect, profile, onReview, opening, openingError }: {
  onConnect: () => void;
  profile: StudioProfile | null;
  onReview: (id: string) => void;
  opening: boolean;
  openingError: string;
}) {
  const pending = profile ? pendingReviews(profile.id) : [];
  const queue = useLoad<InstagramState>("getPublishSettings");
  const videos = useLoad<{ videos: ExportedVideo[] }>("listVideos");
  const [series, setSeries] = useState<{ video: string; caption: string }[]>([]);
  const [time, setTime] = useState("18:00");
  const [interval, setIntervalDays] = useState(1);
  const [account, setAccount] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const destination = account || queue.data?.defaultAccount || queue.data?.accounts[0]?.id || "";

  async function run(action: () => Promise<string>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      setNotice(await action());
      await queue.reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }
  return <div className="studio-workspace reel-workbench">
    <header><h1>{t("Rotina de Reels")}</h1><p>{t("Veja a fila do Instagram e programe uma sequência de vídeos revisados.")}</p></header>
    {(error || queue.error || videos.error) && <p className="reel-error" role="alert">{error || queue.error || videos.error}</p>}
    {notice && <p role="status">{notice}</p>}
    <section className="reel-form-card">
      <h2>{t("Aguardando revisão")}</h2>
      {openingError && <p role="alert">{openingError}</p>}
      {opening && <p role="status">{t("Abrindo Reel…")}</p>}
      {!pending.length && <p>{t("Os Reels gerados que ainda não foram exportados aparecem aqui.")}</p>}
      <ul className="routine-queue">{pending.map((entry) => <li key={entry.filmId}>
        <strong>{entry.draft.brief || entry.draft.objective}</strong>
        <button className="studio-secondary-button" disabled={opening} onClick={() => onReview(entry.filmId)}>{t("Revisar")}</button>
      </li>)}</ul>
    </section>
    <section className="reel-form-card">
      <h2>{t("Fila de publicação")}</h2>
      <button className="studio-secondary-button" disabled={busy} onClick={() => void queue.reload()}>{t("Atualizar fila")}</button>
      {queue.data?.scheduled.length === 0 && <p>{t("Nenhum Reel na fila.")}</p>}
      <ul className="routine-queue">{queue.data?.scheduled.map((entry) => <li key={entry.id}>
        <strong>{name(entry.video)}</strong><span>{date(entry.at)} · {t(scheduledLabels[entry.status] ?? entry.status)}</span>
        {entry.error && <p>{entry.error}</p>}
        {entry.status === "scheduled" && <button className="studio-secondary-button" disabled={busy} onClick={() => void run(async () => {
          await studioRequest("cancelScheduledReel", { id: entry.id }); return "Agendamento cancelado.";
        })}>{t("Cancelar")}</button>}
      </li>)}</ul>
    </section>
    {profile && <PilotDrafts key={profile.id} profile={profile} />}
    <section className="reel-form-card">
      <h2>{t("Piloto automático")}</h2>
      <p>{t("Selecione os MP4s na ordem em que quer publicar. A fila publica na frequência e no horário escolhidos.")}</p>
      {queue.data?.accounts.length === 0 && <ConnectInstagramCard onConnect={onConnect} />}
      {!!queue.data?.accounts.length && <label className="reel-field">{t("Conta")}<select value={destination} disabled={busy} onChange={(e) => setAccount(e.target.value)}>
        {queue.data.accounts.map((entry) => <option key={entry.id} value={entry.id}>@{entry.username}</option>)}
      </select></label>}
      <label className="reel-field">Horário local · {Intl.DateTimeFormat().resolvedOptions().timeZone}<input type="time" value={time} disabled={busy} onChange={(e) => setTime(e.target.value)} /></label>
      <label className="reel-field">{t("Frequência")}<select value={interval} disabled={busy} onChange={(e) => setIntervalDays(Number(e.target.value))}>
        <option value={1}>{t("Todo dia")}</option><option value={2}>{t("A cada 2 dias")}</option><option value={7}>{t("Uma vez por semana")}</option>
      </select></label>
      <div className="reel-collection">{videos.data?.videos.map((entry) => {
        const index = series.findIndex((item) => item.video === entry.path);
        return <label key={entry.path}><input type="checkbox" disabled={busy} checked={index >= 0} onChange={(e) => setSeries(e.target.checked
          ? [...series, { video: entry.path, caption: "" }] : series.filter((item) => item.video !== entry.path))} />
          {index >= 0 ? `${index + 1}. ` : ""}{entry.name}
        </label>;
      })}</div>
      {series.map((item, i) => <label key={item.video} className="reel-field">{t("Legenda")} {i + 1} · {name(item.video)}<textarea rows={2} value={item.caption} maxLength={2200} disabled={busy} onChange={(e) =>
        setSeries(series.map((entry, index) => index === i ? { ...entry, caption: e.target.value } : entry))} /></label>)}
      <button className="studio-primary-button" disabled={busy || !destination || !series.length || !time} onClick={() => void run(async () => {
        const result = await studioRequest<{ warnings: string[]; scheduled: unknown[] }>("scheduleReelSeries", { posts: series, time, everyDays: interval, account: destination, confirm: true });
        setSeries([]);
        return [`${result.scheduled.length} Reels agendados.`, ...result.warnings].join(" ");
      })}>Confirmar sequência · {series.length} Reels</button>
    </section>
    <section className="reel-form-card"><h2>{t("Publicados")}</h2>
      {queue.data?.history.length === 0 && <p>{t("Nenhuma publicação registrada.")}</p>}
      <ul className="routine-queue">{queue.data?.history.map((entry) => <li key={entry.mediaId}><strong>{name(entry.video)}</strong>
        <span>@{entry.username} · {date(entry.publishedAt)}</span>{entry.permalink && <button className="studio-secondary-button" onClick={() => void studioRequest("openInstagramPost", { permalink: entry.permalink }).catch((reason) => setError(String(reason)))}>{t("Ver no Instagram")}</button>}
      </li>)}</ul>
    </section>
  </div>;
}


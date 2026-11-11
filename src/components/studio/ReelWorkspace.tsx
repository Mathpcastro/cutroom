import type { ReelOrigin } from "./ReelCreator";
import { t, getStudioLanguage } from "./studioLanguage";
import { useEffect, useState } from "react";
import type { StudioProfile } from "../../shared/profile";
import { suggestSalesIdeas, studioRequest, type SalesIdea } from "./salesReels";
import { cachedInstagramAnalytics, topReelReferences } from "./InstagramAnalyticsPage";
import { queuePilotIdea } from "./ReelPilot";
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

const name = (path: string) => path.split(/[\\/]/).at(-1);



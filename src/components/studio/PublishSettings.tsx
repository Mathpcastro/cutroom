import { t } from "./studioLanguage";
import { useEffect, useState } from "react";
import { Rocket } from "lucide-react";
import type { AppSnapshot } from "../../shared/types";
import { useStudioGuard } from "./useStudioGuard";

interface Account { id: string; username?: string; igUserId?: string }
interface VideoFile { path: string; name: string; size: number; modifiedAt: string }

const api = <T,>(method: string, params?: unknown) => window.cutroom!.request<T>(method, params);

export function PublishSettings({ jobs, connectionOnly = false }: { jobs: AppSnapshot["jobs"]; connectionOnly?: boolean }) {
  const { error, notice, setNotice, guard } = useStudioGuard();
  const [pub, setPub] = useState<{
    hasKey: boolean;
    accounts: Account[];
    defaultAccount?: string;
    history: { permalink: string; username: string; publishedAt: string }[];
    scheduled?: { id: string; video: string; at: string; status: string; error?: string; permalink?: string }[];
  } | null>(null);
  const [when, setWhen] = useState("");
  const [series, setSeries] = useState<string[]>([]);
  const [seriesTime, setSeriesTime] = useState("18:00");
  const [videos, setVideos] = useState<VideoFile[]>([]);
  const [video, setVideo] = useState("");
  const [caption, setCaption] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [composioKey, setComposioKey] = useState("");
  useEffect(() => {
    void api<typeof pub>("getPublishSettings").then(setPub, () => undefined);
    if (connectionOnly) return;
    void api<{ videos: VideoFile[] }>("listVideos").then((r) => {
      setVideos(r.videos);
      setVideo((v) => v || r.videos[0]?.path || "");
    }, () => undefined);
  }, [connectionOnly]);
  const account = pub?.accounts.find((a) => a.id === pub.defaultAccount);
  const busy = jobs.some((j) => j.status === "running");

  return (
    <section className="studio-section">
      {error && <p className="studio-error" role="alert">{error}</p>}
      {notice && <p className="studio-notice">{notice}</p>}
      <p className="studio-lead">{t("Publica Reels no Instagram pelo Composio, com a chave do seu projeto. Use a mesma chave do Carrossell: as contas já conectadas lá aparecem aqui.")}</p>
      <div className="studio-box">
        <p>{pub?.hasKey ? t("Chave do Composio cadastrada (cifrada neste computador).") : t("Cole a chave do PROJETO do Composio (composio.dev › Settings › Project Settings › API Keys).")}</p>
        <div className="field-pair">
          <input type="password" autoComplete="off" aria-label={t("Chave do projeto Composio")} value={composioKey} placeholder={t("Chave do projeto Composio")} onChange={(e) => setComposioKey(e.target.value)} />
          <button className="button" disabled={!composioKey.trim()} onClick={() => void guard(async () => { setPub(await api("setComposioKey", { key: composioKey })); setComposioKey(""); }, "Chave salva e contas atualizadas.")}>{t("Salvar")}</button>
          {pub?.hasKey && <button className="button" onClick={() => void guard(async () => setPub(await api("refreshInstagram")), "Contas atualizadas.")}>{t("Atualizar contas")}</button>}
        </div>
      </div>
      {!!pub?.accounts.length && (
        <label className="field">
          {t("Conta")}
          <select value={pub.defaultAccount ?? ""} onChange={(e) => void guard(async () => setPub(await api("setDefaultInstagram", { id: e.target.value })))}>
            {pub.accounts.map((a) => <option key={a.id} value={a.id}>@{a.username}</option>)}
          </select>
        </label>
      )}
      {!connectionOnly && <>
      <label className="field">
        Vídeo
        <select value={video} onChange={(e) => { setVideo(e.target.value); setConfirmed(false); }}>
          {videos.map((v) => <option key={v.path} value={v.path}>{v.name}</option>)}
        </select>
      </label>
      <label className="field">
        {t("Legenda")}
        <textarea rows={4} maxLength={2200} value={caption} onChange={(e) => { setCaption(e.target.value); setConfirmed(false); }} placeholder="Legenda do Reels (inclua o crédito da música CC BY, se houver)." />
      </label>
      <label className="studio-confirm">
        <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
        Confirmo que quero publicar este vídeo{account ? ` em @${account.username}` : ""}. A publicação é pública.
      </label>
      <div className="studio-actions">
        <button className="button primary" disabled={!confirmed || !video || !account || busy} onClick={() => void guard(async () => { const r = await api<{ permalink: string }>("publishReel", { video, caption, account: account?.id, confirm: true }); setConfirmed(false); setPub(await api("getPublishSettings")); setNotice(`Publicado${r.permalink ? `: ${r.permalink}` : "."}`); })}>
          <Rocket size={13} /> Publicar Reels
        </button>
        <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} aria-label="Data e hora do agendamento" />
        <button className="button" disabled={!confirmed || !video || !account || !when} onClick={() => void guard(async () => { await api("scheduleReel", { video, caption, account: account?.id, at: when.replace("T", " "), confirm: true }); setConfirmed(false); setPub(await api("getPublishSettings")); }, "Reels agendado. O CutRoom abre sozinho no horário e publica.")}>
          {t("Agendar")}
        </button>
        {video && <button className="button" onClick={() => void guard(() => api("revealVideo", { path: video }))}>Mostrar o vídeo</button>}
      </div>
      <div className="studio-box">
        <strong>{t("Piloto automático")}</strong>
        <p>Escolha os vídeos na ordem: o CutRoom publica um por dia no mesmo horário, com a legenda acima. Junto com os carrosséis do Carrossell, o perfil fica ativo todo dia sem tráfego pago.</p>
        <div className="studio-picks">
          {videos.slice(0, 12).map((v) => (
            <label key={v.path} className="studio-pick">
              <input type="checkbox" checked={series.includes(v.path)} onChange={(e) => setSeries(e.target.checked ? [...series, v.path] : series.filter((x) => x !== v.path))} />
              {series.includes(v.path) && <b>{series.indexOf(v.path) + 1}</b>} {v.name}
            </label>
          ))}
        </div>
        <div className="field-pair">
          <input type="time" value={seriesTime} onChange={(e) => setSeriesTime(e.target.value)} aria-label="Horário diário" />
          <button className="button primary" disabled={!confirmed || !series.length || !account} onClick={() => void guard(async () => { await api("scheduleReelSeries", { posts: series.map((v) => ({ video: v, caption })), time: seriesTime, account: account?.id, confirm: true }); setSeries([]); setConfirmed(false); setPub(await api("getPublishSettings")); }, "Piloto automático ligado.")}>
            Ligar: 1 por dia às {seriesTime}
          </button>
        </div>
      </div>
      {!!pub?.scheduled?.length && (
        <ul className="studio-list">
          {pub.scheduled.map((e) => (
            <li key={e.id}>
              <div>
                <strong>{new Date(e.at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })} · {e.status === "scheduled" ? "agendado" : e.status === "published" ? "publicado" : e.status === "late" ? "atrasado (PC estava desligado)" : e.status === "failed" ? "erro" : "publicando…"}</strong>
                <small>{e.video.split(/[\\/]/).pop()}{e.error ? ` · ${e.error}` : ""}{e.permalink ? ` · ${e.permalink}` : ""}</small>
              </div>
              {e.status === "scheduled" && <button className="button small" onClick={() => void guard(async () => setPub(await api("cancelScheduledReel", { id: e.id })))}>{t("Cancelar")}</button>}
              {(e.status === "late" || e.status === "failed") && <button className="button small" onClick={() => void guard(async () => { await api("publishLateReel", { id: e.id }); setPub(await api("getPublishSettings")); }, "Publicado.")}>{t("Publicar agora")}</button>}
            </li>
          ))}
        </ul>
      )}
      {!!pub?.history.length && (
        <ul className="studio-list">
          {pub.history.map((h) => <li key={h.publishedAt}><div><strong>@{h.username}</strong><small>{new Date(h.publishedAt).toLocaleString("pt-BR")} · {h.permalink}</small></div></li>)}
        </ul>
      )}
      </>}
    </section>
  );
}

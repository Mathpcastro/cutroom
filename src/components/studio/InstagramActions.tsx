import { t } from "./studioLanguage";
import { useEffect, useState } from "react";
import { studioRequest } from "./salesReels";

export interface InstagramState {
  accounts: { id: string; username: string }[];
  defaultAccount?: string;
  scheduled: { id: string; video: string; at: string; status: string; error?: string }[];
  publicationLinks?: InstagramState["history"];
  history: { accountId?: string; mediaId: string; video: string; permalink: string; username: string; publishedAt: string }[];
}
export interface ExportedVideo { path: string; name: string; modifiedAt: string }

export function InstagramActions({ video, initialCaption, onConnect }: {
  video: string;
  initialCaption: string;
  onConnect: () => void;
}) {
  const [settings, setSettings] = useState<InstagramState>();
  const [account, setAccount] = useState("");
  const [caption, setCaption] = useState(initialCaption);
  const [at, setAt] = useState("");
  const [intent, setIntent] = useState<"publish" | "schedule">();
  const [status, setStatus] = useState("");
  const [permalink, setPermalink] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    studioRequest<InstagramState>("getPublishSettings").then((result) => {
      if (!active) return;
      setSettings(result);
      setAccount(result.defaultAccount ?? result.accounts[0]?.id ?? "");
    }, (reason) => { if (active) setError(String(reason)); });
    return () => { active = false; };
  }, []);

  const selected = settings?.accounts.find((entry) => entry.id === account);
  async function submit() {
    if (!selected || !intent || busy || done) return;
    setBusy(true);
    setError("");
    try {
      if (intent === "publish") {
        const result = await studioRequest<{ permalink?: string }>("publishReel", { video, caption, account, confirm: true });
        setStatus(`Publicado em @${selected.username}.`);
        setPermalink(result.permalink ?? "");
      } else {
        const result = await studioRequest<{ warnings?: string[] }>("scheduleReel", { video, caption, account, at: at.replace("T", " "), confirm: true });
        setStatus([`Agendado para @${selected.username}.`, ...(result.warnings ?? [])].join(" "));
      }
      setDone(true);
      setIntent(undefined);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="reel-form-card instagram-actions">
      <h2>Instagram</h2>
      {error && <p role="alert" className="reel-error">{error}</p>}
      {status && <p role="status">{status} {permalink && <button className="studio-secondary-button" onClick={() => void studioRequest("openInstagramPost", { permalink }).catch((reason) => setError(String(reason)))}>{t("Ver publicação")}</button>}</p>}
      {!settings && !error && <p>{t("Carregando contas…")}</p>}
      {settings && !settings.accounts.length && <button type="button" className="studio-secondary-button" onClick={onConnect}>{t("Conectar Instagram")}</button>}
      {settings && settings.accounts.length > 0 && !done && <>
        {!intent ? <div className="reel-action-row">
          <button className="studio-primary-button" onClick={() => setIntent("publish")}>{t("Publicar agora")}</button>
          <button className="studio-secondary-button" onClick={() => setIntent("schedule")}>{t("Agendar")}</button>
        </div> : <>
          <label className="reel-field">{t("Conta")}<select value={account} disabled={busy} onChange={(e) => setAccount(e.target.value)}>
            {settings.accounts.map((entry) => <option key={entry.id} value={entry.id}>@{entry.username}</option>)}
          </select></label>
          <label className="reel-field">{t("Legenda")}<textarea rows={4} maxLength={2200} disabled={busy} value={caption} onChange={(e) => setCaption(e.target.value)} /></label>
          {intent === "schedule" && <label className="reel-field">Data e hora ({Intl.DateTimeFormat().resolvedOptions().timeZone})
            <input type="datetime-local" value={at} disabled={busy} onChange={(e) => setAt(e.target.value)} />
          </label>}
          <p>{intent === "publish" ? t("O vídeo acima será publicado no perfil selecionado.") : t("O vídeo acima entra na fila para o horário escolhido.")}</p>
          <div className="reel-action-row">
            <button className="studio-primary-button" disabled={busy || !selected || (intent === "schedule" && !at)} onClick={() => void submit()}>
              {busy ? t("Enviando…") : intent === "publish" ? t("Confirmar publicação") : t("Confirmar agendamento")}
            </button>
            <button className="studio-secondary-button" disabled={busy} onClick={() => setIntent(undefined)}>{t("Voltar")}</button>
          </div>
        </>}
      </>}
    </section>
  );
}

export function ExportedVideoPlayer({ path }: { path: string }) {
  const [source, setSource] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    studioRequest<{ url: string }>("previewExportedVideo", { path }).then(
      ({ url }) => { if (active) setSource(url); },
      (reason) => { if (active) setError(String(reason)); },
    );
    return () => { active = false; };
  }, [path]);
  return error ? <p role="alert">{error}</p> : source ? <video className="reel-mp4-player" src={source} controls playsInline preload="metadata" /> : <p>{t("Abrindo prévia…")}</p>;
}


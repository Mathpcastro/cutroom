import { useEffect, useState } from "react";
import { Check, ChevronDown, CircleAlert, LoaderCircle, RotateCcw, Send, CalendarPlus, WandSparkles } from "lucide-react";
import { t } from "./studioLanguage";
import { studioRequest } from "./salesReels";
import { ExportedVideoPlayer, InstagramActions } from "./InstagramActions";
import { explainError } from "./InstagramConnect";
import type { ReelSession } from "./ReelCreator";

/** Spec 4 B/C: one screen from the sentence to the post — progress in plain steps, then the 3 actions. */

export const FLOW_STAGES = ["Roteiro", "Voz", "Cenas", "Vídeo"] as const;

/** Which step a progress message belongs to (messages come from generateSalesReel, already translated). */
export function stageOf(message: string) {
  const m = message.toLowerCase();
  if (/roteiro|script|guion|referência|reference|referencia/.test(m)) return 0;
  if (/narra|voice|voz/.test(m)) return 1;
  if (/cena|scene|escena|anima/.test(m)) return 2;
  if (/vídeo final|final video|render|mp4/.test(m)) return 3;
  return 0;
}

export interface FlowState {
  stage: number;
  message: string;
  error?: string;
  startedAt: number;
  previous?: ReelSession;
}

interface RenderResult { status: "done" | "rendering" | "blocked" | "failed"; output?: string; error?: string; progress?: number; errors?: string[] }

/** Renders the final MP4 (no separate "export" step) and returns its path. */
export async function renderReel(filmId: string, onProgress: (value?: number) => void) {
  for (;;) {
    const result = await studioRequest<RenderResult>("render_film", { film: filmId });
    if (result.status === "done" && result.output) return result.output;
    if (result.status === "failed" || result.status === "blocked") throw new Error(result.error || result.errors?.join("\n") || "O vídeo não pôde ser finalizado.");
    onProgress(result.progress);
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
}

const TIMES_KEY = "videosell.flowSeconds";
export function rememberFlowTime(seconds: number) {
  try {
    const list = JSON.parse(localStorage.getItem(TIMES_KEY) ?? "[]") as number[];
    localStorage.setItem(TIMES_KEY, JSON.stringify([...list, Math.round(seconds)].slice(-5)));
  } catch { /* ignore */ }
}
/** "cerca de 3 minutos", from the last renders on this computer. */
export function flowEstimate() {
  try {
    const list = (JSON.parse(localStorage.getItem(TIMES_KEY) ?? "[]") as number[]).filter((n) => n > 0);
    if (!list.length) return "";
    const minutes = Math.max(1, Math.round(list.reduce((a, b) => a + b, 0) / list.length / 60));
    return `Leva cerca de ${minutes} ${minutes === 1 ? "minuto" : "minutos"} neste computador.`;
  } catch {
    return "";
  }
}

export function ReelFlow({ session, flow, onRetry, onAdjust, onRestore, onConnect, onEdit, onAdvanced, onPilot }: {
  session: ReelSession;
  flow: FlowState;
  onRetry: () => void;
  onAdjust: (request: string) => void;
  onRestore: () => void;
  onConnect: () => void;
  onEdit: () => void;
  onAdvanced: () => void;
  onPilot: () => void;
}) {
  const [request, setRequest] = useState("");
  const [pilotNote, setPilotNote] = useState("");
  const [pilotError, setPilotError] = useState("");
  const [post, setPost] = useState(false);
  const [more, setMore] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const working = !session.output && !flow.error;
  useEffect(() => {
    if (!working) return;
    const timer = setInterval(() => setElapsed(Math.round((Date.now() - flow.startedAt) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [working, flow.startedAt]);
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") { setPost(false); setMore(false); } };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, []);

  const addToPilot = async () => {
    if (!session.output) return;
    setPilotError("");
    try {
      const r = await studioRequest<{ scheduled: { at: string }[] }>("addToReelPilot", { video: session.output, caption: session.caption ?? "", title: session.plan?.title, confirm: true });
      const at = new Date(r.scheduled[0].at);
      setPilotNote(`${t("No piloto automático: sai")} ${at.toLocaleDateString(undefined, { weekday: "long", day: "2-digit", month: "2-digit" })} ${t("às")} ${at.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}.`);
    } catch (reason) {
      const e = explainError(reason);
      setPilotError(/conta do Instagram|Composio/i.test(e.details) ? "Conecte o Instagram para usar o piloto." : e.message);
    }
  };

  return (
    <div className="reel-flow">
      <ol className="reel-flow-steps" aria-label={t("Andamento")}>
        {FLOW_STAGES.map((label, i) => {
          const done = session.output ? true : i < flow.stage;
          const current = !session.output && i === flow.stage;
          return (
            <li key={label} className={done ? "done" : current ? (flow.error ? "failed" : "current") : ""}>
              <span>{done ? <Check size={13} /> : current && flow.error ? <CircleAlert size={13} /> : current ? <LoaderCircle size={13} className="spin" /> : i + 1}</span>
              {t(label)}
            </li>
          );
        })}
      </ol>

      {working && <p className="reel-busy" role="status">{t(flow.message)} · {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}</p>}
      {working && <p className="reel-hint">{t("Pode sair desta tela: a criação continua e um aviso aparece no topo.")}</p>}

      {flow.error && (
        <div className="ig-error" role="alert">
          <p>{t("Não deu certo nesta etapa:")} {t(explainError(new Error(flow.error)).message)}</p>
          <button type="button" className="studio-secondary-button" onClick={onRetry}><RotateCcw size={13} /> {t("Tentar de novo a partir daqui")}</button>
        </div>
      )}

      {!session.output && session.review?.images.length ? (
        <div className="reel-flow-preview">{session.review.images.slice(0, 4).map((src, i) => <img key={i} src={src} alt="" className="reel-review-still" />)}</div>
      ) : null}

      {session.output && (
        <div className={`reel-result ${flow.previous?.output ? "compare" : ""}`}>
          {flow.previous?.output && (
            <figure>
              <figcaption>{t("Versão anterior")}</figcaption>
              <ExportedVideoPlayer path={flow.previous.output} />
              <button type="button" className="studio-secondary-button" onClick={onRestore}><RotateCcw size={13} /> {t("Voltar à anterior")}</button>
            </figure>
          )}
          <figure>
            {flow.previous?.output && <figcaption>{t("Nova versão")}</figcaption>}
            <ExportedVideoPlayer key={session.output} path={session.output} />
          </figure>
          <div className="reel-result-actions">
            <h2>{t("Seu Reels está pronto")}</h2>
            <button type="button" className="studio-primary-button" onClick={() => setPost(!post)}><Send size={15} /> {t("Postar agora")}</button>
            <button type="button" className="studio-secondary-button" disabled={!!pilotNote} onClick={() => void addToPilot()}><CalendarPlus size={15} /> {t("Colocar no piloto automático")}</button>
            {pilotNote && <p className="pilot-notice" role="status"><Check size={14} /> {pilotNote} <button type="button" className="ig-link" onClick={onPilot}>{t("Ver calendário")}</button></p>}
            {pilotError && <p className="pilot-problem" role="alert">{t(pilotError)} {/Conecte/.test(pilotError) && <button type="button" className="ig-link" onClick={onConnect}>{t("Conectar")}</button>}</p>}
            <label className="reel-field">{t("O que você quer mudar?")}
              <textarea rows={2} maxLength={750} value={request} placeholder={t("Ex.: deixa o começo mais forte")} onChange={(event) => setRequest(event.target.value)} />
            </label>
            <button type="button" className="studio-secondary-button" aria-disabled={!request.trim()} title={request.trim() ? "" : t("Escreva o que mudar.")} onClick={() => request.trim() && (onAdjust(request.trim()), setRequest(""))}>
              <WandSparkles size={14} /> {t("Ajustar")}
            </button>
            <button type="button" className="pilot-collapse" aria-expanded={more} onClick={() => setMore(!more)}>{t("Mais opções")} <ChevronDown size={14} /></button>
            {more && (
              <div className="reel-more">
                <button type="button" className="ig-link" onClick={() => void studioRequest("revealVideo", { path: session.output })}>{t("Mostrar o MP4 na pasta")}</button>
                <button type="button" className="ig-link" onClick={onEdit}>{t("Editar roteiro e cenas")}</button>
                <button type="button" className="ig-link" onClick={onAdvanced}>{t("Abrir no editor avançado")}</button>
              </div>
            )}
          </div>
        </div>
      )}
      {session.output && post && <InstagramActions key={session.output} video={session.output} initialCaption={session.caption ?? ""} onConnect={onConnect} />}
    </div>
  );
}

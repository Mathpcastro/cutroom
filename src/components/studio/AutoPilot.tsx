import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, CalendarDays, Check, ChevronDown, Plus, Send, SkipForward, Trash2, X } from "lucide-react";
import type { StudioProfile } from "../../shared/profile";
import { t, getStudioLanguage } from "./studioLanguage";
import { studioRequest } from "./salesReels";
import { ConnectInstagramCard, announceInstagram, explainError, type PublishState } from "./InstagramConnect";
import { PilotDrafts } from "./ReelPilot";
import { findReelByExport, pendingReviews } from "./reelRecords";

/** Spec 3: one place for the autopilot — state, a 2-week calendar and the ready queue. */

export type PilotDays = "daily" | "alternate" | number[];
export interface PilotRule { enabled: boolean; times: string[]; days: PilotDays; account?: string; notify?: boolean }
export interface QueueItem { id: string; video: string; at: string; status: string; error?: string; permalink?: string; caption?: string; pilot?: boolean; title?: string }
type PilotState = Omit<PublishState, "scheduled"> & { pilot?: PilotRule & { skipped?: string[] }; scheduled?: QueueItem[] };
interface ExportedVideo { path: string; name: string; modifiedAt: string }

export const DEFAULT_TIMES: Record<number, string[]> = {
  1: ["18:00"],
  2: ["12:00", "18:00"],
  3: ["09:00", "13:00", "18:00"],
  4: ["08:00", "12:00", "16:00", "20:00"],
  5: ["08:00", "11:00", "14:00", "17:00", "20:00"],
};
const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const statusLabel: Record<string, string> = { scheduled: "Agendado", publishing: "Publicando", published: "Publicado ✓", late: "Atrasado", failed: "Falhou", cancelled: "Removido" };

const minutes = (time: string) => { const [h, m] = time.split(":").map(Number); return h * 60 + m; };
/** Same rule as the main process: 1 to 5 times, at least 1 hour apart. "" when fine. */
export function timesProblem(times: string[]) {
  if (!times.length || times.length > 5) return "Escolha de 1 a 5 Reels por dia.";
  if (times.some((x) => !/^([01]\d|2[0-3]):[0-5]\d$/.test(x))) return "Use horários no formato 18:00.";
  const sorted = [...times].sort((a, b) => minutes(a) - minutes(b));
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === sorted[i - 1]) return "Dois Reels no mesmo horário: escolha horários diferentes.";
    if (minutes(sorted[i]) - minutes(sorted[i - 1]) < 60) return `Deixe pelo menos 1 hora entre dois Reels do mesmo dia (${sorted[i - 1]} e ${sorted[i]}).`;
  }
  return "";
}

export const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const shortDate = (d: Date) => d.toLocaleDateString(getStudioLanguage(), { weekday: "short", day: "2-digit", month: "2-digit" });
const hour = (iso: string) => new Date(iso).toLocaleTimeString(getStudioLanguage(), { hour: "2-digit", minute: "2-digit" });
const fileName = (path: string) => path.split(/[\\/]/).at(-1) ?? path;

/** A readable title when the Reel has no record: "da-nota-ao-post-2026-11-10-15-09-13.mp4" → "Da nota ao post". */
export function titleFromFile(path: string) {
  const words = fileName(path)
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[-_ ]?\d{4}-\d{2}-\d{2}(?:[-_ ]\d{2}){0,3}$/, "")
    .replace(/[-_]+/g, " ")
    .trim();
  return words ? words[0].toUpperCase() + words.slice(1) : "Reels sem título";
}

function dayAllowed(day: Date, days: PilotDays, start: Date) {
  if (days === "daily") return true;
  if (days === "alternate") return Math.round((Date.UTC(day.getFullYear(), day.getMonth(), day.getDate()) - Date.UTC(start.getFullYear(), start.getMonth(), start.getDate())) / 864e5) % 2 === 0;
  return days.includes(day.getDay());
}

/** "Sua fila acaba em X dias": last scheduled day, counted from today. */
export function queueDaysLeft(items: QueueItem[], now = new Date()) {
  const left = items.filter((i) => i.status === "scheduled").map((i) => new Date(i.at).getTime());
  if (!left.length) return 0;
  const last = new Date(Math.max(...left));
  return Math.max(0, Math.round((Date.UTC(last.getFullYear(), last.getMonth(), last.getDate()) - Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) / 864e5) + 1);
}

/** One sentence that says the state and, if something is missing, what. */
export function pilotSentence(state: { enabled: boolean; account?: string; next?: QueueItem; hasAccount: boolean; queued: number }) {
  if (!state.hasAccount) return { text: "Desligado · conecte o Instagram para usar o piloto.", fix: "connect" as const };
  if (!state.enabled) return { text: "Desligado.", fix: state.queued ? undefined : ("videos" as const) };
  if (!state.next) return { text: "Ligado, mas a fila está vazia · adicione vídeos à fila.", fix: "videos" as const };
  const at = new Date(state.next.at);
  const today = dayKey(new Date()), tomorrow = dayKey(new Date(Date.now() + 864e5));
  const when = dayKey(at) === today ? "hoje" : dayKey(at) === tomorrow ? "amanhã" : shortDate(at);
  return { text: `Ligado · próximo Reels ${when} às ${hour(state.next.at)}${state.account ? ` em @${state.account}` : ""}.` };
}

function Thumb({ path }: { path: string }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    let alive = true;
    studioRequest<{ url: string }>("previewExportedVideo", { path }).then(({ url }) => alive && setSrc(url), () => undefined);
    return () => { alive = false; };
  }, [path]);
  return <span className="pilot-thumb">{src ? <video src={`${src}#t=1`} preload="metadata" muted playsInline /> : null}</span>;
}

export function AutoPilot({ profile, onConnect, onReview, onCreate, onRadar }: {
  profile: StudioProfile | null;
  onConnect: () => void;
  onReview: (filmId: string) => void;
  onCreate: () => void;
  onRadar: () => void;
}) {
  const [state, setState] = useState<PilotState>();
  const [videos, setVideos] = useState<ExportedVideo[]>([]);
  const [error, setError] = useState<ReturnType<typeof explainError> | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [perDay, setPerDay] = useState(1);
  const [times, setTimes] = useState<string[]>(DEFAULT_TIMES[1]);
  const [days, setDays] = useState<PilotDays>("daily");
  const [preview, setPreview] = useState<{ video: string; caption: string; title: string; at: string }[] | null>(null);
  const [selected, setSelected] = useState<QueueItem | null>(null);
  const [captionDraft, setCaptionDraft] = useState("");
  const [timeDraft, setTimeDraft] = useState("");
  const [confirmAdd, setConfirmAdd] = useState<string>("");
  const [creationOpen, setCreationOpen] = useState(false);
  const [dragging, setDragging] = useState("");

  const reload = useCallback(async () => {
    try {
      const [s, v] = await Promise.all([studioRequest<PilotState>("getPublishSettings"), studioRequest<{ videos: ExportedVideo[] }>("listVideos")]);
      setState(s);
      setVideos(v.videos);
      announceInstagram(s);
      if (s.pilot) {
        setPerDay(s.pilot.times.length);
        setTimes(s.pilot.times);
        setDays(s.pilot.days);
      }
    } catch (reason) {
      setError(explainError(reason));
    }
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  const run = async (work: () => Promise<unknown>, ok?: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice("");
    try {
      await work();
      if (ok) setNotice(ok);
      await reload();
    } catch (reason) {
      setError(explainError(reason));
    } finally {
      setBusy(false);
    }
  };

  const account = state?.accounts.find((a) => a.id === (state.pilot?.account ?? state.defaultAccount)) ?? state?.accounts[0];
  const items = useMemo(() => (state?.scheduled ?? []).filter((i) => i.status !== "cancelled"), [state]);
  const queued = items.filter((i) => i.status === "scheduled").sort((a, b) => a.at.localeCompare(b.at));
  const enabled = !!state?.pilot?.enabled;
  const scheduledVideos = new Set(items.filter((i) => i.status === "scheduled" || i.status === "publishing").map((i) => i.video));
  const ready = videos.filter((v) => !scheduledVideos.has(v.path));
  const reviews = profile ? pendingReviews(profile.id) : [];
  const meta = (path: string) => {
    const record = profile ? findReelByExport(profile.id, path) : undefined;
    return { caption: record?.caption ?? "", title: record?.draft.brief || record?.plan?.title || titleFromFile(path) };
  };
  const title = (item: QueueItem) => item.title || meta(item.video).title;
  const sentence = pilotSentence({ enabled, account: account?.username, next: queued[0], hasAccount: !!state?.accounts.length, queued: queued.length });
  const problem = timesProblem(times);
  const daysLeft = queueDaysLeft(items);
  const attention = items.filter((i) => i.status === "late" || i.status === "failed");

  const setCount = (n: number) => { setPerDay(n); setTimes(DEFAULT_TIMES[n]); setPreview(null); };

  /** Turning it on: lay the ready videos over the next days and show them before confirming. */
  async function startPreview() {
    if (problem) return;
    if (!ready.length) {
      await run(() => studioRequest("setReelPilot", { enabled: true, times, days, account: account?.id }), "Piloto ligado. Adicione vídeos à fila para ele publicar.");
      return;
    }
    const posts = ready.slice(0, 14 * times.length).map((v) => ({ video: v.path, ...meta(v.path) }));
    await run(async () => {
      const { slots } = await studioRequest<{ slots: string[] }>("previewReelPilot", { count: posts.length, times, days });
      setPreview(posts.map((p, i) => ({ ...p, at: slots[i] })));
    });
  }

  async function confirmPreview() {
    if (!preview) return;
    const posts = preview.map((p) => ({ video: p.video, caption: p.caption }));
    await run(async () => {
      await studioRequest("setReelPilot", { enabled: true, times, days, account: account?.id });
      await studioRequest("scheduleReelSeries", { posts, times, days, account: account?.id, pilot: true, confirm: true });
      setPreview(null);
    }, `${posts.length} Reels no piloto automático.`);
  }

  async function move(item: QueueItem, delta: number) {
    const ids = queued.map((i) => i.id);
    const from = ids.indexOf(item.id), to = from + delta;
    if (from < 0 || to < 0 || to >= ids.length) return;
    [ids[from], ids[to]] = [ids[to], ids[from]];
    await run(() => studioRequest("reorderScheduledReels", { ids }));
  }
  async function dropOn(target: QueueItem) {
    if (!dragging || dragging === target.id) return;
    const ids = queued.map((i) => i.id).filter((id) => id !== dragging);
    ids.splice(ids.indexOf(target.id), 0, dragging);
    setDragging("");
    await run(() => studioRequest("reorderScheduledReels", { ids }));
  }

  const open = (item: QueueItem) => {
    setSelected(item);
    setCaptionDraft(item.caption ?? "");
    const d = new Date(item.at);
    setTimeDraft(`${dayKey(d)}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`);
  };

  // Calendar: today + 13 days, real items or the preview laid over it.
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const calendar = Array.from({ length: 14 }, (_, i) => {
    const day = new Date(start);
    day.setDate(start.getDate() + i);
    const key = dayKey(day);
    const real = items.filter((it) => dayKey(new Date(it.at)) === key).sort((a, b) => a.at.localeCompare(b.at));
    const ghost = (preview ?? []).filter((p) => dayKey(new Date(p.at)) === key);
    const active = dayAllowed(day, days, start) && !(state?.pilot as { skipped?: string[] } | undefined)?.skipped?.includes(key);
    return { day, key, real, ghost, active };
  });

  if (state && !state.accounts.length)
    return (
      <div className="studio-workspace reel-workbench pilot-page">
        <header><h1>{t("Piloto automático")}</h1><p>{t("Na hora marcada, o Videosell abre sozinho e publica.")}</p></header>
        <ConnectInstagramCard onConnect={onConnect} text="O piloto publica no seu Instagram. Conecte a conta e volte aqui." />
      </div>
    );

  return (
    <div className="studio-workspace reel-workbench pilot-page">
      <header><h1>{t("Piloto automático")}</h1></header>

      {attention.length > 0 && (
        <button type="button" className="pilot-attention" onClick={() => open(attention[0])}>
          <AlertTriangle size={15} /> {attention.length === 1 ? t("Um Reels precisa de atenção") : `${attention.length} ${t("Reels precisam de atenção")}`} · {t(statusLabel[attention[0].status])}: {title(attention[0])}
        </button>
      )}

      <section className={`pilot-state ${enabled ? "on" : "off"}`}>
        <div>
          <span className="pilot-state-dot" aria-hidden="true" />
          <strong role="status">{t(sentence.text)}</strong>
          {sentence.fix === "connect" && <button type="button" className="studio-secondary-button" onClick={onConnect}>{t("Conectar o Instagram")}</button>}
          {sentence.fix === "videos" && <button type="button" className="studio-secondary-button" onClick={onCreate}>{t("Criar Reels")}</button>}
        </div>
        <button type="button" className={`pilot-switch ${enabled ? "on" : ""}`} aria-pressed={enabled} disabled={busy || !!problem || !state}
          onClick={() => void (enabled ? run(() => studioRequest("setReelPilot", { enabled: false }), "Piloto pausado. A fila continua guardada.") : startPreview())}>
          {enabled ? t("Pausar") : t("Ligar")}
        </button>
      </section>

      <p className="pilot-howto">{t("Na hora marcada, o Videosell abre sozinho e publica. Se o computador estiver desligado, publica quando ligar (até 6 horas depois). Depois disso, o vídeo fica como Atrasado e espera você.")}</p>

      {error && <div className="ig-error" role="alert"><p>{t(error.message)}</p>{error.details && error.details !== error.message && <details><summary>{t("Detalhes")}</summary><code>{error.details}</code></details>}</div>}
      {notice && <p role="status" className="pilot-notice"><Check size={14} /> {notice}</p>}

      <section className="reel-form-card pilot-rule">
        <h2>{t("Regras")}</h2>
        <div className="pilot-rule-row">
          <label className="reel-field">{t("Reels por dia")}
            <select value={perDay} disabled={busy} onChange={(e) => setCount(Number(e.target.value))}>
              {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <div className="pilot-times" role="group" aria-label={t("Horários")}>
            {times.map((time, i) => (
              <label key={i} className="reel-field">{`${i + 1}º`}
                <input type="time" value={time} disabled={busy} onChange={(e) => { setTimes(times.map((x, j) => (j === i ? e.target.value : x))); setPreview(null); }} />
              </label>
            ))}
          </div>
          <label className="reel-field">{t("Dias")}
            <select value={Array.isArray(days) ? "week" : days} disabled={busy} onChange={(e) => { setDays(e.target.value === "week" ? [1, 2, 3, 4, 5] : (e.target.value as PilotDays)); setPreview(null); }}>
              <option value="daily">{t("Todo dia")}</option>
              <option value="alternate">{t("Dia sim, dia não")}</option>
              <option value="week">{t("Dias da semana")}</option>
            </select>
          </label>
        </div>
        {Array.isArray(days) && (
          <div className="pilot-weekdays">
            {WEEKDAYS.map((label, d) => (
              <label key={d}><input type="checkbox" checked={days.includes(d)} onChange={(e) => setDays(e.target.checked ? [...days, d].sort() : days.filter((x) => x !== d))} /> {t(label)}</label>
            ))}
          </div>
        )}
        {problem && <p className="pilot-problem" role="alert">{t(problem)}</p>}
        {enabled && !problem && (JSON.stringify(times) !== JSON.stringify(state?.pilot?.times) || JSON.stringify(days) !== JSON.stringify(state?.pilot?.days)) && (
          <button type="button" className="studio-secondary-button" disabled={busy} onClick={() => void run(() => studioRequest("setReelPilot", { enabled: true, times, days }), "Regras salvas. Os próximos vídeos seguem os novos horários.")}>{t("Salvar regras")}</button>
        )}
        <label className="pilot-notify">
          <input type="checkbox" checked={state?.pilot?.notify !== false} onChange={(e) => void run(() => studioRequest("setReelPilot", { enabled, notify: e.target.checked }))} />
          {t("Avisar no computador quando publicar, falhar ou a fila acabar")}
        </label>
      </section>

      {preview && (
        <section className="pilot-confirm" role="alertdialog" aria-label={t("Confirmar o piloto")}>
          <p>
            <strong>{preview.length} Reels</strong>, {t("de")} {new Date(preview[0].at).toLocaleDateString(getStudioLanguage())} {t("a")} {new Date(preview.at(-1)!.at).toLocaleDateString(getStudioLanguage())}, {t("às")} {times.join(", ")}{account ? ` ${t("em")} @${account.username}` : ""}.
          </p>
          <p className="pilot-howto">{t("Confira no calendário abaixo. Nada é publicado sem esta confirmação.")}</p>
          <div className="reel-action-row">
            <button type="button" className="studio-primary-button" disabled={busy} onClick={() => void confirmPreview()}>{t("Confirmar e ligar")}</button>
            <button type="button" className="studio-secondary-button" disabled={busy} onClick={() => setPreview(null)}>{t("Cancelar")}</button>
          </div>
        </section>
      )}

      {enabled && daysLeft > 0 && daysLeft < 3 && (
        <section className="pilot-warning">
          <AlertTriangle size={15} /> {t("Sua fila acaba")} {daysLeft === 1 ? t("hoje") : `${t("em")} ${daysLeft} ${t("dias")}`}.
          <button type="button" className="studio-secondary-button" onClick={onCreate}>{t("Criar mais Reels")}</button>
          <button type="button" className="studio-secondary-button" onClick={onRadar}>{t("Gerar pautas")}</button>
        </section>
      )}

      <section className="reel-form-card">
        <h2><CalendarDays size={16} /> {t("Próximas 2 semanas")}</h2>
        <ol className="pilot-calendar">
          {calendar.map(({ day, key, real, ghost, active }) => (
            <li key={key} className={active ? "" : "inactive"}>
              <div className="pilot-day">
                <strong>{shortDate(day)}</strong>
                {real.some((r) => r.pilot && r.status === "scheduled") && (
                  <button type="button" className="ig-link" disabled={busy} onClick={() => void run(() => studioRequest("skipReelDay", { date: key }), "Dia pulado. Os vídeos seguintes andaram um espaço.")}>
                    <SkipForward size={12} /> {t("Pular este dia")}
                  </button>
                )}
              </div>
              <div className="pilot-slots">
                {real.map((item) => (
                  <div key={item.id} className={`pilot-item ${item.status}`} draggable={item.status === "scheduled"}
                    onDragStart={() => setDragging(item.id)} onDragOver={(e) => e.preventDefault()} onDrop={() => void dropOn(item)}>
                    <button type="button" className="pilot-item-main" onClick={() => open(item)}>
                      <Thumb path={item.video} />
                      <span className="pilot-item-text"><b>{hour(item.at)}</b> {title(item)}</span>
                      <span className={`pilot-badge ${item.status}`}>{t(statusLabel[item.status] ?? item.status)}</span>
                    </button>
                    {item.status === "scheduled" && (
                      <span className="pilot-item-actions">
                        <button type="button" aria-label={t("Subir")} disabled={busy} onClick={() => void move(item, -1)}><ArrowUp size={13} /></button>
                        <button type="button" aria-label={t("Descer")} disabled={busy} onClick={() => void move(item, 1)}><ArrowDown size={13} /></button>
                      </span>
                    )}
                  </div>
                ))}
                {ghost.map((p) => (
                  <div key={p.video + p.at} className="pilot-item ghost">
                    <span className="pilot-item-main"><Thumb path={p.video} /><span className="pilot-item-text"><b>{hour(p.at)}</b> {p.title}</span><span className="pilot-badge">{t("Prévia")}</span></span>
                  </div>
                ))}
                {!real.length && !ghost.length && (
                  <span className="pilot-empty">{t(active ? "Sem vídeo" : "Sem postagem neste dia")}
                    {active && <button type="button" aria-label={t("Adicionar vídeo")} onClick={() => document.getElementById("pilot-ready")?.scrollIntoView({ behavior: "smooth" })}><Plus size={13} /></button>}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="reel-form-card" id="pilot-ready">
        <h2>{t("Vídeos prontos")}</h2>
        {!ready.length && !reviews.length && <p>{t("Nenhum vídeo pronto fora da fila.")} <button type="button" className="ig-link" onClick={onCreate}>{t("Criar um Reels")}</button></p>}
        <ul className="pilot-ready">
          {reviews.map((r) => (
            <li key={r.filmId}>
              <span className="pilot-thumb review" />
              <span className="pilot-item-text">{r.draft.brief || r.plan?.title || t("Rascunho")}</span>
              <span className="pilot-badge late">{t("Revisar antes")}</span>
              <button type="button" className="studio-secondary-button" onClick={() => onReview(r.filmId)}>{t("Revisar")}</button>
            </li>
          ))}
          {ready.map((v) => (
            <li key={v.path}>
              <Thumb path={v.path} />
              <span className="pilot-item-text">{meta(v.path).title}</span>
              {confirmAdd === v.path ? (
                <span className="reel-action-row">
                  <button type="button" className="studio-primary-button" disabled={busy} onClick={() => void run(async () => {
                    await studioRequest("addToReelPilot", { video: v.path, caption: meta(v.path).caption, title: meta(v.path).title, confirm: true });
                    setConfirmAdd("");
                  }, "Agendado no primeiro horário livre.")}>{t("Agendar este")}</button>
                  <button type="button" className="studio-secondary-button" onClick={() => setConfirmAdd("")}><X size={13} /></button>
                </span>
              ) : (
                <button type="button" className="studio-secondary-button" disabled={busy} onClick={() => setConfirmAdd(v.path)}><Plus size={13} /> {t("Adicionar ao piloto")}</button>
              )}
            </li>
          ))}
        </ul>
      </section>

      {profile && (
        <section className="reel-form-card pilot-creation">
          <button type="button" className="pilot-collapse" aria-expanded={creationOpen} onClick={() => setCreationOpen(!creationOpen)}>
            <strong>{t("Criar os próximos Reels sozinho")}</strong> <ChevronDown size={15} />
          </button>
          {creationOpen && <PilotDrafts key={profile.id} profile={profile} />}
        </section>
      )}

      {selected && (
        <aside className="pilot-panel" role="dialog" aria-label={title(selected)}>
          <header>
            <strong>{title(selected)}</strong>
            <button type="button" aria-label={t("Fechar")} onClick={() => setSelected(null)}><X size={16} /></button>
          </header>
          <PanelVideo path={selected.video} />
          <span className={`pilot-badge ${selected.status}`}>{t(statusLabel[selected.status] ?? selected.status)}</span>
          {selected.error && <div className="ig-error"><p>{t(explainError(new Error(selected.error)).message)}</p><details><summary>{t("Detalhes")}</summary><code>{selected.error}</code></details></div>}
          <label className="reel-field">{t("Legenda")}
            <textarea rows={6} maxLength={2200} value={captionDraft} disabled={selected.status !== "scheduled"} onChange={(e) => setCaptionDraft(e.target.value)} />
          </label>
          {selected.status === "scheduled" && (
            <label className="reel-field">{t("Data e hora")}
              <input type="datetime-local" value={timeDraft} onChange={(e) => setTimeDraft(e.target.value)} />
            </label>
          )}
          <div className="reel-action-row">
            {selected.status === "scheduled" && (
              <button type="button" className="studio-primary-button" disabled={busy} onClick={() => void run(async () => {
                const original = new Date(selected.at);
                const changedTime = timeDraft && timeDraft !== `${dayKey(original)}T${String(original.getHours()).padStart(2, "0")}:${String(original.getMinutes()).padStart(2, "0")}`;
                await studioRequest("updateScheduledReel", { id: selected.id, caption: captionDraft, ...(changedTime ? { at: timeDraft.replace("T", " ") } : {}) });
                setSelected(null);
              }, "Alterações salvas.")}>{t("Salvar")}</button>
            )}
            {(selected.status === "scheduled" || selected.status === "late" || selected.status === "failed") && (
              <button type="button" className="studio-secondary-button" disabled={busy} onClick={() => void run(async () => {
                await studioRequest("publishLateReel", { id: selected.id });
                setSelected(null);
              }, "Publicado.")}><Send size={13} /> {t(selected.status === "failed" ? "Tentar de novo" : "Publicar agora")}</button>
            )}
            {selected.status !== "published" && selected.status !== "publishing" && (
              <button type="button" className="studio-danger-button" disabled={busy} onClick={() => void run(async () => {
                await studioRequest("cancelScheduledReel", { id: selected.id });
                setSelected(null);
              }, "Removido da fila.")}><Trash2 size={13} /> {t("Remover da fila")}</button>
            )}
            {selected.permalink && <button type="button" className="studio-secondary-button" onClick={() => void studioRequest("openInstagramPost", { permalink: selected.permalink })}>{t("Ver no Instagram")}</button>}
          </div>
        </aside>
      )}
    </div>
  );
}

function PanelVideo({ path }: { path: string }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    let alive = true;
    studioRequest<{ url: string }>("previewExportedVideo", { path }).then(({ url }) => alive && setSrc(url), () => undefined);
    return () => { alive = false; };
  }, [path]);
  return src ? <video className="pilot-panel-video" src={src} controls autoPlay muted playsInline /> : <div className="pilot-panel-video" />;
}

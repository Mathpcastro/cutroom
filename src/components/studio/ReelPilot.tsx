import { t, getStudioLanguage } from "./studioLanguage";
import { useEffect, useState } from "react";
import { blankCreationPilot, creationPilotSchema, type CreationPilot } from "../../shared/creation-pilot";
import type { StudioProfile } from "../../shared/profile";
import { generateSalesReel, initialReelDraft } from "./ReelCreator";
import { rememberReel } from "./reelRecords";

const pilotSchema = creationPilotSchema;
type Pilot = CreationPilot;
const blank: Pilot = blankCreationPilot;
const active = new Set<string>();
const eventName = "videosell:pilot";
const key = (id: string) => "videosell.pilot." + id;
/** Spec 3 D: the state lives in <userData>/profiles/<id>/pilot.json; this cache keeps reads synchronous. */
const cache = new Map<string, Pilot>();

function legacyPilot(id: string): Pilot | null {
  try {
    const raw = localStorage.getItem(key(id));
    return raw ? pilotSchema.parse(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function readPilot(id: string): Pilot {
  return cache.get(id) ?? legacyPilot(id) ?? blank;
}

/** Loads the file once per profile; migrates the old localStorage state the first time. */
export async function loadPilot(id: string) {
  if (cache.has(id) || !window.cutroom) return readPilot(id);
  let stored = await window.cutroom.request<Pilot | null>("getCreationPilot", { profileId: id }).catch(() => null);
  if (!stored) {
    const legacy = legacyPilot(id);
    if (legacy) {
      stored = await window.cutroom.request<Pilot>("saveCreationPilot", { profileId: id, pilot: legacy }).catch(() => legacy);
      try { localStorage.removeItem(key(id)); } catch { /* ignore */ }
    }
  }
  cache.set(id, stored ?? blank);
  window.dispatchEvent(new Event(eventName));
  return cache.get(id)!;
}

function savePilot(id: string, pilot: Pilot) {
  cache.set(id, pilot);
  window.dispatchEvent(new Event(eventName));
  if (window.cutroom) void window.cutroom.request("saveCreationPilot", { profileId: id, pilot }).catch(() => undefined);
  else try { localStorage.setItem(key(id), JSON.stringify(pilot)); } catch { /* ignore */ }
}

function nextRun(time: string, interval: number, first = false) {
  const [hours, minutes] = time.split(":").map(Number);
  const next = new Date();
  next.setHours(hours, minutes, 0, 0);
  if (!first || next.getTime() <= Date.now()) next.setDate(next.getDate() + interval);
  return next.getTime();
}

export function queuePilotIdea(profileId: string, idea: { title: string; brief: string }) {
  const state = readPilot(profileId);
  if (state.queue.some((item) => item.brief === idea.brief)) return false;
  if (state.queue.length >= 40) throw new Error("A fila já tem 40 pautas.");
  savePilot(profileId, { ...state, queue: [...state.queue, { title: idea.title, brief: idea.brief }] });
  return true;
}

export function useReelPilot(profile: StudioProfile | null, canRun: boolean, onGenerated: () => void) {
  useEffect(() => {
    if (!profile) return;
    const id = profile.id;
    async function tick() {
      const state = readPilot(id);
      if (active.has(id)) return;
      if (state.running) {
        savePilot(id, { ...state, running: false, enabled: false, error: "A geração foi interrompida. Confira os projetos e reative o piloto." });
        return;
      }
      if (!canRun || !state.enabled || !state.nextAt || state.nextAt > Date.now() || !state.queue.length || !profile) return;
      const idea = state.queue[0];
      active.add(id);
      try {
        savePilot(id, { ...state, running: true, error: undefined });
        const session = await generateSalesReel(profile, { ...initialReelDraft(profile, false), brief: idea.brief, origin: { ideaId: idea.brief, ideaTitle: idea.title } }, () => {});
        rememberReel(session);
        const latest = readPilot(id);
        savePilot(id, {
          ...latest,
          queue: latest.queue.filter((item) => item.brief !== idea.brief),
          running: false,
          nextAt: nextRun(latest.time, latest.everyDays),
        });
        onGenerated();
      } catch (reason) {
        savePilot(id, {
          ...readPilot(id), enabled: false, running: false,
          error: reason instanceof Error ? reason.message : String(reason),
        });
      } finally {
        active.delete(id);
      }
    }
    const timer = setInterval(() => void tick().catch(() => undefined), 30_000);
    void loadPilot(id).then(() => tick()).catch(() => undefined);
    return () => clearInterval(timer);
  }, [profile, canRun, onGenerated]);
}

export function PilotDrafts({ profile }: { profile: StudioProfile }) {
  const [state, setState] = useState(() => readPilot(profile.id));
  const [time, setTime] = useState(state.time);
  const [everyDays, setEveryDays] = useState(state.everyDays);
  const [error, setError] = useState("");
  useEffect(() => {
    const update = () => setState(readPilot(profile.id));
    void loadPilot(profile.id).then(update);
    window.addEventListener(eventName, update);
    return () => window.removeEventListener(eventName, update);
  }, [profile.id]);
  function update(next: Pilot) {
    try { savePilot(profile.id, pilotSchema.parse(next)); setError(""); }
    catch { setError("Não foi possível salvar a configuração da rotina."); }
  }
  return <section className="reel-form-card">
    <p>{t("Usa as pautas do Radar para gerar rascunhos com o app aberto e a IA conectada. Criar sozinho não publica: os rascunhos esperam sua revisão.")}</p>
    {(error || state.error) && <p role="alert">{error || state.error}</p>}
    {state.running && <p role="status">{t("Gerando o próximo Reel…")}</p>}
    {state.enabled && state.nextAt && <p role="status">Próxima geração a partir de {new Date(state.nextAt).toLocaleString(getStudioLanguage())}{state.queue.length ? "." : " · aguardando pautas."}</p>}
    {!state.queue.length && <p>{t("Nenhuma pauta na fila de criação.")}</p>}
    <ul className="routine-queue">{state.queue.map((idea) => <li key={idea.brief}>
      <strong>{idea.title}</strong>
      <button className="studio-secondary-button" disabled={state.running} onClick={() => update({ ...state, queue: state.queue.filter((item) => item.brief !== idea.brief) })}>{t("Remover")}</button>
    </li>)}</ul>
    <div className="reel-action-row">
      <label className="reel-field">{t("Horário local")}<input type="time" value={time} disabled={state.enabled} onChange={(e) => setTime(e.target.value)} /></label>
      <label className="reel-field">{t("Frequência")}<select value={everyDays} disabled={state.enabled} onChange={(e) => setEveryDays(Number(e.target.value))}>
        <option value={1}>{t("Todo dia")}</option><option value={2}>{t("A cada 2 dias")}</option><option value={7}>{t("Uma vez por semana")}</option>
      </select></label>
    </div>
    <button className="studio-primary-button" disabled={state.running || (!state.enabled && (!state.queue.length || !time))}
      onClick={() => update(state.enabled ? { ...state, enabled: false } : {
        ...state, enabled: true, time, everyDays, nextAt: nextRun(time, everyDays, true), error: undefined,
      })}>{state.enabled ? t("Pausar criação automática") : t("Ativar criação com revisão")}</button>
  </section>;
}


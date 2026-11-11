import { useState } from "react";
import { Check, CircleAlert, LoaderCircle, Sparkles, Wand2 } from "lucide-react";
import type { StudioProfile } from "../../shared/profile";
import { STORY_PLACES } from "../../shared/story";
import { t } from "./studioLanguage";
import { DEFAULT_CHOICES, clearSeriesFactory, createReadySeries, scheduleSeriesDaily, useSeriesFactory, type SeriesChoices } from "./seriesFactory";
import { studioRequest } from "./salesReels";

/** Few choices → a finished series: cast, scripted episodes and videos, ready for the autopilot. */

function Chips<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: readonly (readonly [T, string])[]; onChange: (v: T) => void }) {
  return (
    <div className="story-choice">
      <span>{t(label)}</span>
      <div className="story-chips" role="radiogroup" aria-label={t(label)}>
        {options.map(([id, name]) => <button key={String(id)} type="button" role="radio" aria-checked={value === id} onClick={() => onChange(id)}>{t(name)}</button>)}
      </div>
    </div>
  );
}

export function ReadySeries({ profile, onOpen }: { profile: StudioProfile; onOpen: (seriesId: string) => void }) {
  const [c, setC] = useState<SeriesChoices>(DEFAULT_CHOICES);
  const [time, setTime] = useState("18:00");
  const [pilot, setPilot] = useState("");
  const [error, setError] = useState("");
  const job = useSeriesFactory();
  const set = (patch: Partial<SeriesChoices>) => setC({ ...c, ...patch });
  const mine = job && job.profileId === profile.id ? job : null;
  const hasBrand = !!profile.personality.description.trim();

  if (mine) {
    const done = mine.steps.filter((s) => s.state === "done").length;
    return (
      <div className="story-factory">
        <h2>{mine.title ?? t("Criando a sua série…")}</h2>
        <div className="story-progress" role="progressbar" aria-valuemin={0} aria-valuemax={mine.steps.length} aria-valuenow={done}><span style={{ width: `${(done / mine.steps.length) * 100}%` }} /></div>
        <ol className="story-steps">
          {mine.steps.map((s, i) => (
            <li key={i} className={s.state}>
              <span>{s.state === "done" ? <Check size={13} /> : s.state === "doing" ? <LoaderCircle size={13} className="spin" /> : s.state === "failed" ? <CircleAlert size={13} /> : i + 1}</span>
              <b>{t(s.label)}</b>{s.detail && <small>{s.detail}</small>}
            </li>
          ))}
        </ol>
        {mine.running && <p className="reel-hint">{t("Pode sair desta tela: a série continua sendo criada. Cada vídeo leva alguns minutos.")}</p>}
        {mine.error && <p className="reel-error" role="alert">{mine.error}</p>}
        {!mine.running && mine.outputs.length > 0 && (
          <div className="story-pilot">
            <strong>{t("Pronto:")} {mine.outputs.length} {t(mine.outputs.length === 1 ? "episódio pronto" : "episódios prontos")}</strong>
            <p>{t("Ligue o piloto automático e ele posta 1 episódio por dia, em ordem, com a legenda de cada um.")}</p>
            <div className="reel-action-row">
              <label className="reel-field">{t("Horário")}<input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></label>
              <button type="button" className="studio-primary-button" disabled={!!pilot} onClick={() => void scheduleSeriesDaily(mine.title ?? "", mine.outputs, time).then((r) => setPilot(`${t("Piloto ligado: primeiro episódio")} ${new Date(r.scheduled[0].at).toLocaleString()}.`), (reason) => setError(String(reason).replace(/^Error.*?: (Error: )?/, "")))}>
                {t("Ligar piloto automático: 1 episódio por dia")}
              </button>
            </div>
            {pilot && <p className="pilot-notice"><Check size={14} /> {pilot}</p>}
          </div>
        )}
        {error && <p className="reel-error" role="alert">{error}</p>}
        {!mine.running && (
          <div className="reel-action-row">
            {mine.seriesId && <button type="button" className="studio-secondary-button" onClick={() => onOpen(mine.seriesId!)}>{t("Abrir a série")}</button>}
            <button type="button" className="ig-link" onClick={clearSeriesFactory}>{t("Criar outra série")}</button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="story-ready">
      <p className="story-lead">{t(hasBrand ? "A IA usa o que você preencheu da sua marca. Escolha só o jeito da série:" : "Escolha o jeito da série. Dica: preencha a sua marca em Ajustes para a história combinar com o que você vende.")}</p>
      <Chips label="Gênero" value={c.genre} onChange={(genre) => set({ genre })} options={[["comedia", "Comédia"], ["drama", "Drama leve"], ["educativo", "Ensina algo"], ["bastidores", "Bastidores"]] as const} />
      <Chips label="Episódios" value={c.episodes} onChange={(episodes) => set({ episodes })} options={[[3, "3"], [5, "5"], [7, "7"]] as const} />
      <Chips label="Personagens" value={c.cast} onChange={(cast) => set({ cast })} options={[[2, "2"], [3, "3"]] as const} />
      <Chips label="O produto aparece?" value={c.product} onChange={(product) => set({ product })} options={[["never", "Nunca"], ["sometimes", "Às vezes"], ["end", "Sempre no final"]] as const} />
      <Chips label="Onde se passa" value={c.place} onChange={(place) => set({ place })} options={[["variado", "Variado"], ...STORY_PLACES.map((p) => [p, { quarto: "Quarto", escritorio: "Escritório", rua: "Rua", cafe: "Café" }[p]] as const)] as const} />
      <label className="reel-field">{t("Ideia da série (opcional)")}
        <input value={c.idea} maxLength={300} placeholder={t("Deixe em branco para a IA decidir pela sua marca")} onChange={(e) => set({ idea: e.target.value })} />
      </label>
      <label className="mcp-mode"><input type="checkbox" checked={c.render} onChange={(e) => set({ render: e.target.checked })} /> {t("Já gerar os vídeos de todos os episódios")}</label>
      {error && <p className="reel-error" role="alert">{error}</p>}
      <button type="button" className="studio-primary-button story-go" onClick={() => void createReadySeries(profile, c).catch((reason) => setError(String(reason).replace(/^Error.*?: (Error: )?/, "")))}>
        <Sparkles size={16} /> {t("Criar série pronta")}
      </button>
      <small className="reel-hint">{t(`A IA cria o elenco, escreve os ${c.episodes} episódios e ${c.render ? "gera os vídeos" : "deixa os roteiros prontos"}. Você pode editar tudo depois.`)}</small>
    </div>
  );
}

export function ManualSeries({ profile, onCreated }: { profile: StudioProfile; onCreated: (id: string) => void }) {
  const [title, setTitle] = useState("");
  const [premise, setPremise] = useState("");
  const [names, setNames] = useState(["", ""]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <form className="story-ready" onSubmit={(e) => {
      e.preventDefault();
      setBusy(true);
      setError("");
      void studioRequest<{ id: string }>("seriesCreate", {
        profileId: profile.id, title, premise,
        characters: names.filter((n) => n.trim()).map((name) => ({ name: name.trim(), role: "", description: "", speech: "" })),
      }).then((s) => onCreated(s.id), (reason) => setError(String(reason))).finally(() => setBusy(false));
    }}>
      <label className="reel-field">{t("Nome da série")}<input required value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} /></label>
      <label className="reel-field">{t("Sobre o que é")}<textarea rows={2} value={premise} maxLength={600} onChange={(e) => setPremise(e.target.value)} /></label>
      <div className="story-names">
        {names.map((n, i) => <input key={i} value={n} maxLength={40} placeholder={`${t("Personagem")} ${i + 1}`} onChange={(e) => setNames(names.map((x, j) => (j === i ? e.target.value : x)))} />)}
        {names.length < 3 && <button type="button" className="ig-link" onClick={() => setNames([...names, ""])}>{t("+ personagem")}</button>}
      </div>
      {error && <p className="reel-error" role="alert">{error}</p>}
      <button type="submit" className="studio-primary-button" disabled={busy || !title.trim() || !names.some((n) => n.trim())}><Wand2 size={14} /> {t("Criar e escrever os episódios")}</button>
    </form>
  );
}

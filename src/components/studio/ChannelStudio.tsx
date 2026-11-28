import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, Copy, FolderOpen, LoaderCircle, Plug, Plus, Sparkles, Tv } from "lucide-react";
import type { StudioProfile } from "../../shared/profile";
import type { Channel, Episode, Format, Stage } from "../../shared/channel";
import { FORMAT_TEMPLATES, formatOf } from "../../shared/channel-formats";
import { studioRequest } from "./salesReels";
import { openMcp } from "./McpConnect";
import { t } from "./studioLanguage";

/**
 * Canais dark. The production (research, script, narration, render) is done by the user's agent
 * through MCP; this screen shows the channels and episodes, creates a channel from a template and
 * hands the agent ready-made requests to copy.
 */

type ChannelRow = { id: string; name: string; handle: string; niche: string; language: string; updatedAt: string };
type EpisodeRow = Pick<Episode, "id" | "title" | "format" | "stage" | "outputs" | "updatedAt">;
type EpisodeStatus = {
  title: string;
  stages: Record<Stage, string>;
  cost: number;
  outputs: Episode["outputs"];
  qa?: { errors?: number; warnings?: number };
  render?: { done?: number; total?: number };
};
type PackageFile = { titles?: string[]; description?: string };
type ScriptPage = {
  page: number;
  pages: number;
  total: number;
  sections: { id: string; title: string }[];
  beats: { id: string; section: string; text: string; facts: string[]; scene: { type: string }; cta?: string; timing?: { start: number; end: number } }[];
};
type ResearchPage = {
  summary: { facts: number; alta: number; media: number; baixa: number; excluded: number; conflicts: number; premise?: { question: string; verdict: string; note: string } };
  page: number;
  pages: number;
  facts: { id: string; claim: string; value?: string | number; unit?: string; date?: string; source: string; kind?: string; confidence: string; prudent?: string; conflicts: number; excluded?: boolean; usedIn?: string[] }[];
};

const tool = <T,>(name: string, args: Record<string, unknown>) => studioRequest<T>("channelTool", { name, args });

/** The stages the screen shows, in order (publishing stays with the agent). */
const SHOWN: { id: Stage; label: string }[] = [
  { id: "research", label: "Pesquisa" },
  { id: "script", label: "Roteiro" },
  { id: "media", label: "Imagens" },
  { id: "narration", label: "Narração" },
  { id: "align", label: "Sincronia" },
  { id: "scenes", label: "Cenas" },
  { id: "qa", label: "Revisão" },
  { id: "render", label: "Vídeo" },
  { id: "package", label: "Pacote" },
  { id: "shorts", label: "Shorts" },
];
const stageLabel = (id: string) => SHOWN.find((s) => s.id === id)?.label ?? id;
const statusOf = (value = "pendente") => value.split(":")[0].trim();

const TEMPLATE_HINT: Record<string, { title: string; example: string }> = {
  cidade: { title: "Cidade / documentário", example: "Ex.: Vale a pena morar em Curitiba?" },
  top10: { title: "Top 10 / curiosidades", example: "Ex.: 5 planetas que parecem mentira" },
  "e-se": { title: "\"E se…\" com personagem", example: "Ex.: E se você ficasse 30 dias sem internet?" },
};

/** The automatic review in the user's words (the ids and params are for the agent). */
const CHECK_LABEL: Record<string, string> = {
  "fact-per-number": "Todo número na tela tem fonte",
  "facts-min": "Fatos com fonte suficientes no episódio",
  "image-share": "Parte certa de fotos reais ou imagens",
  "max-text-run": "Não empilha cenas só de texto",
  "first-sentence-words": "Primeira frase curta",
  "hook-numbers": "Abertura com número",
  "hook-question": "A abertura faz a pergunta do vídeo",
  "hook-teaser": "Promessa no começo, paga no final",
  "cta-after": "Pedido de inscrição só depois do começo",
  "max-ctas": "Poucos pedidos de inscrição",
  "endscreen-last": "Tela final no fim",
  "sentence-max-words": "Frases curtas",
  "beat-max-seconds": "Nenhuma cena longa demais",
  "section-required": "Seção obrigatória presente",
  "counter-continuity": "O contador nunca volta",
  "ending-twist": "Final com reviravolta",
  "ranked-countdown": "Contagem sem pular números",
  "place-tag": "Nome do lugar só quando aparece",
  "media-query": "Cada cena de imagem tem o que buscar",
  "vary-backdrop": "Cenário muda a cada cena",
};
const SOURCE_LABEL: Record<string, string> = { "foto-real": "Fotos reais com crédito", "b-roll": "Vídeos de banco", avatar: "Avatar do Videosell", ia: "Imagens geradas por IA", grafico: "Gráficos e números", custom: "Cenas desenhadas pelo agente" };
const SCENE_LABEL: Record<string, string> = { photo: "Foto", video: "Vídeo", stat: "Número", rank: "Ranking", versus: "Comparação", calc: "Conta", timeline: "Linha do tempo", map: "Mapa", title: "Título", quote: "Citação", doc: "Documento", list: "Lista", cards: "Cartões", cta: "Inscreva-se", poll: "Enquete", next: "Próximo vídeo", avatar: "Avatar", counter: "Contador", character: "Personagem", custom: "Cena livre" };

function formatDate(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(undefined, { day: "2-digit", month: "short" });
}

/** A request for the user's agent, with a copy button and a way to connect it. */
function AgentRequest({ text, label = "Peça ao seu agente" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => setCopied(false), [text]);
  return (
    <div className="ch-agent">
      <span className="ch-agent-label"><Sparkles size={13} /> {t(label)}</span>
      <p>“{text}”</p>
      <div className="ch-agent-actions">
        <button type="button" className="studio-primary-button" onClick={() => void navigator.clipboard.writeText(text).then(() => setCopied(true), () => setCopied(false))}>
          {copied ? <Check size={14} /> : <Copy size={14} />} {t(copied ? "Copiado" : "Copiar pedido")}
        </button>
        <button type="button" className="studio-secondary-button" onClick={() => openMcp()}><Plug size={14} /> {t("Conectar o Claude Code ou o Codex")}</button>
      </div>
    </div>
  );
}

function useMedia(ids: { profileId: string; channelId: string; episodeId: string }, file?: string) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    setUrl("");
    if (!file) return;
    let alive = true;
    studioRequest<{ url: string }>("channelMedia", { ...ids, file }).then((r) => alive && setUrl(r.url), () => undefined);
    return () => { alive = false; };
  }, [ids.profileId, ids.channelId, ids.episodeId, file]);
  return url;
}

function Thumb({ ids, file, alt }: { ids: { profileId: string; channelId: string; episodeId: string }; file?: string; alt: string }) {
  const url = useMedia(ids, file);
  return url ? <img src={url} alt={alt} /> : <span className="ch-thumb-empty"><Tv size={22} strokeWidth={1.4} /></span>;
}

function Progress({ stages }: { stages?: Record<string, string> }) {
  const done = SHOWN.filter((s) => statusOf(stages?.[s.id]) === "ok").length;
  return (
    <span className="ch-progress" aria-label={`${done} ${t("de")} ${SHOWN.length} ${t("etapas")}`}>
      <span style={{ width: `${Math.round((done / SHOWN.length) * 100)}%` }} />
    </span>
  );
}

// ---------- New channel ----------

function NewChannel({ profile, onCreated, onCancel }: { profile: StudioProfile; onCreated: (id: string) => void; onCancel?: () => void }) {
  const [template, setTemplate] = useState<string>("top10");
  const [name, setName] = useState("");
  const [niche, setNiche] = useState("");
  const [handle, setHandle] = useState("");
  const [language, setLanguage] = useState<"pt-BR" | "en" | "es">("pt-BR");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const custom = template === "outro";
  const nicheText = niche.trim() || "[o seu nicho]";
  const create = async () => {
    if (!name.trim()) { setError(t("Dê um nome ao canal.")); return; }
    const at = handle.trim().replace(/^@?/, "@");
    if (handle.trim() && !/^@[A-Za-z0-9._-]{3,30}$/.test(at)) { setError(t("O @ do canal usa de 3 a 30 letras, números, ponto, traço ou sublinhado.")); return; }
    setBusy(true);
    setError("");
    try {
      const ch = await tool<{ id: string }>("channel_create", { profileId: profile.id, name: name.trim(), niche: niche.trim(), handle: handle.trim() ? at : "", language, format: template });
      onCreated(ch.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="ch-new" aria-labelledby="ch-new-title">
      <header className="ch-head">
        <div>
          <span className="studio-eyebrow">{t("NOVO CANAL DARK")}</span>
          <h1 id="ch-new-title">{t("Escolha o formato do canal")}</h1>
          <p>{t("O formato diz que cenas, duração e revisão cada episódio segue. Para um nicho diferente, o seu agente escreve um formato só dele.")}</p>
        </div>
        {onCancel && <button type="button" className="studio-secondary-button" onClick={onCancel}>{t("Cancelar")}</button>}
      </header>
      <div className="ch-templates" role="radiogroup" aria-label={t("Formato")}>
        {Object.entries(FORMAT_TEMPLATES).map(([id, tpl]) => (
          <button key={id} type="button" role="radio" aria-checked={template === id} className="ch-template" onClick={() => setTemplate(id)}>
            <strong>{t(TEMPLATE_HINT[id]?.title ?? tpl.format.name)}</strong>
            <span>{t(tpl.when)}</span>
            <small>{t(TEMPLATE_HINT[id]?.example ?? "")} · {tpl.format.aspect}</small>
          </button>
        ))}
        <button type="button" role="radio" aria-checked={custom} className="ch-template ch-template-custom" onClick={() => setTemplate("outro")}>
          <strong>{t("Outro nicho")}</strong>
          <span>{t("Finanças, história, receita, mistério… O seu agente pensa um formato sob medida e o Videosell produz.")}</span>
          <small>{t("Formato pelo agente, vídeo pelo Videosell")}</small>
        </button>
      </div>
      <div className="ch-form">
        <label className="reel-field">{t("Nicho")}<input value={niche} maxLength={200} placeholder={t("Ex.: curiosidades do espaço")} onChange={(e) => setNiche(e.target.value)} /></label>
        {!custom && <>
          <label className="reel-field">{t("Nome do canal")}<input value={name} maxLength={100} placeholder={t("Ex.: Top Cósmico")} onChange={(e) => setName(e.target.value)} /></label>
          <label className="reel-field">{t("@ no YouTube (opcional)")}<input value={handle} maxLength={31} placeholder="@topcosmico" onChange={(e) => setHandle(e.target.value)} /></label>
          <label className="reel-field">{t("Idioma")}
            <select value={language} onChange={(e) => setLanguage(e.target.value as typeof language)}>
              <option value="pt-BR">Português</option><option value="en">English</option><option value="es">Español</option>
            </select>
          </label>
        </>}
      </div>
      {custom ? (
        <AgentRequest text={`No Videosell, no perfil ${profile.name}, crie um canal dark sobre ${nicheText} com um formato próprio para esse nicho (use format_templates como exemplo) e faça o primeiro episódio com fontes, narração, thumbs e 2 Shorts.`} />
      ) : (
        <div className="ch-form-actions">
          {error && <p className="ch-error" role="alert">{error}</p>}
          <button type="button" className="studio-primary-button" disabled={busy} onClick={() => void create()}>
            {busy ? <LoaderCircle size={15} className="spin" /> : <Plus size={15} />} {t("Criar canal")}
          </button>
        </div>
      )}
    </section>
  );
}

// ---------- Episode: script and research the agent saved in Videosell ----------

/** Reads every page of a paged tool (script_get / research_get). */
async function allPages<T extends { page: number; pages: number }>(name: string, ids: Record<string, string>) {
  const first = await tool<T>(name, ids);
  const rest = await Promise.all(Array.from({ length: Math.max(0, first.pages - 1) }, (_, i) => tool<T>(name, { ...ids, page: i + 2 })));
  return [first, ...rest];
}

const clock = (sec?: number) => (sec === undefined ? "" : `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`);

function ScriptView({ ids }: { ids: Record<string, string> }) {
  const [pages, setPages] = useState<ScriptPage[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    allPages<ScriptPage>("script_get", ids).then(setPages, (e: Error) => setError(e.message));
  }, [ids]);
  if (error) return <div className="ch-doc ch-doc-empty"><p>{t("O roteiro aparece aqui quando o seu agente salvar no Videosell.")}</p></div>;
  if (!pages) return <div className="ch-doc studio-projects-status" role="status"><LoaderCircle size={16} className="spin" /> {t("Carregando o roteiro…")}</div>;
  const beats = pages.flatMap((p) => p.beats);
  const known = pages[0].sections;
  // Beats in a section the format does not have still show (the review flags them).
  const orphan = beats.some((b) => !known.some((s) => s.id === b.section));
  const sections = orphan ? [...known, ...[...new Set(beats.map((b) => b.section))].filter((id) => !known.some((s) => s.id === id)).map((id) => ({ id, title: id }))] : known;
  const number = new Map(beats.map((b, i) => [b.id, i + 1]));
  return (
    <div className="ch-doc" aria-label={t("Roteiro")}>
      {sections.map((section) => {
        const own = beats.filter((b) => b.section === section.id);
        if (!own.length) return null;
        return (
          <section key={section.id} className="ch-doc-section">
            <h3>{section.title}</h3>
            <ol className="ch-beats">
              {own.map((b) => (
                <li key={b.id} className={b.cta ? "is-cta" : ""}>
                  <span className="ch-beat-n">{number.get(b.id)}</span>
                  <p>{b.text}</p>
                  <span className="ch-beat-meta">
                    <span className="ch-tag">{t(SCENE_LABEL[b.scene.type] ?? b.scene.type)}</span>
                    {b.facts.length > 0 && <span className="ch-tag is-ok">{b.facts.length} {t(b.facts.length === 1 ? "fonte" : "fontes")}</span>}
                    {b.timing && <small>{clock(b.timing.start)}</small>}
                  </span>
                </li>
              ))}
            </ol>
          </section>
        );
      })}
    </div>
  );
}

const CONFIDENCE_LABEL: Record<string, string> = { alta: "confiança alta", "média": "confiança média", baixa: "confiança baixa" };

function ResearchView({ ids }: { ids: Record<string, string> }) {
  const [pages, setPages] = useState<ResearchPage[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    allPages<ResearchPage>("research_get", ids).then(setPages, (e: Error) => setError(e.message));
  }, [ids]);
  if (error) return <div className="ch-doc ch-doc-empty"><p>{error}</p></div>;
  if (!pages) return <div className="ch-doc studio-projects-status" role="status"><LoaderCircle size={16} className="spin" /> {t("Carregando a pesquisa…")}</div>;
  const facts = pages.flatMap((p) => p.facts);
  const summary = pages[0].summary;
  if (!facts.length) return <div className="ch-doc ch-doc-empty"><p>{t("A pesquisa aparece aqui quando o seu agente salvar os fatos com fonte no Videosell.")}</p></div>;
  return (
    <div className="ch-doc" aria-label={t("Pesquisa")}>
      <div className="ch-facts ch-research-summary">
        <span><b>{summary.facts}</b> {t("fatos com fonte")}</span>
        <span><b>{summary.alta}</b> {t("de confiança alta")}</span>
        {summary.conflicts > 0 && <span><b>{summary.conflicts}</b> {t("com fontes que discordam")}</span>}
        {summary.excluded > 0 && <span><b>{summary.excluded}</b> {t("descartados")}</span>}
      </div>
      {summary.premise && <p className="ch-premise"><b>{summary.premise.question}</b> {summary.premise.note}</p>}
      <ul className="ch-fact-list">
        {facts.map((f) => {
          const url = f.source.split(" ").pop() ?? "";
          const publisher = f.source.slice(0, Math.max(0, f.source.length - url.length)).trim();
          let host = url;
          try { host = new URL(url).hostname.replace(/^www\./, ""); } catch { /* keep it as is */ }
          return (
            <li key={f.id} className={f.excluded ? "is-excluded" : ""}>
              <div className="ch-fact-main">
                <p>{f.claim}{f.value !== undefined && <b> {String(f.value)}{f.unit ? ` ${f.unit}` : ""}</b>}{f.date && <small> ({f.date})</small>}</p>
                {f.prudent && <small className="ch-fact-note">{t("Forma prudente")}: {f.prudent}</small>}
              </div>
              <div className="ch-fact-source">
                <strong>{publisher || host}</strong>
                <small title={url}>{host}</small>
                <span className={`ch-tag is-${f.confidence === "alta" ? "ok" : f.confidence === "baixa" ? "low" : "mid"}`}>{t(CONFIDENCE_LABEL[f.confidence] ?? f.confidence)}</span>
                {f.usedIn?.length ? <small>{t("usado em")} {f.usedIn.length} {t(f.usedIn.length === 1 ? "fala" : "falas")}</small> : null}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ---------- Episode ----------

function EpisodeDetail({ profile, channel, episode, onBack }: { profile: StudioProfile; channel: Channel; episode: EpisodeRow; onBack: () => void }) {
  const ids = useMemo(() => ({ profileId: profile.id, channelId: channel.id, episodeId: episode.id }), [profile.id, channel.id, episode.id]);
  const [status, setStatus] = useState<EpisodeStatus | null>(null);
  const [pkg, setPkg] = useState<PackageFile | null>(null);
  const [error, setError] = useState("");
  const [view, setView] = useState<"video" | "script" | "research">("video");
  const load = useCallback(async () => {
    try {
      setStatus(await tool<EpisodeStatus>("episode_status", ids));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
    tool<PackageFile>("package_get", ids).then(setPkg, () => setPkg(null));
  }, [ids]);
  useEffect(() => { void load(); }, [load]);
  const running = status ? Object.values(status.stages).some((v) => statusOf(v) === "rodando") : false;
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => void load(), 4000);
    return () => window.clearInterval(timer);
  }, [running, load]);
  const outputs = status?.outputs ?? episode.outputs;
  const video = useMedia(ids, outputs.video);
  const next = SHOWN.find((s) => statusOf(status?.stages[s.id]) !== "ok");
  const request = next
    ? `No Videosell, continue o episódio "${episode.title}" do canal ${channel.name} a partir da etapa ${t(stageLabel(next.id)).toLowerCase()} e vá até o pacote com thumbs, títulos, descrição e 2 Shorts.`
    : `No Videosell, revise o episódio "${episode.title}" do canal ${channel.name} e prepare a publicação no YouTube.`;
  return (
    <section className="ch-episode" aria-label={episode.title}>
      <header className="ch-episode-head">
        <button type="button" className="studio-secondary-button" onClick={onBack}><ArrowLeft size={14} /> {t("Episódios")}</button>
        <h2>{episode.title}</h2>
        <div className="reels-tabs" role="tablist" aria-label={t("Episódio")}>
          <button type="button" role="tab" aria-selected={view === "video"} onClick={() => setView("video")}>{t("Vídeo")}</button>
          <button type="button" role="tab" aria-selected={view === "script"} onClick={() => setView("script")}>{t("Roteiro")}</button>
          <button type="button" role="tab" aria-selected={view === "research"} onClick={() => setView("research")}>{t("Pesquisa")}</button>
        </div>
        <button type="button" className="studio-secondary-button" onClick={() => void studioRequest("channelReveal", ids)}><FolderOpen size={14} /> {t("Abrir pasta")}</button>
      </header>
      {error && <p className="ch-error" role="alert">{error}</p>}
      <ol className="ch-stages">
        {SHOWN.map((s) => {
          const value = status?.stages[s.id] ?? "pendente";
          const state = statusOf(value);
          return (
            <li key={s.id} className={`ch-stage is-${state}`} title={value}>
              {state === "rodando" ? <LoaderCircle size={12} className="spin" /> : state === "ok" ? <Check size={12} /> : <span className="ch-dot" />}
              {t(s.label)}
            </li>
          );
        })}
      </ol>
      {view === "script" && <ScriptView ids={ids} />}
      {view === "research" && <ResearchView ids={ids} />}
      {view === "video" && <div className="ch-episode-body">
        <div className="ch-player">
          {video ? <video src={video} controls preload="metadata" /> : <div className="ch-video-empty"><Tv size={28} strokeWidth={1.3} /><span>{t(status?.render?.total ? `Renderizando: ${status.render.done ?? 0} de ${status.render.total} cenas` : "O vídeo aparece aqui quando a etapa Vídeo terminar.")}</span></div>}
          {outputs.thumbs.length > 0 && (
            <div className="ch-thumbs">
              {outputs.thumbs.slice(0, 3).map((file, i) => <Thumb key={file} ids={ids} file={file} alt={`${t("Thumb")} ${i + 1}`} />)}
            </div>
          )}
        </div>
        <aside className="ch-side">
          {pkg?.titles?.length ? (
            <div className="ch-box">
              <span className="ch-box-label">{t("Títulos")}</span>
              <ul className="ch-titles">{pkg.titles.slice(0, 3).map((title) => <li key={title}>{title}</li>)}</ul>
            </div>
          ) : null}
          <div className="ch-box ch-facts">
            <span><b>{outputs.shorts.length}</b> {t("Shorts")}</span>
            <span><b>{outputs.thumbs.length}</b> {t("thumbs")}</span>
            {status?.qa && <span><b>{status.qa.errors ?? 0}</b> {t("erros na revisão")}</span>}
            {status && <span><b>US$ {status.cost.toFixed(2)}</b> {t("de voz e IA")}</span>}
          </div>
          {outputs.shorts.length > 0 && (
            <div className="ch-box">
              <span className="ch-box-label">{t("Shorts")}</span>
              <div className="ch-shorts">
                {outputs.shorts.map((file, i) => (
                  <button key={file} type="button" className="studio-secondary-button" onClick={() => void studioRequest("channelReveal", { ...ids, file })}>{t("Short")} {i + 1}</button>
                ))}
              </div>
            </div>
          )}
          <AgentRequest text={request} label={next ? "Para continuar" : "Próximo passo"} />
        </aside>
      </div>}
    </section>
  );
}

// ---------- Channel ----------

function FormatView({ format }: { format: Format }) {
  return (
    <div className="ch-format">
      <div className="ch-box">
        <span className="ch-box-label">{t("Formato")}</span>
        <strong>{t(format.name)}</strong>
        {format.description && <p>{t(format.description)}</p>}
        <div className="ch-facts">
          <span><b>{format.aspect}</b> {t("episódio longo")}</span>
          <span><b>{Math.round(format.durationSec.min / 60)}–{Math.round(format.durationSec.max / 60)} min</b> {t("de duração")}</span>
          <span><b>{format.scenes.length}</b> {t("tipos de cena")}</span>
        </div>
      </div>
      <div className="ch-box">
        <span className="ch-box-label">{t("Revisão automática")}</span>
        <ul className="ch-list">{format.checklist.length ? format.checklist.map((c) => <li key={c.id}><span className={`ch-level is-${c.level}`}>{t(c.level === "erro" ? "obrigatório" : "aviso")}</span> {t(CHECK_LABEL[c.kind] ?? c.id)}</li>) : <li>{t("Só as checagens de estrutura.")}</li>}</ul>
      </div>
      <div className="ch-box">
        <span className="ch-box-label">{t("Imagens")}</span>
        <ul className="ch-list">{format.imagery.sources.map((src) => <li key={src}>{t(SOURCE_LABEL[src] ?? src)}</li>)}</ul>
        <span className="ch-box-label">{t("Tipos de cena")}</span>
        <div className="ch-chips">{format.scenes.map((scene) => <span key={scene}>{t(SCENE_LABEL[scene] ?? scene)}</span>)}</div>
      </div>
    </div>
  );
}

function ChannelView({ profile, channelId }: { profile: StudioProfile; channelId: string }) {
  const [channel, setChannel] = useState<Channel | null>(null);
  const [episodes, setEpisodes] = useState<EpisodeRow[]>([]);
  const [tab, setTab] = useState<"episodes" | "format">("episodes");
  const [open, setOpen] = useState<EpisodeRow | null>(null);
  const [statuses, setStatuses] = useState<Record<string, Record<string, string>>>({});
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      const ids = { profileId: profile.id, channelId };
      const [ch, list] = await Promise.all([tool<Channel>("channel_get", ids), tool<EpisodeRow[]>("channel_episode_list", ids)]);
      setChannel(ch);
      setEpisodes([...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
      setError("");
      const entries = await Promise.all(list.slice(0, 12).map(async (e) => [e.id, (await tool<EpisodeStatus>("episode_status", { ...ids, episodeId: e.id }).catch(() => null))?.stages ?? {}] as const));
      setStatuses(Object.fromEntries(entries));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [profile.id, channelId]);
  useEffect(() => { setOpen(null); setTab("episodes"); void load(); }, [load]);
  useEffect(() => {
    const timer = window.setInterval(() => void load(), 15000);
    return () => window.clearInterval(timer);
  }, [load]);
  if (error && !channel) return <p className="ch-error" role="alert">{error}</p>;
  if (!channel) return <div className="studio-projects-status" role="status"><LoaderCircle size={16} className="spin" /> {t("Carregando o canal…")}</div>;
  const format = formatOf(channel);
  if (open) return <EpisodeDetail profile={profile} channel={channel} episode={open} onBack={() => { setOpen(null); void load(); }} />;
  const newEpisode = `No Videosell, faça o próximo episódio do canal ${channel.name} (perfil ${profile.name}): escolha uma pauta forte do nicho ${channel.niche || format.name}, pesquise com fontes, escreva o roteiro no formato do canal, narre, renderize e entregue thumbs, títulos, descrição com capítulos e 2 Shorts.`;
  return (
    <section className="ch-channel" aria-labelledby="ch-title">
      <header className="ch-head">
        <div>
          <span className="studio-eyebrow">{t(format.name)} · {format.aspect}</span>
          <h1 id="ch-title">{channel.name}</h1>
          <p>{[channel.handle, channel.niche].filter(Boolean).join(" · ") || t("Canal sem nicho definido")}</p>
        </div>
        <div className="reels-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === "episodes"} onClick={() => setTab("episodes")}>{t("Episódios")}<small>{episodes.length}</small></button>
          <button type="button" role="tab" aria-selected={tab === "format"} onClick={() => setTab("format")}>{t("Formato")}</button>
        </div>
      </header>
      {tab === "format" ? <FormatView format={format} /> : (
        <div className="ch-episodes-area">
          <div className="ch-episodes">
            {episodes.length === 0 && (
              <div className="ch-empty">
                <Tv size={26} strokeWidth={1.4} />
                <strong>{t("Nenhum episódio ainda")}</strong>
                <p>{t("O seu agente pesquisa e escreve o roteiro. O Videosell narra, monta as cenas, revisa e gera o vídeo, as thumbs e os Shorts. Copie o pedido ao lado e cole no chat do agente.")}</p>
              </div>
            )}
            {episodes.map((e) => {
              const stages = statuses[e.id];
              const runningStage = SHOWN.find((s) => statusOf(stages?.[s.id]) === "rodando");
              const failed = SHOWN.find((s) => statusOf(stages?.[s.id]) === "erro");
              return (
                <button key={e.id} type="button" className="ch-episode-card" onClick={() => setOpen(e)}>
                  <span className="ch-card-thumb"><Thumb ids={{ profileId: profile.id, channelId, episodeId: e.id }} file={e.outputs.thumbs[0]} alt="" /></span>
                  <strong>{e.title}</strong>
                  <Progress stages={stages} />
                  <small>
                    {runningStage ? `${t("Agora")}: ${t(runningStage.label)}` : failed ? `${t("Parou em")}: ${t(failed.label)}` : e.outputs.video ? t("Vídeo pronto") : `${t("Etapa")}: ${t(stageLabel(e.stage))}`}
                    {" · "}{formatDate(e.updatedAt)}
                  </small>
                </button>
              );
            })}
          </div>
          <AgentRequest text={newEpisode} label="Novo episódio" />
        </div>
      )}
    </section>
  );
}

// ---------- Screen ----------

export function ChannelStudio({ profile, startNew = false }: { profile: StudioProfile; startNew?: boolean }) {
  const [channels, setChannels] = useState<ChannelRow[] | null>(null);
  const [selected, setSelected] = useState<string>("");
  const [creating, setCreating] = useState(startNew);
  const [error, setError] = useState("");
  const load = useCallback(async (pick?: string) => {
    try {
      const list = await tool<ChannelRow[]>("channel_list", { profileId: profile.id });
      const sorted = [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      setChannels(sorted);
      setSelected((current) => pick ?? (sorted.some((c) => c.id === current) ? current : sorted[0]?.id ?? ""));
      setError("");
    } catch (e) {
      setChannels([]);
      setError((e as Error).message);
    }
  }, [profile.id]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (startNew) setCreating(true); }, [startNew]);
  const showNew = creating || (channels !== null && channels.length === 0);
  return (
    <div className="channels">
      <aside className="ch-rail" aria-label={t("Seus canais")}>
        <div className="ch-rail-head">
          <strong>{t("Canais dark")}</strong>
          <button type="button" className="studio-secondary-button" onClick={() => setCreating(true)}><Plus size={14} /> {t("Novo")}</button>
        </div>
        {channels === null && <div className="studio-projects-status" role="status"><LoaderCircle size={15} className="spin" /> {t("Carregando…")}</div>}
        {error && <p className="ch-error" role="alert">{error}</p>}
        <div className="ch-rail-list">
          {channels?.map((c) => (
            <button key={c.id} type="button" className={!showNew && selected === c.id ? "active" : ""} aria-current={!showNew && selected === c.id ? "true" : undefined}
              onClick={() => { setCreating(false); setSelected(c.id); }}>
              <strong>{c.name}</strong>
              <small>{c.niche || c.handle || t("Sem nicho")}</small>
            </button>
          ))}
          {channels?.length === 0 && <p className="ch-rail-empty">{t("Seu primeiro canal aparece aqui.")}</p>}
        </div>
        <button type="button" className="ch-rail-agent" onClick={() => openMcp()}><Plug size={14} /> {t("Conectar o meu agente")}</button>
      </aside>
      <div className="ch-main">
        {showNew ? (
          <NewChannel profile={profile} onCancel={channels?.length ? () => setCreating(false) : undefined}
            onCreated={(id) => { setCreating(false); void load(id); }} />
        ) : selected ? <ChannelView key={selected} profile={profile} channelId={selected} /> : null}
      </div>
    </div>
  );
}

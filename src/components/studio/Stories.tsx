import { useCallback, useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { ArrowDown, ArrowLeft, ArrowUp, BookOpen, Code2, Laugh, Plus, Scissors, Sparkles, Trash2, Volume2, Wand2 } from "lucide-react";
import type { StudioProfile } from "../../shared/profile";
import {
  MAX_WORDS, NARRATOR, SAMPLE_SERIES, STORY_MOODS, STORY_PLACES, estimateSeconds, ideaSchema, scriptSchema, toEngineText, validateScript,
  type Character, type Episode, type Series, type StoryScript,
} from "../../shared/story";
import { BASE_AVATARS } from "../../shared/story-html";
import { t } from "./studioLanguage";
import { structuredReply, studioRequest } from "./salesReels";
import { renderReel } from "./ReelFlow";
import { ExportedVideoPlayer, InstagramActions } from "./InstagramActions";
import { explainError } from "./InstagramConnect";
import { ManualSeries, ReadySeries } from "./StoryWizard";
import { useSeriesFactory } from "./seriesFactory";

/** Spec 5: series → (episodes | characters | bible) → episode editor with the script in blocks. */

type SeriesCard = Series & { episodes: number; nextEpisode?: string };
const STATE_LABEL: Record<Episode["state"], string> = { idea: "Ideia", script: "Roteiro", ready: "Pronto", scheduled: "Agendado", published: "Publicado" };
const BASE_NAMES: Record<string, string> = { strategist: "Estrategista", companion: "Parceira", expert: "Especialista" };

const seriesProposal = z.object({
  title: z.string().min(1).max(120),
  premise: z.string().max(600),
  tone: z.string().max(300),
  setting: z.string().max(300),
  rules: z.string().max(1200),
  characters: z.array(z.object({ name: z.string().min(1).max(40), role: z.string().max(200), description: z.string().max(600), speech: z.string().max(400), quirk: z.string().max(200).optional() })).min(2).max(4),
  ideas: z.array(ideaSchema).min(3).max(8),
});
const ideasReply = z.object({ ideas: z.array(ideaSchema).min(1).max(8) });
const lineReply = z.object({ text: z.string().min(1).max(300), mood: z.string().max(20).optional() });

const errorText = (reason: unknown) => explainError(reason).message;

/** Different default voices for each character, from the voices installed for the profile's provider. */
type VoiceProvider = NonNullable<Character["voice"]>["provider"];
export function assignVoices<T extends { voice?: Character["voice"] }>(characters: T[], voices: string[], provider: VoiceProvider): T[] {
  if (!voices.length) return characters;
  return characters.map((c, i) => (c.voice ? c : { ...c, voice: { provider, voiceId: voices[i % voices.length] } }));
}

export function Stories({ profile, onConnect, onPilot }: { profile: StudioProfile; onConnect: () => void; onPilot: () => void }) {
  const [list, setList] = useState<SeriesCard[] | null>(null);
  const [open, setOpen] = useState<string>("");
  const [error, setError] = useState("");
  const reload = useCallback(async () => {
    try {
      setList(await studioRequest<SeriesCard[]>("seriesList", { profileId: profile.id }));
    } catch (reason) {
      setError(errorText(reason));
    }
  }, [profile.id]);
  useEffect(() => { void reload(); }, [reload]);
  if (open) return <SeriesView profile={profile} seriesId={open} onBack={() => { setOpen(""); void reload(); }} onConnect={onConnect} onPilot={onPilot} />;
  return <SeriesList profile={profile} list={list} error={error} onOpen={setOpen} onCreated={(id) => { void reload(); setOpen(id); }} />;
}

function SeriesList({ profile, list, error, onOpen, onCreated }: { profile: StudioProfile; list: SeriesCard[] | null; error: string; onOpen: (id: string) => void; onCreated: (id: string) => void }) {
  const [about, setAbout] = useState("");
  const [product, setProduct] = useState<Series["product"]>("sometimes");
  const [proposal, setProposal] = useState<z.infer<typeof seriesProposal> | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [creating, setCreating] = useState(false);
  const [mode, setMode] = useState<"pronta" | "frase" | "manual">("pronta");
  const factory = useSeriesFactory();
  const factoryHere = !!factory && factory.profileId === profile.id;

  async function propose() {
    setBusy(true);
    setProblem("");
    try {
      const brand = `${profile.brand.name}: ${profile.personality.description}`.slice(0, 1500);
      setProposal(await structuredReply(
        `Crie uma série de vídeos curtos (Reels) em episódios a partir desta ideia: "${about}". Marca: ${brand}. Produto na série: ${{ never: "nunca aparece", sometimes: "aparece às vezes, resolvendo a cena", end: "sempre no final" }[product]}.
Devolva título, premissa em 2 frases, tom, cenário habitual, o que nunca muda (rules), 2 a 4 personagens (nome curto, papel, descrição curta, jeito de falar, uma mania) e ideias para os 5 primeiros episódios (title + line).
Responda só com JSON: {"title":"","premise":"","tone":"","setting":"","rules":"","characters":[{"name":"","role":"","description":"","speech":"","quirk":""}],"ideas":[{"title":"","line":""}]}`,
        "Criar série com IA", seriesProposal));
    } catch (reason) {
      setProblem(errorText(reason));
    } finally {
      setBusy(false);
    }
  }

  async function save(source: { title: string; premise: string; tone: string; setting: string; rules: string; characters: { name: string; role: string; description: string; speech: string; quirk?: string }[]; ideas?: { title: string; line: string }[] }, sample?: StoryScript) {
    setBusy(true);
    setProblem("");
    try {
      const provider = profile.voice.provider;
      const voices = await studioRequest<{ voices: { id: string }[] }>("listVoices", { provider }).then((r) => r.voices.map((v) => v.id), () => [] as string[]);
      const characters = assignVoices(
        source.characters.map((c, i): { voice?: Character["voice"] } & typeof c & { avatar: { avatarId: string } } => ({ ...c, avatar: { avatarId: i === 0 && profile.defaultAvatar ? profile.defaultAvatar.avatarId : `base:${BASE_AVATARS[(i + 1) % 3]}` } })),
        voices, provider,
      );
      const series = await studioRequest<Series>("seriesCreate", { profileId: profile.id, ...source, product, cta: "Segue pra parte 2", characters, ideas: source.ideas ?? [] });
      if (sample) {
        const ep = await studioRequest<Episode>("episodeCreate", { profileId: profile.id, seriesId: series.id, title: sample.title, idea: "Exemplo" });
        await studioRequest("episodeUpdate", { profileId: profile.id, seriesId: series.id, number: ep.number, script: sample });
      }
      onCreated(series.id);
    } catch (reason) {
      setProblem(errorText(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stories">
      <header className="stories-head">
        <h1>{t("Histórias")}</h1>
        {!!list?.length && !creating && <button type="button" className="studio-primary-button" onClick={() => setCreating(true)}><Plus size={15} /> {t("Nova série")}</button>}
      </header>
      {error && <p className="reel-error" role="alert">{error}</p>}
      {(creating || list?.length === 0 || factoryHere) && (
        <div className="reels-tabs story-modes" role="tablist">
          {([["pronta", "Série pronta com IA"], ["frase", "Com uma frase"], ["manual", "Manual"]] as const).map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={mode === id} onClick={() => setMode(id)}>{t(label)}</button>
          ))}
        </div>
      )}
      {(creating || list?.length === 0 || factoryHere) && mode === "pronta" && <section className="stories-new"><ReadySeries profile={profile} onOpen={onCreated} /></section>}
      {(creating || list?.length === 0) && mode === "manual" && <section className="stories-new"><ManualSeries profile={profile} onCreated={onCreated} /></section>}
      {(creating || list?.length === 0) && mode === "frase" && (
        <section className="stories-new">
          <h2>{t("Sobre o que é a sua série?")}</h2>
          <textarea rows={2} value={about} maxLength={600} placeholder={t("Ex.: dois sócios tentando conseguir o primeiro cliente do SaaS")} onChange={(e) => setAbout(e.target.value)} />
          <div className="stories-product" role="radiogroup" aria-label={t("Essa série deve mostrar o seu produto?")}>
            <span>{t("Essa série deve mostrar o seu produto?")}</span>
            <div className="segmented">
              {(["never", "sometimes", "end"] as const).map((p) => (
                <button key={p} type="button" role="radio" aria-checked={product === p} onClick={() => setProduct(p)}>{t({ never: "Nunca", sometimes: "Às vezes", end: "Sempre no final" }[p])}</button>
              ))}
            </div>
          </div>
          <div className="reel-action-row">
            <button type="button" className="studio-primary-button" disabled={busy || !about.trim()} title={about.trim() ? "" : t("Escreva uma frase sobre a série.")} onClick={() => void propose()}>
              <Sparkles size={15} /> {busy && !proposal ? t("Criando…") : t("Criar com IA")}
            </button>
            {list?.length === 0 && <button type="button" className="studio-secondary-button" disabled={busy} onClick={() => void save(SAMPLE_SERIES, SAMPLE_SERIES.script)}>{t("Usar a série de exemplo “O primeiro cliente”")}</button>}
            {creating && <button type="button" className="ig-link" onClick={() => setCreating(false)}>{t("Cancelar")}</button>}
          </div>
          {problem && <p className="reel-error" role="alert">{problem}</p>}
          {proposal && (
            <div className="stories-proposal">
              <label className="reel-field">{t("Título")}<input value={proposal.title} onChange={(e) => setProposal({ ...proposal, title: e.target.value })} /></label>
              <label className="reel-field">{t("Premissa")}<textarea rows={2} value={proposal.premise} onChange={(e) => setProposal({ ...proposal, premise: e.target.value })} /></label>
              <div className="stories-cast">
                {proposal.characters.map((c, i) => (
                  <div key={i} className="stories-cast-card">
                    <input value={c.name} aria-label={t("Nome")} onChange={(e) => setProposal({ ...proposal, characters: proposal.characters.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
                    <small>{c.role}</small>
                    <span>{c.speech}</span>
                  </div>
                ))}
              </div>
              <ol className="stories-ideas">{proposal.ideas.map((idea) => <li key={idea.title}><b>{idea.title}</b> {idea.line}</li>)}</ol>
              <button type="button" className="studio-primary-button" disabled={busy} onClick={() => void save(proposal)}>{t("Aprovar e criar a série")}</button>
            </div>
          )}
        </section>
      )}
      {!!list?.length && (
        <div className="stories-grid">
          {list.map((s) => (
            <button key={s.id} type="button" className="stories-card" onClick={() => onOpen(s.id)}>
              <span className="stories-card-cover"><BookOpen size={26} /></span>
              <strong>{s.title}</strong>
              <small>{s.episodes} {t(s.episodes === 1 ? "episódio" : "episódios")}{s.nextEpisode ? ` · ${t("próximo:")} ${s.nextEpisode}` : ""}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SeriesView({ profile, seriesId, onBack, onConnect, onPilot }: { profile: StudioProfile; seriesId: string; onBack: () => void; onConnect: () => void; onPilot: () => void }) {
  const [data, setData] = useState<{ series: Series; episodes: Episode[] } | null>(null);
  const [tab, setTab] = useState<"episodes" | "cast" | "about">("episodes");
  const [episode, setEpisode] = useState<number>(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const ref = { profileId: profile.id, seriesId };
  const reload = useCallback(async () => {
    try { setData(await studioRequest("seriesGet", { profileId: profile.id, seriesId })); } catch (reason) { setError(errorText(reason)); }
  }, [profile.id, seriesId]);
  useEffect(() => { void reload(); }, [reload]);
  if (!data) return <div className="stories"><p role="status">{t("Abrindo a série…")}</p></div>;
  const { series, episodes } = data;
  if (episode) {
    const ep = episodes.find((e) => e.number === episode);
    if (ep) return <EpisodeEditor profile={profile} series={series} episodes={episodes} episode={ep} onBack={() => { setEpisode(0); void reload(); }} onSaved={reload} onConnect={onConnect} onPilot={onPilot} />;
  }
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try { await work(); await reload(); } catch (reason) { setError(errorText(reason)); } finally { setBusy(false); }
  };
  const newEpisode = (title: string, idea: string) => run(async () => {
    const ep = await studioRequest<Episode>("episodeCreate", { ...ref, title, idea });
    setEpisode(ep.number);
  });
  const suggest = () => run(async () => {
    const done = episodes.map((e) => `${e.number}. ${e.title}: ${e.summary ?? e.idea}`).join("\n") || "Nenhum episódio ainda.";
    const r = await structuredReply(`Série "${series.title}". Premissa: ${series.premise}. Episódios até agora:\n${done}\nSugira 5 ideias para os próximos episódios que continuem a história. Responda só com JSON: {"ideas":[{"title":"","line":""}]}`, "Sugerir próximos episódios", ideasReply);
    await studioRequest("seriesUpdate", { ...ref, ideas: [...series.ideas, ...r.ideas].slice(-30) });
  });
  const usedIdeas = new Set(episodes.map((e) => e.title));
  return (
    <div className="stories">
      <button type="button" className="studio-back-button" onClick={onBack}><ArrowLeft size={15} /> {t("Séries")}</button>
      <header className="stories-head"><h1>{series.title}</h1></header>
      <div className="reels-tabs" role="tablist">
        {(["episodes", "cast", "about"] as const).map((id) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{t({ episodes: "Episódios", cast: "Personagens", about: "Sobre a série" }[id])}</button>
        ))}
      </div>
      {error && <p className="reel-error" role="alert">{error}</p>}
      {tab === "episodes" && (
        <div className="stories-episodes">
          <ul className="my-reels">
            {episodes.map((e) => (
              <li key={e.number}>
                <span className="stories-ep-n">{e.number}</span>
                <span className="pilot-item-text"><strong>{e.title}</strong></span>
                <span className={`pilot-badge ${e.state === "published" ? "published" : e.state === "ready" ? "ready" : e.state === "scheduled" ? "scheduled" : ""}`}>{t(STATE_LABEL[e.state])}</span>
                <button type="button" className="studio-secondary-button" onClick={() => setEpisode(e.number)}>{t(e.state === "idea" ? "Escrever roteiro" : e.state === "script" ? "Abrir roteiro" : "Ver episódio")}</button>
              </li>
            ))}
          </ul>
          <section className="stories-next">
            <h2>{t("Novo episódio")}</h2>
            <div className="stories-idea-list">
              {series.ideas.filter((i) => !usedIdeas.has(i.title)).slice(0, 6).map((idea) => (
                <button key={idea.title} type="button" disabled={busy} onClick={() => void newEpisode(idea.title, idea.line)}><b>{idea.title}</b><span>{idea.line}</span></button>
              ))}
            </div>
            <div className="reel-action-row">
              <button type="button" className="studio-secondary-button" disabled={busy} onClick={() => void suggest()}><Sparkles size={14} /> {t("Sugerir próximos episódios")}</button>
              <button type="button" className="studio-secondary-button" disabled={busy} onClick={() => { const title = window.prompt(t("Em uma linha, sobre o que é o episódio?")); if (title?.trim()) void newEpisode(title.trim().slice(0, 120), title.trim()); }}><Plus size={14} /> {t("Escrever uma linha")}</button>
            </div>
          </section>
        </div>
      )}
      {tab === "cast" && <CastEditor profile={profile} series={series} onSave={(c) => run(() => studioRequest("characterUpsert", { ...ref, character: c }))} busy={busy} />}
      {tab === "about" && <BibleEditor series={series} busy={busy} onSave={(patch) => run(() => studioRequest("seriesUpdate", { ...ref, ...patch }))} onDelete={() => run(async () => { await studioRequest("seriesDelete", { ...ref, confirm: true }); onBack(); })} />}
    </div>
  );
}

function CastEditor({ profile, series, onSave, busy }: { profile: StudioProfile; series: Series; onSave: (c: Character) => Promise<void>; busy: boolean }) {
  const [voices, setVoices] = useState<{ id: string; name?: string }[]>([]);
  const [playing, setPlaying] = useState("");
  const [note, setNote] = useState("");
  useEffect(() => {
    studioRequest<{ voices: { id: string; name?: string }[] }>("listVoices", { provider: profile.voice.provider }).then((r) => setVoices(r.voices), () => setVoices([]));
  }, [profile.voice.provider]);
  const listen = async (c: Character) => {
    setPlaying(c.id);
    setNote("");
    try {
      const r = await studioRequest<{ status: string; url?: string }>("previewVoiceLine", { text: c.narrator ? "Episódio um. Tudo começou numa terça." : `Oi, eu sou ${c.name}. ${c.speech}`.slice(0, 200), provider: c.voice?.provider ?? profile.voice.provider, voice: c.voice?.voiceId });
      if (r.status === "generating") setNote("A voz está sendo preparada. Clique em Ouvir de novo em alguns segundos.");
      else if (r.url) void new Audio(r.url).play();
    } catch (reason) {
      setNote(errorText(reason));
    } finally {
      setPlaying("");
    }
  };
  const avatarOptions = [
    ...(profile.defaultAvatar ? [{ id: profile.defaultAvatar.avatarId, label: "Meu avatar" }] : []),
    ...BASE_AVATARS.map((b) => ({ id: `base:${b}`, label: BASE_NAMES[b] })),
  ];
  return (
    <div className="stories-cast-editor">
      {note && <p className="reel-hint" role="status">{t(note)}</p>}
      {series.characters.map((c) => (
        <div key={c.id} className="stories-character">
          <div className="stories-character-head">
            <strong>{c.name}</strong>
            <small>{c.narrator ? t("Narrador · sem avatar") : c.role}</small>
          </div>
          {!c.narrator && <p>{c.description}</p>}
          <div className="stories-character-row">
            {!c.narrator && (
              <label className="reel-field">{t("Avatar")}
                <select value={c.avatar?.avatarId ?? ""} disabled={busy} onChange={(e) => void onSave({ ...c, avatar: { avatarId: e.target.value } })}>
                  {avatarOptions.map((o) => <option key={o.id} value={o.id}>{t(o.label)}</option>)}
                </select>
              </label>
            )}
            <label className="reel-field">{t("Voz")}
              <select value={c.voice?.voiceId ?? ""} disabled={busy || !voices.length} title={voices.length ? "" : t("Nenhuma voz instalada para este provedor.")} onChange={(e) => void onSave({ ...c, voice: { provider: profile.voice.provider, voiceId: e.target.value } })}>
                <option value="">{t("Voz do perfil")}</option>
                {voices.map((v) => <option key={v.id} value={v.id}>{v.name ?? v.id}</option>)}
              </select>
            </label>
            <button type="button" className="studio-secondary-button" disabled={!!playing} onClick={() => void listen(c)}><Volume2 size={14} /> {t(playing === c.id ? "Gerando…" : "Ouvir")}</button>
          </div>
        </div>
      ))}
      <p className="reel-hint">{t("Mudar avatar ou voz não altera episódios já prontos.")}</p>
    </div>
  );
}

function BibleEditor({ series, busy, onSave, onDelete }: { series: Series; busy: boolean; onSave: (patch: Partial<Series>) => Promise<void>; onDelete: () => Promise<void> }) {
  const [form, setForm] = useState({ premise: series.premise, tone: series.tone, setting: series.setting, rules: series.rules, cta: series.cta });
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="stories-bible">
      {(["premise", "tone", "setting", "rules", "cta"] as const).map((k) => (
        <label key={k} className="reel-field">{t({ premise: "Premissa", tone: "Tom", setting: "Cenário habitual", rules: "O que nunca muda", cta: "Chamada do final" }[k])}
          <textarea rows={k === "rules" ? 3 : 2} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
        </label>
      ))}
      <div className="reel-action-row">
        <button type="button" className="studio-primary-button" disabled={busy} onClick={() => void onSave(form)}>{t("Salvar")}</button>
        {!confirm ? <button type="button" className="ig-link" onClick={() => setConfirm(true)}><Trash2 size={13} /> {t("Apagar série")}</button> : <>
          <span className="reel-hint">{t("Apaga a série e os roteiros. Os vídeos prontos continuam em Meus Reels.")}</span>
          <button type="button" className="studio-danger-button" disabled={busy} onClick={() => void onDelete()}>{t("Apagar")}</button>
          <button type="button" className="ig-link" onClick={() => setConfirm(false)}>{t("Cancelar")}</button>
        </>}
      </div>
    </div>
  );
}

function EpisodeEditor({ profile, series, episodes, episode, onBack, onSaved, onConnect, onPilot }: {
  profile: StudioProfile; series: Series; episodes: Episode[]; episode: Episode;
  onBack: () => void; onSaved: () => Promise<void>; onConnect: () => void; onPilot: () => void;
}) {
  const [script, setScript] = useState<StoryScript | undefined>(episode.script);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [asText, setAsText] = useState(false);
  const [change, setChange] = useState("");
  const [output, setOutput] = useState(episode.output ?? "");
  const [post, setPost] = useState(false);
  const [pilotNote, setPilotNote] = useState("");
  const ref = { profileId: profile.id, seriesId: series.id, number: episode.number };
  const cast = series.characters.filter((c) => !c.narrator).map((c) => c.name);
  const issues = useMemo(() => (script ? validateScript(script, cast) : []), [script, cast]);
  const seconds = script ? estimateSeconds(script) : 0;
  const run = async (label: string, work: () => Promise<void>) => {
    setBusy(label);
    setError("");
    try { await work(); } catch (reason) { setError(errorText(reason)); } finally { setBusy(""); }
  };
  const save = (next: StoryScript) => studioRequest("episodeUpdate", { ...ref, script: next }).then(onSaved);
  const write = (extra = "") => run("write", async () => {
    const { brief } = await studioRequest<{ brief: string }>("episodeBrief", { ...ref, idea: episode.idea || episode.title });
    const next = await structuredReply(`${brief}${extra ? `\n\nRoteiro atual: ${JSON.stringify(script)}\nMude assim: ${extra}` : ""}`, extra ? "Ajustar roteiro" : "Escrever roteiro do episódio", scriptSchema);
    setScript(next);
    await save(next);
  });
  const update = (next: StoryScript) => { setScript(next); };
  const setLine = (s: number, l: number, patch: Partial<StoryScript["scenes"][number]["lines"][number]>) =>
    script && update({ ...script, scenes: script.scenes.map((sc, i) => (i !== s ? sc : { ...sc, lines: sc.lines.map((ln, j) => (j === l ? { ...ln, ...patch } : ln)) })) });
  const moveLine = (s: number, l: number, d: number) => {
    if (!script) return;
    const lines = [...script.scenes[s].lines];
    const to = l + d;
    if (to < 0 || to >= lines.length) return;
    [lines[l], lines[to]] = [lines[to], lines[l]];
    update({ ...script, scenes: script.scenes.map((sc, i) => (i === s ? { ...sc, lines } : sc)) });
  };
  const lineAction = (s: number, l: number, how: string) => run(`line-${s}-${l}`, async () => {
    if (!script) return;
    const line = script.scenes[s].lines[l];
    const r = await structuredReply(`Série "${series.title}". Personagem: ${line.who}. Fala atual: "${line.text}". ${how}. Até ${MAX_WORDS} palavras, no jeito de falar do personagem. Humores possíveis: ${STORY_MOODS.join(", ")}. Responda só com JSON: {"text":"","mood":""}`, how, lineReply);
    setLine(s, l, { text: r.text, ...(r.mood && (STORY_MOODS as readonly string[]).includes(r.mood) ? { mood: r.mood } : {}) });
  });
  const generate = () => run("generate", async () => {
    if (!script) return;
    await save(script);
    const r = await studioRequest<{ film: string; warnings: string[] }>("episodeGenerate", ref);
    if (r.warnings.length) setError(r.warnings.join(" "));
    setBusy("render");
    const path = await renderReel(r.film, () => undefined);
    setOutput(path);
    await studioRequest("episodeUpdate", { ...ref, output: path, state: "ready", summary: script.hook ?? script.scenes.at(-1)?.lines.at(-1)?.text });
    await onSaved();
  });
  const caption = `Ep. ${episode.number} · ${script?.title ?? episode.title} | ${series.title}\n\n${t("E você, o que faria no lugar deles?")}`;

  return (
    <div className="stories episode-editor">
      <button type="button" className="studio-back-button" onClick={onBack}><ArrowLeft size={15} /> {series.title}</button>
      <header className="stories-head">
        <h1>{`Ep. ${episode.number} · ${script?.title ?? episode.title}`}</h1>
        {script && <span className={`stories-duration ${seconds > 45 ? "over" : ""}`}>~{seconds} s</span>}
      </header>
      {error && <p className="reel-error" role="alert">{error}</p>}
      {!script ? (
        <section className="stories-new">
          <p>{episode.idea || episode.title}</p>
          <button type="button" className="studio-primary-button" disabled={!!busy} onClick={() => void write()}><Wand2 size={15} /> {t(busy === "write" ? "Escrevendo…" : "Escrever roteiro")}</button>
        </section>
      ) : (
        <div className="episode-layout">
          <section className="episode-script">
            <div className="reel-action-row">
              <button type="button" className="ig-link" onClick={() => setAsText(!asText)}><Code2 size={13} /> {t(asText ? "Ver em blocos" : "Ver como texto")}</button>
              <button type="button" className="studio-secondary-button" disabled={!!busy} onClick={() => void run("save", () => save(script))}>{t("Salvar roteiro")}</button>
            </div>
            {asText ? <pre className="wys-prompt-box episode-text">{toEngineText(script, episode.number)}</pre> : script.scenes.map((scene, s) => (
              <div key={s} className="episode-scene">
                <div className="episode-scene-head">
                  <span>{t("Cena")} {s + 1}</span>
                  <select value={scene.place} onChange={(e) => update({ ...script, scenes: script.scenes.map((x, i) => (i === s ? { ...x, place: e.target.value } : x)) })}>
                    {[...new Set([...STORY_PLACES, scene.place])].map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                  <select value={scene.time} onChange={(e) => update({ ...script, scenes: script.scenes.map((x, i) => (i === s ? { ...x, time: e.target.value as "dia" | "noite" } : x)) })}>
                    <option value="dia">{t("dia")}</option><option value="noite">{t("noite")}</option>
                  </select>
                </div>
                {scene.lines.map((line, l) => {
                  const lineIssues = issues.filter((i) => i.scene === s && i.line === l);
                  return (
                    <div key={l} className={`episode-line ${lineIssues.length ? "bad" : ""}`}>
                      <select value={line.who} aria-label={t("Personagem")} onChange={(e) => setLine(s, l, { who: e.target.value })}>
                        {[...new Set([...cast, NARRATOR, line.who])].map((n) => <option key={n} value={n}>{n}</option>)}
                      </select>
                      <select value={line.mood ?? ""} aria-label={t("Humor")} onChange={(e) => setLine(s, l, { mood: e.target.value || undefined })}>
                        <option value="">—</option>
                        {[...new Set([...STORY_MOODS, ...(line.mood ? [line.mood] : [])])].map((m) => <option key={m} value={m}>{m}</option>)}
                      </select>
                      <input value={line.text} maxLength={300} aria-label={t("Fala")} onChange={(e) => setLine(s, l, { text: e.target.value })} />
                      <span className="episode-line-tools">
                        <button type="button" title={t("Reescrever esta fala")} disabled={!!busy} onClick={() => void lineAction(s, l, "Reescreva esta fala")}><Wand2 size={12} /></button>
                        <button type="button" title={t("Deixar mais engraçado")} disabled={!!busy} onClick={() => void lineAction(s, l, "Deixe a fala mais engraçada")}><Laugh size={12} /></button>
                        <button type="button" title={t("Encurtar")} disabled={!!busy} onClick={() => void lineAction(s, l, "Encurte a fala")}><Scissors size={12} /></button>
                        <button type="button" title={t("Subir")} onClick={() => moveLine(s, l, -1)}><ArrowUp size={12} /></button>
                        <button type="button" title={t("Descer")} onClick={() => moveLine(s, l, 1)}><ArrowDown size={12} /></button>
                        <button type="button" title={t("Remover fala")} onClick={() => update({ ...script, scenes: script.scenes.map((x, i) => (i === s ? { ...x, lines: x.lines.filter((_, j) => j !== l) } : x)).filter((x) => x.lines.length) })}><Trash2 size={12} /></button>
                      </span>
                      {lineIssues.map((i) => <small key={i.message} className="episode-issue">{i.message} {i.fix}</small>)}
                    </div>
                  );
                })}
                <button type="button" className="ig-link" onClick={() => update({ ...script, scenes: script.scenes.map((x, i) => (i === s ? { ...x, lines: [...x.lines, { who: cast[0] ?? NARRATOR, text: "…" }] } : x)) })}><Plus size={12} /> {t("fala")}</button>
              </div>
            ))}
            {!asText && <button type="button" className="ig-link" onClick={() => update({ ...script, scenes: [...script.scenes, { place: "quarto", time: "dia", lines: [{ who: NARRATOR, text: "…" }] }] })}><Plus size={12} /> {t("cena")}</button>}
            {issues.filter((i) => i.line === undefined).map((i) => <p key={i.message} className="episode-issue">{i.message} {i.fix}</p>)}
            <div className="episode-change">
              <input value={change} placeholder={t("O que mudar no roteiro?")} onChange={(e) => setChange(e.target.value)} />
              <button type="button" className="studio-secondary-button" disabled={!change.trim() || !!busy} onClick={() => void write(change).then(() => setChange(""))}>{t("Mudar")}</button>
              <button type="button" className="studio-secondary-button" disabled={!!busy} onClick={() => void write("Escreva outro final, com outro gancho.")}>{t("Outro final")}</button>
            </div>
          </section>
          <aside className="episode-preview">
            {output ? <ExportedVideoPlayer key={output} path={output} /> : <div className="episode-preview-empty"><BookOpen size={28} /><span>{t("A prévia aparece aqui depois de gerar.")}</span></div>}
            <button type="button" className="studio-primary-button" disabled={!!busy || issues.some((i) => i.line !== undefined || !/dura/.test(i.message))}
              title={issues.length ? t("Corrija os pontos marcados no roteiro.") : ""} onClick={() => void generate()}>
              <Sparkles size={15} /> {t(busy === "generate" ? "Gravando as vozes…" : busy === "render" ? "Finalizando o vídeo…" : output ? "Gerar de novo" : "Gerar episódio")}
            </button>
            {output && <>
              <button type="button" className="studio-secondary-button" onClick={() => setPost(!post)}>{t("Postar")}</button>
              <button type="button" className="studio-secondary-button" disabled={!!pilotNote} onClick={() => void studioRequest<{ scheduled: { at: string }[] }>("addToReelPilot", { video: output, caption, title: `Ep. ${episode.number} · ${script.title}`, confirm: true }).then((r) => setPilotNote(`${t("No piloto:")} ${new Date(r.scheduled[0].at).toLocaleString()}`), (reason) => setError(errorText(reason)))}>{t("Colocar no piloto automático")}</button>
              {pilotNote && <p className="pilot-notice">{pilotNote} <button type="button" className="ig-link" onClick={onPilot}>{t("Ver calendário")}</button></p>}
              {post && <InstagramActions video={output} initialCaption={caption} onConnect={onConnect} />}
            </>}
            <small className="reel-hint">{episodes.length > 1 ? t("O resumo dos episódios anteriores entra no pedido à IA para manter a continuidade.") : ""}</small>
          </aside>
        </div>
      )}
    </div>
  );
}

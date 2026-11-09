import { useCallback, useEffect, useState } from "react";
import { Clapperboard, Copy, FolderOpen, Mic, Palette, Rocket, Send, Sparkles, X } from "lucide-react";
import type { AppSnapshot } from "../shared/types";
import { useDialogKeyboard } from "../lib/useDialogKeyboard";
import { BrandSettings } from "./studio/BrandSettings";
import { VoiceSettings } from "./studio/VoiceSettings";
import { PublishSettings } from "./studio/PublishSettings";

type Tab = "start" | "brand" | "voices" | "films" | "publish";
interface Format { id: string; name: string; aspect: string; length: string; goodFor: string }
interface Film { id: string; name: string; size: string; format?: string; path: string; createdAt: string }

const GOALS = [
  ["saas", "Divulgar meu SaaS ou app", "um Reels que faça a pessoa querer testar o meu produto"],
  ["servico", "Vender consultoria ou serviço", "um Reels que gere conversas e pedidos de orçamento"],
  ["autoridade", "Conteúdo de autoridade", "um Reels que ensine algo do meu nicho e gere salvamentos"],
] as const;
const api = <T,>(method: string, params?: unknown) => window.cutroom!.request<T>(method, params);

export function StudioPanel({ state, run, onClose, initial }: { state: AppSnapshot; run: (m: string, p?: unknown) => Promise<void>; onClose: () => void; initial?: Tab }) {
  useDialogKeyboard(true, onClose);
  const [tab, setTab] = useState<Tab>(initial ?? "start");
  useEffect(() => {
    if (initial) setTab(initial); // open_studio / menu while the panel is already open
  }, [initial]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const guard = useCallback(async (work: () => Promise<unknown>, ok?: string) => {
    setError("");
    setNotice("");
    try {
      await work();
      if (ok) setNotice(ok);
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(e));
    }
  }, []);

  // ---- Começar ----
  const [formats, setFormats] = useState<Format[]>([]);
  const [goal, setGoal] = useState<(typeof GOALS)[number][0]>("saas");
  const [format, setFormat] = useState("professor");
  const [extra, setExtra] = useState("");
  useEffect(() => void api<{ formats: Format[] }>("listFormats").then((r) => setFormats(r.formats), () => undefined), []);
  const chosen = formats.find((f) => f.id === format);
  const goalText = GOALS.find((g) => g[0] === goal)![2];
  const prompt = `Use o formato "${chosen?.name ?? format}" do CutRoom (get_format_guide{id:"${format}"}) para criar ${goalText}, com a minha marca (get_brand).${extra.trim() ? ` ${extra.trim()}` : ""} Mostre o roteiro antes de gerar a voz, revise com film_review e renderize com render_film.`;

  // ---- Filmes ----
  const [films, setFilms] = useState<Film[]>([]);
  const [playing, setPlaying] = useState<{ id: string; url: string } | null>(null);
  const play = (id: string) =>
    void guard(async () => {
      if (playing?.id === id) return setPlaying(null);
      const r = await api<{ path: string | null }>("latestFilmRender", { id });
      if (!r.path) throw new Error("Este filme ainda não foi renderizado. Clique em Renderizar.");
      setPlaying({ id, url: window.cutroom!.mediaUrl(r.path) });
    });
  useEffect(() => {
    if (tab === "films") void api<{ films: Film[] }>("listFilms").then((r) => setFilms(r.films), () => undefined);
  }, [tab, state.jobs.length]);
  const busy = state.jobs.some((j) => j.status === "running");

  return (
    <div className="modal-backdrop">
      <div className="modal studio-panel" role="dialog" aria-modal="true" aria-labelledby="studio-title">
        <button type="button" className="icon-button modal-close" aria-label="Fechar estúdio" onClick={onClose}>
          <X size={18} />
        </button>
        <h2 id="studio-title">Estúdio de vídeos</h2>
        <nav className="studio-tabs" role="tablist">
          {(
            [
              ["start", "Começar", Sparkles],
              ["brand", "Marca", Palette],
              ["voices", "Vozes", Mic],
              ["films", "Filmes", Clapperboard],
              ["publish", "Publicar", Rocket],
            ] as const
          ).map(([id, label, Icon]) => (
            <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>
              <Icon size={14} /> {label}
            </button>
          ))}
        </nav>
        {error && <p className="studio-error" role="alert">{error}</p>}
        {notice && <p className="studio-notice">{notice}</p>}

        {tab === "start" && (
          <section className="studio-section">
            <p className="studio-lead">Escolha o objetivo e o formato. O agente escreve o roteiro, grava a voz, monta o filme em código e renderiza no seu computador.</p>
            <div className="studio-label">Objetivo</div>
            <div className="studio-choices">
              {GOALS.map(([id, label]) => (
                <button key={id} className={goal === id ? "choice active" : "choice"} onClick={() => setGoal(id)}>{label}</button>
              ))}
            </div>
            <div className="studio-label">Formato</div>
            <div className="studio-formats">
              {formats.map((f) => (
                <button key={f.id} className={format === f.id ? "format-card active" : "format-card"} onClick={() => setFormat(f.id)}>
                  <strong>{f.name}</strong>
                  <span>{f.aspect} · {f.length}</span>
                  <small>{f.goodFor}</small>
                </button>
              ))}
            </div>
            <label className="field">
              Detalhes (opcional)
              <textarea rows={2} maxLength={800} value={extra} placeholder="Ex.: falar do teste grátis de 7 dias; usar o print da tela de relatórios." onChange={(e) => setExtra(e.target.value)} />
            </label>
            <div className="studio-actions">
              <button
                className="button primary"
                disabled={state.connection.status !== "connected"}
                title={state.connection.status !== "connected" ? "Conecte uma IA no assistente" : undefined}
                onClick={() => void guard(async () => { await run("sendChat", { text: prompt, displayText: `Criar vídeo: ${chosen?.name ?? format}` }); onClose(); })}
              >
                <Send size={13} /> Pedir ao assistente
              </button>
              <button className="button" onClick={() => void guard(() => navigator.clipboard.writeText(prompt), "Pedido copiado. Cole no Claude Code ou no Codex com o CutRoom conectado.")}>
                <Copy size={13} /> Copiar para Claude Code/Codex
              </button>
              <button className="button" onClick={() => void guard(async () => { const r = await api<{ files: string[] }>("installAgentSkill"); setNotice(`Skill instalada: ${r.files.join(" · ")}`); })}>
                Instalar Skill nos agentes
              </button>
            </div>
          </section>
        )}

        {tab === "brand" && <BrandSettings />}

        {tab === "voices" && <VoiceSettings packages={state.packages} jobs={state.jobs} run={run} />}

        {tab === "films" && (
          <section className="studio-section">
            {playing && <video className="studio-player" src={playing.url} controls autoPlay playsInline />}
            <p className="studio-lead">Filmes criados pelo agente em Vídeos/CutRoom/filmes. Cada pasta é um projeto que você pode abrir e editar.</p>
            {!films.length && <p className="studio-empty">Nenhum filme ainda. Comece pela aba Começar.</p>}
            <ul className="studio-list">
              {films.map((f) => (
                <li key={f.id}>
                  <div><strong>{f.name}</strong><small>{f.format ?? "livre"} · {f.size} · {new Date(f.createdAt).toLocaleDateString("pt-BR")}</small></div>
                  <button className="button small" onClick={() => play(f.id)}>{playing?.id === f.id ? "Fechar" : "▶ Assistir"}</button>
                  <button className="button small" onClick={() => void guard(() => api("openFilmFolder", { id: f.id }))}><FolderOpen size={12} /> Pasta</button>
                  <button className="button small" disabled={busy} onClick={() => void guard(async () => { const r = await api<{ status: string; output?: string; errors?: string[] }>("renderFilm", { id: f.id }); setNotice(r.status === "done" ? `Pronto: ${r.output}` : r.status === "blocked" ? `Corrija antes: ${r.errors?.join(" ")}` : "Renderizando… acompanhe a barra de tarefas."); })}>Renderizar</button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {tab === "publish" && <PublishSettings jobs={state.jobs} />}
      </div>
    </div>
  );
}

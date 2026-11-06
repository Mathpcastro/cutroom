import { useCallback, useEffect, useState } from "react";
import { Clapperboard, Copy, FolderOpen, Mic, Palette, Rocket, Send, Sparkles, X } from "lucide-react";
import type { AppSnapshot } from "../shared/types";
import { useDialogKeyboard } from "../lib/useDialogKeyboard";

type Tab = "start" | "brand" | "voices" | "films" | "publish";
interface Format { id: string; name: string; aspect: string; length: string; goodFor: string }
interface Brand { name: string; handle?: string; context: string; website?: string; logo?: string; palette: { accent: string; ink: string; paper: string }; source: "manual" | "carrossell" }
interface Voice { id: string; name: string; language?: string; description?: string }
interface Account { id: string; username?: string; igUserId?: string }
interface Film { id: string; name: string; size: string; format?: string; path: string; createdAt: string }
interface VideoFile { path: string; name: string; size: number; modifiedAt: string }

const GOALS = [
  ["saas", "Divulgar meu SaaS ou app", "um Reels que faça a pessoa querer testar o meu produto"],
  ["servico", "Vender consultoria ou serviço", "um Reels que gere conversas e pedidos de orçamento"],
  ["autoridade", "Conteúdo de autoridade", "um Reels que ensine algo do meu nicho e gere salvamentos"],
] as const;
const PROVIDERS = [
  ["kokoro", "Kokoro (offline, sem créditos)"],
  ["elevenlabs", "ElevenLabs (chave própria)"],
  ["openai", "OpenAI (chave própria)"],
  ["local", "Voz do computador"],
] as const;
const api = <T,>(method: string, params?: unknown) => window.cutroom!.request<T>(method, params);
const EMPTY_BRAND: Brand = { name: "", context: "", palette: { accent: "#E8462F", ink: "#1E1C1A", paper: "#EBE7E1" }, source: "manual" };

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

  // ---- Marca ----
  const [brand, setBrand] = useState<Brand>(EMPTY_BRAND);
  const [profiles, setProfiles] = useState<{ id: string; name: string }[] | null>(null);
  useEffect(() => {
    if (tab === "brand") void api<{ brand: Brand | null }>("getBrand").then((r) => r.brand && setBrand(r.brand), () => undefined);
  }, [tab]);
  const setPalette = (key: keyof Brand["palette"], value: string) => setBrand({ ...brand, palette: { ...brand.palette, [key]: value } });

  // ---- Vozes ----
  const [voice, setVoice] = useState<{ keys: Record<string, boolean>; preferences: { provider?: string; voices?: Record<string, string> }; kokoroAvailable: boolean; localAvailable: boolean } | null>(null);
  const [provider, setProvider] = useState("kokoro");
  const [voices, setVoices] = useState<Voice[]>([]);
  const [keyInput, setKeyInput] = useState("");
  const loadVoices = useCallback(async (p: string) => {
    setVoices([]);
    try {
      setVoices((await api<{ voices: Voice[] }>("listVoices", { provider: p })).voices);
    } catch {
      /* Provider not configured yet: the form explains what to do. */
    }
  }, []);
  useEffect(() => {
    if (tab !== "voices") return;
    void api<typeof voice>("getVoiceSettings").then((v) => {
      setVoice(v);
      const p = v?.preferences.provider ?? (v?.kokoroAvailable ? "kokoro" : "elevenlabs");
      setProvider(p);
      void loadVoices(p);
    });
  }, [tab, loadVoices, state.packages]);
  const kokoroPackage = state.packages.find((p) => p.id === "kokoro-voice");

  // ---- Filmes ----
  const [films, setFilms] = useState<Film[]>([]);
  useEffect(() => {
    if (tab === "films") void api<{ films: Film[] }>("listFilms").then((r) => setFilms(r.films), () => undefined);
  }, [tab, state.jobs.length]);

  // ---- Publicar ----
  const [pub, setPub] = useState<{ hasKey: boolean; accounts: Account[]; defaultAccount?: string; history: { permalink: string; username: string; publishedAt: string }[] } | null>(null);
  const [videos, setVideos] = useState<VideoFile[]>([]);
  const [video, setVideo] = useState("");
  const [caption, setCaption] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [composioKey, setComposioKey] = useState("");
  useEffect(() => {
    if (tab !== "publish") return;
    void api<typeof pub>("getPublishSettings").then(setPub, () => undefined);
    void api<{ videos: VideoFile[] }>("listVideos").then((r) => {
      setVideos(r.videos);
      setVideo((v) => v || r.videos[0]?.path || "");
    }, () => undefined);
  }, [tab]);
  const account = pub?.accounts.find((a) => a.id === pub.defaultAccount);
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

        {tab === "brand" && (
          <section className="studio-section">
            <p className="studio-lead">Os vídeos usam o nome, o tom, a oferta e as cores daqui. Importe do Carrossell ou preencha à mão.</p>
            <div className="studio-actions">
              <button className="button" onClick={() => void guard(async () => setProfiles((await api<{ profiles: { id: string; name: string }[] }>("carrossellProfiles")).profiles))}>Importar do Carrossell</button>
              {profiles?.map((p) => (
                <button key={p.id} className="button small" onClick={() => void guard(async () => { setBrand((await api<{ brand: Brand }>("importCarrossellBrand", { profileId: p.id })).brand); setProfiles(null); }, `Marca importada do perfil ${p.name}.`)}>
                  {p.name}
                </button>
              ))}
            </div>
            <div className="field-pair">
              <label className="field">Nome da marca<input value={brand.name} maxLength={200} onChange={(e) => setBrand({ ...brand, name: e.target.value })} /></label>
              <label className="field">@ do Instagram<input value={brand.handle ?? ""} maxLength={100} onChange={(e) => setBrand({ ...brand, handle: e.target.value })} /></label>
            </div>
            <label className="field">
              O que vende, para quem, tom e oferta
              <textarea rows={5} value={brand.context} maxLength={60000} placeholder="Ex.: App de agenda para clínicas de estética. Tom direto e leve. Oferta: 7 dias grátis." onChange={(e) => setBrand({ ...brand, context: e.target.value })} />
            </label>
            <label className="field">Site<input value={brand.website ?? ""} maxLength={500} placeholder="https://" onChange={(e) => setBrand({ ...brand, website: e.target.value })} /></label>
            <div className="studio-colors">
              {(["accent", "ink", "paper"] as const).map((k) => (
                <label key={k} className="field color-field">
                  {k === "accent" ? "Destaque" : k === "ink" ? "Texto" : "Fundo"}
                  <input type="color" value={brand.palette[k]} onChange={(e) => setPalette(k, e.target.value)} />
                </label>
              ))}
              <label className="field">
                Logo (PNG, JPG, WebP ou SVG)
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = () => setBrand({ ...brand, logo: String(reader.result) });
                    reader.readAsDataURL(file);
                  }}
                />
              </label>
              {brand.logo && <img className="studio-logo" src={brand.logo} alt="Logo da marca" />}
            </div>
            <div className="studio-actions">
              <button className="button primary" onClick={() => void guard(async () => setBrand((await api<{ brand: Brand }>("saveBrand", { ...brand, source: brand.source ?? "manual" })).brand), "Marca salva.")}>Salvar marca</button>
            </div>
          </section>
        )}

        {tab === "voices" && (
          <section className="studio-section">
            <p className="studio-lead">A narração dos vídeos. O Kokoro roda no seu computador, sem internet e sem créditos. ElevenLabs e OpenAI usam a sua chave (o custo é da sua conta).</p>
            <label className="field">
              Provedor padrão
              <select value={provider} onChange={(e) => { setProvider(e.target.value); setKeyInput(""); void loadVoices(e.target.value); }}>
                {PROVIDERS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
              </select>
            </label>
            {provider === "kokoro" && !voice?.kokoroAvailable && (
              <div className="studio-box">
                <p>A Voz Kokoro ainda não está instalada (≈ 230 MB, download único).</p>
                <button className="button primary" disabled={busy || kokoroPackage?.status === "installing"} onClick={() => void guard(() => run("installPackage", { id: "kokoro-voice" }), "Voz Kokoro instalada.")}>
                  {kokoroPackage?.status === "installing" ? "Instalando…" : "Instalar Voz Kokoro"}
                </button>
              </div>
            )}
            {(provider === "elevenlabs" || provider === "openai") && (
              <div className="studio-box">
                <p>{voice?.keys[`voice.${provider}`] ? "Chave cadastrada (guardada cifrada neste computador)." : "Cole a sua chave de API. Ela fica cifrada no seu computador e nunca vai para o chat."}</p>
                <div className="field-pair">
                  <input type="password" autoComplete="off" value={keyInput} placeholder={provider === "elevenlabs" ? "Chave da ElevenLabs" : "Chave da OpenAI (sk-…)"} onChange={(e) => setKeyInput(e.target.value)} />
                  <button className="button" disabled={!keyInput.trim()} onClick={() => void guard(async () => { setVoice(await api("setVoiceKey", { provider, key: keyInput })); setKeyInput(""); await loadVoices(provider); }, "Chave salva.")}>Salvar</button>
                  {voice?.keys[`voice.${provider}`] && <button className="button" onClick={() => void guard(async () => setVoice(await api("setVoiceKey", { provider })), "Chave removida.")}>Remover</button>}
                </div>
              </div>
            )}
            {voices.length > 0 && (
              <label className="field">
                Voz padrão
                <select
                  value={voice?.preferences.voices?.[provider] ?? ""}
                  onChange={(e) => void guard(async () => { await api("setVoicePreferences", { provider, voices: { ...(voice?.preferences.voices ?? {}), [provider]: e.target.value } }); setVoice(await api("getVoiceSettings")); }, "Voz padrão salva.")}
                >
                  <option value="">Escolha…</option>
                  {voices.map((v) => <option key={v.id} value={v.id}>{v.name}{v.language ? ` · ${v.language}` : ""}{v.description ? ` — ${v.description}` : ""}</option>)}
                </select>
              </label>
            )}
            <div className="studio-actions">
              <button className="button primary" onClick={() => void guard(async () => { await api("setVoicePreferences", { provider }); setVoice(await api("getVoiceSettings")); }, "Provedor padrão salvo.")}>Usar este provedor</button>
            </div>
          </section>
        )}

        {tab === "films" && (
          <section className="studio-section">
            <p className="studio-lead">Filmes criados pelo agente em Vídeos/CutRoom/filmes. Cada pasta é um projeto que você pode abrir e editar.</p>
            {!films.length && <p className="studio-empty">Nenhum filme ainda. Comece pela aba Começar.</p>}
            <ul className="studio-list">
              {films.map((f) => (
                <li key={f.id}>
                  <div><strong>{f.name}</strong><small>{f.format ?? "livre"} · {f.size} · {new Date(f.createdAt).toLocaleDateString("pt-BR")}</small></div>
                  <button className="button small" onClick={() => void guard(() => api("openFilmFolder", { id: f.id }))}><FolderOpen size={12} /> Pasta</button>
                  <button className="button small" disabled={busy} onClick={() => void guard(async () => { const r = await api<{ status: string; output?: string; errors?: string[] }>("renderFilm", { id: f.id }); setNotice(r.status === "done" ? `Pronto: ${r.output}` : r.status === "blocked" ? `Corrija antes: ${r.errors?.join(" ")}` : "Renderizando… acompanhe a barra de tarefas."); })}>Renderizar</button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {tab === "publish" && (
          <section className="studio-section">
            <p className="studio-lead">Publica Reels no Instagram pelo Composio, com a chave do seu projeto. Use a mesma chave do Carrossell: as contas já conectadas lá aparecem aqui.</p>
            <div className="studio-box">
              <p>{pub?.hasKey ? "Chave do Composio cadastrada (cifrada neste computador)." : "Cole a chave do PROJETO do Composio (composio.dev › Settings › Project Settings › API Keys)."}</p>
              <div className="field-pair">
                <input type="password" autoComplete="off" value={composioKey} placeholder="Chave do projeto Composio" onChange={(e) => setComposioKey(e.target.value)} />
                <button className="button" disabled={!composioKey.trim()} onClick={() => void guard(async () => { setPub(await api("setComposioKey", { key: composioKey })); setComposioKey(""); }, "Chave salva e contas atualizadas.")}>Salvar</button>
                {pub?.hasKey && <button className="button" onClick={() => void guard(async () => setPub(await api("refreshInstagram")), "Contas atualizadas.")}>Atualizar contas</button>}
              </div>
            </div>
            {!!pub?.accounts.length && (
              <label className="field">
                Conta
                <select value={pub.defaultAccount ?? ""} onChange={(e) => void guard(async () => setPub(await api("setDefaultInstagram", { id: e.target.value })))}>
                  {pub.accounts.map((a) => <option key={a.id} value={a.id}>@{a.username}</option>)}
                </select>
              </label>
            )}
            <label className="field">
              Vídeo
              <select value={video} onChange={(e) => { setVideo(e.target.value); setConfirmed(false); }}>
                {videos.map((v) => <option key={v.path} value={v.path}>{v.name}</option>)}
              </select>
            </label>
            <label className="field">
              Legenda
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
              {video && <button className="button" onClick={() => void guard(() => api("revealVideo", { path: video }))}>Mostrar o vídeo</button>}
            </div>
            {!!pub?.history.length && (
              <ul className="studio-list">
                {pub.history.map((h) => <li key={h.publishedAt}><div><strong>@{h.username}</strong><small>{new Date(h.publishedAt).toLocaleString("pt-BR")} · {h.permalink}</small></div></li>)}
              </ul>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

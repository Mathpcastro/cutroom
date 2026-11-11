import { useEffect, useMemo, useState } from "react";
import { MoreHorizontal, Play, X } from "lucide-react";
import type { StudioProfile } from "../../shared/profile";
import { t, getStudioLanguage } from "./studioLanguage";
import { studioRequest } from "./salesReels";
import { findReelByExport } from "./reelRecords";
import { titleFromFile } from "./AutoPilot";
import { InstagramActions } from "./InstagramActions";
import type { StudioProject } from "./StudioHome";

/**
 * Spec 4 E: Projetos + Vídeos exportados in one place ("Meus Reels"), with a horizontal menu:
 * the project list (state + main action) and a visual library of the exported videos.
 */

export type ReelState = "Rascunho" | "Pronto" | "Agendado" | "Publicado";
export interface ReelRow { key: string; title: string; state: ReelState; date?: string; filmId?: string; video?: string; permalink?: string }

interface Settings { scheduled?: { video: string; status: string; at: string }[]; history: { video: string; permalink: string; publishedAt: string }[] }
interface Video { path: string; name: string; modifiedAt: string }

/** Pure: merges projects, exported MP4s (agents' too), the queue and the history. */
export function reelRows(profileId: string | undefined, projects: StudioProject[], videos: Video[], settings: Settings | undefined): ReelRow[] {
  const published = new Map((settings?.history ?? []).map((h) => [h.video, h]));
  const scheduled = new Set((settings?.scheduled ?? []).filter((s) => s.status === "scheduled" || s.status === "publishing").map((s) => s.video));
  const state = (video?: string): ReelState => (!video ? "Rascunho" : published.has(video) ? "Publicado" : scheduled.has(video) ? "Agendado" : "Pronto");
  const rows: ReelRow[] = [];
  const used = new Set<string>();
  for (const project of projects) {
    const video = profileId ? videos.find((v) => findReelByExport(profileId, v.path)?.filmId === project.id) : undefined;
    if (video) used.add(video.path);
    rows.push({
      key: project.id,
      title: project.name,
      state: video ? state(video.path) : "Rascunho",
      date: project.createdAt,
      filmId: project.id,
      video: video?.path,
      permalink: video ? published.get(video.path)?.permalink : undefined,
    });
  }
  // MP4s made outside this profile's flow (MCP agents, the advanced editor) still show up.
  for (const video of videos) {
    if (used.has(video.path)) continue;
    rows.push({ key: video.path, title: titleFromFile(video.path), state: state(video.path), date: video.modifiedAt, video: video.path, permalink: published.get(video.path)?.permalink });
  }
  return rows.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
}

const action: Record<ReelState, string> = { Rascunho: "Revisar", Pronto: "Postar", Agendado: "Ver no calendário", Publicado: "Ver no Instagram" };
const badge = (state: ReelState) => (state === "Publicado" ? "published" : state === "Agendado" ? "scheduled" : state === "Pronto" ? "ready" : "");

function useVideoUrl(path?: string) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    if (!path) return;
    let alive = true;
    studioRequest<{ url: string }>("previewExportedVideo", { path }).then(({ url }) => alive && setSrc(url), () => undefined);
    return () => { alive = false; };
  }, [path]);
  return src;
}

function VideoCard({ row, onOpen }: { row: ReelRow; onOpen: () => void }) {
  const src = useVideoUrl(row.video);
  return (
    <button type="button" className="video-card" onClick={onOpen} title={row.title}>
      <span className="video-card-media">
        {src && <video src={`${src}#t=1`} preload="metadata" muted playsInline
          onMouseEnter={(e) => void e.currentTarget.play().catch(() => undefined)}
          onMouseLeave={(e) => { e.currentTarget.pause(); e.currentTarget.currentTime = 1; }} />}
        <span className={`pilot-badge ${badge(row.state)}`}>{t(row.state)}</span>
        <span className="video-card-play" aria-hidden="true"><Play size={14} /></span>
      </span>
      <strong>{row.title}</strong>
      {row.date && <small>{new Date(row.date).toLocaleDateString(getStudioLanguage())}</small>}
    </button>
  );
}

function VideoViewer({ row, onClose, onConnect, onPilot }: { row: ReelRow; onClose: () => void; onConnect: () => void; onPilot: () => void }) {
  const src = useVideoUrl(row.video);
  const [post, setPost] = useState(false);
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);
  return (
    <div className="video-viewer" role="dialog" aria-label={row.title}>
      {src ? <video src={src} controls autoPlay playsInline /> : <div />}
      <div className="video-viewer-side">
        <header>
          <strong>{row.title}</strong>
          <button type="button" aria-label={t("Fechar")} onClick={onClose}><X size={18} /></button>
        </header>
        <span className={`pilot-badge ${badge(row.state)}`}>{t(row.state)}</span>
        {row.state === "Pronto" && <>
          <button type="button" className="studio-primary-button" onClick={() => setPost(!post)}>{t("Postar no Instagram")}</button>
          <button type="button" className="studio-secondary-button" onClick={onPilot}>{t("Colocar no piloto automático")}</button>
        </>}
        {row.state === "Agendado" && <button type="button" className="studio-secondary-button" onClick={onPilot}>{t("Ver no calendário")}</button>}
        {row.permalink && <button type="button" className="studio-secondary-button" onClick={() => void studioRequest("openInstagramPost", { permalink: row.permalink })}>{t("Ver no Instagram")}</button>}
        <button type="button" className="ig-link" onClick={() => void studioRequest("revealVideo", { path: row.video })}>{t("Mostrar o MP4 na pasta")}</button>
        {post && row.video && <InstagramActions video={row.video} initialCaption="" onConnect={onConnect} />}
      </div>
    </div>
  );
}

export function MyReels({ profile, projects, onOpen, onPilot, onCreate, onConnect, initialTab = "projects" }: {
  profile: StudioProfile | null;
  projects: StudioProject[];
  onOpen: (filmId: string) => void;
  onPilot: () => void;
  onCreate: () => void;
  onConnect: () => void;
  initialTab?: "projects" | "library";
}) {
  const [videos, setVideos] = useState<Video[]>([]);
  const [settings, setSettings] = useState<Settings>();
  const [tab, setTab] = useState<"projects" | "library">(initialTab);
  const [filter, setFilter] = useState<ReelState | "">("");
  const [menu, setMenu] = useState("");
  const [viewing, setViewing] = useState<ReelRow | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    Promise.all([studioRequest<{ videos: Video[] }>("listVideos"), studioRequest<Settings>("getPublishSettings")])
      .then(([v, s]) => { setVideos(v.videos ?? []); setSettings(s); }, (reason) => setError(String(reason)));
  }, []);
  const rows = useMemo(() => reelRows(profile?.id, projects, videos, settings), [profile?.id, projects, videos, settings]);
  const library = rows.filter((r) => r.video);
  const shown = (tab === "library" ? library : rows).filter((r) => !filter || r.state === filter);
  const main = (row: ReelRow) => {
    if (row.state === "Rascunho" && row.filmId) onOpen(row.filmId);
    else if (row.state === "Pronto" && row.video) setViewing(row);
    else if (row.state === "Agendado") onPilot();
    else if (row.permalink) void studioRequest("openInstagramPost", { permalink: row.permalink });
  };
  return (
    <div className="reels-v2">
      <div className="reels-head">
        <h1>{t("Meus Reels")}</h1>
        <div className="reels-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === "projects"} onClick={() => setTab("projects")}>{t("Projetos")} <small>{rows.length}</small></button>
          <button type="button" role="tab" aria-selected={tab === "library"} onClick={() => setTab("library")}>{t("Biblioteca de vídeos")} <small>{library.length}</small></button>
        </div>
        <div className="reels-filters" role="group" aria-label={t("Filtrar")}>
          {(["", "Rascunho", "Pronto", "Agendado", "Publicado"] as const).filter((s) => tab === "projects" || s !== "Rascunho").map((s) => (
            <button key={s || "all"} type="button" aria-pressed={filter === s} onClick={() => setFilter(s)}>{t(s || "Todos")}</button>
          ))}
        </div>
      </div>
      {error && <p className="reel-error" role="alert">{error}</p>}
      <div className="reels-scroll">
        {!rows.length && (
          <div className="studio-library-empty">
            <h2>{t("Você ainda não criou nenhum Reels")}</h2>
            <button type="button" className="studio-primary-button" onClick={onCreate}>{t("Criar meu primeiro Reels")}</button>
          </div>
        )}
        {tab === "library" ? (
          <div className="video-library">
            {shown.map((row) => <VideoCard key={row.key} row={row} onOpen={() => setViewing(row)} />)}
          </div>
        ) : (
          <ul className="my-reels">
            {shown.map((row) => (
              <li key={row.key}>
                <span className={`pilot-badge ${badge(row.state)}`}>{t(row.state)}</span>
                <span className="pilot-item-text"><strong>{row.title}</strong>{row.date && <small> · {new Date(row.date).toLocaleDateString(getStudioLanguage())}</small>}</span>
                <button type="button" className="studio-secondary-button" onClick={() => main(row)}>{t(action[row.state])}</button>
                <span className="my-reels-more">
                  <button type="button" aria-label={t("Mais")} aria-expanded={menu === row.key} onClick={() => setMenu(menu === row.key ? "" : row.key)}><MoreHorizontal size={15} /></button>
                  {menu === row.key && (
                    <span className="my-reels-menu" role="menu">
                      {row.filmId && <button type="button" role="menuitem" onClick={() => onOpen(row.filmId!)}>{t("Abrir e ajustar")}</button>}
                      {row.video && <button type="button" role="menuitem" onClick={() => { setMenu(""); setViewing(row); }}>{t("Assistir")}</button>}
                      {row.video && <button type="button" role="menuitem" onClick={() => void studioRequest("revealVideo", { path: row.video })}>{t("Mostrar o MP4 na pasta")}</button>}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {viewing && <VideoViewer row={viewing} onClose={() => setViewing(null)} onConnect={onConnect} onPilot={onPilot} />}
    </div>
  );
}

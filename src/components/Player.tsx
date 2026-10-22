import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Clapperboard,
  ChevronDown,
  Expand,
  FolderOpen,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from "lucide-react";
import { Menu } from "./Menu";
import type { Project } from "../shared/types";
import { duration, locateClip, timecode } from "../lib/editor";
import { OverlayPreview } from "./OverlayPreview";
import { CaptionPreview } from "./CaptionPreview";
import { MotionPreview } from "./MotionPreview";
import { videoLookCss, wipeProgress } from "../shared/video-looks";

interface Props {
  project: Project;
  time: number;
  setTime: (time: number) => void;
  playing: boolean;
  setPlaying: (playing: boolean) => void;
  importMedia: () => void;
  desktop: boolean;
}
export function Player({
  project,
  time,
  setTime,
  playing,
  setPlaying,
  importMedia,
  desktop,
}: Props) {
  const video = useRef<HTMLVideoElement>(null);
  const playRequest = useRef(0);
  const mounted = useRef(true);
  const viewport = useRef<HTMLDivElement>(null);
  const composition = useRef<HTMLDivElement>(null);
  const [previewWidth, setPreviewWidth] = useState(640);
  const [volumeMuted, setVolumeMuted] = useState(false);
  const [mediaError, setMediaError] = useState("");
  const repairAttempt = useRef(new Set<string>());
  const [repairing, setRepairing] = useState(false);
  const total = duration(project);
  const active = locateClip(project, time);
  const media = project.media.find((item) => item.id === active?.clip.mediaId);
  const source = media
    ? window.cutroom?.mediaUrl(media.proxy || media.path)
    : undefined;
  const sourceTime = active?.sourceTime ?? 0;
  const recoverPreview = async () => {
    if (
      !media ||
      !window.cutroom ||
      repairAttempt.current.has(media.id) ||
      repairing
    )
      return;
    repairAttempt.current.add(media.id);
    setPlaying(false);
    setRepairing(true);
    setMediaError("Preparando uma prévia compatível no seu computador…");
    try {
      await window.cutroom.request("repairPreview", { id: media.id });
      if (mounted.current) {
        video.current?.load();
        setMediaError("");
      }
    } catch (error) {
      if (mounted.current)
        setMediaError(
          `Não foi possível preparar a prévia: ${error instanceof Error ? error.message : String(error)}`,
        );
    } finally {
      if (mounted.current) setRepairing(false);
    }
  };
  const state = useRef({ active, time, playing, total });
  // Commit the playhead and any source seek together before the next paint.
  // Otherwise RAF can read a new clip with the previous clip's video time.
  useLayoutEffect(() => {
    state.current = { active, time, playing, total };
  });
  const seekVideo = (transition = false) => {
    const element = video.current;
    if (
      element &&
      Math.abs(element.currentTime - sourceTime) > (transition ? 0.015 : 0.15)
    )
      element.currentTime = sourceTime;
  };
  const requestPlayback = () => {
    const element = video.current;
    if (
      !element ||
      !state.current.playing ||
      !state.current.active ||
      state.current.total <= 0
    )
      return;
    const request = ++playRequest.current;
    void element.play().catch((error: unknown) => {
      // A seek, pause or source transition legitimately interrupts play().
      if (
        !mounted.current ||
        request !== playRequest.current ||
        !state.current.playing ||
        (error instanceof DOMException && error.name === "AbortError") ||
        (error as { name?: string })?.name === "AbortError"
      )
        return;
      setMediaError(
        `Não foi possível reproduzir: ${error instanceof Error ? error.message : String(error)}`,
      );
      setPlaying(false);
    });
  };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      ++playRequest.current;
    };
  }, []);
  useEffect(() => {
    setMediaError("");
  }, [source]);
  useLayoutEffect(() => {
    ++playRequest.current;
    const element = video.current;
    if (!element || !active) return;
    // Even a 50–100 ms removed pause must seek at a cut boundary. The normal
    // drift tolerance is intentionally larger and cannot be reused here.
    seekVideo(true);
    element.playbackRate = active.clip.speed;
    if (playing && total > 0) requestPlayback();
    else element.pause();
    return () => {
      ++playRequest.current;
    };
  }, [source, active?.clip.id, active?.clip.speed, playing]);
  useLayoutEffect(() => {
    const element = video.current;
    if (
      element &&
      (!playing || Math.abs(element.currentTime - sourceTime) > 0.45)
    )
      seekVideo();
  }, [time]);
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const tick = () => {
      const current = state.current;
      const element = video.current;
      if (
        element &&
        current.active &&
        !element.paused &&
        !element.seeking &&
        element.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
      ) {
        const clip = current.active.clip;
        const nextTime =
          current.active.offset +
          (element.currentTime - clip.start) / clip.speed;
        if (element.currentTime >= clip.end - 0.025) {
          const boundary =
            current.active.offset + (clip.end - clip.start) / clip.speed;
          if (boundary >= current.total - 0.03) {
            setTime(current.total);
            setPlaying(false);
          } else setTime(boundary + 0.001);
        } else if (Math.abs(current.time - nextTime) > 0.025)
          setTime(Math.max(0, nextTime));
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);
  const togglePlay = () => {
    if (time >= total - 0.03) setTime(0);
    setPlaying(!playing);
  };
  const overlays = project.overlays.filter(
    (item) => time >= item.start && time < item.end,
  );
  const cover = overlays.some((overlay) => overlay.kind === "cover");
  const zoom = active?.clip.zoom ?? 1;
  const cropX = Math.max(
    0,
    Math.min(zoom - 1, zoom * (active?.clip.focusX ?? 0.5) - 0.5),
  );
  const cropY = Math.max(
    0,
    Math.min(zoom - 1, zoom * (active?.clip.focusY ?? 0.5) - 0.5),
  );
  const renderScale = previewWidth / project.settings.width;
  useEffect(() => {
    if (!composition.current) return;
    const observer = new ResizeObserver((entries) =>
      setPreviewWidth(entries[0].contentRect.width),
    );
    observer.observe(composition.current);
    return () => observer.disconnect();
  }, [source]);
  return (
    <section className="player-section" aria-label="Prévia do vídeo">
      <div className="player-meta">
        <span>
          <span className="tiny-square" /> Prévia
        </span>
        <div>
          {media ? (
            <>
              <span>
                {media.width} × {media.height}
              </span>
              <span>{media.fps.toFixed(0)} fps</span>
            </>
          ) : (
            <span>Prévia em tempo real</span>
          )}
        </div>
      </div>
      <div
        className={`player-viewport ${media ? "has-media" : ""}`}
        ref={viewport}
      >
        {media && source ? (
          <div
            ref={composition}
            className="video-composition"
            style={{
              aspectRatio: `${project.settings.width}/${project.settings.height}`,
              maxHeight: "100%",
            }}
          >
            <video
              ref={video}
              src={source}
              playsInline
              muted={volumeMuted || active?.clip.muted}
              style={{
                objectFit: cover ? "cover" : "contain",
                transformOrigin: "0 0",
                filter: videoLookCss(active?.clip, previewWidth),
                transform: `${active?.clip.mirrored ? "translateX(100%) scaleX(-1) " : ""}translate(${-cropX * 100}%, ${-cropY * 100}%) scale(${zoom})`,
              }}
              onLoadedMetadata={() => {
                seekVideo();
                requestPlayback();
              }}
              onCanPlay={() => {
                setMediaError("");
                if (state.current.playing && video.current?.paused)
                  requestPlayback();
              }}
              onEnded={() => {
                const current = state.current;
                if (!current.active) return;
                const boundary =
                  current.active.offset +
                  (current.active.clip.end - current.active.clip.start) /
                    current.active.clip.speed;
                if (boundary < total - 0.03) setTime(boundary + 0.001);
                else {
                  setTime(total);
                  setPlaying(false);
                }
              }}
              onError={() => {
                const error = video.current?.error;
                if (!error || error.code === MediaError.MEDIA_ERR_ABORTED)
                  return;
                if (!repairAttempt.current.has(media.id)) void recoverPreview();
                else {
                  setMediaError(
                    `A prévia não pôde ser reproduzida (erro ${error.code}). ${error.message || "Reabra o projeto para tentar novamente."}`,
                  );
                  setPlaying(false);
                }
              }}
            />
            {active?.clip.look === "cinema" && (
              <div
                aria-hidden="true"
                style={{
                  position: "absolute",
                  inset: 0,
                  pointerEvents: "none",
                  zIndex: 2,
                  background:
                    "linear-gradient(to bottom,#000 0%,#000 11%,transparent 11%,transparent 89%,#000 89%,#000 100%)",
                }}
              />
            )}
            {active?.clip.look === "vignette" && (
              <div
                aria-hidden="true"
                style={{
                  position: "absolute",
                  inset: 0,
                  pointerEvents: "none",
                  zIndex: 2,
                  background:
                    "radial-gradient(ellipse at center,transparent 38%,rgba(0,0,0,.65) 100%)",
                }}
              />
            )}
            {active?.clip.look === "color-wipe" && (
              <div
                aria-hidden="true"
                data-video-wipe
                style={{
                  position: "absolute",
                  top: 0,
                  bottom: 0,
                  right: 0,
                  width: `${(1 - wipeProgress(active.clip, sourceTime)) * 100}%`,
                  pointerEvents: "none",
                  zIndex: 2,
                  backdropFilter: "grayscale(1) contrast(1.132075)",
                  background: "rgba(0,0,0,.001)",
                }}
              />
            )}
            {overlays.map((overlay) => (
              <OverlayPreview
                key={overlay.id}
                overlay={overlay}
                project={project}
                time={time}
                scale={renderScale}
              />
            ))}
            {active && active.clip.muted && active.clip.speed >= 4 && (
              <div
                className="timelapse-preview"
                style={{
                  color: project.settings.accent,
                  fontSize:
                    44 *
                    Math.min(
                      project.settings.width / 1920,
                      project.settings.height / 1080,
                    ) *
                    renderScale,
                }}
              >
                &gt;&gt; {active.clip.speed}x
              </div>
            )}
            <MotionPreview project={project} time={time} />
            {!active?.clip.muted && (
              <CaptionPreview project={project} time={time} />
            )}
          </div>
        ) : (
          <div className="empty-player">
            <div className="empty-frame">
              <span />
              <Clapperboard size={34} strokeWidth={1.15} />
              <span />
            </div>
            <h2>Importe seu vídeo</h2>
            <p>
              Arraste um arquivo para o editor
              <br />
              ou escolha um vídeo no computador.
            </p>
            <button
              className="button primary import-hero"
              disabled={!desktop}
              onClick={importMedia}
            >
              <FolderOpen size={15} /> Importar mídia
            </button>
            <span className="formats">MP4, MOV, MKV, WEBM e mais</span>
            {!desktop && (
              <span className="desktop-note">
                Abra o CutRoom desktop para acessar seus arquivos.
              </span>
            )}
          </div>
        )}
        {mediaError && (
          <div className="player-error" role="alert">
            {mediaError}
          </div>
        )}
        {media && <span className="source-name">{media.name}</span>}
      </div>
      <div className="player-transport">
        <div className="transport-left">
          <button
            className="icon-button"
            aria-label={volumeMuted ? "Ativar áudio" : "Silenciar prévia"}
            disabled={!media}
            onClick={() => setVolumeMuted(!volumeMuted)}
          >
            {volumeMuted ? <VolumeX size={15} /> : <Volume2 size={15} />}
          </button>
          <span className="preview-scale">Prévia ajustada</span>
        </div>
        <div className="transport-center">
          <button
            className="play-button"
            aria-label={playing ? "Pausar" : "Reproduzir"}
            disabled={!media || total <= 0 || repairing}
            onClick={togglePlay}
          >
            {playing ? (
              <Pause size={18} fill="currentColor" />
            ) : (
              <Play size={18} fill="currentColor" />
            )}
          </button>
        </div>
        <div className="transport-right">
          <span className="time-display">
            {timecode(time, true)} <span>/ {timecode(total, true)}</span>
          </span>
          <Menu
            label="Reprodução"
            icon={<ChevronDown size={14} />}
            className="playback-menu"
          >
            <button
              role="menuitem"
              disabled={!media}
              onClick={() => setTime(0)}
            >
              <SkipBack size={14} />
              Voltar ao início
            </button>
            <button
              role="menuitem"
              disabled={!media}
              onClick={() => {
                setTime(total);
                setPlaying(false);
              }}
            >
              <SkipForward size={14} />
              Ir ao fim
            </button>
            <button
              role="menuitem"
              disabled={!media}
              onClick={() => void viewport.current?.requestFullscreen()}
            >
              <Expand size={14} />
              Tela cheia
            </button>
          </Menu>
        </div>
      </div>
      <input
        className="player-seek"
        type="range"
        aria-label="Posição no projeto"
        min="0"
        max={Math.max(total, 0.01)}
        step="0.01"
        value={Math.min(time, total)}
        disabled={!total}
        onChange={(event) => setTime(Number(event.target.value))}
      />
    </section>
  );
}

import { useEffect, useRef, useState } from "react";
import {
  Clapperboard,
  Expand,
  FolderOpen,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from "lucide-react";
import type { Project } from "../shared/types";
import { duration, locateClip, timecode } from "../lib/editor";
import { OverlayPreview } from "./OverlayPreview";

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
  const viewport = useRef<HTMLDivElement>(null);
  const composition = useRef<HTMLDivElement>(null);
  const [previewWidth, setPreviewWidth] = useState(640);
  const [volumeMuted, setVolumeMuted] = useState(false);
  const [mediaError, setMediaError] = useState("");
  const total = duration(project);
  const active = locateClip(project, time);
  const media = project.media.find((item) => item.id === active?.clip.mediaId);
  const source = media
    ? window.cutroom?.mediaUrl(media.proxy || media.path)
    : undefined;
  const sourceTime = active?.sourceTime ?? 0;
  const state = useRef({ active, time, playing, total });
  state.current = { active, time, playing, total };
  const seekVideo = () => {
    const element = video.current;
    if (element && Math.abs(element.currentTime - sourceTime) > 0.15)
      element.currentTime = sourceTime;
  };
  useEffect(() => {
    setMediaError("");
  }, [source]);
  useEffect(() => {
    const element = video.current;
    if (!element || !active) return;
    seekVideo();
    element.playbackRate = active.clip.speed;
    if (playing && total > 0)
      void element.play().catch((error) => {
        setMediaError(`Não foi possível reproduzir: ${error.message}`);
        setPlaying(false);
      });
    else element.pause();
  }, [source, active?.clip.id, active?.clip.speed, playing]);
  useEffect(() => {
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
      if (element && current.active && !element.paused) {
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
  const captions =
    project.settings.captions && media
      ? project.words
          .filter(
            (word) =>
              word.mediaId === media.id &&
              sourceTime >= word.start &&
              sourceTime <= word.end,
          )
          .map((word) => word.text)
          .join(" ")
      : "";
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
          <span className="tiny-square" /> MONITOR DO PROJETO
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
                transform: `translate(${-cropX * 100}%, ${-cropY * 100}%) scale(${zoom})`,
              }}
              onLoadedMetadata={seekVideo}
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
              onError={() =>
                setMediaError(
                  "Este formato não pode ser reproduzido no monitor. Use um arquivo H.264/MP4 compatível.",
                )
              }
            />
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
            {captions && !active?.clip.muted && (
              <div
                className="caption-preview faithful-caption"
                style={{
                  color: project.settings.accent,
                  fontSize:
                    64 *
                    Math.min(
                      project.settings.width / 1920,
                      project.settings.height / 1080,
                    ) *
                    renderScale,
                }}
              >
                {captions}
              </div>
            )}
          </div>
        ) : (
          <div className="empty-player">
            <div className="empty-frame">
              <span />
              <Clapperboard size={34} strokeWidth={1.15} />
              <span />
            </div>
            <h2>Um novo corte começa aqui.</h2>
            <p>
              Importe seu vídeo para editar com palavras.
              <br />O resto fica na sua timeline.
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
            className="icon-button"
            title="Voltar ao início"
            aria-label="Voltar ao início"
            disabled={!media}
            onClick={() => setTime(0)}
          >
            <SkipBack size={15} />
          </button>
          <button
            className="play-button"
            aria-label={playing ? "Pausar" : "Reproduzir"}
            disabled={!media || total <= 0}
            onClick={togglePlay}
          >
            {playing ? (
              <Pause size={18} fill="currentColor" />
            ) : (
              <Play size={18} fill="currentColor" />
            )}
          </button>
          <button
            className="icon-button"
            title="Ir ao fim"
            aria-label="Ir ao fim"
            disabled={!media}
            onClick={() => {
              setTime(total);
              setPlaying(false);
            }}
          >
            <SkipForward size={15} />
          </button>
        </div>
        <div className="transport-right">
          <span className="time-display">
            {timecode(time, true)} <span>/ {timecode(total, true)}</span>
          </span>
          <button
            className="icon-button"
            title="Tela cheia"
            aria-label="Tela cheia"
            disabled={!media}
            onClick={() => void viewport.current?.requestFullscreen()}
          >
            <Expand size={14} />
          </button>
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

import { useState } from "react";
import {
  ChevronDown,
  Film,
  Redo2,
  Scissors,
  Sparkles,
  Trash2,
  Undo2,
  Volume2,
} from "lucide-react";
import { Menu } from "./Menu";
import type { AppSnapshot, EditCommand } from "../shared/types";
import {
  clipDuration,
  clipOffset,
  duration,
  locateClip,
  timecode,
} from "../lib/editor";

interface Props {
  state: AppSnapshot;
  time: number;
  setTime: (time: number) => void;
  selectedId?: string;
  setSelectedId: (id?: string) => void;
  command: (command: EditCommand) => void;
  run: (method: string) => Promise<void>;
  desktop: boolean;
}
export function Timeline({
  state,
  time,
  setTime,
  selectedId,
  setSelectedId,
  command,
  run,
  desktop,
}: Props) {
  const [scale, setScale] = useState(1);
  const project = state.project;
  const total = duration(project);
  const motions = project.motions ?? [];
  const selectedMotion = motions.find((scene) => scene.id === selectedId);
  const editMotion = () =>
    window.dispatchEvent(new Event("cutroom:motion-edit"));
  const selected = project.clips.find((clip) => clip.id === selectedId);
  const selectedMedia = project.media.find(
    (media) => media.id === selected?.mediaId,
  );
  const split = () => {
    const current = locateClip(project, time);
    if (current)
      command({
        name: "split",
        args: { clipId: current.clip.id, time: current.sourceTime },
      });
  };
  const seconds = total > 0 ? Math.max(total * 1.04, 3) : 30;
  const divisions = 8;
  const timelineWidth = `${scale * 100}%`;
  return (
    <section
      className={`timeline-section ${motions.length ? "has-motions" : ""}`}
      aria-label="Timeline de edição"
    >
      <div className="timeline-toolbar">
        <div className="timeline-title">
          <span>Timeline</span>
          <span className="timeline-counter">
            {project.clips.length}{" "}
            {project.clips.length === 1 ? "clipe" : "clipes"}
          </span>
        </div>
        <div className="timeline-actions">
          <Menu label="Editar">
            <button
              role="menuitem"
              disabled={!state.canUndo || state.busy}
              onClick={() => void run("undo")}
            >
              <Undo2 size={14} />
              Desfazer<kbd>Ctrl Z</kbd>
            </button>
            <button
              role="menuitem"
              disabled={!state.canRedo || state.busy}
              onClick={() => void run("redo")}
            >
              <Redo2 size={14} />
              Refazer<kbd>Ctrl Shift Z</kbd>
            </button>
            <div role="separator" />
            <button
              role="menuitem"
              disabled={!total || state.busy}
              onClick={split}
            >
              <Scissors size={14} />
              Dividir na posição atual
            </button>
            <button
              role="menuitem"
              disabled={(!selected && !selectedMotion) || state.busy}
              onClick={() =>
                selectedMotion
                  ? command({
                      name: "delete_motion",
                      args: { id: selectedMotion.id },
                    })
                  : selected &&
                    command({
                      name: "delete_clip",
                      args: { clipId: selected.id },
                    })
              }
            >
              <Trash2 size={14} />
              {selectedMotion
                ? "Excluir animação selecionada"
                : "Excluir clipe selecionado"}
            </button>
          </Menu>
          <Menu label="Zoom da timeline" className="timeline-zoom-menu">
            <div className="menu-caption">{Math.round(scale * 100)}%</div>
            <button role="menuitem" onClick={() => setScale(1)}>
              Ajustar ao projeto
            </button>
            <button
              role="menuitem"
              disabled={scale <= 1}
              onClick={() => setScale(Math.max(1, scale - 0.5))}
            >
              Diminuir timeline
            </button>
            <button
              role="menuitem"
              disabled={scale >= 5}
              onClick={() => setScale(Math.min(5, scale + 0.5))}
            >
              Ampliar timeline
            </button>
          </Menu>
        </div>
      </div>
      <div className="timeline-content">
        <div className="track-labels">
          <span />
          <div>
            <Film size={14} />
            <span>Vídeo</span>
            <ChevronDown size={11} />
          </div>
          <div>
            <Volume2 size={14} />
            <span>Áudio</span>
          </div>
          {motions.length > 0 && (
            <div className="motion-track-label">
              <Sparkles size={13} />
              <span>Efeitos</span>
            </div>
          )}
        </div>
        <div className="timeline-scroll">
          <div className="timeline-canvas" style={{ width: timelineWidth }}>
            <div
              className="timeline-ruler"
              onClick={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                setTime(
                  Math.min(
                    total,
                    ((event.clientX - rect.left) / rect.width) * seconds,
                  ),
                );
              }}
            >
              {Array.from({ length: divisions + 1 }, (_, i) => (
                <span key={i} style={{ left: `${(i / divisions) * 100}%` }}>
                  {timecode((seconds * i) / divisions, seconds < 12)}
                </span>
              ))}
            </div>
            <div
              className="timeline-lanes"
              onClick={(event) => {
                if (event.target !== event.currentTarget) return;
                const rect = event.currentTarget.getBoundingClientRect();
                setTime(
                  Math.min(
                    total,
                    ((event.clientX - rect.left) / rect.width) * seconds,
                  ),
                );
              }}
            >
              <div className="video-lane">
                {project.clips.map((clip) => {
                  const media = project.media.find(
                    (item) => item.id === clip.mediaId,
                  );
                  const offset = clipOffset(project, clip.id);
                  return (
                    <button
                      key={clip.id}
                      className={`timeline-clip ${clip.id === selectedId ? "active" : ""}`}
                      style={{
                        left: `${(offset / seconds) * 100}%`,
                        width: `${(clipDuration(clip) / seconds) * 100}%`,
                        ...(media?.thumbnail
                          ? {
                              backgroundImage: `linear-gradient(0deg,rgba(15,15,15,.8),rgba(15,15,15,.3)),url("${window.cutroom?.mediaUrl(media.thumbnail)}")`,
                            }
                          : {}),
                      }}
                      title={`${media?.name} · ${timecode(clipDuration(clip), true)}`}
                      onClick={(event) => {
                        setSelectedId(clip.id);
                        const rect =
                          event.currentTarget.getBoundingClientRect();
                        setTime(
                          offset +
                            ((event.clientX - rect.left) / rect.width) *
                              clipDuration(clip),
                        );
                      }}
                    >
                      <span className="clip-grip" />
                      <Film size={11} />
                      <span className="clip-name">{media?.name}</span>
                      {clip.speed !== 1 && (
                        <span className="clip-speed">{clip.speed}×</span>
                      )}
                    </button>
                  );
                })}
                {!project.clips.length && (
                  <span className="timeline-empty-text">
                    Seus clipes aparecem aqui após a importação
                  </span>
                )}
              </div>
              <div className="audio-lane">
                {project.clips.map((clip) => {
                  const media = project.media.find(
                    (item) => item.id === clip.mediaId,
                  );
                  if (!media?.hasAudio) return null;
                  return (
                    <button
                      aria-label={`Áudio ${media.name}${clip.muted ? ", silenciado" : ""}`}
                      key={clip.id}
                      className={`audio-block ${clip.muted ? "is-muted" : ""}`}
                      style={{
                        left: `${(clipOffset(project, clip.id) / seconds) * 100}%`,
                        width: `${(clipDuration(clip) / seconds) * 100}%`,
                      }}
                      onClick={() => {
                        setSelectedId(clip.id);
                        setTime(clipOffset(project, clip.id));
                      }}
                    >
                      <Volume2 size={10} />
                      <span>
                        {clip.muted ? "Silenciado" : "Áudio original"}
                      </span>
                      <i />
                    </button>
                  );
                })}
              </div>
              {motions.length > 0 && (
                <div
                  className="motion-lane"
                  aria-label="Trilha de efeitos e animações"
                >
                  {motions.map((scene) => (
                    <button
                      key={scene.id}
                      className={`motion-block ${scene.id === selectedId ? "active" : ""}`}
                      style={{
                        left: `${(scene.start / seconds) * 100}%`,
                        width: `${((scene.end - scene.start) / seconds) * 100}%`,
                      }}
                      title={`${scene.name} · ${timecode(scene.start, true)} → ${timecode(scene.end, true)}`}
                      aria-label={`Animação ${scene.name}`}
                      onClick={() => {
                        setSelectedId(scene.id);
                        setTime(scene.start);
                        editMotion();
                      }}
                    >
                      <Sparkles size={11} />
                      <span>{scene.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div
              className="playhead"
              style={{ left: `${(Math.min(time, seconds) / seconds) * 100}%` }}
            >
              <span />
              <i />
            </div>
          </div>
        </div>
      </div>
      <div className="clip-inspector">
        {selectedMotion ? (
          <>
            <span className="inspector-label">
              <Sparkles size={12} /> Animação
            </span>
            <span className="motion-inspector-name">{selectedMotion.name}</span>
            <button
              className="button small"
              disabled={state.busy}
              onClick={editMotion}
            >
              Editar animação
            </button>
            <button
              className="icon-button"
              disabled={state.busy}
              aria-label="Excluir animação selecionada"
              onClick={() =>
                command({
                  name: "delete_motion",
                  args: { id: selectedMotion.id },
                })
              }
            >
              <Trash2 size={13} />
            </button>
          </>
        ) : selected ? (
          <>
            <span className="inspector-label">
              <Film size={12} /> Clipe selecionado
            </span>
            <label>
              Entrada
              <input
                key={`${selected.id}-start-${selected.start}`}
                type="number"
                aria-label="Entrada do clipe em segundos"
                min="0"
                step="0.01"
                defaultValue={selected.start.toFixed(2)}
                onBlur={(event) => {
                  const start = Number(event.target.value);
                  if (start !== selected.start)
                    command({
                      name: "trim",
                      args: { clipId: selected.id, start, end: selected.end },
                    });
                }}
              />
            </label>
            <label>
              Saída
              <input
                key={`${selected.id}-end-${selected.end}`}
                type="number"
                aria-label="Saída do clipe em segundos"
                min="0"
                max={selectedMedia?.duration}
                step="0.01"
                defaultValue={selected.end.toFixed(2)}
                onBlur={(event) => {
                  const end = Number(event.target.value);
                  if (end !== selected.end)
                    command({
                      name: "trim",
                      args: { clipId: selected.id, start: selected.start, end },
                    });
                }}
              />
            </label>
            <label>
              Velocidade
              <select
                aria-label="Velocidade do clipe"
                value={selected.speed}
                onChange={(event) =>
                  command({
                    name: "speed",
                    args: {
                      clipId: selected.id,
                      factor: Number(event.target.value),
                    },
                  })
                }
              >
                {[0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 8].map((speed) => (
                  <option value={speed} key={speed}>
                    {speed}×
                  </option>
                ))}
              </select>
            </label>
            <label>
              Zoom
              <select
                aria-label="Zoom do clipe"
                value={selected.zoom}
                onChange={(event) =>
                  command({
                    name: "zoom",
                    args: {
                      clipId: selected.id,
                      factor: Number(event.target.value),
                    },
                  })
                }
              >
                {[1, 1.1, 1.2, 1.3, 1.5, 2].map((zoom) => (
                  <option key={zoom} value={zoom}>
                    {Math.round(zoom * 100)}%
                  </option>
                ))}
              </select>
            </label>
            <button
              className={`small-toggle ${selected.muted ? "on" : ""}`}
              onClick={() =>
                command({
                  name: "speed",
                  args: {
                    clipId: selected.id,
                    factor: selected.speed,
                    muted: !selected.muted,
                  },
                })
              }
            >
              {selected.muted ? "Áudio desligado" : "Áudio ligado"}
            </button>
          </>
        ) : (
          <span className="inspector-empty">
            {desktop
              ? "Selecione um clipe para ajustar cortes, zoom e velocidade."
              : "A timeline ficará disponível no aplicativo desktop."}
          </span>
        )}
        <span className="duration-summary">
          {timecode(total, true)}
          <span> duração final</span>
        </span>
      </div>
    </section>
  );
}

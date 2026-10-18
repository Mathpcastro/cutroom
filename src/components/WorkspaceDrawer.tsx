import { useState } from "react";
import {
  AudioLines,
  Check,
  ChevronRight,
  FileVideo,
  FolderPlus,
  Languages,
  MessageSquareText,
  ScanLine,
  Scissors,
  Sparkles,
  Type,
  X,
} from "lucide-react";
import type { AppSnapshot, EditCommand, OverlayKind } from "../shared/types";
import { clipOffset, duration, timecode } from "../lib/editor";
import { CaptionStudio } from "./CaptionStudio";
import { useDialogKeyboard } from "../lib/useDialogKeyboard";

interface Props {
  tab: "media" | "transcript" | "style";
  state: AppSnapshot;
  run: (method: string, params?: unknown) => Promise<void>;
  command: (command: EditCommand) => void;
  desktop: boolean;
  setTime: (time: number) => void;
  setSelectedId: (id: string) => void;
}
export function WorkspaceDrawer({
  tab,
  state,
  run,
  command,
  desktop,
  setTime,
  setSelectedId,
}: Props) {
  const [overlayOpen, setOverlayOpen] = useState(false);
  useDialogKeyboard(overlayOpen, () => setOverlayOpen(false));
  const [overlayText, setOverlayText] = useState("");
  const [overlayKind, setOverlayKind] = useState<OverlayKind>("title");
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(3);
  const [transcriptSearch, setTranscriptSearch] = useState("");
  const project = state.project;
  const hasMedia = project.media.length > 0;
  const busy = state.busy || state.jobs.some((job) => job.status === "running");
  const disabled = !desktop || !hasMedia || busy;
  const openPackages = () =>
    window.dispatchEvent(new Event("cutroom:packages"));
  const transcriptionPackage = state.packages.find(
    (item) =>
      item.capabilities.some((cap) =>
        /transcri|transcri|whisper|speech|stt/i.test(cap),
      ) || /whisper|transcri/i.test(item.name),
  );
  const seekWord = (mediaId: string, sourceTime: number) => {
    const clip = project.clips.find(
      (item) =>
        item.mediaId === mediaId &&
        sourceTime >= item.start &&
        sourceTime <= item.end,
    );
    if (clip) {
      setSelectedId(clip.id);
      setTime(
        clipOffset(project, clip.id) + (sourceTime - clip.start) / clip.speed,
      );
    }
  };
  const segments: {
    mediaId: string;
    start: number;
    words: typeof project.words;
  }[] = [];
  project.words.forEach((word) => {
    const last = segments.at(-1);
    if (
      last &&
      last.mediaId === word.mediaId &&
      last.words.length < 24 &&
      word.start - last.words.at(-1)!.end < 1.2
    )
      last.words.push(word);
    else
      segments.push({
        mediaId: word.mediaId,
        start: word.start,
        words: [word],
      });
  });
  return (
    <aside
      className="workspace-drawer"
      aria-label={
        tab === "media"
          ? "Mídia do projeto"
          : tab === "transcript"
            ? "Transcrição"
            : "Ferramentas de estilo"
      }
    >
      {tab === "media" && (
        <>
          <div className="drawer-heading">
            <span>Arquivos do projeto</span>
            <span>{project.media.length}</span>
          </div>
          <button
            className="media-import-tile"
            disabled={!desktop}
            onClick={() => void run("importMedia")}
          >
            <FolderPlus size={21} strokeWidth={1.5} />
            <span>Importar arquivos</span>
            <small>Vídeos e áudios locais</small>
          </button>
          {project.media.length ? (
            <div className="media-list">
              {project.media.map((media) => (
                <button
                  className="media-item"
                  key={media.id}
                  onClick={() => {
                    const clip = project.clips.find(
                      (item) => item.mediaId === media.id,
                    );
                    if (clip) {
                      setSelectedId(clip.id);
                      setTime(clipOffset(project, clip.id));
                    }
                  }}
                >
                  <div className="media-thumbnail">
                    {media.thumbnail ? (
                      <img
                        src={window.cutroom?.mediaUrl(media.thumbnail)}
                        alt=""
                      />
                    ) : (
                      <FileVideo size={24} />
                    )}
                    <span>{timecode(media.duration)}</span>
                  </div>
                  <strong>{media.name}</strong>
                  <small>
                    {media.width} × {media.height} · {media.fps.toFixed(0)} fps
                  </small>
                </button>
              ))}
            </div>
          ) : (
            <div className="drawer-empty">
              <FileVideo size={22} strokeWidth={1.2} />
              <p>Nenhum arquivo ainda.</p>
              <small>Os originais ficam preservados no seu computador.</small>
            </div>
          )}
          <div className="drawer-footnote">
            <Check size={12} /> Edição não destrutiva
          </div>
        </>
      )}
      {tab === "transcript" && (
        <>
          <div className="drawer-heading">
            <span>Transcrição</span>
            <Languages size={14} />
          </div>
          {project.words.length ? (
            <>
              <input
                className="search-input"
                aria-label="Buscar na transcrição"
                placeholder="Buscar na transcrição…"
                value={transcriptSearch}
                onChange={(event) => setTranscriptSearch(event.target.value)}
              />
              <div className="transcript-segments">
                {segments
                  .filter((segment) =>
                    segment.words
                      .map((word) => word.text)
                      .join(" ")
                      .toLocaleLowerCase()
                      .includes(transcriptSearch.toLocaleLowerCase()),
                  )
                  .map((segment, index) => (
                    <div
                      className="transcript-segment"
                      key={`${segment.mediaId}-${index}`}
                    >
                      <button
                        className="transcript-time"
                        onClick={() => seekWord(segment.mediaId, segment.start)}
                      >
                        {timecode(segment.start)}
                      </button>
                      <p>
                        {segment.words.map((word, i) => (
                          <button
                            title={`Ir para ${timecode(word.start, true)}`}
                            key={i}
                            onClick={() => seekWord(word.mediaId, word.start)}
                          >
                            {word.text}{" "}
                          </button>
                        ))}
                      </p>
                    </div>
                  ))}
              </div>
              <button
                className="button full-width"
                disabled={disabled}
                onClick={() => void run("transcribe")}
              >
                Transcrever novamente
              </button>
            </>
          ) : (
            <div className="transcript-empty">
              <MessageSquareText size={26} strokeWidth={1.3} />
              <h3>O vídeo, em palavras.</h3>
              <p>
                Gere uma transcrição local para encontrar falas e remover
                muletas.
              </p>
              <button
                className="button primary full-width"
                disabled={
                  !desktop ||
                  busy ||
                  (!!transcriptionPackage?.installed && !hasMedia)
                }
                onClick={() =>
                  transcriptionPackage?.installed
                    ? void run("transcribe")
                    : openPackages()
                }
              >
                {!transcriptionPackage?.installed
                  ? "Instalar em Pacotes"
                  : "Transcrever vídeo"}
              </button>
              <small>
                {hasMedia
                  ? "Transcrição, muletas e legendas usam o pacote local; pausas não precisam dele."
                  : "Importe um vídeo para começar."}
              </small>
            </div>
          )}
        </>
      )}
      {tab === "style" && (
        <>
          <div className="drawer-heading">
            <span>Estilo e edição</span>
            <Sparkles size={14} />
          </div>
          <details className="style-group" open>
            <summary>Edição</summary>
            <button
              className="preset-button"
              disabled={disabled}
              onClick={() => command({ name: "preset", args: {} })}
            >
              <span className="preset-icon">
                <Sparkles size={20} />
              </span>
              <span>
                <strong>Edição limpa</strong>
                <small>Cortes, ritmo e áudio</small>
              </span>
              <ChevronRight size={14} />
            </button>

            <button
              className="tool-row"
              disabled={disabled}
              onClick={() => command({ name: "remove_silence", args: {} })}
            >
              <Scissors size={15} />
              <span>Remover pausas</span>
              <ChevronRight size={13} />
            </button>
            <button
              className="tool-row"
              disabled={disabled}
              onClick={() => command({ name: "remove_fillers", args: {} })}
            >
              <MessageSquareText size={15} />
              <span>Remover muletas</span>
              <ChevronRight size={13} />
            </button>
            {!project.words.length && (
              <small className="tool-hint">
                {transcriptionPackage?.installed ? (
                  "A transcrição será gerada antes da remoção."
                ) : (
                  <>
                    Instale a transcrição para encontrar muletas.{" "}
                    <button className="text-link" onClick={openPackages}>
                      Abrir Pacotes
                    </button>
                  </>
                )}
              </small>
            )}
            <button
              className="tool-row"
              disabled={disabled}
              onClick={() =>
                command({ name: "speed", args: { factor: 4, muted: true } })
              }
            >
              <ScanLine size={15} />
              <span>Time-lapse · 4×</span>
              <ChevronRight size={13} />
            </button>
          </details>
          <details className="style-group">
            <summary>Texto e áudio</summary>
            <button
              className="tool-row"
              disabled={disabled}
              onClick={() => {
                setEnd(Math.min(3, duration(project)));
                setOverlayOpen(true);
              }}
            >
              <Type size={15} />
              <span>Adicionar texto</span>
              <ChevronRight size={13} />
            </button>
            <button
              className="tool-row toggle-row"
              disabled={disabled}
              aria-pressed={project.settings.normalize}
              onClick={() =>
                command({
                  name: "normalize",
                  args: {
                    enabled: !project.settings.normalize,
                    targetLufs: -14,
                  },
                })
              }
            >
              <AudioLines size={15} />
              <span>Normalizar áudio</span>
              <span
                className={`switch ${project.settings.normalize ? "on" : ""}`}
              />
            </button>
            <small className="tool-hint">
              Alvo de áudio: {project.settings.targetLufs} LUFS
            </small>
          </details>
          <details className="style-group caption-style-group" open>
            <summary>Legendas</summary>
            <button
              className="tool-row toggle-row"
              disabled={disabled}
              aria-pressed={project.settings.captions}
              onClick={() =>
                command({
                  name: "captions",
                  args: { enabled: !project.settings.captions },
                })
              }
            >
              <Languages size={15} />
              <span>
                Legendas{" "}
                {project.settings.captions ? "ativadas" : "desativadas"}
              </span>
              <span
                className={`switch ${project.settings.captions ? "on" : ""}`}
              />
            </button>
            <CaptionStudio
              project={project}
              disabled={disabled}
              onChange={(style) =>
                command({ name: "captions", args: { enabled: true, style } })
              }
            />
            {!transcriptionPackage?.installed && (
              <small className="tool-hint">
                Legendas precisam da transcrição local.{" "}
                <button className="text-link" onClick={openPackages}>
                  Instalar em Pacotes
                </button>
              </small>
            )}
          </details>
          <details className="style-group">
            <summary>Formato de saída</summary>
            <div className="output-format">
              <span>
                {project.settings.width} × {project.settings.height}
              </span>
              <span>{project.settings.fps} fps</span>
            </div>
            <small className="tool-hint">
              Peça ao assistente outros ajustes de edição.
            </small>
          </details>
        </>
      )}
      {overlayOpen && (
        <div className="modal-backdrop">
          <form
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="overlay-title"
            onSubmit={(event) => {
              event.preventDefault();
              command({
                name: "overlay",
                args: { kind: overlayKind, text: overlayText, start, end },
              });
              setOverlayOpen(false);
              setOverlayText("");
            }}
          >
            <button
              type="button"
              className="icon-button modal-close"
              aria-label="Fechar texto"
              onClick={() => setOverlayOpen(false)}
            >
              <X size={18} />
            </button>
            <h2 id="overlay-title">Uma ideia em destaque.</h2>
            <p>O texto aparece no intervalo da timeline.</p>
            <label className="field">
              Tipo
              <select
                value={overlayKind}
                onChange={(event) =>
                  setOverlayKind(event.target.value as OverlayKind)
                }
              >
                {(
                  [
                    ["title", "Título"],
                    ["statement", "Frase"],
                    ["callout", "Destaque"],
                    ["flow", "Fluxo"],
                    ["promo", "Promoção"],
                    ["cover", "Capa"],
                  ] as const
                ).map(([value, label]) => (
                  <option value={value} key={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Texto
              <textarea
                autoFocus
                required
                maxLength={500}
                rows={3}
                value={overlayText}
                onChange={(event) => setOverlayText(event.target.value)}
                placeholder="Escreva uma mensagem…"
              />
            </label>
            <div className="field-pair">
              <label className="field">
                Início (s)
                <input
                  type="number"
                  min="0"
                  max={duration(project)}
                  step="0.1"
                  value={start}
                  onChange={(event) => setStart(Number(event.target.value))}
                />
              </label>
              <label className="field">
                Fim (s)
                <input
                  type="number"
                  min={start + 0.1}
                  max={duration(project)}
                  step="0.1"
                  value={end}
                  onChange={(event) => setEnd(Number(event.target.value))}
                />
              </label>
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="button"
                onClick={() => setOverlayOpen(false)}
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="button primary"
                disabled={!overlayText.trim() || end <= start}
              >
                Adicionar texto
              </button>
            </div>
          </form>
        </div>
      )}
    </aside>
  );
}

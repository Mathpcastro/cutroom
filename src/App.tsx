import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  Check,
  ChevronDown,
  CircleHelp,
  FilePlus2,
  Film,
  FolderOpen,
  LoaderCircle,
  PanelLeftClose,
  PanelLeftOpen,
  Save,
  Settings2,
  Terminal,
  X,
} from "lucide-react";
import type { AppSnapshot, EditCommand } from "./shared/types";
import { duration, emptySnapshot, timecode } from "./lib/editor";
import { Assistant } from "./components/Assistant";
import { Player } from "./components/Player";
import { Timeline } from "./components/Timeline";
import { WorkspaceDrawer } from "./components/WorkspaceDrawer";
import { useDialogKeyboard } from "./lib/useDialogKeyboard";

export default function App() {
  const [state, setState] = useState<AppSnapshot>(emptySnapshot);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(!!window.cutroom);
  const [tab, setTab] = useState<"media" | "transcript" | "style">("media");
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [projectMenu, setProjectMenu] = useState(false);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selectedId, setSelectedId] = useState<string>();
  const [jobsOpen, setJobsOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [dragging, setDragging] = useState(false);
  useDialogKeyboard(renameOpen, () => setRenameOpen(false));
  useEffect(() => {
    const closeMenus = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setProjectMenu(false);
        setJobsOpen(false);
      }
    };
    window.addEventListener("keydown", closeMenus);
    return () => window.removeEventListener("keydown", closeMenus);
  }, []);
  const desktop = !!window.cutroom;
  const projectId = useRef(state.project.id);
  const run = useCallback(async (method: string, params?: unknown) => {
    if (!window.cutroom) {
      setError("Este recurso precisa do aplicativo CutRoom desktop.");
      return;
    }
    try {
      setError("");
      const next = await window.cutroom.request<AppSnapshot>(method, params);
      if (next?.project) setState(next);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, []);
  const command = useCallback(
    (edit: EditCommand) => {
      setPlaying(false);
      void run("executeCommand", edit);
    },
    [run],
  );
  useEffect(() => {
    if (!window.cutroom) return;
    let active = true;
    const unsubscribe = window.cutroom.onEvent((event) => {
      if (active && event.type === "state") setState(event.state);
    });
    void window.cutroom
      .request<AppSnapshot>("getState")
      .then((snapshot) => {
        if (active) setState(snapshot);
      })
      .catch((reason) => {
        if (active) setError(String(reason));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);
  useEffect(() => {
    if (projectId.current !== state.project.id) {
      projectId.current = state.project.id;
      setTime(0);
      setPlaying(false);
      setSelectedId(undefined);
    }
    setTime((current) => Math.min(current, duration(state.project)));
    if (
      selectedId &&
      !state.project.clips.some((clip) => clip.id === selectedId)
    )
      setSelectedId(undefined);
  }, [state.project]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (
        target.closest("input,textarea,select,[contenteditable=true]") ||
        document.querySelector("[role=dialog]")
      )
        return;
      if (event.code === "Space" && state.project.clips.length) {
        event.preventDefault();
        if (time >= duration(state.project) - 0.03) setTime(0);
        setPlaying((current) => !current);
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey ? state.canRedo : state.canUndo)
          void run(event.shiftKey ? "redo" : "undo");
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void run("saveProject");
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "o") {
        event.preventDefault();
        void run("openProject");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state.canRedo, state.canUndo, state.project, time, run]);
  const activeJobs = state.jobs.filter((job) => job.status === "running");
  const recentJob = activeJobs[0] || state.jobs.at(-1);
  const originalDuration = state.project.media.reduce(
    (total, media) => total + media.duration,
    0,
  );
  const switchTab = (next: typeof tab) => {
    if (next === tab) setDrawerOpen(!drawerOpen);
    else {
      setTab(next);
      setDrawerOpen(true);
    }
  };
  return (
    <div className="app-shell">
      <header className="titlebar">
        <a
          className="wordmark"
          href="#"
          onClick={(event) => event.preventDefault()}
          aria-label="CutRoom"
        >
          <span className="brand-icon">
            <span /> <Film size={15} /> <span />
          </span>
          CutRoom<span className="version">BETA</span>
        </a>
        <span className="titlebar-divider" />
        <div className="project-menu-wrap">
          <button
            className="project-title"
            onClick={() => setProjectMenu(!projectMenu)}
            aria-expanded={projectMenu}
          >
            {state.project.name}
            <ChevronDown size={13} />
          </button>
          {projectMenu && (
            <>
              <div
                className="menu-dismiss"
                onClick={() => setProjectMenu(false)}
              />
              <div className="project-menu">
                <button
                  disabled={!desktop}
                  onClick={() => {
                    setProjectMenu(false);
                    void run("newProject");
                  }}
                >
                  <FilePlus2 size={15} /> Novo projeto
                </button>
                <button
                  disabled={!desktop}
                  onClick={() => {
                    setProjectMenu(false);
                    void run("openProject");
                  }}
                >
                  <FolderOpen size={15} /> Abrir projeto <kbd>Ctrl O</kbd>
                </button>
                <button
                  disabled={!desktop}
                  onClick={() => {
                    setProjectMenu(false);
                    void run("saveProject");
                  }}
                >
                  <Save size={15} /> Salvar projeto <kbd>Ctrl S</kbd>
                </button>
                <button
                  disabled={!desktop}
                  onClick={() => {
                    setProjectMenu(false);
                    setProjectName(state.project.name);
                    setRenameOpen(true);
                  }}
                >
                  <Settings2 size={15} /> Renomear
                </button>
              </div>
            </>
          )}
        </div>
        <span className="project-location">
          {state.projectPath ? "Salvo localmente" : "Projeto local"}
        </span>
        <div className="titlebar-right">
          <span className="connection-badge">
            <span className={`connection-dot ${state.connection.status}`} />
            {state.connection.status === "connected"
              ? "Codex conectado"
              : state.connection.status === "connecting"
                ? "Conectando…"
                : "Codex desconectado"}
          </span>
          <button
            className="icon-button save-action"
            disabled={!desktop}
            title="Salvar projeto (Ctrl+S)"
            aria-label="Salvar projeto"
            onClick={() => void run("saveProject")}
          >
            <Save size={15} />
          </button>
          <button
            className="button primary export-button"
            disabled={
              !desktop ||
              !state.project.clips.length ||
              activeJobs.some((job) => job.kind === "export")
            }
            onClick={() => {
              setPlaying(false);
              void run("exportVideo");
            }}
          >
            <ArrowDownToLine size={15} /> Exportar
          </button>
        </div>
      </header>
      <div className="main-layout">
        <Assistant state={state} run={run} desktop={desktop} />
        <main
          className={`workspace ${dragging ? "is-dragging" : ""}`}
          onDragOver={(event) => {
            event.preventDefault();
            if (desktop && event.dataTransfer.types.includes("Files"))
              setDragging(true);
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node))
              setDragging(false);
          }}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            const paths = Array.from(event.dataTransfer.files)
              .map((file) => window.cutroom?.pathForFile?.(file))
              .filter((path): path is string => !!path);
            if (paths.length) void run("importPaths", { paths });
            else if (desktop)
              setError(
                "Não foi possível acessar os arquivos. Use Importar para selecioná-los.",
              );
          }}
        >
          <nav className="workspace-toolbar" aria-label="Painéis do editor">
            <div className="workspace-tabs">
              <button
                className={tab === "media" && drawerOpen ? "active" : ""}
                onClick={() => switchTab("media")}
              >
                <FolderOpen size={14} /> Mídia
              </button>
              <button
                className={tab === "transcript" && drawerOpen ? "active" : ""}
                onClick={() => switchTab("transcript")}
              >
                Transcrição
              </button>
              <button
                className={tab === "style" && drawerOpen ? "active" : ""}
                onClick={() => switchTab("style")}
              >
                Estilo
              </button>
            </div>
            <div className="workspace-tools">
              <button
                className="button small"
                disabled={!desktop}
                onClick={() => void run("importMedia")}
              >
                <FolderOpen size={13} /> Importar
              </button>
              <button
                className="icon-button"
                aria-label={drawerOpen ? "Recolher painel" : "Expandir painel"}
                title={drawerOpen ? "Recolher painel" : "Expandir painel"}
                onClick={() => setDrawerOpen(!drawerOpen)}
              >
                {drawerOpen ? (
                  <PanelLeftClose size={15} />
                ) : (
                  <PanelLeftOpen size={15} />
                )}
              </button>
            </div>
          </nav>
          <div
            className={`workspace-main ${drawerOpen ? "" : "drawer-closed"}`}
          >
            {drawerOpen && (
              <WorkspaceDrawer
                tab={tab}
                state={state}
                run={run}
                command={command}
                desktop={desktop}
                setTime={setTime}
                setSelectedId={setSelectedId}
              />
            )}
            <Player
              project={state.project}
              time={time}
              setTime={setTime}
              playing={playing}
              setPlaying={setPlaying}
              desktop={desktop}
              importMedia={() => void run("importMedia")}
            />
          </div>
          <Timeline
            state={state}
            time={time}
            setTime={setTime}
            selectedId={selectedId}
            setSelectedId={setSelectedId}
            command={command}
            run={run}
            desktop={desktop}
          />
        </main>
      </div>
      <footer className="statusbar">
        <div className="statusbar-left">
          <span className="local-status">
            <span /> Local por padrão
          </span>
          <span className="status-divider" />
          <span>
            {desktop
              ? "Arquivos originais preservados"
              : "Prévia da interface · requer aplicativo desktop"}
          </span>
        </div>
        <div className="statusbar-right">
          {loading && (
            <span className="job-summary">
              <LoaderCircle size={12} className="spin" /> Abrindo projeto…
            </span>
          )}
          {recentJob && (
            <button
              className="job-summary"
              onClick={() => setJobsOpen(!jobsOpen)}
            >
              {recentJob.status === "running" ? (
                <LoaderCircle size={12} className="spin" />
              ) : recentJob.status === "completed" ? (
                <Check size={12} />
              ) : (
                <CircleHelp size={12} />
              )}
              <span>{recentJob.label}</span>
              {recentJob.status === "running" && (
                <span>{Math.round(recentJob.progress)}%</span>
              )}
            </button>
          )}
          {originalDuration > 0 && (
            <span className="status-duration">
              {timecode(originalDuration)} original <span>→</span>{" "}
              {timecode(duration(state.project))} editado
            </span>
          )}
          <Terminal size={12} />
          <span>v0.1.0</span>
        </div>
      </footer>
      {dragging && (
        <div className="drop-overlay">
          <FolderOpen size={35} />
          <strong>Solte seus arquivos para importar</strong>
          <span>Os arquivos originais permanecem no seu computador.</span>
        </div>
      )}
      {renameOpen && (
        <div className="modal-backdrop">
          <form
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="rename-title"
            onSubmit={(event) => {
              event.preventDefault();
              command({ name: "rename", args: { name: projectName.trim() } });
              setRenameOpen(false);
            }}
          >
            <button
              type="button"
              className="icon-button modal-close"
              aria-label="Fechar renomeação"
              onClick={() => setRenameOpen(false)}
            >
              <X size={18} />
            </button>
            <h2 id="rename-title">Nome do projeto</h2>
            <label className="field">
              Nome
              <input
                autoFocus
                maxLength={120}
                required
                value={projectName}
                onChange={(event) => setProjectName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") setRenameOpen(false);
                }}
              />
            </label>
            <div className="modal-actions">
              <button
                type="button"
                className="button"
                onClick={() => setRenameOpen(false)}
              >
                Cancelar
              </button>
              <button className="button primary" disabled={!projectName.trim()}>
                Salvar nome
              </button>
            </div>
          </form>
        </div>
      )}
      {error && (
        <div className="error-toast" role="alert">
          <CircleHelp size={17} />
          <span>{error}</span>
          <button
            className="icon-button"
            aria-label="Fechar erro"
            onClick={() => setError("")}
          >
            <X size={15} />
          </button>
        </div>
      )}
      {jobsOpen && (
        <section className="jobs-popover" aria-label="Atividades">
          <div className="drawer-heading">
            <span>ATIVIDADES</span>
            <button
              className="icon-button"
              aria-label="Fechar atividades"
              onClick={() => setJobsOpen(false)}
            >
              <X size={14} />
            </button>
          </div>
          {[...state.jobs].reverse().map((job) => (
            <article className="job-item" key={job.id}>
              <div>
                <strong>{job.label}</strong>
                <span>
                  {job.status === "running"
                    ? "Em andamento"
                    : job.status === "completed"
                      ? "Concluído"
                      : job.status === "failed"
                        ? "Falhou"
                        : "Cancelado"}
                </span>
              </div>
              {job.status === "running" && (
                <>
                  <progress max="100" value={job.progress} />
                  <button
                    className="button small"
                    onClick={() => void run("cancelJob", { id: job.id })}
                  >
                    Cancelar
                  </button>
                </>
              )}
              {job.error && <p className="inline-error">{job.error}</p>}
              {job.output && (
                <button
                  className="button small"
                  onClick={() => void run("revealFile", { path: job.output })}
                >
                  <FolderOpen size={12} /> Mostrar arquivo
                </button>
              )}
            </article>
          ))}
        </section>
      )}
    </div>
  );
}

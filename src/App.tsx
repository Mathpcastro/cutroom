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
  Save,
  Settings2,
  X,
} from "lucide-react";
import type { AppSnapshot, EditCommand } from "./shared/types";
import { duration, emptySnapshot, timecode } from "./lib/editor";
import { Assistant } from "./components/Assistant";
import { Player } from "./components/Player";
import { Timeline } from "./components/Timeline";
import { WorkspaceDrawer } from "./components/WorkspaceDrawer";
import { Menu } from "./components/Menu";
import { applyTheme, themes, type ThemeId } from "./lib/themes";
import { useDialogKeyboard } from "./lib/useDialogKeyboard";

export default function App() {
  const [state, setState] = useState<AppSnapshot>(emptySnapshot);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState<string[]>([]);
  const [loading, setLoading] = useState(!!window.cutroom);
  const [tab, setTab] = useState<"media" | "transcript" | "style">("media");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [theme, setTheme] = useState<ThemeId>(
    (document.documentElement.dataset.theme as ThemeId) || "graphite",
  );
  const [helpOpen, setHelpOpen] = useState(false);
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
        setJobsOpen(false);
      }
    };
    window.addEventListener("keydown", closeMenus);
    return () => window.removeEventListener("keydown", closeMenus);
  }, []);
  useDialogKeyboard(helpOpen, () => setHelpOpen(false));
  const desktop = !!window.cutroom;
  const projectId = useRef(state.project.id);
  const run = useCallback(async (method: string, params?: unknown) => {
    if (!window.cutroom) {
      setError("Este recurso precisa do aplicativo CutRoom desktop.");
      return;
    }
    setPending((current) => [...current, method]);
    try {
      setError("");
      setNotice("");
      const next = await window.cutroom.request<AppSnapshot>(method, params);
      if (next?.project) setState(next);
      if (method === "saveProject" && next?.projectPath)
        setNotice("Projeto salvo no computador.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setPending((current) => {
        const index = current.indexOf(method);
        return current.filter((_, i) => i !== index);
      });
    }
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);
  const command = useCallback(
    (edit: EditCommand) => {
      if (!["captions", "motion", "delete_motion"].includes(edit.name))
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
      !state.project.clips.some((clip) => clip.id === selectedId) &&
      !state.project.motions?.some((scene) => scene.id === selectedId)
    )
      setSelectedId(undefined);
  }, [state.project]);
  useEffect(() => {
    const edit = () => {
      setTab("style");
      setDrawerOpen(true);
    };
    window.addEventListener("cutroom:motion-edit", edit);
    return () => window.removeEventListener("cutroom:motion-edit", edit);
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === ",") {
        event.preventDefault();
        window.dispatchEvent(new Event("cutroom:preferences"));
        return;
      }
      if (
        (event.ctrlKey || event.metaKey) &&
        ["s", "o"].includes(event.key.toLowerCase())
      ) {
        event.preventDefault();
        void run(
          event.key.toLowerCase() === "s" ? "saveProject" : "openProject",
        );
        return;
      }
      const target = event.target as HTMLElement;
      if (
        target.closest(
          "input,textarea,select,[contenteditable=true],[role=listbox],[role=combobox],[role=menu],button[aria-haspopup]",
        ) ||
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
  return (
    <div className={`app-shell ${desktop ? "is-desktop" : ""}`}>
      <header className="titlebar">
        <a
          className="wordmark"
          href="#"
          onClick={(event) => event.preventDefault()}
          aria-label="CutRoom"
        >
          <Film size={16} />
          CutRoom
        </a>
        <span className="titlebar-divider" />
        <Menu
          label={`Projeto: ${state.project.name}`}
          className="project-file-menu"
        >
          <div className="menu-caption">{state.project.name}</div>
          <button
            role="menuitem"
            disabled={!desktop}
            onClick={() => void run("newProject")}
          >
            <FilePlus2 size={14} />
            Novo projeto
          </button>
          <button
            role="menuitem"
            disabled={!desktop}
            onClick={() => void run("openProject")}
          >
            <FolderOpen size={14} />
            Abrir projeto<kbd>Ctrl O</kbd>
          </button>
          <button
            role="menuitem"
            disabled={!desktop || pending.includes("saveProject")}
            onClick={() => void run("saveProject")}
          >
            <Save size={14} />
            Salvar projeto<kbd>Ctrl S</kbd>
          </button>
          <button
            role="menuitem"
            disabled={!desktop}
            onClick={() => {
              setProjectName(state.project.name);
              setRenameOpen(true);
            }}
          >
            <Settings2 size={14} />
            Renomear
          </button>
          <div role="separator" />
          <button
            role="menuitem"
            disabled={!desktop}
            onClick={() => void run("importMedia")}
          >
            <FolderOpen size={14} />
            Importar mídia
          </button>
        </Menu>
        <div className="titlebar-right">
          <button
            className="button export-button"
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
            <ArrowDownToLine size={14} />
            Exportar
          </button>
          <Menu
            label="Configurações"
            icon={<Settings2 size={15} />}
            className="settings-menu"
            eventName="cutroom:preferences"
          >
            <div className="menu-caption">
              Aparência<kbd>Ctrl ,</kbd>
            </div>
            {themes.map((item) => (
              <button
                key={item.id}
                role="menuitemradio"
                aria-checked={theme === item.id}
                onClick={() => setTheme(applyTheme(item.id))}
              >
                <span
                  className="theme-swatch"
                  style={{ background: item.color, borderColor: item.accent }}
                />
                {item.name}
                {theme === item.id && (
                  <Check size={14} className="menu-check" />
                )}
              </button>
            ))}
            <div role="separator" />
            <button role="menuitem" onClick={() => setHelpOpen(true)}>
              <CircleHelp size={14} />
              Atalhos e ajuda
            </button>
          </Menu>
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
            <Menu label="Ferramentas" className="workspace-menu">
              <div className="menu-caption">Painéis do projeto</div>
              {(
                [
                  ["media", "Mídia"],
                  ["transcript", "Transcrição"],
                  ["style", "Estilo e edição"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  role="menuitem"
                  onClick={() => {
                    setTab(value);
                    setDrawerOpen(true);
                  }}
                >
                  {label}
                  {drawerOpen && tab === value && (
                    <Check size={14} className="menu-check" />
                  )}
                </button>
              ))}
              <div role="separator" />
              <button
                role="menuitem"
                disabled={!drawerOpen}
                onClick={() => setDrawerOpen(false)}
              >
                Recolher painel
              </button>
            </Menu>
            <span className="workspace-context">
              {drawerOpen
                ? tab === "media"
                  ? "Mídia"
                  : tab === "transcript"
                    ? "Transcrição"
                    : "Estilo e edição"
                : "Editor"}
            </span>
            {drawerOpen && (
              <button
                className="icon-button"
                aria-label="Recolher painel"
                title="Recolher painel"
                onClick={() => setDrawerOpen(false)}
              >
                <X size={14} />
              </button>
            )}
          </nav>
          <div
            className={`workspace-main ${drawerOpen ? "" : "drawer-closed"} ${tab === "style" ? "style-drawer-open" : ""}`}
          >
            {drawerOpen && (
              <WorkspaceDrawer
                tab={tab}
                state={state}
                run={run}
                command={command}
                desktop={desktop}
                time={time}
                selectedId={selectedId}
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
            <span />
            {desktop ? "Local" : "Prévia da interface"}
          </span>
        </div>
        <div className="statusbar-right">
          {loading && (
            <span className="job-summary">
              <LoaderCircle size={12} className="spin" />
              Abrindo projeto…
            </span>
          )}
          {recentJob && (
            <button
              className="job-summary"
              title="Ver atividades do projeto"
              aria-label="Atividades do projeto"
              onClick={() => setJobsOpen(!jobsOpen)}
            >
              {recentJob.status === "running" ? (
                <LoaderCircle size={12} className="spin" />
              ) : recentJob.status === "completed" ? (
                <Check size={12} />
              ) : (
                <CircleHelp size={12} />
              )}
              <span>
                {recentJob.status === "running"
                  ? `${Math.round(recentJob.progress)}% · Em andamento`
                  : recentJob.status === "completed"
                    ? "Concluído"
                    : "Ver atividade"}
              </span>
            </button>
          )}
          {originalDuration > 0 && (
            <span className="status-duration">
              {timecode(originalDuration)}
              <span> → </span>
              {timecode(duration(state.project))}
            </span>
          )}
        </div>
      </footer>
      {helpOpen && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setHelpOpen(false);
          }}
        >
          <section
            className="modal help-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="help-title"
          >
            <button
              className="icon-button modal-close"
              aria-label="Fechar ajuda"
              onClick={() => setHelpOpen(false)}
            >
              <X size={17} />
            </button>
            <h2 id="help-title">Atalhos e ajuda</h2>
            <p>
              Importe um vídeo pelo menu do projeto ou arraste os arquivos para
              o editor. Use Ferramentas para abrir mídia, transcrição e estilo.
            </p>
            <dl className="shortcut-list">
              <dt>Salvar projeto</dt>
              <dd>Ctrl S</dd>
              <dt>Abrir projeto</dt>
              <dd>Ctrl O</dd>
              <dt>Desfazer / refazer</dt>
              <dd>Ctrl Z / Ctrl Shift Z</dd>
              <dt>Reproduzir / pausar</dt>
              <dd>Espaço</dd>
              <dt>Aparência</dt>
              <dd>Ctrl ,</dd>
            </dl>
            <p>
              Conecte sua sessão e instale a transcrição pelo menu Conversa.
            </p>
          </section>
        </div>
      )}
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
      {notice && (
        <div className="notice-toast" role="status">
          <Check size={16} />
          {notice}
          <button
            className="icon-button"
            aria-label="Fechar confirmação"
            onClick={() => setNotice("")}
          >
            <X size={14} />
          </button>
        </div>
      )}
      {error && (
        <div className="error-toast" role="alert">
          <CircleHelp size={17} />
          <span>{error}</span>
          {/transcri|pacote|whisper/i.test(error) && (
            <button
              className="button small"
              onClick={() => {
                window.dispatchEvent(new Event("cutroom:packages"));
                setError("");
              }}
            >
              Abrir Pacotes
            </button>
          )}
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

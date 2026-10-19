import { useEffect, useState } from "react";
import { ChevronRight, Plus, Sparkles, Trash2 } from "lucide-react";
import type {
  EditCommand,
  MotionPresetId,
  MotionTween,
  Project,
} from "../shared/types";
import { MOTION_PRESETS } from "../shared/motions";
import { duration, timecode } from "../lib/editor";
import "./motion-studio.css";

interface Props {
  project: Project;
  disabled: boolean;
  packageReady: boolean;
  time?: number;
  selectedId?: string;
  command: (command: EditCommand) => void;
  openPackages: () => void;
}

export function MotionStudio({
  project,
  disabled,
  packageReady,
  time = 0,
  selectedId,
  command,
  openPackages,
}: Props) {
  const scenes = project.motions ?? [];
  const [editingId, setEditingId] = useState<string>();
  const [formOpen, setFormOpen] = useState(false);
  const [preset, setPreset] = useState<MotionPresetId | "custom">("title");
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [items, setItems] = useState("");
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(3);
  const [mode, setMode] = useState<"overlay" | "fullscreen">("overlay");
  const [accent, setAccent] = useState("#ff8a3d");
  const [background, setBackground] = useState("#151515");
  const [html, setHtml] = useState("");
  const [animations, setAnimations] = useState("[]");
  const [error, setError] = useState("");
  const total = duration(project);
  const edit = (id: string) => {
    const scene = scenes.find((item) => item.id === id);
    if (!scene) return;
    setEditingId(id);
    setName(scene.name);
    setPreset(scene.presetId ?? "custom");
    setText(scene.text ?? "");
    setSubtitle(scene.subtitle ?? "");
    setItems((scene.items ?? []).join("\n"));
    setStart(scene.start);
    setEnd(scene.end);
    setMode(scene.mode);
    setAccent(scene.accent ?? project.settings.accent);
    setBackground(scene.background ?? "#151515");
    setHtml(scene.html);
    setAnimations(JSON.stringify(scene.animations, null, 2));
    setError("");
    setFormOpen(true);
  };
  useEffect(() => {
    if (selectedId && scenes.some((scene) => scene.id === selectedId))
      edit(selectedId);
  }, [selectedId]);
  useEffect(() => {
    const reopen = () => {
      if (selectedId) edit(selectedId);
    };
    window.addEventListener("cutroom:motion-edit", reopen);
    return () => window.removeEventListener("cutroom:motion-edit", reopen);
  }, [selectedId, scenes]);
  useEffect(() => {
    if (editingId && !scenes.some((scene) => scene.id === editingId)) {
      setEditingId(undefined);
      setFormOpen(false);
    }
  }, [scenes, editingId]);
  const create = () => {
    setEditingId(undefined);
    setName("");
    setText("");
    setSubtitle("");
    setItems("");
    setPreset("title");
    setMode("overlay");
    setStart(Math.min(time, Math.max(0, total - 0.1)));
    setEnd(Math.min(total, time + 4));
    setAccent(project.settings.accent);
    setBackground("#151515");
    setHtml("");
    setAnimations("[]");
    setError("");
    setFormOpen(true);
  };
  return (
    <div className="motion-studio">
      <div className="motion-intro">
        <Sparkles size={16} />
        <div>
          <strong>Ideias em movimento.</strong>
          <p>Títulos, destaques e cenas explicativas no seu vídeo.</p>
        </div>
      </div>
      {!packageReady && (
        <div className="motion-package-note">
          <p>
            A prévia já funciona. Para exportar, instale o pacote gratuito de
            efeitos.
          </p>
          <button className="text-link" onClick={openPackages}>
            Abrir Pacotes <ChevronRight size={12} />
          </button>
        </div>
      )}
      {scenes.length > 0 && (
        <div className="motion-scene-list" aria-label="Animações do projeto">
          {scenes.map((scene) => (
            <div
              className={`motion-scene-row ${scene.id === editingId ? "selected" : ""}`}
              key={scene.id}
            >
              <button disabled={disabled} onClick={() => edit(scene.id)}>
                <strong>{scene.name}</strong>
                <small>
                  {timecode(scene.start, true)} → {timecode(scene.end, true)} ·{" "}
                  {scene.mode === "overlay" ? "Sobre o vídeo" : "Tela cheia"}
                </small>
              </button>
              <button
                className="icon-button"
                aria-label={`Remover animação ${scene.name}`}
                disabled={disabled}
                onClick={() =>
                  command({ name: "delete_motion", args: { id: scene.id } })
                }
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
      {!formOpen ? (
        <button
          className="button full-width motion-add"
          disabled={disabled || total <= 0}
          onClick={create}
        >
          <Plus size={13} /> Adicionar animação
        </button>
      ) : (
        <form
          className="motion-form"
          aria-label="Editar animação"
          onSubmit={(event) => {
            event.preventDefault();
            setError("");
            if (
              !Number.isFinite(start) ||
              !Number.isFinite(end) ||
              start < 0 ||
              end <= start ||
              end > total + 0.001
            ) {
              setError("Escolha um intervalo dentro da duração do vídeo.");
              return;
            }
            let tweens: MotionTween[] = [];
            if (preset === "custom") {
              try {
                const parsed: unknown = JSON.parse(animations);
                if (!Array.isArray(parsed)) throw new Error();
                tweens = parsed as MotionTween[];
              } catch {
                setError("As animações precisam ser uma lista JSON válida.");
                return;
              }
              if (!html.trim()) {
                setError("Adicione o HTML/CSS da cena personalizada.");
                return;
              }
            }
            command({
              name: "motion",
              args: {
                ...(editingId ? { id: editingId } : {}),
                name:
                  name.trim() ||
                  (preset === "custom"
                    ? "Cena personalizada"
                    : MOTION_PRESETS.find((item) => item.id === preset)?.name),
                start,
                end,
                mode,
                accent,
                background,
                ...(preset === "custom"
                  ? { presetId: undefined, html, animations: tweens }
                  : {
                      presetId: preset,
                      text: text.trim(),
                      subtitle: subtitle.trim(),
                      items: items
                        .split("\n")
                        .map((item) => item.trim())
                        .filter(Boolean),
                    }),
              },
            });
            setFormOpen(false);
            setEditingId(undefined);
          }}
        >
          <div className="motion-form-heading">
            <strong>{editingId ? "Editar animação" : "Nova animação"}</strong>
            <button
              type="button"
              className="text-link"
              onClick={() => setFormOpen(false)}
            >
              Cancelar
            </button>
          </div>
          <label className="field">
            Modelo
            <select
              aria-label="Modelo da animação"
              disabled={disabled}
              value={preset}
              onChange={(event) => {
                const id = event.target.value as MotionPresetId | "custom";
                setPreset(id);
                const entry = MOTION_PRESETS.find((item) => item.id === id);
                if (entry) setMode(entry.mode);
              }}
            >
              {MOTION_PRESETS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
              <option value="custom">HTML/CSS personalizado</option>
            </select>
          </label>
          {preset !== "custom" && (
            <>
              <label className="field">
                Texto principal
                <textarea
                  aria-label="Texto da animação"
                  value={text}
                  maxLength={500}
                  required
                  rows={2}
                  disabled={disabled}
                  placeholder="A ideia que merece destaque"
                  onChange={(event) => setText(event.target.value)}
                />
              </label>
              <label className="field">
                Complemento <span className="motion-optional">opcional</span>
                <input
                  value={subtitle}
                  maxLength={500}
                  disabled={disabled}
                  onChange={(event) => setSubtitle(event.target.value)}
                />
              </label>
              {(preset === "steps" || preset === "explainer") && (
                <label className="field">
                  Etapas · uma por linha
                  <textarea
                    aria-label="Etapas da animação"
                    rows={3}
                    value={items}
                    maxLength={2000}
                    disabled={disabled}
                    placeholder={
                      "Primeiro passo\nSegundo passo\nTerceiro passo"
                    }
                    onChange={(event) => setItems(event.target.value)}
                  />
                </label>
              )}
            </>
          )}
          <div className="field-pair">
            <label className="field">
              Início (s)
              <input
                aria-label="Início da animação"
                type="number"
                min={0}
                max={total}
                step="0.1"
                required
                value={start}
                disabled={disabled}
                onChange={(event) => setStart(Number(event.target.value))}
              />
            </label>
            <label className="field">
              Fim (s)
              <input
                aria-label="Fim da animação"
                type="number"
                min={start + 0.1}
                max={total}
                step="0.1"
                required
                value={end}
                disabled={disabled}
                onChange={(event) => setEnd(Number(event.target.value))}
              />
            </label>
          </div>
          <label className="field">
            Composição
            <select
              aria-label="Composição da animação"
              value={mode}
              disabled={disabled}
              onChange={(event) => setMode(event.target.value as typeof mode)}
            >
              <option value="overlay">Sobre o vídeo</option>
              <option value="fullscreen">Tela cheia · mantém o áudio</option>
            </select>
          </label>
          <details
            className="motion-options"
            open={preset === "custom" ? true : undefined}
          >
            <summary>
              {preset === "custom" ? "HTML/CSS e movimento" : "Mais ajustes"}
            </summary>
            <label className="field">
              Nome
              <input
                aria-label="Nome da animação"
                value={name}
                maxLength={120}
                disabled={disabled}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <div className="motion-color-fields">
              <label>
                Cor de destaque
                <input
                  aria-label="Cor da animação"
                  type="color"
                  value={accent}
                  disabled={disabled}
                  onChange={(event) => setAccent(event.target.value)}
                />
              </label>
              <label>
                Fundo
                <input
                  aria-label="Fundo da animação"
                  type="color"
                  value={background}
                  disabled={disabled}
                  onChange={(event) => setBackground(event.target.value)}
                />
              </label>
            </div>
            {preset === "custom" && (
              <>
                <p className="tool-hint">
                  HTML/CSS local, sem scripts ou recursos externos. Movimento
                  por seletores e propriedades GSAP.
                </p>
                <label className="field">
                  HTML/CSS
                  <textarea
                    className="motion-code"
                    aria-label="HTML e CSS da animação"
                    rows={7}
                    value={html}
                    disabled={disabled}
                    onChange={(event) => setHtml(event.target.value)}
                    spellCheck={false}
                  />
                </label>
                <label className="field">
                  Animações JSON
                  <textarea
                    className="motion-code"
                    aria-label="Animações JSON"
                    rows={6}
                    value={animations}
                    disabled={disabled}
                    onChange={(event) => setAnimations(event.target.value)}
                    spellCheck={false}
                  />
                </label>
              </>
            )}
          </details>
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
          <button
            className="button primary full-width"
            type="submit"
            disabled={disabled}
          >
            {editingId ? "Salvar animação" : "Adicionar à timeline"}
          </button>
        </form>
      )}
      <small className="tool-hint">
        Ou peça no chat: “Anime as três etapas quando eu começar a explicação”.
      </small>
    </div>
  );
}

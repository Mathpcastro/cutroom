import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { Project } from "../shared/types";
import {
  CAPTION_FONTS,
  CAPTION_PRESETS,
  resolveCaptionSettings,
} from "../shared/captions";
import type { CaptionSettings } from "../shared/captions";
import "./caption-studio.css";

const SAVED_KEY = "cutroom.caption-styles.v1";
type SavedStyle = { id: string; name: string; style: CaptionSettings };
function readSaved(): SavedStyle[] {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(SAVED_KEY) ?? "[]");
    return Array.isArray(data)
      ? data
          .filter((entry): entry is SavedStyle => {
            try {
              return (
                typeof entry.id === "string" &&
                typeof entry.name === "string" &&
                !!resolveCaptionSettings(entry.style)
              );
            } catch {
              return false;
            }
          })
          .slice(0, 50)
      : [];
  } catch {
    return [];
  }
}
export function CaptionStudio({
  project,
  disabled,
  onChange,
}: {
  project: Project;
  disabled: boolean;
  onChange: (style: CaptionSettings) => void;
}) {
  const [current, setCurrent] = useState(() =>
    resolveCaptionSettings(project.settings.captionStyle),
  );
  const draft = useRef(current),
    editing = useRef(false),
    projectId = useRef(project.id);
  const committed = useRef(JSON.stringify(current)),
    pending = useRef<string | null>(null);
  useEffect(() => {
    const incoming = resolveCaptionSettings(project.settings.captionStyle),
      signature = JSON.stringify(incoming);
    if (project.id !== projectId.current) {
      projectId.current = project.id;
      editing.current = false;
      pending.current = null;
    }
    if (
      editing.current ||
      (pending.current && pending.current !== signature && disabled)
    )
      return;
    pending.current = null;
    committed.current = signature;
    draft.current = incoming;
    setCurrent(incoming);
  }, [project, disabled]);
  const [category, setCategory] = useState("Todos");
  const [saved, setSaved] = useState<SavedStyle[]>(readSaved);
  const [saveName, setSaveName] = useState("");
  const [notice, setNotice] = useState("");
  const applyStyle = (style: CaptionSettings) => {
    editing.current = false;
    draft.current = style;
    setCurrent(style);
    const signature = JSON.stringify(style);
    if (signature === committed.current && project.settings.captions) return;
    committed.current = signature;
    pending.current = signature;
    onChange(style);
  };
  const commitDraft = () => {
    if (editing.current) applyStyle(draft.current);
  };
  const patch = (value: Partial<CaptionSettings>, defer = false) => {
    const style = resolveCaptionSettings({ ...draft.current, ...value });
    draft.current = style;
    setCurrent(style);
    if (defer) editing.current = true;
    else applyStyle(style);
  };
  const categories = [
    "Todos",
    ...new Set(CAPTION_PRESETS.map((p) => p.category)),
  ];
  const persist = (entries: SavedStyle[]) => {
    try {
      localStorage.setItem(SAVED_KEY, JSON.stringify(entries));
      setSaved(entries);
      return true;
    } catch {
      setNotice("Não foi possível salvar o estilo neste computador.");
      return false;
    }
  };
  return (
    <section className="caption-studio" aria-label="Estúdio de legendas">
      <div className="caption-studio-heading">
        <strong>Legendas com intenção.</strong>
        <span>{CAPTION_PRESETS.length} estilos</span>
      </div>
      <p className="caption-studio-intro">
        Escolha um estilo e veja o resultado no vídeo. Ajustes ficam salvos no
        projeto.
      </p>
      {!project.words.length && (
        <p className="caption-studio-note">
          Ao aplicar, o CutRoom prepara a transcrição local para sincronizar as
          legendas.
        </p>
      )}
      <div className="caption-category-list" aria-label="Categorias de legenda">
        {categories.map((item) => (
          <button
            type="button"
            key={item}
            aria-pressed={category === item}
            onClick={() => setCategory(item)}
          >
            {item}
          </button>
        ))}
      </div>
      <div className="caption-preset-list" aria-label="Estilos de legenda">
        {CAPTION_PRESETS.filter(
          (p) => category === "Todos" || p.category === category,
        ).map((p) => {
          const s = p.settings;
          return (
            <button
              type="button"
              key={p.id}
              disabled={disabled}
              className={`caption-preset ${current.presetId === p.id ? "selected" : ""}`}
              aria-pressed={current.presetId === p.id}
              title={p.description}
              onClick={() => applyStyle({ ...s })}
            >
              <div
                className={`caption-preset-sample mode-${s.mode} background-${s.background} position-${s.position}`}
                style={
                  {
                    "--sample-color": s.color,
                    "--sample-active": s.activeColor,
                    "--sample-bg": s.backgroundColor,
                    fontFamily: s.fontFamily,
                    fontWeight: s.bold ? 800 : 400,
                    fontStyle: s.italic ? "italic" : "normal",
                    textTransform:
                      s.casing === "upper"
                        ? "uppercase"
                        : s.casing === "lower"
                          ? "lowercase"
                          : "none",
                    letterSpacing: s.spacing * 0.15,
                  } as CSSProperties
                }
              >
                <span>
                  {s.mode === "word" ? (
                    "Foco"
                  ) : s.mode === "typewriter" ? (
                    "Sua voz…"
                  ) : s.mode === "cumulative" ? (
                    "Sua voz"
                  ) : (
                    <>
                      Sua <em>voz</em> em foco
                    </>
                  )}
                </span>
              </div>
              <span className="caption-preset-name">
                {p.name}
                <small>
                  {s.mode === "word" ? "1 palavra" : `${s.maxWords} palavras`} ·{" "}
                  {s.fontFamily}
                </small>
              </span>
            </button>
          );
        })}
      </div>
      <details className="caption-customize">
        <summary>Personalizar estilo</summary>
        <fieldset
          disabled={disabled}
          className="caption-controls"
          onPointerUp={commitDraft}
          onKeyUp={commitDraft}
          onBlur={commitDraft}
        >
          <label>
            Fonte
            <select
              value={current.fontFamily}
              onChange={(e) => patch({ fontFamily: e.target.value })}
            >
              {CAPTION_FONTS.map((font) => (
                <option key={font}>{font}</option>
              ))}
            </select>
          </label>
          <label>
            Tamanho <output>{current.fontSize}</output>
            <input
              aria-label="Tamanho da legenda"
              type="range"
              min="24"
              max="160"
              step="2"
              value={current.fontSize}
              onChange={(e) =>
                patch({ fontSize: Number(e.target.value) }, true)
              }
            />
          </label>
          <label>
            Palavras por frase
            <input
              aria-label="Palavras por frase"
              type="number"
              min="1"
              max="16"
              value={current.maxWords}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (n >= 1 && n <= 16) patch({ maxWords: n });
              }}
            />
          </label>
          <label>
            Comportamento
            <select
              value={current.mode}
              onChange={(e) =>
                patch({ mode: e.target.value as CaptionSettings["mode"] })
              }
            >
              {Object.entries({
                phrase: "Frase inteira",
                highlight: "Palavra ativa",
                karaoke: "Karaokê",
                word: "Uma palavra",
                cumulative: "Frase progressiva",
                typewriter: "Letra por letra",
                emphasis: "Última palavra em destaque",
              }).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Posição
            <select
              value={current.position}
              onChange={(e) =>
                patch({
                  position: e.target.value as CaptionSettings["position"],
                })
              }
            >
              <option value="top">Topo</option>
              <option value="center">Centro</option>
              <option value="bottom">Inferior</option>
            </select>
          </label>
          <label>
            Margem segura <output>{current.margin}%</output>
            <input
              aria-label="Margem da legenda"
              type="range"
              min="4"
              max="42"
              value={current.margin}
              onChange={(e) => patch({ margin: Number(e.target.value) }, true)}
            />
          </label>
          <label>
            Animação
            <select
              value={current.animation}
              onChange={(e) =>
                patch({
                  animation: e.target.value as CaptionSettings["animation"],
                })
              }
            >
              {Object.entries({
                none: "Sem movimento",
                fade: "Fade",
                pop: "Pop",
                bounce: "Salto",
                rise: "Subida",
                slide: "Entrada lateral",
              }).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Caixa do texto
            <select
              value={current.casing}
              onChange={(e) =>
                patch({ casing: e.target.value as CaptionSettings["casing"] })
              }
            >
              <option value="original">Original</option>
              <option value="upper">MAIÚSCULAS</option>
              <option value="lower">minúsculas</option>
            </select>
          </label>
          <div className="caption-color-row">
            <label>
              Texto
              <input
                aria-label="Cor do texto da legenda"
                type="color"
                value={current.color}
                onChange={(e) => patch({ color: e.target.value }, true)}
              />
            </label>
            <label>
              Destaque
              <input
                aria-label="Cor da palavra ativa"
                type="color"
                value={current.activeColor}
                onChange={(e) => patch({ activeColor: e.target.value }, true)}
              />
            </label>
            <label>
              Contorno
              <input
                aria-label="Cor do contorno"
                type="color"
                value={current.outlineColor}
                onChange={(e) => patch({ outlineColor: e.target.value }, true)}
              />
            </label>
          </div>
          <label>
            Espessura do contorno <output>{current.outline}</output>
            <input
              aria-label="Espessura do contorno"
              type="range"
              min="0"
              max="12"
              step=".5"
              value={current.outline}
              onChange={(e) => patch({ outline: Number(e.target.value) }, true)}
            />
          </label>
          <label>
            Fundo
            <select
              value={current.background}
              onChange={(e) =>
                patch({
                  background: e.target.value as CaptionSettings["background"],
                })
              }
            >
              <option value="none">Sem fundo</option>
              <option value="box">Caixa</option>
              <option value="pill">Pílula arredondada</option>
            </select>
          </label>
          <div className="caption-color-row">
            <label>
              Cor do fundo
              <input
                aria-label="Cor do fundo da legenda"
                type="color"
                value={current.backgroundColor}
                onChange={(e) =>
                  patch({ backgroundColor: e.target.value }, true)
                }
              />
            </label>
            <label>
              Opacidade{" "}
              <output>{Math.round(current.backgroundOpacity * 100)}%</output>
              <input
                aria-label="Opacidade do fundo"
                type="range"
                min="0"
                max="1"
                step=".05"
                value={current.backgroundOpacity}
                onChange={(e) =>
                  patch({ backgroundOpacity: Number(e.target.value) }, true)
                }
              />
            </label>
          </div>
          <div className="caption-weight-row">
            <label>
              <input
                type="checkbox"
                checked={current.bold}
                onChange={(e) => patch({ bold: e.target.checked })}
              />{" "}
              Negrito
            </label>
            <label>
              <input
                type="checkbox"
                checked={current.italic}
                onChange={(e) => patch({ italic: e.target.checked })}
              />{" "}
              Itálico
            </label>
          </div>
          <label>
            Espaçamento <output>{current.spacing}</output>
            <input
              aria-label="Espaçamento das letras"
              type="range"
              min="-2"
              max="8"
              step=".5"
              value={current.spacing}
              onChange={(e) => patch({ spacing: Number(e.target.value) }, true)}
            />
          </label>
        </fieldset>
      </details>
      <details className="caption-customize">
        <summary>
          Meus estilos <span>{saved.length}</span>
        </summary>
        <div className="caption-save-style">
          <input
            aria-label="Nome do estilo de legenda"
            value={saveName}
            maxLength={60}
            placeholder="Ex.: Reels da minha marca"
            onChange={(e) => setSaveName(e.target.value)}
          />
          <button
            type="button"
            disabled={!saveName.trim() || disabled}
            onClick={() => {
              if (
                persist([
                  ...saved.slice(-49),
                  {
                    id: crypto.randomUUID(),
                    name: saveName.trim(),
                    style: { ...current },
                  },
                ])
              ) {
                setNotice("Estilo salvo para os próximos projetos.");
                setSaveName("");
              }
            }}
          >
            Salvar
          </button>
        </div>
        {saved.length ? (
          saved.map((entry) => (
            <div className="caption-saved-row" key={entry.id}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => applyStyle({ ...entry.style })}
              >
                {entry.name}
                <small>
                  {entry.style.fontFamily} · {entry.style.fontSize}
                </small>
              </button>
              <button
                type="button"
                aria-label={`Excluir estilo ${entry.name}`}
                onClick={() =>
                  persist(saved.filter((item) => item.id !== entry.id))
                }
              >
                ×
              </button>
            </div>
          ))
        ) : (
          <p className="caption-studio-note">
            Salve sua combinação de fonte, cores e comportamento para reutilizar
            em qualquer projeto.
          </p>
        )}
      </details>
      {notice && (
        <p className="caption-studio-note" role="status">
          {notice}
        </p>
      )}
    </section>
  );
}

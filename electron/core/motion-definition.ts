import { parseHTML } from "linkedom";
import type { MotionScene, MotionTween, Project } from "../../src/shared/types";
import { MOTION_PRESETS, presetMotion } from "../../src/shared/motions";

const fail = (s: string): never => {
  throw new Error(s);
};
const number = (v: unknown, min: number, max: number) =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max
    ? v
    : fail("Tempo de animação inválido.");
const text = (v: unknown, max: number, fallback = "") =>
  v === undefined
    ? fallback
    : typeof v === "string" && v.length <= max
      ? v
      : fail("Texto de animação inválido.");
const color = (v: unknown, fallback: string) =>
  v === undefined
    ? fallback
    : typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v)
      ? v
      : fail("Cor de animação inválida.");
const PROPS = new Set([
  "x",
  "y",
  "xPercent",
  "yPercent",
  "scale",
  "scaleX",
  "scaleY",
  "rotation",
  "rotationX",
  "rotationY",
  "opacity",
  "autoAlpha",
  "color",
  "backgroundColor",
  "borderColor",
  "borderRadius",
  "width",
  "height",
  "letterSpacing",
  "fontSize",
  "clipPath",
  "filter",
  "transformOrigin",
]);
export function validateMotionHtml(html: string) {
  if (!html.trim() || html.length > 100000)
    fail("HTML de animação vazio ou grande demais.");
  const { document } = parseHTML(`<html><body>${html}</body></html>`);
  const allowed = new Set(
    "html head body div section article span p h1 h2 h3 h4 strong em b i small br ul ol li style svg g path rect circle ellipse line polyline polygon text defs lineargradient radialgradient stop clippath mask symbol use".split(
      " ",
    ),
  );
  for (const node of document.querySelectorAll("*")) {
    if (!allowed.has(node.localName.toLowerCase()))
      fail(
        `Elemento não permitido na animação: ${node.localName}. Use HTML/CSS sem scripts ou mídia externa.`,
      );
    for (const attr of Array.from(node.attributes)) {
      if (
        /^on|^(src|href|xlink:href|srcset|nonce|is|formaction)$/i.test(
          attr.name,
        )
      )
        fail(
          "A animação não pode carregar recursos externos ou executar scripts.",
        );
    }
  }
  // No CSS imports, external URLs, escaped protocol names, or animation clocks independent of the playhead.
  if (
    /@import|@font-face|url\s*\(|\\|<\s*\/??\s*(script|iframe)|(?:animation|transition)(?:-[a-z-]+)?\s*:/i.test(
      html,
    )
  )
    fail(
      "Use CSS local e movimento na lista animations; URLs e scripts não são permitidos.",
    );
}
export function validateMotion(scene: MotionScene): MotionScene {
  text(scene.id, 200) || fail("ID de animação inválido.");
  text(scene.name, 120) || fail("Nome de animação inválido.");
  number(scene.start, 0, 7 * 86400);
  number(scene.end, scene.start + 0.00001, 7 * 86400);
  number(scene.duration, 0.05, 120);
  const rate = number(scene.playbackRate ?? 1, 0.01, 256);
  const offset = number(scene.sourceOffset ?? 0, 0, scene.duration);
  if (offset + (scene.end - scene.start) * rate > scene.duration + 0.001)
    fail("A cena excede a duração da animação.");
  if (!["overlay", "fullscreen"].includes(scene.mode))
    fail("Composição inválida.");
  validateMotionHtml(text(scene.html, 100000));
  const { document } = parseHTML(`<html><body>${scene.html}</body></html>`);
  if (!Array.isArray(scene.animations) || scene.animations.length > 100)
    fail("Lista de animações inválida.");
  for (const tween of scene.animations) {
    const selector = text(tween.selector, 200);
    if (!selector || !/^[.#a-zA-Z0-9_\- >,:()\[\]="']+$/.test(selector))
      fail("Seletor de animação inválido.");
    try {
      if (!document.querySelector(selector))
        fail("O seletor não encontra um elemento da cena.");
    } catch {
      fail("Seletor de animação inválido ou sem elemento correspondente.");
    }
    number(tween.start, 0, scene.duration);
    number(tween.duration, 0.001, scene.duration);
    if (tween.start + tween.duration > scene.duration + 0.001)
      fail("Movimento fora da duração da cena.");
    if (
      tween.ease !== undefined &&
      !/^(none|linear|power[1-4]\.(in|out|inOut)|back\.(in|out|inOut)|sine\.(in|out|inOut)|expo\.(in|out|inOut))$/.test(
        tween.ease,
      )
    )
      fail("Curva de animação inválida.");
    for (const [index, vars] of [tween.from, tween.to].entries()) {
      if (index === 0 && vars === undefined) continue;
      if (!vars || typeof vars !== "object" || Array.isArray(vars))
        fail("Propriedades de movimento inválidas.");
      for (const [key, value] of Object.entries(vars!)) {
        if (
          !PROPS.has(key) ||
          !(
            (typeof value === "number" &&
              Number.isFinite(value) &&
              Math.abs(value) <= 100000) ||
            (typeof value === "string" &&
              value.length <= 200 &&
              !/[<>\\;]|url\s*\(/i.test(value))
          )
        )
          fail("Propriedade de movimento não permitida.");
      }
    }
  }
  color(scene.accent, "#ff6b0b");
  color(scene.background, "#151515");
  return scene;
}
export function makeMotion(
  project: Project,
  args: Record<string, unknown>,
  id: string,
): MotionScene {
  const previous = args.id
    ? (project.motions?.find((s) => s.id === args.id) ??
      fail("Animação não encontrada."))
    : undefined;
  const a = { ...previous, ...args };
  if (args.html !== undefined && args.presetId === undefined)
    a.presetId = undefined;
  const total = project.clips.reduce(
    (sum, c) => sum + (c.end - c.start) / c.speed,
    0,
  );
  const start = number(a.start, 0, total),
    end = number(a.end, start + 0.05, total);
  const duration = end - start;
  if (duration > 120) fail("Cada cena pode ter até 120 segundos.");
  const preset = MOTION_PRESETS.find((p) => p.id === a.presetId);
  if (a.presetId !== undefined && !preset)
    fail("Modelo de animação desconhecido.");
  const title = text(a.text, 500),
    subtitle = text(a.subtitle, 500),
    accent = color(a.accent, project.settings.accent),
    background = color(a.background, "#151515");
  const items =
    a.items === undefined
      ? []
      : Array.isArray(a.items) && a.items.length <= 6
        ? a.items.map((x) => text(x, 300))
        : fail("Use até seis etapas.");
  const content = preset
    ? presetMotion(
        preset.id,
        {
          text: title || fail("Escreva o texto da animação."),
          subtitle,
          items,
          accent,
        },
        duration,
      )
    : { html: text(a.html, 100000), animations: a.animations as MotionTween[] };
  // Moving/resizing an existing custom scene retimes its visible interval. Keep
  // the authored clock, including any phase retained after a video cut.
  const preserve =
    previous &&
    !preset &&
    content.html === previous.html &&
    JSON.stringify(content.animations) === JSON.stringify(previous.animations);
  return validateMotion({
    id: previous?.id ?? id,
    name: text(a.name, 120, preset?.name ?? "Cena personalizada"),
    start,
    end,
    duration: preserve ? previous.duration : duration,
    ...(preserve
      ? {
          sourceOffset: previous.sourceOffset ?? 0,
          playbackRate:
            ((previous.end - previous.start) * (previous.playbackRate ?? 1)) /
            duration,
        }
      : {}),
    mode: (a.mode as MotionScene["mode"]) ?? preset?.mode ?? "overlay",
    ...content,
    ...(preset ? { presetId: preset.id, text: title, subtitle, items } : {}),
    accent,
    background,
  });
}

import type {
  MotionPresetId,
  MotionScene,
  MotionTween,
  Project,
} from "./types";

export const MOTION_PRESETS: {
  id: MotionPresetId;
  name: string;
  description: string;
  mode: "overlay" | "fullscreen";
}[] = [
  {
    id: "title",
    name: "Título animado",
    description: "Uma ideia em destaque",
    mode: "overlay",
  },
  {
    id: "lower-third",
    name: "Identificação",
    description: "Nome e complemento",
    mode: "overlay",
  },
  {
    id: "highlight",
    name: "Destaque",
    description: "Chame a atenção para uma frase",
    mode: "overlay",
  },
  {
    id: "steps",
    name: "Etapas",
    description: "Explique uma sequência",
    mode: "fullscreen",
  },
  {
    id: "stat",
    name: "Número em foco",
    description: "Um dado com contexto",
    mode: "fullscreen",
  },
  {
    id: "explainer",
    name: "Diagrama",
    description: "Conecte conceitos",
    mode: "fullscreen",
  },
];
export const motionLocalTime = (scene: MotionScene, time: number) =>
  Math.max(
    0,
    Math.min(
      scene.duration,
      (scene.sourceOffset ?? 0) +
        (time - scene.start) * (scene.playbackRate ?? 1),
    ),
  );
/** Match per-clip frame rounding in the video exporter without restarting the authored animation. */
export function motionExportSegments(scene: MotionScene, project: Project) {
  const segments: {
    start: number;
    end: number;
    sourceOffset: number;
    playbackRate: number;
  }[] = [];
  let original = 0,
    rendered = 0;
  for (const clip of project.clips) {
    const raw = (clip.end - clip.start) / clip.speed,
      rounded =
        Math.max(1, Math.round(raw * project.settings.fps)) /
        project.settings.fps;
    const start = Math.max(scene.start, original),
      end = Math.min(scene.end, original + raw);
    if (end > start + 0.00001)
      segments.push({
        start: rendered + ((start - original) * rounded) / raw,
        end: rendered + ((end - original) * rounded) / raw,
        sourceOffset:
          (scene.sourceOffset ?? 0) +
          (start - scene.start) * (scene.playbackRate ?? 1),
        playbackRate: ((scene.playbackRate ?? 1) * raw) / rounded,
      });
    original += raw;
    rendered += rounded;
  }
  return segments;
}
const escape = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );

export function presetMotion(
  id: MotionPresetId,
  data: { text: string; subtitle?: string; items?: string[]; accent?: string },
  duration: number,
): { html: string; animations: MotionTween[] } {
  const text = escape(data.text),
    sub = escape(data.subtitle ?? ""),
    color = data.accent ?? "#ff6b0b";
  const items = (data.items ?? []).slice(0, 6);
  const cards = items
    .map(
      (item, i) =>
        `<div class="card card-${i}"><span class="number">${String(i + 1).padStart(2, "0")}</span><span>${escape(item)}</span></div>`,
    )
    .join("");
  const html = `<style>
    .scene{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;padding:8%;font-family:Barlow,sans-serif;color:#fff;box-sizing:border-box}
    .panel{max-width:88%;padding:3.2%;border-left:8px solid ${color};background:rgba(16,16,19,.92);border-radius:12px}
    h1{font-size:80px;line-height:1.1;letter-spacing:-2px;margin:0;font-weight:700}p{font-size:36px;line-height:1.4;margin:24px 0 0;color:#c8c8cc}
    .lower-third{justify-content:flex-end;padding-bottom:10%}.lower-third h1{font-size:58px}.highlight .panel{align-self:center;text-align:center;border-left:0;border-bottom:6px solid ${color}}
    .stat h1{font-size:150px;color:${color}}.cards{display:flex;gap:28px;margin-top:54px;flex-wrap:wrap}.card{flex:1;min-width:160px;font-size:34px;padding:30px;background:#242428;border:1px solid #424248;border-radius:16px;display:flex;flex-direction:column;gap:24px}.number{color:${color};font-size:27px;font-weight:700}.steps .panel,.explainer .panel,.stat .panel{max-width:100%;background:none;border:0;padding:0}.explainer .card{border-top:4px solid ${color}}
  </style><section class="scene ${id}"><div class="panel"><h1>${text}</h1>${sub ? `<p>${sub}</p>` : ""}${cards ? `<div class="cards">${cards}</div>` : ""}</div></section>`;
  const fade = Math.min(0.5, duration / 4);
  const animations: MotionTween[] = [
    {
      selector: ".panel",
      start: 0,
      duration: fade,
      from: { opacity: 0, y: 32 },
      to: { opacity: 1, y: 0 },
      ease: "power2.out",
    },
  ];
  items.forEach((_, i) =>
    animations.push({
      selector: `.card-${i}`,
      start: Math.min(fade + i * 0.18, duration / 2),
      duration: fade,
      from: { opacity: 0, y: 24 },
      to: { opacity: 1, y: 0 },
      ease: "power2.out",
    }),
  );
  animations.push({
    selector: ".scene",
    start: duration - fade,
    duration: fade,
    to: { opacity: 0 },
    ease: "power1.in",
  });
  return { html, animations };
}

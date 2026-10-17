import type { Overlay, Project } from "../shared/types";

interface Props {
  overlay: Overlay;
  project: Project;
  time: number;
  scale: number;
}

/** Mirrors the composition geometry in createAss; font rasterization can differ in the monitor. */
export function OverlayPreview({ overlay, project, time, scale }: Props) {
  const { width, height, accent } = project.settings;
  const unit = Math.min(width / 1920, height / 1080);
  const full = ["title", "statement", "cover"].includes(overlay.kind);
  const end = Math.min(
    overlay.end,
    project.clips.reduce(
      (total, clip) => total + (clip.end - clip.start) / clip.speed,
      0,
    ),
  );
  const steps =
    overlay.kind === "flow"
      ? overlay.text.split(/\s*(?:→|->|\n)\s*/).filter(Boolean)
      : [];
  const step = Math.min(
    steps.length,
    Math.floor(
      ((time - overlay.start) / Math.max(0.001, end - overlay.start)) *
        steps.length,
    ) + 1,
  );
  const text =
    steps.length > 1 ? steps.slice(0, step).join(" → ") : overlay.text;
  const size = (overlay.kind === "promo" ? 60 : full ? 78 : 44) * unit;
  const chars = full
    ? Math.floor((width / Math.max(1, size * 0.55)) * 0.8)
    : Math.floor((width * 0.6) / Math.max(1, size * 0.55));
  const opacity = Math.min(
    1,
    Math.max(0, (time - overlay.start) / 0.18),
    Math.max(0, (end - time) / 0.16),
  );
  return (
    <div
      className={`render-overlay render-overlay-${overlay.kind}`}
      style={{ "--overlay-accent": accent, opacity } as React.CSSProperties}
    >
      <div className="render-overlay-background" />
      <div
        className="render-overlay-text"
        style={{
          fontSize: size * scale,
          maxWidth: `${Math.min(full ? 90 : 65, ((chars * size * 0.55) / width) * 100)}%`,
        }}
      >
        {text}
      </div>
    </div>
  );
}

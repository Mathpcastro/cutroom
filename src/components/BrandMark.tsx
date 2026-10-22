import { brandBars, brandTransform, brandViewBox } from "../shared/branding";

export function BrandMark({ size = 16 }: { size?: number }) {
  return (
    <svg
      className="cutroom-mark"
      width={size}
      height={(size * 31) / 25}
      viewBox={brandViewBox}
      fill="currentColor"
      stroke="none"
      aria-hidden="true"
      focusable="false"
    >
      <g transform={brandTransform}>
        {brandBars.map((bar) => <rect key={bar.x} {...bar} />)}
      </g>
    </svg>
  );
}

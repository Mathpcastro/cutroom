import {
  brandColors,
  brandPath,
  brandViewBox,
} from "../shared/branding";

export function BrandMark({
  size = 16,
  title,
}: {
  size?: number;
  title?: string;
}) {
  return (
    <svg
      className="cutroom-mark"
      width={size}
      height={size}
      viewBox={brandViewBox}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      <rect x="2" y="2" width="60" height="60" rx="16" fill={brandColors.violet} />
      <path
        d={brandPath}
        fill="none"
        stroke={brandColors.white}
        strokeWidth="7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="46" cy="18" r="5" fill={brandColors.lime} />
    </svg>
  );
}

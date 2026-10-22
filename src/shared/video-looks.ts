import type { Clip } from "./types";
export const VIDEO_LOOKS = [
  "none",
  "monochrome",
  "cinema",
  "vivid",
  "blur",
  "vignette",
  "color-wipe",
] as const;
export function videoLookCss(clip: Clip | undefined, width = 1920): string {
  switch (clip?.look) {
    case "monochrome":
      return "grayscale(1) contrast(1.2)";
    case "cinema":
      return "saturate(.75) contrast(1.08)";
    case "vivid":
    case "color-wipe":
      return "saturate(1.35) contrast(1.06)";
    case "blur":
      return `blur(${(8 * width) / 1920}px)`;
    default:
      return "none";
  }
}
export function videoLookFilters(clip: Clip, width = 1920): string[] {
  const result: string[] = [];
  switch (clip.look) {
    case "monochrome":
      result.push("hue=s=0", "eq=contrast=1.2");
      break;
    case "cinema":
      result.push(
        "eq=saturation=.75:contrast=1.08",
        "drawbox=x=0:y=0:w=iw:h=ih*.11:color=black:t=fill",
        "drawbox=x=0:y=ih*.89:w=iw:h=ih*.11:color=black:t=fill",
      );
      break;
    case "vivid":
      result.push("eq=saturation=1.35:contrast=1.06");
      break;
    case "blur":
      result.push(`gblur=sigma=${(8 * width) / 1920}`);
      break;
    case "vignette":
      result.push("vignette=angle=PI/5");
      break;
  }
  if (clip.mirrored) result.push("hflip");
  return result;
}
export function wipeProgress(clip: Clip | undefined, sourceTime: number) {
  if (clip?.look !== "color-wipe") return 0;
  return Math.max(
    0,
    Math.min(
      1,
      (sourceTime - (clip.lookStart ?? clip.start)) /
        ((clip.lookEnd ?? clip.end) - (clip.lookStart ?? clip.start)),
    ),
  );
}

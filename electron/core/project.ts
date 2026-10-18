import { randomUUID } from "node:crypto";
import {
  captionTimelineWords,
  resolveCaptionSettings,
} from "../../src/shared/captions";
import type { CaptionSettings } from "../../src/shared/captions";
import type {
  Clip,
  EditCommand,
  Media,
  OverlayKind,
  Project,
  Word,
} from "../../src/shared/types";

const id = () => randomUUID();
const fail = (message: string): never => {
  throw new Error(message);
};
const num = (
  v: unknown,
  label: string,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
): number =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max
    ? v
    : fail(`${label} inválido.`);
const str = (v: unknown, label: string, max = 20000): string =>
  typeof v === "string" && v.length > 0 && v.length <= max
    ? v
    : fail(`${label} inválido.`);
const bool = (v: unknown, label: string): boolean =>
  typeof v === "boolean" ? v : fail(`${label} inválido.`);
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : fail("Projeto ou comando inválido.");
const kinds: OverlayKind[] = [
  "title",
  "statement",
  "callout",
  "flow",
  "promo",
  "cover",
];
const eps = 0.00001;

export function createProject(): Project {
  const now = new Date().toISOString();
  return {
    version: 1,
    id: id(),
    name: "Novo projeto",
    createdAt: now,
    updatedAt: now,
    media: [],
    clips: [],
    words: [],
    overlays: [],
    settings: {
      captions: false,
      normalize: true,
      targetLufs: -14,
      width: 1920,
      height: 1080,
      fps: 30,
      accent: "#FF6B0B",
    },
  };
}

export const clipDuration = (clip: Clip) =>
  (clip.end - clip.start) / clip.speed;
export const projectDuration = (project: Project) =>
  project.clips.reduce((total, clip) => total + clipDuration(clip), 0);

/** Source seconds stay authoritative. Duplicate clips (including hooks) map a word more than once. */
export function timelineWords(project: Project): Word[] {
  return captionTimelineWords(project);
}

export function validateProject(value: unknown): Project {
  const p = obj(value);
  if (p.version !== 1) fail("Versão de projeto incompatível.");
  str(p.id, "ID", 200);
  str(p.name, "Nome", 300);
  for (const key of ["createdAt", "updatedAt"])
    if (!Number.isFinite(Date.parse(str(p[key], "Data", 100))))
      fail("Data de projeto inválida.");
  for (const key of ["media", "clips", "words", "overlays"])
    if (
      !Array.isArray(p[key]) ||
      (p[key] as unknown[]).length > (key === "words" ? 500000 : 10000)
    )
      fail(`Lista ${key} inválida ou grande demais.`);
  const media = p.media as Media[],
    clips = p.clips as Clip[];
  const unique = (items: { id: string }[]) => {
    if (new Set(items.map((i) => i.id)).size !== items.length)
      fail("IDs duplicados no projeto.");
  };
  for (const raw of media) {
    const m = obj(raw);
    str(m.id, "ID", 200);
    str(m.name, "Nome", 1000);
    str(m.path, "Caminho", 32768);
    num(m.duration, "Duração", 0.001, 7 * 86400);
    num(m.width, "Largura", 1, 32768);
    num(m.height, "Altura", 1, 32768);
    num(m.fps, "FPS", 0.01, 1000);
    bool(m.hasAudio, "Áudio");
    if (m.thumbnail !== undefined) str(m.thumbnail, "Miniatura", 32768);
    if (m.proxy !== undefined) str(m.proxy, "Proxy", 32768);
  }
  unique(media);
  const byId = new Map(media.map((m) => [m.id, m]));
  for (const raw of clips) {
    const c = obj(raw);
    str(c.id, "ID", 200);
    const source = byId.get(str(c.mediaId, "Fonte", 200));
    if (!source) fail("Trecho sem arquivo de origem.");
    num(c.start, "Início", 0, source!.duration);
    num(c.end, "Fim", 0, source!.duration + eps);
    if ((c.end as number) <= (c.start as number) + eps)
      fail("O fim do trecho deve vir depois do início.");
    num(c.speed, "Velocidade", 0.1, 16);
    num(c.zoom, "Zoom", 1, 4);
    bool(c.muted, "Mudo");
    if (c.focusX !== undefined) num(c.focusX, "Foco X", 0, 1);
    if (c.focusY !== undefined) num(c.focusY, "Foco Y", 0, 1);
  }
  unique(clips);
  for (const raw of p.words as Word[]) {
    const w = obj(raw);
    str(w.text, "Palavra", 1000);
    const source = byId.get(str(w.mediaId, "Fonte", 200));
    if (!source) fail("Palavra sem arquivo de origem.");
    num(w.start, "Início da palavra", 0, source!.duration);
    num(w.end, "Fim da palavra", 0, source!.duration + eps);
    if ((w.end as number) <= (w.start as number))
      fail("Tempo de palavra inválido.");
  }
  for (const raw of p.overlays as Project["overlays"]) {
    const o = obj(raw);
    str(o.id, "ID", 200);
    str(o.text, "Texto", 2000);
    if (!kinds.includes(o.kind as OverlayKind))
      fail("Tipo de motion inválido.");
    num(o.start, "Início do motion");
    num(o.end, "Fim do motion");
    if ((o.end as number) <= (o.start as number))
      fail("Tempo de motion inválido.");
  }
  unique(p.overlays as Project["overlays"]);
  const s = obj(p.settings);
  bool(s.captions, "Legendas");
  bool(s.normalize, "Normalização");
  num(s.targetLufs, "LUFS", -30, -5);
  for (const key of ["width", "height"]) {
    const n = num(s[key], key, 64, 7680);
    if (!Number.isInteger(n) || n % 2 !== 0)
      fail("Resolução deve ser um número par.");
  }
  num(s.fps, "FPS", 1, 120);
  if (typeof s.accent !== "string" || !/^#[a-f\d]{6}$/i.test(s.accent))
    fail("Cor de destaque inválida.");
  if (s.captionStyle !== undefined)
    resolveCaptionSettings(s.captionStyle as Partial<CaptionSettings>);
  return structuredClone(value) as Project;
}

type Range = { mediaId: string; start: number; end: number };
function removeRanges(
  project: Project,
  ranges: Range[],
  clipId?: string,
  lineage?: Map<string, string>,
): void {
  for (const r of ranges) {
    const m = project.media.find((m) => m.id === r.mediaId);
    if (!m) fail("Arquivo de origem não encontrado.");
    num(r.start, "Início do corte", 0, m!.duration);
    num(r.end, "Fim do corte", 0, m!.duration + eps);
    if (r.end <= r.start) fail("O corte precisa ter duração positiva.");
    project.clips = project.clips.flatMap((c) => {
      if (
        c.mediaId !== r.mediaId ||
        (clipId && c.id !== clipId) ||
        r.end <= c.start ||
        r.start >= c.end
      )
        return [c];
      const result: Clip[] = [];
      if (r.start > c.start + eps)
        result.push({ ...c, end: Math.min(r.start, c.end) });
      if (r.end < c.end - eps) {
        const nextId = result.length ? id() : c.id;
        result.push({ ...c, id: nextId, start: Math.max(r.end, c.start) });
        if (lineage) lineage.set(nextId, lineage.get(c.id) ?? c.id);
      }
      return result;
    });
  }
}
function silenceRanges(project: Project, value: unknown): Range[] {
  if (!Array.isArray(value))
    fail("Analise as pausas antes de aplicar os cortes.");
  return (value as unknown[])
    .map((raw) => {
      const r = obj(raw),
        mediaId = str(r.mediaId, "Fonte", 200),
        media =
          project.media.find((m) => m.id === mediaId) ??
          fail("Arquivo de origem não encontrado.");
      const start = num(r.start, "Início", 0, media.duration),
        end = num(r.end, "Fim", 0, media.duration);
      if (end <= start) fail("Intervalo de silêncio inválido.");
      const long = end - start > 1.4;
      return {
        mediaId,
        start: start + (long ? 0.2 : 0.09),
        end: end - (long ? 0.15 : 0.07),
      };
    })
    .filter((r) => r.end - r.start >= 0.08);
}
/** Keep motions attached to the surviving source content, including after speed changes. */
function remapOverlays(
  before: Project,
  after: Project,
  lineage: Map<string, string>,
): void {
  const oldOffsets = new Map<string, number>();
  let oldOffset = 0;
  for (const c of before.clips) {
    oldOffsets.set(c.id, oldOffset);
    oldOffset += clipDuration(c);
  }
  after.overlays = before.overlays.flatMap((overlay) => {
    const intervals: { start: number; end: number }[] = [];
    let offset = 0;
    for (const clip of after.clips) {
      const original = before.clips.find((c) => c.id === lineage.get(clip.id));
      if (original) {
        const from = oldOffsets.get(original.id)!;
        const sourceStart =
          original.start + Math.max(0, overlay.start - from) * original.speed;
        const sourceEnd =
          original.start +
          Math.min(clipDuration(original), overlay.end - from) * original.speed;
        const start = Math.max(clip.start, sourceStart),
          end = Math.min(clip.end, sourceEnd);
        if (end > start + eps)
          intervals.push({
            start: offset + (start - clip.start) / clip.speed,
            end: offset + (end - clip.start) / clip.speed,
          });
      }
      offset += clipDuration(clip);
    }
    return intervals.length
      ? [
          {
            ...overlay,
            start: Math.min(...intervals.map((i) => i.start)),
            end: Math.max(...intervals.map((i) => i.end)),
          },
        ]
      : [];
  });
}
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
function fillerRanges(project: Project): Range[] {
  const ranges: Range[] = [];
  for (const media of project.media) {
    const words = project.words
      .filter((w) => w.mediaId === media.id)
      .sort((a, b) => a.start - b.start);
    words.forEach((w, i) => {
      const text = norm(w.text),
        prev = norm(words[i - 1]?.text ?? ""),
        next = norm(words[i + 1]?.text ?? "");
      // A lone "é" is grammatically ambiguous: keep it. Only explicit elongated tokens are automatic fillers.
      const filler =
        /^(né|ah+|a{2,}h*|u+h+m*|uhm+|uhum|hum|hm+|hã+|ã+h*|ahn|eh+|e{2,}|é{2,}h*|éh+)$/.test(
          text,
        ) ||
        (text === "tipo" &&
          ![
            "um",
            "o",
            "esse",
            "este",
            "outro",
            "qualquer",
            "que",
            "de",
            "do",
            "dessa",
            "desse",
            "mesmo",
            "algum",
            "nenhum",
            "cada",
            "tal",
            "por",
            "no",
            "num",
          ].includes(prev) &&
          !["de", "do", "da", "dos", "das"].includes(next));
      if (filler)
        ranges.push({
          mediaId: media.id,
          start: Math.max(words[i - 1]?.end ?? 0, w.start - 0.045),
          end: Math.min(words[i + 1]?.start ?? media.duration, w.end + 0.06),
        });
    });
  }
  return ranges.filter((r) => r.end > r.start);
}

export function applyCommand(project: Project, command: EditCommand): Project {
  const p = validateProject(project),
    a = obj(command.args);
  const before = structuredClone(p),
    lineage = new Map(p.clips.map((c) => [c.id, c.id]));
  const clip = () =>
    p.clips.find((c) => c.id === a.clipId) ?? fail("Trecho não encontrado.");
  const selected = () => (a.clipId === undefined ? p.clips : [clip()]);
  switch (command.name) {
    case "rename":
      p.name = str(a.name, "Nome", 300).trim() || fail("O nome está vazio.");
      break;
    case "trim": {
      const c = clip();
      const start = num(a.start, "Início", c.start, c.end),
        end = num(a.end, "Fim", c.start, c.end);
      if (end <= start + eps) fail("O trecho precisa ter duração positiva.");
      c.start = start;
      c.end = end;
      break;
    }
    case "split": {
      const c = clip(),
        time = num(a.time, "Tempo", c.start + eps, c.end - eps),
        index = p.clips.indexOf(c);
      const nextId = id();
      lineage.set(nextId, c.id);
      p.clips.splice(
        index,
        1,
        { ...c, end: time },
        { ...c, id: nextId, start: time },
      );
      break;
    }
    case "delete_clip": {
      const c = clip();
      p.clips = p.clips.filter((x) => x.id !== c.id);
      break;
    }
    case "remove_range": {
      const c = a.clipId === undefined ? undefined : clip();
      const mediaId =
        c?.mediaId ??
        (a.mediaId === undefined && p.media.length === 1
          ? p.media[0].id
          : str(a.mediaId, "Fonte", 200));
      removeRanges(
        p,
        [{ mediaId, start: num(a.start, "Início"), end: num(a.end, "Fim") }],
        c?.id,
        lineage,
      );
      break;
    }
    case "zoom":
      for (const c of selected()) {
        c.zoom = num(a.factor, "Zoom", 1, 4);
        if (a.focusX !== undefined) c.focusX = num(a.focusX, "Foco X", 0, 1);
        if (a.focusY !== undefined) c.focusY = num(a.focusY, "Foco Y", 0, 1);
      }
      break;
    case "speed":
      for (const c of selected()) {
        c.speed = num(a.factor, "Velocidade", 0.1, 16);
        if (a.muted !== undefined) c.muted = bool(a.muted, "Mudo");
      }
      break;
    case "captions":
      p.settings.captions = bool(a.enabled, "Legendas");
      if (a.style !== undefined) {
        const change = obj(a.style) as Partial<CaptionSettings>;
        const base =
          change.presetId &&
          change.presetId !== p.settings.captionStyle?.presetId
            ? resolveCaptionSettings({ presetId: change.presetId })
            : resolveCaptionSettings(p.settings.captionStyle);
        p.settings.captionStyle = resolveCaptionSettings({
          ...base,
          ...change,
        });
      }
      break;
    case "normalize":
      p.settings.normalize = bool(a.enabled, "Normalização");
      if (a.targetLufs !== undefined)
        p.settings.targetLufs = num(a.targetLufs, "LUFS", -30, -5);
      break;
    case "overlay": {
      if (!kinds.includes(a.kind as OverlayKind))
        fail("Tipo de motion inválido.");
      const start = num(a.start, "Início", 0, projectDuration(p)),
        end = num(a.end, "Fim", 0, projectDuration(p));
      if (end <= start) fail("O motion precisa ter duração positiva.");
      p.overlays.push({
        id: id(),
        kind: a.kind as OverlayKind,
        text: str(a.text, "Texto", 2000),
        start,
        end,
      });
      break;
    }
    case "remove_silence": {
      removeRanges(p, silenceRanges(p, a.ranges), undefined, lineage);
      break;
    }
    case "remove_fillers":
      if (!p.words.length) fail("Transcreva o vídeo antes de remover muletas.");
      removeRanges(p, fillerRanges(p), undefined, lineage);
      break;
    case "preset": {
      if (a.ranges !== undefined)
        removeRanges(p, silenceRanges(p, a.ranges), undefined, lineage);
      else if (p.words.length) {
        const ranges: Range[] = [];
        for (const m of p.media) {
          const words = p.words
            .filter((w) => w.mediaId === m.id)
            .sort((a, b) => a.start - b.start);
          words.slice(1).forEach((w, i) => {
            const prev = words[i],
              gap = w.start - prev.end;
            if (gap >= 0.32) {
              const sentence = /[.!?]$/.test(prev.text);
              ranges.push({
                mediaId: m.id,
                start: prev.end + (sentence ? 0.18 : 0.09),
                end: w.start - (sentence ? 0.12 : 0.07),
              });
            }
          });
        }
        removeRanges(
          p,
          ranges.filter((r) => r.end > r.start),
          undefined,
          lineage,
        );
      }
      removeRanges(p, fillerRanges(p), undefined, lineage);
      p.clips = p.clips.flatMap((c) => {
        const count = clipDuration(c) > 9 ? Math.ceil(clipDuration(c) / 6) : 1;
        return Array.from({ length: count }, (_, i) => {
          const nextId = i ? id() : c.id;
          lineage.set(nextId, lineage.get(c.id) ?? c.id);
          return {
            ...c,
            id: nextId,
            start: c.start + ((c.end - c.start) * i) / count,
            end: c.start + ((c.end - c.start) * (i + 1)) / count,
          };
        });
      });
      p.clips.forEach((c, i) => {
        c.zoom = i % 2 && clipDuration(c) >= 1.1 ? 1.25 : 1;
        c.focusX = 0.4;
        c.focusY = 0.5;
      });
      p.settings.normalize = true;
      p.settings.targetLufs = -14;
      break;
    }
    case "hook": {
      const mediaId = str(a.mediaId, "Fonte", 200),
        m =
          p.media.find((m) => m.id === mediaId) ??
          fail("Arquivo de origem não encontrado.");
      const start = num(a.start, "Início", 0, m.duration),
        end = num(a.end, "Fim", 0, m.duration);
      if (end <= start) fail("O gancho precisa ter duração positiva.");
      if (a.move === true)
        removeRanges(p, [{ mediaId, start, end }], undefined, lineage);
      p.clips.unshift({
        id: id(),
        mediaId,
        start,
        end,
        speed: 1,
        zoom: 1,
        muted: false,
      });
      break;
    }
    case "reset": {
      p.clips = p.media.map((m) => ({
        id: id(),
        mediaId: m.id,
        start: 0,
        end: m.duration,
        speed: 1,
        zoom: 1,
        muted: false,
      }));
      p.overlays = [];
      p.settings = createProject().settings;
      const source = p.media[0];
      if (source) {
        const scale = Math.min(1, 7680 / Math.max(source.width, source.height));
        p.settings.width = Math.max(
          64,
          Math.round((source.width * scale) / 2) * 2,
        );
        p.settings.height = Math.max(
          64,
          Math.round((source.height * scale) / 2) * 2,
        );
        p.settings.fps = Math.max(1, Math.min(120, source.fps));
      }
      break;
    }
    default:
      fail("Comando de edição desconhecido.");
  }
  if (
    [
      "trim",
      "split",
      "delete_clip",
      "remove_range",
      "speed",
      "remove_silence",
      "remove_fillers",
      "preset",
      "hook",
    ].includes(command.name)
  )
    remapOverlays(before, p, lineage);
  const duration = projectDuration(p);
  p.overlays = p.overlays
    .filter((o) => o.start < duration)
    .map((o) => ({ ...o, end: Math.min(o.end, duration) }));
  p.updatedAt = new Date().toISOString();
  return validateProject(p);
}

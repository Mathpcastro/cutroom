import type { Project, Word } from "./types";

export type CaptionMode =
  | "phrase"
  | "highlight"
  | "karaoke"
  | "word"
  | "cumulative"
  | "typewriter"
  | "emphasis";
export type CaptionAnimation =
  "none" | "fade" | "pop" | "bounce" | "rise" | "slide";
export interface CaptionSettings {
  presetId: string;
  fontFamily: string;
  /** Pixels at a 1080px short edge; scales with output resolution. */
  fontSize: number;
  color: string;
  activeColor: string;
  outlineColor: string;
  outline: number;
  backgroundColor: string;
  backgroundOpacity: number;
  background: "none" | "box" | "pill";
  position: "top" | "center" | "bottom";
  /** Distance from nearest top/bottom edge, as percentage of output height. */
  margin: number;
  maxWords: number;
  mode: CaptionMode;
  animation: CaptionAnimation;
  casing: "original" | "upper" | "lower";
  bold: boolean;
  italic: boolean;
  spacing: number;
}
export interface CaptionPreset {
  id: string;
  name: string;
  category: string;
  description: string;
  settings: CaptionSettings;
}
export const CAPTION_FONTS = [
  "Barlow",
  "Montserrat",
  "Anton",
  "Lora",
  "Oswald",
  "Caveat",
] as const;
export const DEFAULT_CAPTION_SETTINGS: CaptionSettings = {
  presetId: "studio-highlight",
  fontFamily: "Barlow",
  fontSize: 64,
  color: "#FFFFFF",
  activeColor: "#FF6B0B",
  outlineColor: "#111111",
  outline: 3,
  backgroundColor: "#111111",
  backgroundOpacity: 0,
  background: "none",
  position: "bottom",
  margin: 13,
  maxWords: 5,
  mode: "highlight",
  animation: "none",
  casing: "original",
  bold: true,
  italic: false,
  spacing: 0,
};
function preset(
  id: string,
  name: string,
  category: string,
  description: string,
  settings: Partial<CaptionSettings>,
): CaptionPreset {
  return {
    id,
    name,
    category,
    description,
    settings: { ...DEFAULT_CAPTION_SETTINGS, ...settings, presetId: id },
  };
}
export const CAPTION_PRESETS: CaptionPreset[] = [
  preset(
    "studio-highlight",
    "Studio",
    "Destaque",
    "Frase de cinco palavras; a voz acende cada palavra.",
    {},
  ),
  preset(
    "clean-phrase",
    "Frase limpa",
    "Frases",
    "Frase inteira, seis palavras e entrada suave.",
    { mode: "phrase", maxWords: 6, animation: "fade", fontSize: 58 },
  ),
  preset(
    "documentary",
    "Documentário",
    "Editorial",
    "Duas linhas discretas em serifada, sem animação.",
    {
      fontFamily: "Lora",
      fontSize: 46,
      mode: "phrase",
      maxWords: 10,
      bold: false,
      margin: 9,
      outline: 2,
    },
  ),
  preset(
    "cinema",
    "Cinema",
    "Editorial",
    "Serifada em itálico, frase curta e fade longo.",
    {
      fontFamily: "Lora",
      fontSize: 54,
      italic: true,
      bold: false,
      mode: "phrase",
      maxWords: 7,
      animation: "fade",
      margin: 10,
    },
  ),
  preset(
    "karaoke",
    "Karaokê",
    "Destaque",
    "A cor percorre as palavras no ritmo da fala.",
    {
      mode: "karaoke",
      maxWords: 6,
      activeColor: "#FFE34D",
      fontFamily: "Montserrat",
      fontSize: 62,
    },
  ),
  preset(
    "karaoke-box",
    "Karaokê em caixa",
    "Destaque",
    "Preenchimento contínuo em uma caixa escura.",
    {
      mode: "karaoke",
      maxWords: 5,
      activeColor: "#78F0D4",
      background: "box",
      backgroundOpacity: 0.85,
      fontSize: 60,
    },
  ),
  preset(
    "word-pop",
    "Pop por palavra",
    "Palavra",
    "Uma palavra grande cresce a cada batida.",
    {
      mode: "word",
      maxWords: 1,
      fontFamily: "Montserrat",
      fontSize: 98,
      animation: "pop",
      casing: "upper",
      margin: 20,
      outline: 5,
    },
  ),
  preset(
    "word-bounce",
    "Bounce",
    "Palavra",
    "Uma palavra salta para o centro.",
    {
      mode: "word",
      maxWords: 1,
      fontFamily: "Anton",
      fontSize: 118,
      animation: "bounce",
      position: "center",
      casing: "upper",
      outline: 4,
    },
  ),
  preset(
    "word-slide",
    "Palavra em movimento",
    "Palavra",
    "Entrada lateral, palavra por palavra, no topo.",
    {
      mode: "word",
      maxWords: 1,
      fontFamily: "Oswald",
      fontSize: 90,
      animation: "slide",
      position: "top",
      margin: 18,
      casing: "upper",
    },
  ),
  preset(
    "word-pill",
    "Pílula falada",
    "Caixas",
    "Cada palavra em uma pílula com entrada pop.",
    {
      mode: "word",
      maxWords: 1,
      fontFamily: "Montserrat",
      fontSize: 78,
      background: "pill",
      backgroundOpacity: 0.95,
      animation: "pop",
      color: "#111111",
      backgroundColor: "#FFE34D",
      outline: 0,
    },
  ),
  preset(
    "build-up",
    "Construção",
    "Progressivas",
    "A frase cresce uma palavra de cada vez.",
    {
      mode: "cumulative",
      maxWords: 6,
      fontSize: 70,
      animation: "none",
      position: "center",
    },
  ),
  preset(
    "typewriter",
    "Máquina de escrever",
    "Progressivas",
    "As letras aparecem dentro do tempo de cada palavra.",
    {
      mode: "typewriter",
      maxWords: 7,
      fontFamily: "Lora",
      fontSize: 55,
      bold: false,
      background: "box",
      backgroundOpacity: 0.85,
      outline: 0,
    },
  ),
  preset(
    "build-up-top",
    "Manchete progressiva",
    "Progressivas",
    "Até quatro palavras sobem para uma manchete no topo.",
    {
      mode: "cumulative",
      maxWords: 4,
      fontFamily: "Anton",
      fontSize: 92,
      position: "top",
      margin: 16,
      casing: "upper",
      animation: "rise",
    },
  ),
  preset(
    "pill-phrase",
    "Pílula",
    "Caixas",
    "Frase curta com fundo arredondado e fade.",
    {
      mode: "phrase",
      maxWords: 4,
      background: "pill",
      backgroundOpacity: 0.92,
      animation: "fade",
      fontFamily: "Montserrat",
      fontSize: 58,
      outline: 0,
    },
  ),
  preset(
    "boxed-caption",
    "Tarja",
    "Caixas",
    "Sete palavras em caixa opaca, com alto contraste.",
    {
      mode: "phrase",
      maxWords: 7,
      background: "box",
      backgroundOpacity: 1,
      fontSize: 53,
      outline: 0,
      margin: 10,
    },
  ),
  preset(
    "highlight-pill",
    "Foco na voz",
    "Caixas",
    "Frase em pílula; a palavra ativa recebe a cor.",
    {
      mode: "highlight",
      maxWords: 4,
      background: "pill",
      backgroundOpacity: 0.88,
      fontSize: 64,
      outline: 0,
      activeColor: "#FFE34D",
    },
  ),
  preset(
    "social-impact",
    "Impacto",
    "Social",
    "Três palavras enormes, condensadas e em caixa alta.",
    {
      fontFamily: "Anton",
      fontSize: 100,
      maxWords: 3,
      casing: "upper",
      animation: "pop",
      outline: 5,
      position: "center",
    },
  ),
  preset(
    "social-stack",
    "Bloco social",
    "Social",
    "Duas palavras por bloco, contorno forte e subida.",
    {
      fontFamily: "Montserrat",
      fontSize: 106,
      maxWords: 2,
      casing: "upper",
      mode: "phrase",
      animation: "rise",
      outline: 6,
      margin: 24,
    },
  ),
  preset(
    "keyword-punch",
    "Palavra-chave",
    "Social",
    "A última palavra da frase ganha tamanho e cor.",
    {
      mode: "emphasis",
      fontFamily: "Oswald",
      fontSize: 76,
      maxWords: 4,
      animation: "pop",
      casing: "upper",
      position: "center",
    },
  ),
  preset(
    "news-top",
    "Notícia",
    "Editorial",
    "Frase no topo, alinhamento editorial e tarja.",
    {
      mode: "phrase",
      fontFamily: "Oswald",
      maxWords: 8,
      fontSize: 56,
      casing: "upper",
      position: "top",
      margin: 9,
      background: "box",
      backgroundOpacity: 0.9,
      outline: 0,
    },
  ),
  preset(
    "handwritten",
    "À mão",
    "Editorial",
    "Letra manuscrita grande com revelação progressiva.",
    {
      fontFamily: "Caveat",
      fontSize: 90,
      maxWords: 5,
      mode: "cumulative",
      position: "center",
      outline: 2,
      bold: true,
    },
  ),
  preset(
    "quiet-center",
    "Ensaio",
    "Frases",
    "Frase central espaçada, com respiro e fade.",
    {
      fontFamily: "Lora",
      fontSize: 59,
      maxWords: 8,
      mode: "phrase",
      position: "center",
      bold: false,
      spacing: 1,
      animation: "fade",
      outline: 1,
    },
  ),
  preset(
    "lecture",
    "Aula",
    "Frases",
    "Até doze palavras, leitura longa e caixa translúcida.",
    {
      mode: "phrase",
      maxWords: 12,
      fontSize: 44,
      background: "box",
      backgroundOpacity: 0.78,
      outline: 0,
      margin: 8,
      bold: false,
    },
  ),
  preset(
    "headline-sweep",
    "Manchete em ritmo",
    "Destaque",
    "Karaokê grande em duas ou três palavras no topo.",
    {
      mode: "karaoke",
      maxWords: 3,
      fontFamily: "Anton",
      fontSize: 90,
      position: "top",
      margin: 20,
      casing: "upper",
      animation: "rise",
      outline: 4,
    },
  ),
];

/** Strict on writes. Old projects without captionStyle receive the complete default. */
export function resolveCaptionSettings(
  value?: Partial<CaptionSettings>,
): CaptionSettings {
  if (
    value !== undefined &&
    (!value || typeof value !== "object" || Array.isArray(value))
  )
    throw new Error("Estilo de legenda inválido.");
  const selected = value?.presetId
    ? CAPTION_PRESETS.find((p) => p.id === value.presetId)
    : undefined;
  const s = { ...(selected?.settings ?? DEFAULT_CAPTION_SETTINGS), ...value };
  const allowed = new Set(Object.keys(DEFAULT_CAPTION_SETTINGS));
  if (value && Object.keys(value).some((key) => !allowed.has(key)))
    throw new Error("Propriedade de legenda desconhecida.");
  if (!CAPTION_PRESETS.some((p) => p.id === s.presetId))
    throw new Error("Preset de legenda inválido.");
  if (
    typeof s.fontFamily !== "string" ||
    !CAPTION_FONTS.includes(s.fontFamily as (typeof CAPTION_FONTS)[number])
  )
    throw new Error("Fonte de legenda inválida.");
  for (const k of [
    "color",
    "activeColor",
    "outlineColor",
    "backgroundColor",
  ] as const)
    if (typeof s[k] !== "string" || !/^#[a-f\d]{6}$/i.test(s[k]))
      throw new Error("Cor de legenda inválida.");
  for (const [key, min, max] of [
    ["fontSize", 24, 160],
    ["outline", 0, 12],
    ["backgroundOpacity", 0, 1],
    ["margin", 4, 42],
    ["maxWords", 1, 16],
    ["spacing", -2, 8],
  ] as const) {
    if (
      typeof s[key] !== "number" ||
      !Number.isFinite(s[key]) ||
      s[key] < min ||
      s[key] > max ||
      (key === "maxWords" && !Number.isInteger(s[key]))
    )
      throw new Error(`Configuração de legenda inválida: ${key}.`);
  }
  for (const [key, values] of Object.entries({
    background: ["none", "box", "pill"],
    position: ["top", "center", "bottom"],
    mode: [
      "phrase",
      "highlight",
      "karaoke",
      "word",
      "cumulative",
      "typewriter",
      "emphasis",
    ],
    animation: ["none", "fade", "pop", "bounce", "rise", "slide"],
    casing: ["original", "upper", "lower"],
  }))
    if (!values.includes(String(s[key as keyof CaptionSettings])))
      throw new Error(`Configuração de legenda inválida: ${key}.`);
  if (typeof s.bold !== "boolean" || typeof s.italic !== "boolean")
    throw new Error("Peso de legenda inválido.");
  return s;
}

export interface CaptionWord extends Word {
  clipId?: string;
}
/** Output time is mapped once; hooks repeat source words and muted sections stay silent. */
export function captionTimelineWords(project: Project): CaptionWord[] {
  const result: CaptionWord[] = [];
  let offset = 0;
  for (const clip of project.clips) {
    if (!clip.muted)
      for (const word of project.words) {
        const start = Math.max(word.start, clip.start),
          end = Math.min(word.end, clip.end);
        if (word.mediaId === clip.mediaId && end > start + 0.00001)
          result.push({
            ...word,
            clipId: clip.id,
            start: offset + (start - clip.start) / clip.speed,
            end: offset + (end - clip.start) / clip.speed,
          });
      }
    offset += (clip.end - clip.start) / clip.speed;
  }
  return result.sort((a, b) => a.start - b.start);
}
export const captionAssTime = (seconds: number) => {
  const ticks = Math.max(0, Math.round(seconds * 100));
  return `${Math.floor(ticks / 360000)}:${String(Math.floor(ticks / 6000) % 60).padStart(2, "0")}:${String(Math.floor(ticks / 100) % 60).padStart(2, "0")}.${String(ticks % 100).padStart(2, "0")}`;
};
export const captionEscape = (text: string) =>
  text
    .replace(/\\/g, "＼")
    .replace(/{/g, "｛")
    .replace(/}/g, "｝")
    .replace(/\r?\n/g, " ");
const assColor = (color: string, opacity = 1) =>
  `&H${Math.round((1 - opacity) * 255)
    .toString(16)
    .padStart(
      2,
      "0",
    )}${color.slice(5, 7)}${color.slice(3, 5)}${color.slice(1, 3)}&`;
const caseText = (text: string, s: CaptionSettings) =>
  s.casing === "upper"
    ? text.toLocaleUpperCase()
    : s.casing === "lower"
      ? text.toLocaleLowerCase()
      : text;
export function groupCaptionWords(
  words: CaptionWord[],
  s: CaptionSettings,
): CaptionWord[][] {
  const groups: CaptionWord[][] = [];
  for (const word of words) {
    if (!word.text.trim() || word.end <= word.start) continue;
    const last = groups.at(-1),
      prev = last?.at(-1);
    if (
      last &&
      prev &&
      last.length < (s.mode === "word" ? 1 : s.maxWords) &&
      word.start - prev.end < 0.55 &&
      word.start - last[0].start < 4.5 &&
      word.mediaId === prev.mediaId &&
      word.clipId === prev.clipId &&
      !/[.!?…]$/.test(prev.text)
    )
      last.push(word);
    else groups.push([word]);
  }
  return groups;
}

const dialogue = (layer: number, start: number, end: number, text: string) =>
  end > start && captionAssTime(end) !== captionAssTime(start)
    ? `Dialogue: ${layer},${captionAssTime(start)},${captionAssTime(end)},Caption,,0,0,0,,${text}`
    : "";
/** Caption ASS fragments are shared verbatim by browser libass and FFmpeg libass. */
export function captionAssParts(
  project: Project,
  words: CaptionWord[] = captionTimelineWords(project),
): { style: string; events: string[] } {
  const s = resolveCaptionSettings(project.settings.captionStyle),
    { width: w, height: h } = project.settings;
  const unit = Math.min(w, h) / 1080,
    size = s.fontSize * unit,
    outline = s.outline * unit;
  const align = s.position === "top" ? 8 : s.position === "center" ? 5 : 2;
  const x = Math.round(w / 2),
    y = Math.round(
      h *
        (s.position === "top"
          ? s.margin / 100
          : s.position === "center"
            ? 0.5
            : 1 - s.margin / 100),
    );
  const boxColor = assColor(s.backgroundColor, s.backgroundOpacity);
  const style = `Style: Caption,${s.fontFamily},${size.toFixed(2)},${assColor(s.color)},${assColor(s.color)},${s.background === "box" ? boxColor : assColor(s.outlineColor)},${boxColor},${s.bold ? -1 : 0},${s.italic ? -1 : 0},0,0,100,100,${(s.spacing * unit).toFixed(2)},0,${s.background === "box" ? 3 : 1},${s.background === "box" ? (size * 0.2).toFixed(2) : outline.toFixed(2)},0,${align},${Math.round(w * 0.07)},${Math.round(w * 0.07)},${Math.round((h * s.margin) / 100)},1`;
  if (!project.settings.captions) return { style, events: [] };
  const events: string[] = [],
    color = assColor(s.color),
    active = assColor(s.activeColor);
  for (const group of groupCaptionWords(words, s)) {
    const start = group[0].start,
      end = group.at(-1)!.end;
    // Conservative layout prevents large social captions from spilling outside the safe area.
    const texts = group.map((word) => captionEscape(caseText(word.text, s)));
    const charWidth = (text: string) =>
      [...text].reduce(
        (n, c) =>
          n + (/[ilI.,!'|]/.test(c) ? 0.28 : /[MW@%]/.test(c) ? 0.88 : 0.58),
        0,
      ) * size;
    const widths = texts.map(
        (text) => charWidth(text) * (s.mode === "emphasis" ? 1.22 : 1),
      ),
      maxWidth = w * 0.84;
    const maxSingle = Math.max(...widths),
      fit = Math.min(1, maxWidth / Math.max(1, maxSingle));
    const actualSize = size * fit,
      space = size * 0.3 * fit;
    const breaks = new Set<number>();
    let lineWidth = 0,
      widest = 0,
      rows = 1;
    widths.forEach((width, i) => {
      const next = width * fit;
      if (i && lineWidth + space + next > maxWidth) {
        breaks.add(i);
        widest = Math.max(widest, lineWidth);
        lineWidth = next;
        rows++;
      } else lineWidth += (lineWidth ? space : 0) + next;
    });
    widest = Math.max(widest, lineWidth);
    const lineH = actualSize * 1.25,
      totalH = lineH * rows;
    const content = (visible: number, activeIndex = -1) =>
      texts
        .slice(0, visible)
        .map(
          (text, i) =>
            `${i ? (breaks.has(i) ? "\\N" : " ") : ""}${s.mode === "highlight" ? `{\\1c${i === activeIndex ? active : color}}` : ""}${s.mode === "emphasis" && i === texts.length - 1 ? `{\\1c${active}\\fs${(actualSize * 1.22).toFixed(2)}}` : ""}${text}`,
        )
        .join("");
    const animation = (duration: number) => {
      const ms = Math.max(1, Math.round(duration * 1000)),
        inMs = Math.min(150, Math.round(ms * 0.35));
      if (s.animation === "fade")
        return `\\fad(${Math.min(180, inMs)},${Math.min(140, Math.round(ms * 0.2))})`;
      if (s.animation === "pop")
        return `\\fscx75\\fscy75\\t(0,${Math.min(90, inMs)},\\fscx110\\fscy110)\\t(${Math.min(90, inMs)},${inMs + 35},\\fscx100\\fscy100)`;
      if (s.animation === "bounce")
        return `\\move(${x},${y + Math.round(size * 0.35)},${x},${y},0,${inMs})\\fscx80\\fscy80\\t(0,${inMs},\\fscx100\\fscy100)`;
      if (s.animation === "rise")
        return `\\move(${x},${y + Math.round(size * 0.25)},${x},${y},0,${inMs})\\fad(${inMs},0)`;
      if (s.animation === "slide")
        return `\\move(${x - Math.round(size * 0.5)},${y},${x},${y},0,${inMs})\\fad(${inMs},0)`;
      return "";
    };
    const emit = (from: number, to: number, text: string, animate = true) => {
      const motion = animate ? animation(to - from) : "";
      const tags = `{\\an${align}${motion.includes("\\move(") ? "" : `\\pos(${x},${y})`}\\q2\\fs${actualSize.toFixed(2)}${motion}}`;
      if (s.background === "pill" && s.backgroundOpacity > 0) {
        const pad = actualSize * 0.28,
          bw = Math.round(widest + pad * 2),
          bh = Math.round(totalH + pad),
          left = Math.round(x - bw / 2),
          top = Math.round(y - (align === 8 ? 0 : align === 5 ? bh / 2 : bh)),
          r = Math.min(Math.round(actualSize * 0.28), Math.round(bh / 2));
        // Cubic corners are ASS vector drawing primitives, not a CSS-only approximation.
        const shape = `m ${r} 0 l ${bw - r} 0 b ${bw} 0 ${bw} 0 ${bw} ${r} l ${bw} ${bh - r} b ${bw} ${bh} ${bw} ${bh} ${bw - r} ${bh} l ${r} ${bh} b 0 ${bh} 0 ${bh} 0 ${bh - r} l 0 ${r} b 0 0 0 0 ${r} 0`;
        events.push(
          dialogue(
            3,
            from,
            to,
            `{\\an7\\pos(${left},${top})\\bord0\\shad0\\1c${assColor(s.backgroundColor)}\\1a&H${Math.round(
              (1 - s.backgroundOpacity) * 255,
            )
              .toString(16)
              .padStart(2, "0")}&\\p1}${shape}{\\p0}`,
          ),
        );
      }
      events.push(dialogue(4, from, to, tags + text));
    };
    if (s.mode === "highlight") {
      for (let i = 0; i < group.length; i++)
        emit(
          group[i].start,
          i + 1 < group.length ? group[i + 1].start : end,
          content(texts.length, i),
          i === 0,
        );
    } else if (s.mode === "cumulative") {
      // Enter the phrase once. Replaying a fade on every added word makes the entire
      // accumulated phrase disappear at each boundary instead of building smoothly.
      for (let i = 0; i < group.length; i++)
        emit(
          group[i].start,
          i + 1 < group.length ? group[i + 1].start : end,
          content(i + 1),
          i === 0,
        );
    } else if (s.mode === "karaoke") {
      let cursor = start;
      const text = texts
        .map((text, i) => {
          const gap = Math.max(0, Math.round((group[i].start - cursor) * 100));
          cursor = group[i].end;
          return `${i ? (breaks.has(i) ? "\\N" : " ") : ""}${gap ? `{\\k${gap}}` : ""}{\\kf${Math.max(1, Math.round((group[i].end - group[i].start) * 100))}}${text}`;
        })
        .join("");
      emit(start, end, `{\\1c${active}\\2c${color}}` + text);
    } else if (s.mode === "typewriter") {
      const text = texts
        .map(
          (text, i) =>
            `${i ? (breaks.has(i) ? "\\N" : " ") : ""}${[...text]
              .map((c, j) => {
                const at = Math.round(
                  (group[i].start -
                    start +
                    ((group[i].end - group[i].start) * j) /
                      Math.max(1, text.length)) *
                    1000,
                );
                return `{\\alpha&HFF&\\t(${at},${at + 1},\\alpha&H00&)}${c}`;
              })
              .join("")}`,
        )
        .join("");
      emit(start, end, text);
    } else emit(start, end, content(texts.length));
  }
  return { style, events: events.filter(Boolean) };
}

export function createCaptionAss(
  project: Project,
  words?: CaptionWord[],
): string {
  const { style, events } = captionAssParts(project, words);
  return `[Script Info]\nScriptType: v4.00+\nPlayResX: ${project.settings.width}\nPlayResY: ${project.settings.height}\nWrapStyle: 2\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding\n${style}\n\n[Events]\nFormat: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text\n${events.join("\n")}\n`;
}

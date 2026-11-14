import { z } from "zod";

/**
 * Motion effects the AI can pick per shot, from the bundled HyperFrames registry (Apache-2.0,
 * resources/film-kit/hf-registry). Each one is mounted as a sub-composition over the drawn scene,
 * filled with the shot's own words and numbers, timed to the shot and coloured by the look.
 * Only self-contained components that read well in 9:16 are listed (checked on a stills bench); tests check every variable exists.
 */
export interface EffectDef {
  /** What it looks like and when to use it (goes into the prompt, in Portuguese). */
  use: string;
  /** Content variables the AI fills: id → hint. */
  vars: Record<string, string>;
  /** Where it sits when the plan does not say. */
  area?: EffectArea;
  /** Timing variable that takes one cue per item of `list` (seconds from mount start). */
  cues?: string;
  list?: string;
  /** Longest `text` that still reads well; a longer line falls back to the engine's kinetic text. */
  fit?: number;
  /** Small in a vertical frame: offered and mounted only in landscape films. */
  wide?: boolean;
  /** Group shown in the prompt. */
  group: "texto" | "dados" | "produto" | "fechamento";
}

export const EFFECT_AREAS = ["full", "center", "top", "lower"] as const;
export type EffectArea = (typeof EFFECT_AREAS)[number];

const T = "frase curta (até 7 palavras)";
export const EFFECTS: Record<string, EffectDef> = {
  /* ---------------------------------------------------------------- kinetic text */
  "headline-slam": { group: "texto", wide: true, fit: 24, use: "manchete pesada que bate na tela e assenta", vars: { text: "até 6 palavras", accent_word_index: "índice (0, 1, 2…) da palavra colorida" } },
  "char-slam-explode": { group: "texto", fit: 12, use: "letras espalhadas que se juntam com impacto", vars: { text: "1 a 3 palavras" } },
  "kinetic-type-swap": { group: "texto", use: "frase fixa com uma palavra que vai trocando", vars: { prefix: "texto fixo antes", options: "palavras que giram, separadas por vírgula", suffix: "texto fixo depois (opcional)" }, cues: "cues", list: "options" },
  "line-swap": { group: "texto", use: "uma frase sai e outra entra, com sublinhado na palavra-chave (quebra de crença)", vars: { line_a: "frase que sai", line_b: "frase que entra", underline_word: "palavra de line_b sublinhada" } },
  "marker-highlight": { group: "texto", use: "frase com marca-texto desenhado à mão na palavra-chave", vars: { text: T, emphasis_word: "palavra marcada", style: "highlight | circle | underline | scribble" } },
  "vox-annotate": { group: "texto", use: "frase com a palavra-chave circulada e uma anotação ao lado (estilo explicativo)", vars: { text: T, keyword: "palavra marcada", note: "anotação curta" } },
  "per-word-rise": { group: "texto", fit: 18, use: "palavras sobem do desfoque para o nítido, elegante", vars: { text: T } },
  "particle-text-dissolve": { group: "texto", fit: 14, use: "texto que se forma a partir de partículas", vars: { text: "1 a 4 palavras" } },
  "scramble-reveal": { group: "texto", fit: 16, use: "texto que se decifra letra a letra, estilo hacker", vars: { text: "1 a 4 palavras" } },
  "text-shimmer": { group: "texto", fit: 18, use: "título com um brilho que atravessa", vars: { text: "1 a 5 palavras" } },
  "shutter-slam": { group: "texto", fit: 10, use: "uma palavra arremessada com borrão de movimento", vars: { text: "uma palavra" } },
  "push-in": { group: "texto", fit: 22, use: "manchete com a câmera aproximando devagar (momento sério)", vars: { text: T } },
  "gloss-sweep": { group: "texto", fit: 14, use: "cartão que assenta com um brilho de vitrine", vars: { text: "1 a 4 palavras" } },
  "beat-accent": { group: "texto", fit: 12, use: "batida de impacto com flash, para a virada", vars: { text: "1 a 3 palavras" } },
  "titlecard-calm": { group: "texto", use: "cartão de título calmo com sobretítulo (capítulo)", vars: { headline: "título", kicker: "sobretítulo curto" } },
  "pull-back-reveal": { group: "texto", wide: true, use: "um número em close e a câmera recua revelando a manchete", vars: { detail_text: "número ou dado curto", headline: "manchete" } },
  /* ---------------------------------------------------------------- data and proof */
  "count-up": { group: "dados", use: "contador grande que sobe até o número", vars: { start: "número inicial (inteiro)", end: "número final (inteiro; com vírgula use graphic stat)", prefix: "antes (ex.: R$ )", suffix: "depois (ex.: %, k, vendas)" } },
  "chart-story": { group: "dados", use: "gráfico que se constrói com os dados", vars: { type: "bars | line | donut | progress", data: "números separados por vírgula", labels: "rótulos separados por vírgula", emphasize: "índice do dado em destaque", unit: "sufixo dos valores" } },
  "decline-chart": { group: "dados", use: "linha descendo (custo, tempo ou trabalho caindo)", vars: { label: "o que cai", start_value: "número inicial", end_value: "número final" } },
  "conic-progress-ring": { group: "dados", use: "anel de progresso enchendo até a porcentagem", vars: { progress: "0 a 100", label: "texto do centro (ex.: 87%)" } },
  "star-rating-fill": { group: "dados", use: "estrelas preenchendo até a nota", vars: { rating: "0 a 5" } },
  "testimonial-proof-card": { group: "dados", use: "cartão de depoimento com trecho sublinhado", vars: { quote: "o depoimento", name: "nome", role: "cargo ou cidade", company: "empresa (opcional)", emphasis: "trecho destacado" } },
  "testimonial-card": { group: "dados", wide: true, use: "depoimento com avatar, nome e estrelas", vars: { quote: "o depoimento", author: "nome", handle: "@perfil ou cargo", rating: "0 a 5" } },
  /* ---------------------------------------------------------------- product, UI */
  "chat-thread": { group: "produto", use: "conversa de celular completa em tela cheia", vars: { contact: "nome do contato", messages: "recv:mensagem recebida|sent:mensagem enviada|recv:…" }, area: "full" },
  "chat-message": { group: "produto", use: "uma mensagem de celular chegando", vars: { type: "recv | sent", text: "a mensagem" } },
  "typed-prompt": { group: "produto", wide: true, use: "um pedido sendo digitado num campo de IA", vars: { text: "o pedido" } },
  "grid-card-assemble": { group: "produto", wide: true, use: "cartões de recursos se montando em grade", vars: { items: "itens separados por vírgula; \"Rótulo: descrição\" opcional" }, cues: "cues", list: "items" },
  "constellation-hub": { group: "produto", wide: true, use: "o produto no centro e os recursos acendendo ao redor", vars: { hub_label: "nome do produto", nodes: "recursos separados por vírgula (3 a 6)" }, cues: "cues", list: "nodes" },
  "tracing-beam": { group: "produto", wide: true, use: "feixe de luz percorrendo 3 etapas", vars: { labels: "3 etapas separadas por vírgula" } },
  "notes-typing": { group: "produto", use: "app de notas sendo escrito (confissão, lista de dores)", vars: { title: "título (| quebra linha)", lines: "linhas separadas por |" }, area: "full" },
  "parallax-device-dive": { group: "produto", use: "celular sobe e a câmera mergulha na tela do app", vars: { app_title: "nome da tela" }, area: "full" },
  "toggle-flip": { group: "produto", use: "chave grande que liga", vars: { label: "o que liga" } },
  /* ---------------------------------------------------------------- closing */
  "cta-close": { group: "fechamento", use: "chamada final palavra por palavra com botão", vars: { action_line: "a chamada", button_label: "texto do botão" } },
  "cta-lockup": { group: "fechamento", use: "fechamento com chamada, botão e frase de apoio", vars: { action_line: "a chamada", button_label: "texto do botão", microcopy: "apoio curto" } },
  "social-proof-card": { group: "fechamento", use: "fechamento estilo loja de apps: marca, estrelas, prova e botão", vars: { brand: "marca", proof: "prova curta", cta: "botão", f1: "recurso 1 (| quebra)", f2: "recurso 2", f3: "recurso 3" }, area: "full" },
  "logo-sting": { group: "fechamento", use: "marca batendo na tela com um anel", vars: { wordmark: "nome da marca" } },
  "logo-brand-close": { group: "fechamento", use: "assinatura da marca com slogan e site", vars: { wordmark: "nome da marca", tagline: "slogan", url: "site ou @perfil" } },
};
export const EFFECT_NAMES = Object.keys(EFFECTS) as [string, ...string[]];

const scalar = z.union([z.string().max(400), z.number().finite(), z.boolean()]);
/** One effect over a shot: which, filled with what, and where. */
export const shotEffectSchema = z
  .object({
    name: z.enum(EFFECT_NAMES),
    vars: z.record(z.string(), scalar).optional().catch(undefined),
    area: z.enum(EFFECT_AREAS).optional().catch(undefined),
    accent: z.enum(["green", "blue", "violet"]).optional().catch(undefined),
  })
  .transform((e) => {
    // Keep only the variables this effect declares, as clean single-line text.
    const allowed = EFFECTS[e.name].vars, vars: Record<string, string | number | boolean> = {};
    for (const [k, v] of Object.entries(e.vars ?? {})) {
      if (!(k in allowed)) continue;
      vars[k] = typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, 240) : v;
    }
    return { name: e.name, vars, ...(e.area ? { area: e.area } : {}), ...(e.accent ? { accent: e.accent } : {}) };
  });
export type ShotEffect = z.infer<typeof shotEffectSchema>;

/** The catalogue as prompt lines, grouped. */
export function effectsPrompt(landscape = false) {
  const groups: Record<EffectDef["group"], string[]> = { texto: [], dados: [], produto: [], fechamento: [] };
  for (const [name, d] of Object.entries(EFFECTS)) {
    if (d.wide && !landscape) continue;
    const vars = Object.entries(d.vars).map(([k, h]) => `${k}: ${h}`).join("; ");
    groups[d.group].push(`  ${name}: ${d.use}${vars ? ` {${vars}}` : ""}`);
  }
  return [
    "  Texto cinético:", ...groups.texto,
    "  Dados e prova:", ...groups.dados,
    "  Produto e interface:", ...groups.produto,
    "  Fechamento:", ...groups.fechamento,
  ].join("\n");
}

/** Box of each area in the frame (the bottom fifth stays free for the captions). */
export function effectBox(area: EffectArea, W: number, H: number) {
  const tall = H > W;
  const r = (v: number) => Math.round(v);
  switch (area) {
    case "full": return { left: 0, top: 0, width: W, height: r(H * (tall ? 0.78 : 0.8)) };
    case "top": return { left: r(W * 0.06), top: r(H * 0.05), width: r(W * 0.88), height: r(H * (tall ? 0.24 : 0.3)) };
    case "lower": return { left: r(W * 0.06), top: r(H * (tall ? 0.52 : 0.5)), width: r(W * 0.88), height: r(H * (tall ? 0.2 : 0.26)) };
    default: return { left: r(W * (tall ? 0.05 : 0.14)), top: r(H * (tall ? 0.2 : 0.16)), width: r(W * (tall ? 0.9 : 0.72)), height: r(H * (tall ? 0.42 : 0.58)) };
  }
}

const attr = (s: string) => s.replace(/&/g, "&amp;").replace(/'/g, "&#39;").replace(/</g, "&lt;");

/**
 * Mount divs for the effects of a plan. `timed` is timeShots(plan.shots, words, D); every effect lasts
 * its shot, list items get cues spread across the shot, and the panel behind it is the paper colour.
 */
export function effectMounts(
  shots: { effect?: ShotEffect }[],
  timed: { start: number; end: number }[],
  o: { width: number; height: number; panel: string },
) {
  const out: string[] = [];
  shots.forEach((s, i) => {
    const fx = s.effect;
    if (!fx || !timed[i]) return;
    const def = EFFECTS[fx.name];
    if (def.wide && o.height > o.width) return;
    const start = Math.max(0, timed[i].start), dur = Math.max(1.2, timed[i].end - timed[i].start);
    const vars: Record<string, string | number | boolean> = { ...fx.vars };
    if (fx.accent) vars.accent = fx.accent;
    if (def.cues && def.list && typeof vars[def.list] === "string") {
      const n = Math.min(12, String(vars[def.list]).split(",").filter((x) => x.trim()).length);
      if (n > 0) vars[def.cues] = Array.from({ length: n }, (_, k) => +(0.25 + (k * Math.max(0.6, dur - 0.9)) / n).toFixed(2)).join(",");
    }
    const box = effectBox(fx.area ?? def.area ?? "center", o.width, o.height);
    const round = fx.area === "full" || (!fx.area && def.area === "full") ? 0 : 36;
    const style = `position:absolute;left:${box.left}px;top:${box.top}px;width:${box.width}px;height:${box.height}px;z-index:36;--bg:${o.panel};border-radius:${round}px;overflow:hidden${round ? `;background:${o.panel};box-shadow:0 24px 70px rgba(0,0,0,.18)` : ""}`;
    out.push(
      `<div id="fx-${i + 1}-${fx.name}" class="clip" data-composition-id="${fx.name}" data-composition-src="compositions/components/${fx.name}.html" data-start="${start.toFixed(2)}" data-duration="${dur.toFixed(2)}" data-track-index="${8 + (i % 4)}" data-variable-values='${attr(JSON.stringify(vars))}' style="${style}"></div>`,
    );
  });
  return out.join("\n  ");
}

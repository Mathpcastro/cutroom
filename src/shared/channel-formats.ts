import { z } from "zod";
import { DEFAULT_STRUCTURE, bibleSchema, formatSchema, movementSchema, type Bible, type Channel, type Format, type Movement } from "./channel";

/**
 * Formats: each channel carries its own rules (structure, scenes, imagery, duration, thumb,
 * checklist). Videosell does not pick the niche: the user's agent writes the format for any
 * niche, and these templates are only examples it can copy, mix or ignore.
 * Channels made before formats have none and are read as "cidade".
 */

export type FormatTemplate = {
  format: Format;
  /** Bible parts that belong to the format (structure of the script, hook, calls, thumb). */
  bible: Pick<Bible, "structure" | "hookRules" | "ctaPlan" | "thumbStyle" | "mustHave">;
  /** One line for the agent: when this template fits. */
  when: string;
};

const check = (id: string, kind: Format["checklist"][number]["kind"], params: Record<string, number | string | boolean | string[]> = {}, level: "erro" | "aviso" = "erro") => ({ id, kind, params, level });

const CITY: FormatTemplate = {
  when: "Documentário com dado e foto real de um lugar (cidade, bairro, país): vale a pena morar, custo de vida, comparação.",
  format: formatSchema.parse({
    id: "cidade",
    name: "Cidade / documentário com fonte",
    description: "Episódio longo sobre um lugar: dados com fonte, fotos reais do lugar, opinião do canal e veredito.",
    aspect: "16:9",
    durationSec: { min: 600, max: 1200 },
    scenes: ["photo", "video", "stat", "title", "list", "rank", "cta", "custom"],
    imagery: { sources: ["foto-real", "b-roll", "grafico"], notes: "Foto real do lugar com crédito; etiqueta de lugar só em imagem daquele lugar." },
    research: "todo-numero",
    checklist: [
      check("numero-com-fonte", "fact-per-number"),
      check("primeira-frase", "first-sentence-words", { max: 15 }),
      check("gancho-numeros", "hook-numbers", { min: 2 }, "aviso"),
      check("gancho-pergunta", "hook-question", {}, "aviso"),
      check("gancho-final", "hook-teaser", {}, "aviso"),
      check("imagem-real", "image-share", { sources: ["foto-real", "b-roll"], min: 0.34 }),
      check("texto-seguido", "max-text-run", { max: 2 }),
      check("etiqueta-lugar", "place-tag"),
      check("busca-de-imagem", "media-query", {}, "aviso"),
      check("chamadas", "max-ctas", { max: 4 }),
      check("chamada-cedo", "cta-after", { sec: 60 }),
      check("tela-final", "endscreen-last"),
      check("frase-longa", "sentence-max-words", { max: 25 }, "aviso"),
      check("fala-longa", "beat-max-seconds", { max: 12 }, "aviso"),
    ],
    rubric: ["A foto mostra o lugar que a fala cita?", "Algum texto estourou ou ficou ilegível?", "Parece template repetido?"],
    writingRules: [
      "Opinião dita como opinião (\"na minha visão\"). O narrador nunca diz que foi ao lugar; cena vivida é hipotética (\"imagina que você…\").",
      "Crítica a preço, governo, urbanismo e serviço, nunca ao povo. Um elogio verdadeiro por episódio.",
      "Se os dados não confirmam a premissa do título, responda com honestidade e faça disso a virada.",
    ],
  }),
  bible: {
    structure: DEFAULT_STRUCTURE,
    hookRules: ["1ª frase ≤ 15 palavras, contraintuitiva, com prova na tela", "2 números no gancho", "gancho para o fim já no primeiro minuto"],
    ctaPlan: [
      { kind: "comment", at: "after-section", section: "contexto", line: "Comenta aí de onde você tá assistindo." },
      { kind: "subscribe", at: "after-section", section: "lado-bom", line: "Se esse tipo de vídeo te ajuda, se inscreve no canal." },
      { kind: "like", at: "after-surprise", line: "Se você também não sabia disso, deixa o like." },
      { kind: "endscreen", at: "end", line: "Tem mais um vídeo aqui que você vai gostar." },
    ],
    thumbStyle: { layout: "foto+frase", maxWords: 6, palette: [] },
    mustHave: ["todo dado com fonte", "um elogio verdadeiro", "opinião dita como opinião"],
  },
};

const TOP10_STRUCTURE: Movement[] = [
  { id: "gancho", title: "Gancho", targetSec: 30, mustHave: "o item nº 1 em mistério; por que esta lista importa; fica até o fim" },
  { id: "contagem", title: "Contagem", targetSec: 480, mustHave: "itens do último ao 2º; cada item: nome, o fato que surpreende (com fonte) e uma imagem" },
  { id: "numero-1", title: "Número 1", targetSec: 60, mustHave: "a revelação prometida no gancho" },
  { id: "pergunta", title: "Pergunta e assinatura", targetSec: 20, mustHave: "qual faltou na lista? tela final" },
];
const TOP10: FormatTemplate = {
  when: "Ranking ou lista de curiosidades: top 10, coisas que você não sabia, os maiores/piores de algo.",
  format: formatSchema.parse({
    id: "top10",
    name: "Top 10 / curiosidades",
    description: "Contagem regressiva de itens surpreendentes, cada um com um fato verificável e uma imagem forte.",
    aspect: "16:9",
    durationSec: { min: 360, max: 900 },
    scenes: ["rank", "photo", "video", "stat", "title", "list", "cta", "custom"],
    imagery: { sources: ["foto-real", "b-roll", "ia", "grafico"], notes: "Imagem forte por item: foto real, B-roll ou imagem gerada (sem fingir que é real)." },
    research: "todo-numero",
    checklist: [
      check("numero-com-fonte", "fact-per-number"),
      check("contagem", "ranked-countdown", { min: 3 }),
      check("primeira-frase", "first-sentence-words", { max: 15 }),
      check("gancho-final", "hook-teaser", {}, "aviso"),
      check("imagem", "image-share", { sources: ["foto-real", "b-roll", "ia"], min: 0.4 }),
      check("texto-seguido", "max-text-run", { max: 2 }),
      check("chamadas", "max-ctas", { max: 3 }),
      check("chamada-cedo", "cta-after", { sec: 45 }),
      check("tela-final", "endscreen-last"),
      check("fala-longa", "beat-max-seconds", { max: 12 }, "aviso"),
    ],
    rubric: ["Cada item tem a sua imagem?", "O número do item aparece grande?", "A revelação do nº 1 entrega o que o gancho prometeu?"],
    writingRules: [
      "Cada item abre com uma cena `rank` (n, título) e depois 1 a 3 falas de fato e imagem.",
      "O fato de cada item tem de surpreender e ter fonte; nada de \"dizem que\".",
      "Imagem gerada por IA entra marcada com scene.source: 'ia' e nunca como se fosse foto real.",
    ],
  }),
  bible: {
    structure: TOP10_STRUCTURE,
    hookRules: ["1ª frase ≤ 15 palavras", "esconder o nº 1 e prometer a revelação no fim"],
    ctaPlan: [
      { kind: "like", at: "after-surprise", line: "Se você não sabia dessa, deixa o like." },
      { kind: "endscreen", at: "end", line: "Tem outra lista aqui que você vai gostar." },
    ],
    thumbStyle: { layout: "foto+frase+icone", maxWords: 5, palette: [] },
    mustHave: ["todo item com fonte", "o nº 1 é a maior surpresa"],
  },
};

const WHATIF_STRUCTURE: Movement[] = [
  { id: "premissa", title: "E se…", targetSec: 30, mustHave: "a pergunta \"e se…\" em uma frase, o personagem e o contador no dia 1" },
  { id: "dias", title: "Os dias", targetSec: 420, mustHave: "o contador avança (nunca volta); inventário muda; cada salto tem uma consequência concreta" },
  { id: "fato-real", title: "O fato real", targetSec: 90, mustHave: "um dado real com fonte que explica o que está acontecendo" },
  { id: "reviravolta", title: "Reviravolta", targetSec: 60, mustHave: "o final inesperado (scene.data.twist: true)" },
  { id: "pergunta", title: "Pergunta", targetSec: 20, mustHave: "e você, o que faria? tela final" },
];
const WHATIF: FormatTemplate = {
  when: "Hipótese animada com personagem fixo: e se você ficasse X dias em…, e se a Terra parasse, sobrevivência.",
  format: formatSchema.parse({
    id: "e-se",
    name: "\"E se…\" com personagem",
    description: "Um personagem fixo vive uma hipótese dia a dia; contador e inventário na tela; um fato real com fonte; final com reviravolta.",
    aspect: "16:9",
    durationSec: { min: 300, max: 900 },
    scenes: ["character", "counter", "title", "photo", "stat", "list", "cta", "custom"],
    imagery: { sources: ["avatar", "ia", "foto-real", "grafico"], notes: "O personagem aparece na maior parte das cenas; foto real só no fato real." },
    character: { name: "Zé", description: "personagem fixo do canal", counters: [{ id: "dia", label: "DIA" }], inventory: true },
    research: "pelo-menos-1",
    checklist: [
      check("fato-real", "facts-min", { min: 1 }),
      check("numero-com-fonte", "fact-per-number", {}, "aviso"),
      check("contador", "counter-continuity", { counter: "dia" }),
      check("cenario", "vary-backdrop", {}, "aviso"),
      check("reviravolta", "ending-twist", { section: "reviravolta" }),
      check("personagem", "image-share", { sources: ["avatar"], min: 0.3 }),
      check("primeira-frase", "first-sentence-words", { max: 15 }),
      check("chamadas", "max-ctas", { max: 3 }),
      check("tela-final", "endscreen-last"),
      check("fala-longa", "beat-max-seconds", { max: 12 }, "aviso"),
    ],
    rubric: ["O personagem é o mesmo em todas as cenas?", "O contador lê fácil e nunca volta?", "A reviravolta surpreende?"],
    writingRules: [
      "Cada salto de tempo é uma cena `counter` (data.counter = 'dia', data.value) ou um `character` com data.counter.",
      "Números do contador e do inventário não precisam de fonte; o fato real precisa.",
      "A última seção tem uma fala com scene.data.twist: true.",
      "Cada cena de personagem ou contador troca de cenário: data.backdrop ('quarto', 'sala', 'cozinha', 'rua', 'parque', 'escritorio', 'noite', 'campo') ou { media: 'm_…' } com uma foto ou imagem gerada.",
    ],
  }),
  bible: {
    structure: WHATIF_STRUCTURE,
    hookRules: ["1ª frase é a pergunta \"E se…\"", "o personagem aparece nos primeiros 2 segundos"],
    ctaPlan: [
      { kind: "comment", at: "after-section", section: "dias", line: "Comenta: você aguentaria quantos dias?" },
      { kind: "endscreen", at: "end", line: "Tem outro \"e se\" aqui do lado." },
    ],
    thumbStyle: { layout: "rosto+frase", maxWords: 5, palette: [] },
    mustHave: ["um fato real com fonte", "reviravolta no final"],
  },
};

export const FORMAT_TEMPLATES: Record<string, FormatTemplate> = { cidade: CITY, top10: TOP10, "e-se": WHATIF };

/** The channel's format (channels made before formats are "cidade" with their own minimum length). */
export function formatOf(channel: Pick<Channel, "format" | "defaults">): Format {
  if (channel.format) return channel.format;
  const min = Math.round(channel.defaults.longMinMinutes * 60);
  return { ...CITY.format, durationSec: { min, max: Math.max(min, 1200) } };
}

/**
 * What the agent passes as `format`: a template id, or a full format for any niche. With
 * `extends`, the template fills what is missing. Bible parts of the format (structure of the
 * script, hook rules, calls, thumb) travel together and land in the channel bible.
 */
export const formatInputSchema = formatSchema
  .partial()
  .extend({
    extends: z.string().max(40).optional(),
    structure: z.array(movementSchema).min(1).max(16).optional(),
    hookRules: bibleSchema.shape.hookRules.optional(),
    ctaPlan: bibleSchema.shape.ctaPlan.optional(),
    thumbStyle: bibleSchema.shape.thumbStyle.optional(),
    mustHave: bibleSchema.shape.mustHave.optional(),
  });
export type FormatInput = z.input<typeof formatInputSchema>;

const BIBLE_KEYS = ["structure", "hookRules", "ctaPlan", "thumbStyle", "mustHave"] as const;

export function templateOf(id: string) {
  const t = FORMAT_TEMPLATES[id];
  if (!t) throw Object.assign(new Error(`Formato "${id}" não existe. Exemplos: ${Object.keys(FORMAT_TEMPLATES).join(", ")}; ou escreva o formato inteiro.`), { code: "FORMAT_NOT_FOUND" });
  return t;
}

/** Template id or format object → validated format + the bible parts it carries. */
export function resolveFormat(input: string | FormatInput, current?: Format): { format: Format; bible: Partial<Bible> } {
  if (typeof input === "string") {
    const t = templateOf(input);
    return { format: t.format, bible: { ...t.bible } };
  }
  const i = formatInputSchema.parse(input);
  const base = i.extends ? templateOf(i.extends) : undefined;
  const own: Record<string, unknown> = {};
  const bible: Record<string, unknown> = { ...(base?.bible ?? {}) };
  // Only what the agent actually sent overrides: zod fills defaults (empty checklist, "16:9"…)
  // that would otherwise erase what the template or the current format has.
  const sent = new Set(Object.keys(input as Record<string, unknown>));
  for (const [k, v] of Object.entries(i)) {
    if (v === undefined || k === "extends" || !sent.has(k)) continue;
    if ((BIBLE_KEYS as readonly string[]).includes(k)) bible[k] = v;
    else own[k] = v;
  }
  const parsed = formatSchema.safeParse({ ...(current ?? {}), ...(base?.format ?? {}), ...own });
  if (!parsed.success)
    throw Object.assign(new Error(`Formato inválido: ${parsed.error.issues.map((x) => `${x.path.join(".") || "formato"} ${x.message}`).join("; ")}`), { code: "FORMAT_INVALID" });
  if (parsed.data.durationSec.max < parsed.data.durationSec.min) throw Object.assign(new Error("Formato inválido: durationSec.max menor que durationSec.min."), { code: "FORMAT_INVALID" });
  return { format: parsed.data, bible: bible as Partial<Bible> };
}

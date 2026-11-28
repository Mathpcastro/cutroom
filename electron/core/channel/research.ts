import { z } from "zod";
import { factSchema, sourceSchema, type Fact, type Research, type Source } from "../../../src/shared/channel";
import type { ChannelStore } from "./channel-store";
import { shortRandomId } from "./fs-json";

/**
 * Pesquisa e checagem de fatos (spec "Pesquisa e checagem de fatos").
 * The search is done by the user's own AI (Claude Code, Codex): it searches with its tools and
 * hands facts to `addFacts` through MCP. Videosell has no search of its own (decision of
 * 2026-11-17): the app classifies each source, computes confidence, merges confirmations and
 * conflicts, and never lets a low-confidence number into the script.
 */

// ---------- sources ----------

const OFFICIAL = [
  /\.gov(\.[a-z]{2})?$/, /\.gob\.[a-z]{2}$/, /\.gouv\.[a-z]{2}$/, /\.mil\.br$/, /\.jus\.br$/, /\.leg\.br$/, /\.mp\.br$/, /\.edu(\.[a-z]{2})?$/, /\.ac\.[a-z]{2}$/,
  /(^|\.)ibge\.gov\.br$/, /(^|\.)ipea\.gov\.br$/, /(^|\.)bcb\.gov\.br$/, /(^|\.)who\.int$/, /(^|\.)un\.org$/, /(^|\.)undp\.org$/, /(^|\.)worldbank\.org$/,
  /(^|\.)imf\.org$/, /(^|\.)oecd\.org$/, /(^|\.)europa\.eu$/, /(^|\.)fipezap\.com\.br$/, /(^|\.)ipsbrasil\.org\.br$/, /(^|\.)atlasbrasil\.org\.br$/, /(^|\.)fgv\.br$/,
];
const PRESS = [
  "g1.globo.com", "globo.com", "oglobo.globo.com", "valor.globo.com", "folha.uol.com.br", "uol.com.br", "estadao.com.br", "cnnbrasil.com.br", "bbc.com", "bbc.co.uk",
  "reuters.com", "apnews.com", "nytimes.com", "theguardian.com", "elpais.com", "exame.com", "infomoney.com.br", "agenciabrasil.ebc.com.br", "veja.abril.com.br",
  "correiobraziliense.com.br", "gazetadopovo.com.br", "terra.com.br", "metropoles.com", "poder360.com.br", "nexojornal.com.br", "bloomberg.com", "ft.com", "wsj.com",
];

export function hostOf(url: string) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function classifySource(url: string): Source["kind"] {
  const host = hostOf(url);
  if (!host) return "outro";
  if (OFFICIAL.some((re) => re.test(host))) return "oficial";
  if (PRESS.some((d) => host === d || host.endsWith(`.${d}`))) return "imprensa";
  if (/blog|medium\.com$|wordpress|blogspot|substack|tumblr/.test(host)) return "blog";
  return "outro";
}

/** Two sources are independent when neither host nor publisher match. */
function independent(a: Source, b: Source) {
  const ha = hostOf(a.url).split(".").slice(-3).join(".");
  const hb = hostOf(b.url).split(".").slice(-3).join(".");
  return ha !== hb && a.publisher.trim().toLowerCase() !== b.publisher.trim().toLowerCase();
}

/**
 * Spec: same fact in 2 independent sources = alta; 1 official source = alta;
 * 1 press source = média; blog or click portal only = baixa (never enters the script).
 */
export function confidenceOf(fact: Pick<Fact, "source" | "confirmations">): Fact["confidence"] {
  const all = [fact.source, ...(fact.confirmations ?? [])];
  if (all.some((s) => s.kind === "oficial")) return "alta";
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) if (independent(all[i], all[j]) && all[i].kind !== "blog" && all[j].kind !== "blog") return "alta";
  if (all.some((s) => s.kind === "imprensa")) return "média";
  return "baixa";
}

// ---------- numbers & prudent wording ----------

/** Parses "481.749", "15,5%", "R$ 4,70", "1,2 mil", "3 milhões" (pt-BR) into a number. */
export function parseNumber(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string") return;
  const m = value.replace(/\s+/g, " ").match(/-?\d[\d.,]*/);
  if (!m) return;
  let raw = m[0];
  if (/,\d{1,2}$/.test(raw) || (raw.includes(",") && raw.includes("."))) raw = raw.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(raw)) raw = raw.replace(/\./g, "");
  else raw = raw.replace(",", ".");
  let n = Number(raw);
  if (!Number.isFinite(n)) return;
  const rest = value.slice((m.index ?? 0) + m[0].length).toLowerCase();
  if (/^\s*(mil)\b/.test(rest)) n *= 1e3;
  else if (/^\s*(milh(ão|ões|ao|oes)|mi)\b/.test(rest)) n *= 1e6;
  else if (/^\s*(bilh(ão|ões|ao|oes)|bi)\b/.test(rest)) n *= 1e9;
  return n;
}

function roundNice(n: number) {
  const abs = Math.abs(n);
  const step = abs >= 1e6 ? 1e5 : abs >= 1e4 ? 1e4 : abs >= 1e3 ? 100 : abs >= 100 ? 10 : 1;
  return Math.round(n / step) * step;
}
function spellApprox(n: number) {
  const r = roundNice(n);
  if (Math.abs(r) >= 1e9) return `${(r / 1e9).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} bilhões`;
  if (Math.abs(r) >= 1e6) return `${(r / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} milhões`;
  if (Math.abs(r) >= 1e4) return `${(r / 1e3).toLocaleString("pt-BR", { maximumFractionDigits: 0 })} mil`;
  return r.toLocaleString("pt-BR");
}

/** Wording for disagreeing sources: "cerca de 480 mil"; years → "por volta de 1550". */
export function prudentWording(values: Array<number | string | undefined>, unit?: string): string | undefined {
  const nums = values.map(parseNumber).filter((n): n is number => n !== undefined);
  if (nums.length < 2) return;
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  if (min === max) return;
  const isYear = nums.every((n) => Number.isInteger(n) && n >= 1000 && n <= 2100);
  if (isYear) return `por volta de ${Math.round((min + max) / 20) * 10}`;
  const mid = (min + max) / 2;
  return `cerca de ${spellApprox(mid)}${unit ? ` ${unit}` : ""}`.trim();
}

function sameValue(a: unknown, b: unknown) {
  const na = parseNumber(a);
  const nb = parseNumber(b);
  if (na !== undefined && nb !== undefined) return Math.abs(na - nb) <= Math.max(Math.abs(na), Math.abs(nb)) * 1e-9;
  return String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase();
}

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

// ---------- hard rules ----------

export type FactWarning = { factId: string; code: "MONEY_NO_CURRENCY" | "MONEY_NO_DATE" | "INDEX_NO_YEAR" | "ACCUSATION" | "LOW_CONFIDENCE" | "SUSPICIOUS_DATE" | "CONFLICT"; message: string };

/** Spec "Regras duras": money with currency and date, index with name and year, no accusation without conviction. */
export function factWarnings(fact: Fact): FactWarning[] {
  const out: FactWarning[] = [];
  const claim = `${fact.claim} ${fact.unit ?? ""} ${typeof fact.value === "string" ? fact.value : ""}`;
  const isMoney = /(r\$|us\$|€|£|\breais?\b|\bd[oó]lar(es)?\b|\beuros?\b|\bG\.\s?\d|\bguaranis?\b|\bpesos?\b|\bsal[aá]rio\b|\bpre[cç]o\b|\baluguel\b|\bcusta\b)/i.test(claim);
  if (isMoney) {
    if (!/(r\$|us\$|€|£|\breais?\b|\bd[oó]lar(es)?\b|\beuros?\b|\bG\.|\bguaranis?\b|\bpesos?\b|\bBRL\b|\bUSD\b|\bEUR\b)/i.test(claim))
      out.push({ factId: fact.id, code: "MONEY_NO_CURRENCY", message: "Dinheiro sempre com a moeda." });
    if (!fact.dataDate && !/\b(19|20)\d{2}\b/.test(claim)) out.push({ factId: fact.id, code: "MONEY_NO_DATE", message: "Dinheiro sempre com a data (\"desde julho de 2026\")." });
  }
  if (/\b(ranking|índice|indice|idh|idhm|ips|ivs|gini|posição|posicao|lugar no)\b/i.test(claim) && !fact.dataDate && !/\b(19|20)\d{2}\b/.test(claim))
    out.push({ factId: fact.id, code: "INDEX_NO_YEAR", message: "Ranking ou índice sempre com o nome e o ano (\"IDHM de 2010\")." });
  if (/\b(acusad[oa]s?|suspeit[oa]s?|investigad[oa]s?|denunciad[oa]s?|r[ée]us?)\b/i.test(fact.claim))
    out.push({ factId: fact.id, code: "ACCUSATION", message: "Acusação sem condenação e pessoas privadas não entram no roteiro." });
  if (fact.confidence === "baixa") out.push({ factId: fact.id, code: "LOW_CONFIDENCE", message: "Só blog ou portal de clique: não entra no roteiro." });
  if (fact.suspiciousDate) out.push({ factId: fact.id, code: "SUSPICIOUS_DATE", message: "Data do metadado diferente da data do texto; vale a do texto." });
  if (fact.conflicts?.length) out.push({ factId: fact.id, code: "CONFLICT", message: `Fontes divergem; use a forma prudente${fact.prudent ? ` ("${fact.prudent}")` : ""}.` });
  return out;
}

/** A fact the script may use: not excluded, confidence média or alta, no accusation. */
export function usableFact(fact: Fact) {
  return !fact.excluded && fact.confidence !== "baixa" && !factWarnings(fact).some((w) => w.code === "ACCUSATION");
}

// ---------- adding facts (agent path) ----------

export const factInputSchema = z.object({
  claim: z.string().trim().min(1).max(500),
  value: z.union([z.number(), z.string().max(80)]).optional(),
  unit: z.string().max(40).optional(),
  dataDate: z.string().max(40).optional(),
  source: z.object({
    title: z.string().max(300).default(""),
    url: z.string().url().max(1000),
    publisher: z.string().max(160).default(""),
    publishedAt: z.string().max(40).optional(),
    quote: z.string().max(1000).optional(),
    kind: z.enum(["oficial", "imprensa", "blog", "outro"]).optional(),
  }),
  /** Date found in the page text, when it disagrees with the metadata. */
  textDate: z.string().max(40).optional(),
});
export type FactInput = z.input<typeof factInputSchema>;

function toSource(input: z.infer<typeof factInputSchema>["source"], now: string): Source {
  const auto = classifySource(input.url);
  // The agent may downgrade a source, never promote a blog to "oficial".
  const kind = input.kind && (auto === "oficial" || input.kind !== "oficial") ? input.kind : auto;
  return sourceSchema.parse({ ...input, publisher: input.publisher || hostOf(input.url), title: input.title || hostOf(input.url), accessedAt: now, kind });
}

export function emptyResearch(): Research {
  return { schemaVersion: 1, questions: [], facts: [], unread: [], pages: [], updatedAt: new Date().toISOString() };
}

/**
 * Merges facts into research: the same claim from another independent source becomes a
 * confirmation (same value) or a conflict (different value, with prudent wording).
 */
export function mergeFacts(research: Research, inputs: FactInput[], now = new Date().toISOString()) {
  const added: string[] = [];
  const merged: string[] = [];
  const ids = new Set(research.facts.map((f) => f.id));
  for (const raw of inputs) {
    const input = factInputSchema.parse(raw);
    const source = toSource(input.source, now);
    const suspiciousDate = Boolean(input.textDate && input.source.publishedAt && yearOf(input.textDate) !== yearOf(input.source.publishedAt));
    if (suspiciousDate) source.publishedAt = input.textDate;
    const key = norm(input.claim);
    const existing = research.facts.find((f) => norm(f.claim) === key);
    if (existing) {
      const known = [existing.source, ...existing.confirmations, ...(existing.conflicts ?? [])].some((s) => s.url === source.url);
      if (!known) {
        if (input.value === undefined || existing.value === undefined || sameValue(input.value, existing.value)) existing.confirmations.push(source);
        else {
          existing.conflicts = [...(existing.conflicts ?? []), { ...source, value: input.value }];
          existing.prudent = prudentWording([existing.value, ...existing.conflicts.map((c) => c.value)], existing.unit);
        }
      }
      existing.confidence = confidenceOf(existing);
      merged.push(existing.id);
      continue;
    }
    let id = shortRandomId("f");
    while (ids.has(id)) id = shortRandomId("f");
    ids.add(id);
    const fact = factSchema.parse({
      id,
      claim: input.claim,
      value: input.value,
      unit: input.unit,
      dataDate: input.dataDate,
      source,
      confirmations: [],
      confidence: "baixa",
      suspiciousDate: suspiciousDate || undefined,
      usedIn: [],
    });
    fact.confidence = confidenceOf(fact);
    research.facts.push(fact);
    added.push(id);
  }
  research.updatedAt = now;
  return { added, merged };
}

function yearOf(s: string) {
  return s.match(/\b(1[89]|20)\d{2}\b/)?.[0];
}

/** Store-backed `research_add_facts`. */
export async function addFacts(store: ChannelStore, profileId: string, channelId: string, episodeId: string, inputs: FactInput[]) {
  let result = { added: [] as string[], merged: [] as string[] };
  const research = await store.mutateEpisodeFile(profileId, channelId, episodeId, "research", emptyResearch, (r) => {
    result = mergeFacts(r, inputs);
  });
  return { ...result, summary: summarizeResearch(research) };
}

export async function setFactExcluded(store: ChannelStore, profileId: string, channelId: string, episodeId: string, factId: string, excluded: boolean) {
  return store.mutateEpisodeFile(profileId, channelId, episodeId, "research", emptyResearch, (r) => {
    const f = r.facts.find((x) => x.id === factId);
    if (!f) throw new Error(`Fato ${factId} não existe.`);
    f.excluded = excluded || undefined;
  });
}

export function summarizeResearch(r: Research) {
  const count = (c: Fact["confidence"]) => r.facts.filter((f) => f.confidence === c && !f.excluded).length;
  return {
    facts: r.facts.length,
    alta: count("alta"),
    media: count("média"),
    baixa: count("baixa"),
    excluded: r.facts.filter((f) => f.excluded).length,
    conflicts: r.facts.filter((f) => f.conflicts?.length).length,
    warnings: r.facts.flatMap(factWarnings).filter((w) => w.code !== "LOW_CONFIDENCE"),
    pagesRead: r.pages.length,
    unread: r.unread.length,
    premise: r.premise,
  };
}

/** One line for the FONTES section of the description: publisher, title and date. */
export function sourceLine(fact: Fact) {
  const s = fact.source;
  const date = fact.dataDate ?? s.publishedAt;
  const title = s.title && s.title !== s.publisher && s.title !== hostOf(s.url) ? ` — ${s.title}` : "";
  return `${s.publisher}${title}${date ? ` (${date})` : ""}: ${s.url}`;
}

export async function setPremise(store: ChannelStore, profileId: string, channelId: string, episodeId: string, premise: NonNullable<Research["premise"]>) {
  return store.mutateEpisodeFile(profileId, channelId, episodeId, "research", emptyResearch, (r) => {
    r.premise = premise;
  });
}

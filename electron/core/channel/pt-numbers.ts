/**
 * Numbers read aloud in Brazilian Portuguese, for the `say` field of a beat
 * ("15.938" → "quinze mil, novecentos e trinta e oito").
 */

const UNITS = ["zero", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez", "onze", "doze", "treze", "quatorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove"];
const TENS = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"];
const HUNDREDS = ["", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos", "seiscentos", "setecentos", "oitocentos", "novecentos"];

function below1000(n: number, feminine = false): string {
  if (n === 0) return "";
  if (n === 100) return "cem";
  const h = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (h) parts.push(feminine && h > 1 ? HUNDREDS[h].replace(/os$/, "as") : HUNDREDS[h]);
  if (rest) {
    if (rest < 20) parts.push(feminine && rest <= 2 ? ["", "uma", "duas"][rest] : UNITS[rest]);
    else {
      const t = Math.floor(rest / 10);
      const u = rest % 10;
      parts.push(u ? `${TENS[t]} e ${feminine && u <= 2 ? ["", "uma", "duas"][u] : UNITS[u]}` : TENS[t]);
    }
  }
  return parts.join(" e ");
}

const SCALES: [number, string, string][] = [
  [1e12, "trilhão", "trilhões"],
  [1e9, "bilhão", "bilhões"],
  [1e6, "milhão", "milhões"],
];

/** Integer → words ("481749" → "quatrocentos e oitenta e um mil, setecentos e quarenta e nove"). */
export function integerToWords(value: number, feminine = false): string {
  let n = Math.floor(Math.abs(value));
  if (n === 0) return "zero";
  const chunks: string[] = [];
  for (const [size, one, many] of SCALES) {
    const q = Math.floor(n / size);
    if (q) {
      chunks.push(`${integerToWords(q)} ${q === 1 ? one : many}`);
      n %= size;
    }
  }
  const thousands = Math.floor(n / 1000);
  const rest = n % 1000;
  if (thousands) chunks.push(thousands === 1 ? "mil" : `${below1000(thousands, feminine)} mil`);
  if (rest) {
    // "mil e cem", "mil e vinte", but "mil, novecentos e trinta e oito".
    const joiner = chunks.length && (rest < 100 || rest % 100 === 0) ? " e " : chunks.length ? ", " : "";
    return `${value < 0 ? "menos " : ""}${chunks.join(", ")}${joiner}${below1000(rest, feminine)}`;
  }
  return `${value < 0 ? "menos " : ""}${chunks.join(", ")}`;
}

/** "4,70" → "quatro vírgula sete"; with `money` → "quatro reais e setenta centavos". */
export function decimalToWords(raw: string, options: { money?: string } = {}): string {
  const [intPart, decPart = ""] = raw.split(",");
  const int = Number(intPart.replace(/\./g, ""));
  if (options.money) {
    const cents = decPart ? Number(decPart.padEnd(2, "0").slice(0, 2)) : 0;
    const currency = options.money;
    const plural = currency === "real" ? "reais" : `${currency}es`;
    const intWords = int ? `${integerToWords(int)} ${int === 1 ? currency : plural}` : "";
    const centWords = cents ? `${integerToWords(cents)} ${cents === 1 ? "centavo" : "centavos"}` : "";
    return [intWords, centWords].filter(Boolean).join(" e ") || `zero ${plural}`;
  }
  if (!decPart) return integerToWords(int);
  const dec = decPart.replace(/0+$/, "");
  if (!dec) return integerToWords(int);
  const decWords = dec.startsWith("0") ? dec.split("").map((d) => UNITS[Number(d)]).join(" ") : integerToWords(Number(dec));
  return `${integerToWords(int)} vírgula ${decWords}`;
}

const LETTERS: Record<string, string> = {
  a: "á", b: "bê", c: "cê", d: "dê", e: "é", f: "éfe", g: "gê", h: "agá", i: "í", j: "jóta", k: "cá", l: "éle", m: "ême",
  n: "ene", o: "ó", p: "pê", q: "quê", r: "érre", s: "ésse", t: "tê", u: "ú", v: "vê", w: "dáblio", x: "xís", y: "ípsilon", z: "zê",
};
/** Acronyms read as words, not spelled. */
const READ_AS_WORD = new Set(["IPTU", "INSS", "SUS", "PIB", "UNESCO", "FIFA", "NASA", "ONU", "OTAN", "UFRJ", "USP", "ENEM", "PIX"]);

export function spellAcronym(acronym: string) {
  return acronym
    .toLowerCase()
    .split("")
    .map((c) => LETTERS[c] ?? c)
    .join(" ");
}

export type Pronunciations = Record<string, string>;

/**
 * Turns the written beat into what the TTS should read (spec "Regras de texto para narração"):
 * numbers with thousands or decimals, percentages and money in words; acronyms spelled;
 * the channel's pronunciation dictionary applied first. Plain integers and years stay as digits.
 */
export function toSay(text: string, dictionary: Pronunciations = {}): string {
  let out = text;
  for (const [from, to] of Object.entries(dictionary).sort((a, b) => b[0].length - a[0].length)) {
    out = out.replace(new RegExp(`(?<![\\p{L}\\d])${from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\d])`, "giu"), to);
  }
  out = out.replace(/(R\$|US\$|€)\s?(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?|\d+(?:,\d{1,2})?)(\s?(milh(?:ão|ões)|bilh(?:ão|ões)|mil)(?![\p{L}]))?/gu, (_m, cur: string, num: string, scale: string | undefined) => {
    const currency = cur === "R$" ? "real" : cur === "US$" ? "dólar" : "euro";
    const plural = currency === "real" ? "reais" : currency === "dólar" ? "dólares" : "euros";
    if (scale) return `${decimalToWords(num)} ${scale.trim()} de ${plural}`;
    return decimalToWords(num, { money: currency }).replace(/dólares?es/g, "dólares").replace(/euroes/g, "euros");
  });
  out = out.replace(/(\d+(?:[.,]\d+)*)\s?%/g, (_m, num: string) => `${/,|\.\d{1,2}$/.test(num) && !/^\d{1,3}(\.\d{3})+$/.test(num) ? decimalToWords(num.replace(".", ",")) : integerToWords(Number(num.replace(/\./g, "")))} por cento`);
  out = out.replace(/\b\d{1,3}(?:\.\d{3})+(?:,\d+)?\b|\b\d+,\d+\b/g, (num) => decimalToWords(num));
  out = out.replace(/\b[A-Z]{2,6}\b/g, (acr) => (READ_AS_WORD.has(acr) ? acr : spellAcronym(acr)));
  return out.replace(/\s+/g, " ").trim();
}

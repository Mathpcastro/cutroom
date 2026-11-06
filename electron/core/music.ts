/**
 * Free music and sound effects from Openverse (no key): Freesound effects and Jamendo music,
 * filtered to licenses that allow commercial use — CC0, public domain mark and CC BY (credit
 * required, returned as `attribution`). NC/ND/SA results are never returned.
 */
export interface MusicResult {
  id: string;
  title: string;
  creator: string;
  license: string;
  licenseUrl: string;
  attribution: string;
  duration?: number;
  url: string;
  source: string;
  page?: string;
}

const API = "https://api.openverse.org/v1/audio/";
export const ALLOWED_LICENSES = ["cc0", "pdm", "by"];

type Raw = {
  id: string;
  title?: string;
  creator?: string;
  license: string;
  license_version?: string;
  license_url?: string;
  attribution?: string;
  duration?: number | null;
  url: string;
  source: string;
  foreign_landing_url?: string;
};

export function toMusicResult(raw: Raw): MusicResult | undefined {
  if (!ALLOWED_LICENSES.includes(raw.license) || !/^https:\/\//.test(raw.url))
    return;
  const license =
    raw.license === "cc0"
      ? "CC0 1.0"
      : raw.license === "pdm"
        ? "Domínio público"
        : `CC BY ${raw.license_version ?? ""}`.trim();
  return {
    id: raw.id,
    title: raw.title?.trim() || "Sem título",
    creator: raw.creator?.trim() || "Autor desconhecido",
    license,
    licenseUrl: raw.license_url ?? "",
    attribution:
      raw.license === "by"
        ? `"${raw.title ?? ""}" por ${raw.creator ?? "autor desconhecido"} (${license}${raw.foreign_landing_url ? `, ${raw.foreign_landing_url}` : ""})`
        : "",
    duration: raw.duration ? raw.duration / 1000 : undefined,
    url: raw.url,
    source: raw.source,
    page: raw.foreign_landing_url,
  };
}

async function get(url: string, signal?: AbortSignal) {
  const response = await fetch(url, {
    signal,
    headers: { "user-agent": "CutRoom (video editor)" },
  });
  if (response.status === 429)
    throw new Error("A busca de músicas atingiu o limite. Tente de novo em um minuto.");
  if (!response.ok)
    throw new Error(`A busca de músicas respondeu ${response.status}.`);
  return response.json();
}

export async function searchMusic(options: {
  query: string;
  kind?: "music" | "sfx";
  limit?: number;
  signal?: AbortSignal;
}): Promise<MusicResult[]> {
  const params = new URLSearchParams({
    q: options.query.slice(0, 200),
    license: ALLOWED_LICENSES.join(","),
    page_size: String(Math.min(30, Math.max(1, options.limit ?? 10))),
  });
  if (options.kind === "sfx") params.set("source", "freesound");
  else params.set("category", "music");
  const body = (await get(`${API}?${params}`, options.signal)) as { results?: Raw[] };
  return (body.results ?? [])
    .map(toMusicResult)
    .filter((r): r is MusicResult => !!r);
}

/** Re-reads the item from Openverse: the license and URL never come from the model's arguments. */
export async function musicDetails(id: string, signal?: AbortSignal) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("ID de música inválido.");
  const result = toMusicResult((await get(`${API}${id}/`, signal)) as Raw);
  if (!result) throw new Error("Esta faixa não tem licença de uso comercial.");
  return result;
}

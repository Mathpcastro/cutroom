import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";

/**
 * Instagram Reels through Composio (REST v3.1) with the buyer's own project API key, the same design
 * as the Carrossell app: the video goes to Composio's storage, a REELS container is created and then
 * published (the publish tool waits for Meta to finish processing the video).
 */
export const COMPOSIO_BASE = "https://backend.composio.dev/api/v3.1";
export const COMPOSIO_KEY = "publish.composio";

export class ComposioError extends Error {
  constructor(
    message: string,
    readonly code = "other",
    readonly status = 0,
  ) {
    super(message);
  }
}

/** Composio and Meta errors in words the user can act on. */
export function friendly(raw: unknown, status = 0) {
  const text = String(raw ?? "").toLowerCase();
  if (status === 401 || /invalid api key/.test(text))
    return new ComposioError("O Composio não aceitou a chave. Use a chave do PROJETO (composio.dev › Settings › Project Settings › API Keys); a chave de AI Clients/MCP e a de usuário (uak_) não servem.", "key", status);
  if (status === 403) return new ComposioError(`O Composio recusou o pedido (403): ${String(raw).slice(0, 240)}. Crie uma chave do projeto com acesso completo.`, "forbidden", status);
  if (status === 429 || /rate limit|too many/.test(text)) return new ComposioError("O Composio pediu uma pausa. Tente de novo em alguns minutos.", "rate", status);
  if (/personal account|not a business|professional account|business or creator/.test(text))
    return new ComposioError("O Instagram só permite postar por aplicativo em contas Profissionais (Empresa ou Criador de conteúdo).", "account", status);
  if (/expired|invalid oauth|access token|reauth|not active|inactive|revoked/.test(text))
    return new ComposioError("A conexão com o Instagram expirou. Reconecte a conta no Composio.", "reconnect", status);
  if (/publishing limit|quota|limit reached|9007|not ready|in_progress/.test(text))
    return new ComposioError(`O Instagram ainda não liberou o vídeo ou atingiu o limite de posts: ${String(raw).slice(0, 200)}`, "quota", status);
  if (/aspect ratio|video|duration|codec|format/.test(text)) return new ComposioError(`O Instagram recusou o vídeo: ${String(raw).slice(0, 240)}`, "video", status);
  return new ComposioError(`O Composio respondeu com erro${status ? ` (${status})` : ""}: ${String(raw ?? "sem detalhes").slice(0, 300)}`, "other", status);
}

/** Tool data arrives as JSON text, nested in data, or plain. */
export function toolData(value: unknown): any {
  let v: any = value;
  for (let i = 0; i < 3; i++) {
    if (typeof v === "string") {
      try {
        v = JSON.parse(v);
      } catch {
        return v;
      }
    } else if (v && typeof v === "object" && v.data !== undefined && Object.keys(v).every((k) => ["data", "successful", "error", "successfull"].includes(k))) v = v.data;
    else break;
  }
  return v;
}
export function pickId(value: unknown, keys = ["id"]) {
  const v = toolData(value);
  if (typeof v === "string" && /^\d{5,}$/.test(v)) return v;
  for (const key of keys) if (v?.[key] !== undefined && v?.[key] !== null && String(v[key])) return String(v[key]);
  return "";
}

export interface InstagramAccount {
  id: string;
  userId?: string;
  igUserId?: string;
  username?: string;
  status?: string;
}

export class Composio {
  constructor(
    private apiKey: string,
    private fetcher: typeof fetch = fetch,
    private base = COMPOSIO_BASE,
  ) {
    if (!apiKey) throw new ComposioError("Cadastre a chave de API do Composio em Publicar, no CutRoom.", "key");
  }
  async call(method: string, path: string, body?: unknown, signal?: AbortSignal) {
    let response: Response;
    try {
      response = await this.fetcher(`${this.base}${path}`, {
        method,
        signal,
        headers: { "x-api-key": this.apiKey, "content-type": "application/json", accept: "application/json" },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new ComposioError(`Sem conexão com o Composio: ${(error as Error).message}`, "network");
    }
    const raw = await response.text();
    let json: any = null;
    try {
      json = raw ? JSON.parse(raw) : null;
    } catch {
      /* Not JSON. */
    }
    if (!response.ok) throw friendly(json?.error?.message ?? json?.message ?? raw, response.status);
    return json ?? {};
  }
  /** Instagram accounts already connected in the Composio project (by any app, Carrossell included). */
  async accounts(signal?: AbortSignal): Promise<InstagramAccount[]> {
    const out: InstagramAccount[] = [];
    let cursor = "";
    for (let page = 0; page < 5; page++) {
      const r = await this.call("GET", `/connected_accounts?toolkit_slugs=instagram&limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, undefined, signal);
      for (const a of r.items ?? []) out.push({ id: String(a.id), status: String(a.status ?? "").toUpperCase(), userId: a.user_id ?? "" });
      cursor = r.next_cursor ?? "";
      if (!cursor) break;
    }
    return out;
  }
  async execute(account: InstagramAccount, slug: string, args: Record<string, unknown>, signal?: AbortSignal) {
    const r = await this.call("POST", `/tools/execute/${encodeURIComponent(slug)}`, { connected_account_id: account.id, arguments: args, ...(account.userId ? { user_id: account.userId } : {}) }, signal);
    if (r.successful === false || (r.error && !r.data)) throw friendly(r.error);
    const data = toolData(r.data);
    if (data && typeof data === "object" && data.error && !data.id) throw friendly(typeof data.error === "string" ? data.error : data.error.message ?? JSON.stringify(data.error));
    return data;
  }
  /** Sends a file to Composio's storage and returns the reference accepted by *_file arguments. */
  async upload(bytes: Uint8Array, name: string, mimetype: string, tool: string, signal?: AbortSignal) {
    const md5 = createHash("md5").update(bytes).digest("hex");
    const r = await this.call("POST", "/files/upload/request", { toolkit_slug: "instagram", tool_slug: tool, filename: name, mimetype, md5 }, signal);
    const url = r.new_presigned_url ?? r.newPresignedUrl;
    if (!url || !r.key) throw new ComposioError("O Composio não liberou o envio do vídeo.");
    const headers: Record<string, string> = { "content-type": mimetype, ...(r.metadata?.storage_backend === "azure_blob_storage" ? { "x-ms-blob-type": "BlockBlob" } : {}) };
    const put = await this.fetcher(url, { method: "PUT", headers, body: bytes as unknown as BodyInit, signal });
    if (!put.ok) throw new ComposioError(`O envio do vídeo falhou (${put.status}).`, "upload", put.status);
    return { name, mimetype, s3key: r.key as string };
  }
}

export async function accountInfo(composio: Composio, account: InstagramAccount, signal?: AbortSignal): Promise<InstagramAccount> {
  const v = await composio.execute(account, "INSTAGRAM_GET_USER_INFO", { ig_user_id: "me", fields: "id,user_id,username,account_type" }, signal);
  const igUserId = pickId(v, ["user_id", "id"]);
  if (!igUserId) throw new ComposioError("O Composio não devolveu o id da conta do Instagram.");
  return { ...account, igUserId, username: String(v?.username ?? "") };
}

export const REEL_LIMITS = { caption: 2200, maxBytes: 300_000_000, minSeconds: 3, maxSeconds: 900 };

/** Publishes an MP4 as a Reel. Only call after the user confirmed this exact video, caption and account. */
export async function publishReel(options: {
  composio: Composio;
  account: InstagramAccount;
  video: string;
  caption?: string;
  shareToFeed?: boolean;
  onStep?: (label: string) => void;
  signal?: AbortSignal;
}) {
  const { composio, account, signal } = options,
    step = options.onStep ?? (() => undefined),
    at = account.username ? ` em @${account.username}` : "";
  if (!account.igUserId) throw new ComposioError("Escolha uma conta do Instagram em Publicar.");
  if ((options.caption ?? "").length > REEL_LIMITS.caption) throw new ComposioError(`A legenda passa de ${REEL_LIMITS.caption} caracteres.`);
  const info = await stat(options.video);
  if (!options.video.toLowerCase().endsWith(".mp4") || info.size > REEL_LIMITS.maxBytes) throw new ComposioError("Use um MP4 de até 300 MB.");
  step(`Enviando o vídeo${at}…`);
  const file = await composio.upload(new Uint8Array(await readFile(options.video)), basename(options.video), "video/mp4", "INSTAGRAM_POST_IG_USER_MEDIA", signal);
  step(`Criando o Reels${at}…`);
  const container = await composio.execute(account, "INSTAGRAM_POST_IG_USER_MEDIA", { ig_user_id: account.igUserId, media_type: "REELS", video_file: file, caption: options.caption ?? "", share_to_feed: options.shareToFeed ?? true }, signal);
  const creationId = pickId(container, ["id", "creation_id", "container_id"]);
  if (!creationId) throw new ComposioError("O Instagram não devolveu o Reels montado. Nada foi postado.");
  step(`Esperando o Instagram processar o vídeo${at}…`);
  const published = await composio.execute(account, "INSTAGRAM_POST_IG_USER_MEDIA_PUBLISH", { ig_user_id: account.igUserId, creation_id: creationId, max_wait_seconds: 300, poll_interval_seconds: 5 }, signal);
  const mediaId = pickId(published, ["id", "media_id"]);
  if (!mediaId) throw new ComposioError("O Instagram não confirmou a publicação. Confira o perfil antes de tentar de novo, para não postar duas vezes.", "unconfirmed");
  let permalink = "";
  try {
    permalink = String((await composio.execute(account, "INSTAGRAM_GET_IG_MEDIA", { ig_media_id: mediaId, fields: "id,permalink" }, signal))?.permalink ?? "");
  } catch {
    /* The post is live even without the link. */
  }
  return { mediaId, permalink, username: account.username ?? "", publishedAt: new Date().toISOString() };
}

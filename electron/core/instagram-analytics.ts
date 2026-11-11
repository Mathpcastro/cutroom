import type { Composio, InstagramAccount } from "./composio";
import { ComposioError } from "./composio";
import { rankReels, type InstagramAnalytics, type ReelInsights } from "../../src/shared/instagramAnalytics";

const day = 86_400_000;
const maximum = 20;
type ObjectData = Record<string, unknown>;
const object = (value: unknown): ObjectData => value && typeof value === "object" ? value as ObjectData : {};
const rows = (value: unknown) => (Array.isArray(value) ? value : object(value).data) as unknown[] | undefined;
const count = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;

export async function fetchReelAnalytics(composio: Pick<Composio, "execute">, account: InstagramAccount, signal?: AbortSignal, now = Date.now()): Promise<InstagramAnalytics> {
  const reels: ReelInsights[] = [];
  const seen = new Set<string>();
  let after: string | undefined;
  let partial = false;
  let limited = false;
  for (let page = 0; page < 3; page++) {
    const result = await composio.execute(account, "INSTAGRAM_GET_IG_USER_MEDIA", {
      ig_user_id: "me", limit: 25, since: Math.floor((now - 30 * day) / 1000), until: Math.floor(now / 1000),
      fields: "id,caption,media_product_type,permalink,timestamp,like_count,comments_count",
      ...(after ? { after } : {}),
    }, signal);
    const list = rows(result);
    if (!Array.isArray(list)) throw new Error("O Composio não retornou a lista de mídias do Instagram.");
    for (const entry of list) {
      const row = object(entry);
      const { id, timestamp } = row;
      if (row.media_product_type !== "REELS" || typeof id !== "string" || seen.has(id) || typeof timestamp !== "string") continue;
      const at = Date.parse(timestamp);
      if (!Number.isFinite(at) || at < now - 30 * day || at > now) continue;
      seen.add(id);
      if (reels.length === maximum) { limited = true; break; }
      const reel: ReelInsights = {
        id, publishedAt: timestamp,
        caption: typeof row.caption === "string" ? row.caption.slice(0, 2200) : "",
        permalink: typeof row.permalink === "string" ? row.permalink : "",
        likes: count(row.like_count), comments: count(row.comments_count),
        reach: null, shares: null, saves: null,
      };
      try {
        const response = await composio.execute(account, "INSTAGRAM_GET_IG_MEDIA_INSIGHTS", {
          ig_media_id: id, metric: ["reach", "saved", "shares"],
        }, signal);
        for (const entry of rows(response) ?? []) {
          const metric = object(entry);
          const values = Array.isArray(metric.values) ? metric.values : [];
          const value = count(object(metric.total_value).value ?? object(values[0]).value);
          if (metric.name === "reach") reel.reach = value;
          if (metric.name === "saved") reel.saves = value;
          if (metric.name === "shares") reel.shares = value;
        }
      } catch (error) {
        if (signal?.aborted || (error instanceof ComposioError && ["key", "reconnect", "rate", "network"].includes(error.code))) throw error;
        partial = true;
      }
      partial ||= Object.values({ likes: reel.likes, comments: reel.comments, saves: reel.saves, shares: reel.shares, reach: reel.reach }).includes(null);
      reels.push(reel);
    }
    const paging = object(object(result).paging);
    const cursor = object(paging.cursors).after;
    if (!paging.next || !list.length || typeof cursor !== "string" || cursor === after) break;
    if (reels.length === maximum || page === 2) { limited = true; break; }
    after = cursor;
  }
  return { accountId: account.id, username: account.username ?? "", updatedAt: new Date(now).toISOString(), reels: rankReels(reels), partial, limited };
}


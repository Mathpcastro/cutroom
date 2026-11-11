import { describe, expect, it, vi } from "vitest";
import { fetchReelAnalytics } from "../electron/core/instagram-analytics";
import { ComposioError, type InstagramAccount } from "../electron/core/composio";
import { interactions } from "../src/shared/instagramAnalytics";

const now = Date.parse("2026-11-09T20:00:00Z");
const account = { id: "connected-1", username: "loja" } as InstagramAccount;
const media = (id: string, likes: number, type = "REELS") => ({
  id, caption: "Legenda " + id, media_product_type: type, timestamp: "2026-11-08T18:00:00Z", like_count: likes, comments_count: 1,
});

describe("Instagram Reel analytics", () => {
  it("ranks recent Reels across pages, preserving missing metrics and zeroes", async () => {
    const execute = vi.fn(async (_account, slug, args) => {
      if (slug === "INSTAGRAM_GET_IG_USER_MEDIA") return args.after
        ? { data: [media("strong", 8), media("regular", 2)] }
        : { data: [media("regular", 2), media("photo", 1000, "FEED")], paging: { next: "next", cursors: { after: "second" } } };
      if (args.ig_media_id === "regular") return { data: [{ name: "saved", values: [{ value: 0 }] }] };
      return { data: [
        { name: "reach", total_value: { value: 500 } },
        { name: "shares", values: [{ value: 3 }] },
        { name: "saved", values: [{ value: 7 }] },
      ] };
    });
    const result = await fetchReelAnalytics({ execute }, account, undefined, now);
    expect(result.reels.map((item) => item.id)).toEqual(["strong", "regular"]);
    expect(interactions(result.reels[0])).toBe(19);
    expect(result.reels[1]).toMatchObject({ saves: 0, shares: null, reach: null });
    expect(result.partial).toBe(true);
    expect(execute.mock.calls.every(([used]) => used.id === account.id)).toBe(true);
    expect(execute.mock.calls.filter(([, slug]) => slug === "INSTAGRAM_GET_IG_MEDIA_INSIGHTS")).toHaveLength(2);
  });

  it("stops on quota errors rather than making more requests", async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce({ data: [media("one", 5), media("two", 1)] })
      .mockRejectedValueOnce(new ComposioError("Rate limit", "rate", 429));
    await expect(fetchReelAnalytics({ execute }, account, undefined, now)).rejects.toThrow("Rate limit");
    expect(execute).toHaveBeenCalledTimes(2);
  });
});


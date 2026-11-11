export interface ReelInsights {
  id: string;
  caption: string;
  permalink: string;
  publishedAt: string;
  likes: number | null;
  comments: number | null;
  saves: number | null;
  shares: number | null;
  reach: number | null;
}

export interface InstagramAnalytics {
  accountId: string;
  username: string;
  updatedAt: string;
  reels: ReelInsights[];
  partial: boolean;
  limited: boolean;
}

export function interactions(reel: ReelInsights) {
  const values = [reel.likes, reel.comments, reel.saves, reel.shares].filter((value): value is number => value !== null);
  return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
}

export function rankReels(reels: ReelInsights[]) {
  return [...reels].sort((a, b) => (interactions(b) ?? -1) - (interactions(a) ?? -1));
}


import { readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { COMPOSIO_KEY, Composio, accountInfo, publishReel, type InstagramAccount } from "./composio";
import type { SecretStore } from "./secrets";

type Progress = (value: number, label?: string) => void;
interface PublishHost {
  secrets: SecretStore;
  userDir: string;
  videosDir: string;
  job<T>(kind: string, label: string, run: (signal: AbortSignal, progress: Progress) => Promise<T>): Promise<T>;
  fetcher?: typeof fetch;
}
interface PublishState {
  accounts: InstagramAccount[];
  defaultAccount?: string;
  history: { mediaId: string; permalink: string; username: string; video: string; publishedAt: string }[];
}

/** Reels publishing settings (Composio key in the encrypted store, accounts and history in publish.json). */
export class Publisher {
  constructor(private host: PublishHost) {}
  private file() {
    return join(this.host.userDir, "publish.json");
  }
  private async state(): Promise<PublishState> {
    try {
      return { accounts: [], history: [], ...JSON.parse(await readFile(this.file(), "utf8")) };
    } catch {
      return { accounts: [], history: [] };
    }
  }
  private async save(state: PublishState) {
    await writeFile(`${this.file()}.partial`, JSON.stringify(state, null, 2), "utf8");
    await rename(`${this.file()}.partial`, this.file());
  }
  private async client() {
    const key = await this.host.secrets.get(COMPOSIO_KEY);
    if (!key) throw new Error("Cadastre a chave do Composio em Estúdio › Publicar, no CutRoom. Não envie a chave pelo chat.");
    return new Composio(key, this.host.fetcher);
  }

  async settings() {
    const s = await this.state();
    const keys = await this.host.secrets.describe([COMPOSIO_KEY]);
    return { hasKey: !!keys[COMPOSIO_KEY], accounts: s.accounts, defaultAccount: s.defaultAccount, history: s.history.slice(-10).reverse() };
  }
  async setKey(key: string | undefined) {
    await this.host.secrets.set(COMPOSIO_KEY, key?.trim() || undefined);
    if (!key?.trim()) {
      await this.save({ ...(await this.state()), accounts: [], defaultAccount: undefined });
      return this.settings();
    }
    return this.refresh();
  }
  /** Reads the Instagram accounts connected in the Composio project (Carrossell's included). */
  async refresh() {
    const composio = await this.client();
    const found: InstagramAccount[] = [];
    for (const account of (await composio.accounts()).filter((a) => a.status === "ACTIVE"))
      try {
        found.push(await accountInfo(composio, account));
      } catch {
        /* Expired or personal accounts are skipped; they cannot post Reels. */
      }
    const s = await this.state();
    const unique = [...new Map(found.map((a) => [a.igUserId, a])).values()];
    await this.save({ ...s, accounts: unique, defaultAccount: unique.some((a) => a.id === s.defaultAccount) ? s.defaultAccount : unique[0]?.id });
    return this.settings();
  }
  async setDefault(id: string) {
    const s = await this.state();
    if (!s.accounts.some((a) => a.id === id)) throw new Error("Conta desconhecida.");
    await this.save({ ...s, defaultAccount: id });
    return this.settings();
  }
  /** MP4s ready to post: Videos/CutRoom, newest first. */
  async videos() {
    const out: { path: string; name: string; size: number; modifiedAt: string }[] = [];
    try {
      for (const name of await readdir(this.host.videosDir))
        if (/\.mp4$/i.test(name) && !/\.partial\./.test(name)) {
          const s = await stat(join(this.host.videosDir, name));
          out.push({ path: join(this.host.videosDir, name), name, size: s.size, modifiedAt: s.mtime.toISOString() });
        }
    } catch {
      /* No videos yet. */
    }
    return out.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt)).slice(0, 30);
  }

  static publishArgs = z
    .object({
      video: z.string().min(1).max(2000),
      caption: z.string().max(2200).optional(),
      account: z.string().max(100).optional(),
      shareToFeed: z.boolean().optional(),
      confirm: z.literal(true, { message: "Confirme com o usuário (vídeo, legenda e conta) e passe confirm: true." }),
    })
    .strict();

  async publish(args: unknown) {
    const a = Publisher.publishArgs.parse(args);
    const s = await this.state();
    const account = s.accounts.find((x) => x.id === (a.account ?? s.defaultAccount) || x.username === a.account?.replace(/^@/, ""));
    if (!account) throw new Error("Nenhuma conta do Instagram escolhida. Atualize as contas em Estúdio › Publicar.");
    const composio = await this.client();
    const result = await this.host.job("publish", `Publicando o Reels em @${account.username}…`, (signal, progress) =>
      publishReel({ composio, account, video: a.video, caption: a.caption, shareToFeed: a.shareToFeed, signal, onStep: (label) => progress(50, label) }),
    );
    const next = await this.state();
    next.history.push({ ...result, video: a.video });
    await this.save(next);
    return result;
  }
}

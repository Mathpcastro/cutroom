import { randomUUID } from "node:crypto";
import { readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { COMPOSIO_KEY, Composio, accountInfo, publishReel, type InstagramAccount } from "./composio";
import type { SecretStore } from "./secrets";
import { dailySlots, dueReels, parseWhen, type OsReelScheduler, type ScheduledReel } from "./reel-schedule";

type Progress = (value: number, label?: string) => void;
interface PublishHost {
  secrets: SecretStore;
  userDir: string;
  videosDir: string;
  job<T>(kind: string, label: string, run: (signal: AbortSignal, progress: Progress) => Promise<T>): Promise<T>;
  fetcher?: typeof fetch;
  /** Wakes CutRoom up at the scheduled time (Task Scheduler / launchd). */
  os?: OsReelScheduler;
}
interface PublishState {
  accounts: InstagramAccount[];
  defaultAccount?: string;
  history: { mediaId: string; permalink: string; username: string; video: string; publishedAt: string }[];
  scheduled?: ScheduledReel[];
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
    const scheduled = (s.scheduled ?? []).filter((e) => e.status !== "cancelled" && (e.status !== "published" || Date.now() - new Date(e.at).getTime() < 7 * 864e5));
    return { hasKey: !!keys[COMPOSIO_KEY], accounts: s.accounts, defaultAccount: s.defaultAccount, history: s.history.slice(-10).reverse(), scheduled: scheduled.sort((a, b) => a.at.localeCompare(b.at)) };
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

  private account(s: PublishState, ref?: string) {
    const account = s.accounts.find((x) => x.id === (ref ?? s.defaultAccount) || x.username === ref?.replace(/^@/, ""));
    if (!account) throw new Error("Nenhuma conta do Instagram escolhida. Atualize as contas em Estúdio › Publicar.");
    return account;
  }
  private async checkVideo(video: string) {
    if (!/\.mp4$/i.test(video) || !(await stat(video).then((x) => x.isFile(), () => false))) throw new Error(`Vídeo não encontrado: ${video}`);
  }

  static scheduleArgs = z
    .object({
      video: z.string().min(1).max(2000),
      caption: z.string().max(2200).optional(),
      account: z.string().max(100).optional(),
      at: z.string().min(10).max(40),
      confirm: z.literal(true, { message: "Confirme com o usuário (vídeo, legenda, conta e horário) e passe confirm: true." }),
    })
    .strict();
  static seriesArgs = z
    .object({
      posts: z.array(z.object({ video: z.string().min(1).max(2000), caption: z.string().max(2200).optional() }).strict()).min(1).max(60),
      time: z.string().regex(/^\d{2}:\d{2}$/),
      everyDays: z.number().int().min(1).max(14).optional(),
      account: z.string().max(100).optional(),
      confirm: z.literal(true, { message: "Confirme a série com o usuário e passe confirm: true." }),
    })
    .strict();

  /** One Reel at a given time. The OS opens CutRoom then; while it is open, a timer posts it. */
  async schedule(args: unknown) {
    const a = Publisher.scheduleArgs.parse(args);
    return this.addScheduled([{ video: a.video, caption: a.caption ?? "", at: parseWhen(a.at) }], a.account);
  }
  /** The autopilot: one Reel per day (or every N days) at the same time. */
  async scheduleSeries(args: unknown) {
    const a = Publisher.seriesArgs.parse(args);
    const slots = dailySlots(a.posts.length, a.time, new Date(), a.everyDays);
    return this.addScheduled(a.posts.map((p, i) => ({ video: p.video, caption: p.caption ?? "", at: slots[i] })), a.account);
  }
  private async addScheduled(items: { video: string; caption: string; at: Date }[], accountRef?: string) {
    const s = await this.state();
    const account = this.account(s, accountRef);
    await this.client(); // a key must exist before anything is promised
    const added: ScheduledReel[] = [];
    const warnings: string[] = [];
    for (const item of items) {
      await this.checkVideo(item.video);
      const entry: ScheduledReel = { id: randomUUID().slice(0, 12), video: item.video, caption: item.caption, account: account.id, at: item.at.toISOString(), status: "scheduled" };
      try {
        await this.host.os?.add(entry.id, item.at);
      } catch (error) {
        warnings.push(`O sistema não aceitou o agendamento automático (${(error as Error).message.split("\n")[0]}): deixe o CutRoom aberto nesse horário.`);
      }
      added.push(entry);
    }
    const next = await this.state();
    next.scheduled = [...(next.scheduled ?? []), ...added];
    await this.save(next);
    return { scheduled: added.map((e) => ({ id: e.id, at: e.at, video: e.video })), account: `@${account.username}`, warnings: [...new Set(warnings)] };
  }
  async cancelScheduled(id: string) {
    const s = await this.state();
    const entry = (s.scheduled ?? []).find((e) => e.id === id);
    if (!entry) throw new Error("Agendamento não encontrado.");
    if (entry.status === "publishing" || entry.status === "published") throw new Error("Este Reels já foi publicado ou está sendo publicado.");
    entry.status = "cancelled";
    await this.save(s);
    await this.host.os?.remove(id);
    return this.settings();
  }
  private running = false;
  /**
   * Publishes what is due (every minute while CutRoom is open, and when the OS opens it with the
   * schedule flag). Entries more than 6 h late wait for the user (status "late").
   */
  async runDue(now = Date.now()) {
    if (this.running) return [];
    this.running = true;
    const results: { id: string; status: string; permalink?: string; error?: string }[] = [];
    try {
      for (const due of dueReels((await this.state()).scheduled ?? [], now)) {
        const s = await this.state();
        const entry = s.scheduled!.find((e) => e.id === due.id)!;
        if (due.late) {
          entry.status = "late";
          await this.save(s);
          results.push({ id: entry.id, status: "late" });
          continue;
        }
        entry.status = "publishing"; // saved before posting: never posts twice
        await this.save(s);
        try {
          const r = await this.post(entry.video, entry.caption, entry.account);
          const after = await this.state();
          Object.assign(after.scheduled!.find((e) => e.id === entry.id)!, { status: "published", permalink: r.permalink });
          await this.save(after);
          results.push({ id: entry.id, status: "published", permalink: r.permalink });
        } catch (error) {
          const after = await this.state();
          Object.assign(after.scheduled!.find((e) => e.id === entry.id)!, { status: "failed", error: (error as Error).message });
          await this.save(after);
          results.push({ id: entry.id, status: "failed", error: (error as Error).message });
        }
        await this.host.os?.remove(entry.id);
      }
    } finally {
      this.running = false;
    }
    return results;
  }
  /** A late or failed entry, after the user confirmed it still makes sense to post. */
  async publishLate(id: string) {
    const s = await this.state();
    const entry = (s.scheduled ?? []).find((e) => e.id === id && (e.status === "late" || e.status === "failed"));
    if (!entry) throw new Error("Só Reels atrasados ou com erro podem ser publicados por aqui.");
    entry.status = "publishing";
    await this.save(s);
    try {
      const r = await this.post(entry.video, entry.caption, entry.account);
      const after = await this.state();
      Object.assign(after.scheduled!.find((e) => e.id === id)!, { status: "published", permalink: r.permalink });
      await this.save(after);
      return r;
    } catch (error) {
      const after = await this.state();
      Object.assign(after.scheduled!.find((e) => e.id === id)!, { status: "failed", error: (error as Error).message });
      await this.save(after);
      throw error;
    }
  }

  async publish(args: unknown) {
    const a = Publisher.publishArgs.parse(args);
    return this.post(a.video, a.caption, a.account, a.shareToFeed);
  }
  private async post(video: string, caption?: string, accountRef?: string, shareToFeed?: boolean) {
    const s = await this.state();
    const account = this.account(s, accountRef);
    const a = { video, caption, shareToFeed };

    const composio = await this.client();
    const result = await this.host.job("publish", `Publicando o Reels em @${account.username}…`, (signal, progress) =>
      publishReel({ composio, account, video: a.video, caption: a.caption, shareToFeed: a.shareToFeed, signal, onStep: (label) => progress(50, label) }),
    );
    const next = await this.state();
    next.history.push({ ...result, video });
    await this.save(next);
    return result;
  }
}

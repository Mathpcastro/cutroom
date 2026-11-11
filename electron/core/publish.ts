import { randomUUID } from "node:crypto";
import { readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { COMPOSIO_KEY, Composio, ComposioError, accountInfo, connectLink, keyFormatProblem, problemMessage, publishReel, type InstagramAccount, type UnusableAccount } from "./composio";
import { fetchReelAnalytics } from "./instagram-analytics";
import type { SecretStore } from "./secrets";
import { DEFAULT_TIMES, dailySlots, dayKey, dueReels, parseWhen, planSlots, validateTimes, type OsReelScheduler, type PilotDays, type PilotRule, type ScheduledReel } from "./reel-schedule";

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
  /** Accounts found in the project that cannot post, with the reason (Spec 2). */
  unusable?: UnusableAccount[];
  checkedAt?: string;
  defaultAccount?: string;
  history: { accountId?: string; mediaId: string; permalink: string; username: string; video: string; publishedAt: string }[];
  scheduled?: ScheduledReel[];
  /** Autopilot rule and switch (Spec 3). */
  pilot?: PilotRule & { enabled: boolean; account?: string; skipped?: string[]; notify?: boolean };
}

const daysSchema = z.union([z.enum(["daily", "alternate"]), z.array(z.number().int().min(0).max(6)).min(1).max(7)]);
const timesSchema = z.array(z.string().regex(/^\d{2}:\d{2}$/)).min(1).max(5);

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
    const pilot = s.pilot ?? { enabled: false, times: DEFAULT_TIMES[1], days: "daily" as PilotDays };
    return { pilot, hasKey: !!keys[COMPOSIO_KEY], keyHint: keys[COMPOSIO_KEY], unusable: s.unusable ?? [], checkedAt: s.checkedAt, accounts: s.accounts, defaultAccount: s.defaultAccount, history: s.history.slice(-10).reverse(), publicationLinks: s.history.slice(-200).reverse(), scheduled: scheduled.sort((a, b) => a.at.localeCompare(b.at)) };
  }
  async analytics(args: unknown) {
    const { account: id } = z.object({ account: z.string().min(1).max(100) }).strict().parse(args);
    const account = this.account(await this.state(), id);
    const composio = await this.client();
    return this.host.job("analytics", "Atualizando Insights dos Reels…", (signal) =>
      fetchReelAnalytics(composio, account, signal),
    );
  }

  async setKey(key: string | undefined) {
    if (!key?.trim()) {
      await this.host.secrets.set(COMPOSIO_KEY, undefined);
      await this.save({ ...(await this.state()), accounts: [], unusable: [], defaultAccount: undefined });
      return this.settings();
    }
    // Validate before saving: a wrong key is never stored.
    const problem = keyFormatProblem(key);
    if (problem) throw new ComposioError(problem, "key");
    try {
      await new Composio(key.trim(), this.host.fetcher).accounts();
    } catch (error) {
      if (error instanceof ComposioError && (error.code === "key" || error.code === "forbidden"))
        throw new ComposioError("Essa chave não foi aceita. Confira se você copiou a chave do projeto (não a chave pessoal).", "key", error.status);
      throw error;
    }
    await this.host.secrets.set(COMPOSIO_KEY, key.trim());
    return this.refresh();
  }
  /** Starts the Instagram authorization for this computer's Composio user. */
  async connectInstagram() {
    return connectLink(await this.client(), "videosell");
  }
  /** Reads the Instagram accounts connected in the Composio project (Carrossell's included). */
  async refresh() {
    const composio = await this.client();
    const found: InstagramAccount[] = [];
    const unusable: UnusableAccount[] = [];
    const flag = (account: InstagramAccount, problem: UnusableAccount["problem"]) =>
      unusable.push({ id: account.id, username: account.username, problem, message: problemMessage(problem, account.username) });
    for (const account of await composio.accounts()) {
      if (account.status !== "ACTIVE") {
        flag(account, /EXPIRED|FAILED/.test(account.status ?? "") ? "expired" : "inactive");
        continue;
      }
      try {
        const info = await accountInfo(composio, account);
        if (info.accountType === "PERSONAL") flag(info, "personal");
        else found.push(info);
      } catch (error) {
        flag(account, error instanceof ComposioError && error.code === "account" ? "personal" : "expired");
      }
    }
    const s = await this.state();
    const unique = [...new Map(found.map((a) => [a.igUserId, a])).values()];
    await this.save({ ...s, accounts: unique, unusable, checkedAt: new Date().toISOString(), defaultAccount: unique.some((a) => a.id === s.defaultAccount) ? s.defaultAccount : unique[0]?.id });
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
      time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
      /** 1 to 5 times a day, each at least 1 h apart. `time` is the one-a-day shortcut. */
      times: timesSchema.optional(),
      days: daysSchema.optional(),
      everyDays: z.number().int().min(1).max(14).optional(),
      pilot: z.boolean().optional(),
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
    if (!a.time && !a.times) throw new Error("Informe o horário (time) ou os horários do dia (times, de 1 a 5).");
    const times = a.times ?? [a.time!];
    const legacy = !a.times && !a.days && a.everyDays && a.everyDays > 2;
    const s = await this.state();
    const taken = (s.scheduled ?? []).filter((e) => e.status === "scheduled" || e.status === "publishing").map((e) => new Date(e.at).getTime());
    const slots = legacy
      ? dailySlots(a.posts.length, a.time!, new Date(), a.everyDays)
      : planSlots(a.posts.length, { times, days: a.days ?? (a.everyDays === 2 ? "alternate" : "daily") }, new Date(), { taken, skip: s.pilot?.skipped });
    return this.addScheduled(a.posts.map((p, i) => ({ video: p.video, caption: p.caption ?? "", at: slots[i], pilot: a.pilot })), a.account);
  }

  /** What the autopilot would do, without saving: shown on the calendar before the user confirms. */
  async previewPilot(args: unknown) {
    const a = z.object({ count: z.number().int().min(1).max(60), times: timesSchema, days: daysSchema }).strict().parse(args);
    const s = await this.state();
    const taken = (s.scheduled ?? []).filter((e) => e.status === "scheduled" || e.status === "publishing").map((e) => new Date(e.at).getTime());
    return { slots: planSlots(a.count, { times: a.times, days: a.days }, new Date(), { taken, skip: s.pilot?.skipped }).map((d) => d.toISOString()) };
  }

  /** Turns the autopilot on (with the rule) or pauses it. Pausing keeps the queue; nothing is posted. */
  async setPilot(args: unknown) {
    const a = z.object({ enabled: z.boolean(), times: timesSchema.optional(), days: daysSchema.optional(), account: z.string().max(100).optional(), notify: z.boolean().optional() }).strict().parse(args);
    const s = await this.state();
    const current = s.pilot ?? { enabled: false, times: DEFAULT_TIMES[1], days: "daily" as PilotDays };
    const times = a.times ? validateTimes(a.times) : current.times;
    s.pilot = { ...current, enabled: a.enabled, times, days: a.days ?? current.days, account: a.account ?? current.account, notify: a.notify ?? current.notify };
    await this.save(s);
    return this.settings();
  }

  /** A new video joins the autopilot at the first free slot (the user confirms this one video). */
  async addToPilot(args: unknown) {
    const a = z.object({ video: z.string().min(1).max(2000), caption: z.string().max(2200).optional(), title: z.string().max(120).optional(), confirm: z.literal(true) }).strict().parse(args);
    const s = await this.state();
    const rule = s.pilot ?? { enabled: false, times: DEFAULT_TIMES[1], days: "daily" as PilotDays };
    const taken = (s.scheduled ?? []).filter((e) => e.status === "scheduled" || e.status === "publishing").map((e) => new Date(e.at).getTime());
    const last = Math.max(Date.now(), ...(s.scheduled ?? []).filter((e) => e.pilot && e.status === "scheduled").map((e) => new Date(e.at).getTime()));
    const [at] = planSlots(1, rule, new Date(), { taken, skip: rule.skipped, from: new Date(last) });
    return this.addScheduled([{ video: a.video, caption: a.caption ?? "", at, pilot: true, title: a.title }], rule.account);
  }

  /** Edits one queued item: its caption or its time. */
  async updateScheduled(args: unknown) {
    const a = z.object({ id: z.string().max(40), caption: z.string().max(2200).optional(), at: z.string().max(40).optional() }).strict().parse(args);
    const s = await this.state();
    const entry = (s.scheduled ?? []).find((e) => e.id === a.id && e.status === "scheduled");
    if (!entry) throw new Error("Só itens agendados podem ser alterados.");
    if (a.caption !== undefined) entry.caption = a.caption;
    if (a.at) {
      const when = parseWhen(a.at);
      entry.at = when.toISOString();
      await this.host.os?.remove(entry.id);
      await this.host.os?.add(entry.id, when).catch(() => undefined);
    }
    await this.save(s);
    return this.settings();
  }

  /** New order for queued items: they keep the same slots, in the order given. */
  async reorderScheduled(args: unknown) {
    const { ids } = z.object({ ids: z.array(z.string().max(40)).min(1).max(200) }).strict().parse(args);
    const s = await this.state();
    const entries = ids.map((id) => (s.scheduled ?? []).find((e) => e.id === id && e.status === "scheduled"));
    if (entries.some((e) => !e)) throw new Error("A fila mudou. Atualize e tente de novo.");
    const slots = entries.map((e) => e!.at).sort();
    for (const [i, entry] of entries.entries()) {
      if (entry!.at === slots[i]) continue;
      entry!.at = slots[i];
      await this.host.os?.remove(entry!.id);
      await this.host.os?.add(entry!.id, new Date(slots[i])).catch(() => undefined);
    }
    await this.save(s);
    return this.settings();
  }

  /** Skips a day: its autopilot items and the ones after it move to the next free slots. */
  async skipDay(args: unknown) {
    const { date } = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict().parse(args);
    const s = await this.state();
    const rule = s.pilot ?? { enabled: false, times: DEFAULT_TIMES[1], days: "daily" as PilotDays };
    rule.skipped = [...new Set([...(rule.skipped ?? []), date])].filter((d) => d >= dayKey(new Date())).slice(-60);
    s.pilot = rule;
    const moving = (s.scheduled ?? []).filter((e) => e.pilot && e.status === "scheduled" && dayKey(new Date(e.at)) >= date).sort((a, b) => a.at.localeCompare(b.at));
    const fixed = (s.scheduled ?? []).filter((e) => !moving.includes(e) && (e.status === "scheduled" || e.status === "publishing")).map((e) => new Date(e.at).getTime());
    const slots = planSlots(moving.length, rule, new Date(), { taken: fixed, skip: rule.skipped });
    for (const [i, entry] of moving.entries()) {
      entry.at = slots[i].toISOString();
      await this.host.os?.remove(entry.id);
      await this.host.os?.add(entry.id, slots[i]).catch(() => undefined);
    }
    await this.save(s);
    return this.settings();
  }
  private async addScheduled(items: { video: string; caption: string; at: Date; pilot?: boolean; title?: string }[], accountRef?: string) {
    const s = await this.state();
    const account = this.account(s, accountRef);
    await this.client(); // a key must exist before anything is promised
    const added: ScheduledReel[] = [];
    const warnings: string[] = [];
    for (const item of items) {
      await this.checkVideo(item.video);
      const entry: ScheduledReel = { id: randomUUID().slice(0, 12), video: item.video, caption: item.caption, account: account.id, at: item.at.toISOString(), status: "scheduled", ...(item.pilot ? { pilot: true } : {}), ...(item.title ? { title: item.title } : {}) };
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
      const before = await this.state();
      // A paused autopilot keeps its items; they wait (and become "late" only if paused past the limit).
      const paused = before.pilot && !before.pilot.enabled;
      for (const due of dueReels((before.scheduled ?? []).filter((e) => !(paused && e.pilot)), now)) {
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
    // "Publicar agora" also works for a scheduled item (the user asked for it on the calendar).
    const entry = (s.scheduled ?? []).find((e) => e.id === id && (e.status === "late" || e.status === "failed" || e.status === "scheduled"));
    if (!entry) throw new Error("Só Reels agendados, atrasados ou com erro podem ser publicados por aqui.");
    await this.host.os?.remove(entry.id);
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
    next.history.push({ ...result, video, accountId: account.id });
    await this.save(next);
    return result;
  }
}

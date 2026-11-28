import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { jobSchema, type Job } from "../../../src/shared/channel";
import { readJson, shortRandomId, writeJsonAtomic } from "./fs-json";

/**
 * Job runner for the channel pipeline (spec "Arquitetura geral"): every long stage runs as a
 * job with progress, cancel and resume. Jobs live in `<userData>/jobs/<id>.json`, survive the
 * app closing, and a job that was running when the app closed is resumed on open (its work
 * is cached on disk, so resuming continues where it stopped).
 * MCP tools answer within 40 s with the job id and keep running in the background.
 */

export type JobContext = { job: Job; signal: AbortSignal; progress: (p: number, message?: string) => void; log: (line: string) => void; addCost: (usd: number) => void };
export type JobHandler = (input: unknown, ctx: JobContext) => Promise<unknown>;

export class JobRunner {
  private running = new Map<string, { controller: AbortController; promise: Promise<Job> }>();
  private handlers = new Map<string, JobHandler>();
  private writes = new Map<string, Promise<unknown>>();
  constructor(readonly dir: string) {}

  register(stage: string, handler: JobHandler) {
    this.handlers.set(stage, handler);
  }

  private file(id: string) {
    if (!/^job_[a-z0-9]{4,24}$/.test(id)) throw new Error("Id de job inválido.");
    return join(this.dir, `${id}.json`);
  }
  private save(job: Job) {
    // Serialized per job: progress updates never overwrite a later state.
    const prev = this.writes.get(job.id) ?? Promise.resolve();
    const snapshot = jobSchema.parse({ ...job, log: job.log.slice(-400) });
    const next = prev.then(() => writeJsonAtomic(this.file(job.id), snapshot)).catch(() => undefined);
    this.writes.set(job.id, next);
    return next;
  }

  async get(id: string): Promise<Job | undefined> {
    try {
      return jobSchema.parse(await readJson(this.file(id)));
    } catch {
      return undefined;
    }
  }

  async list(filter: { episodeId?: string; stage?: string; status?: Job["status"][] } = {}) {
    const names = await readdir(this.dir).catch(() => [] as string[]);
    const out: Job[] = [];
    for (const n of names) {
      if (!n.endsWith(".json")) continue;
      const j = await this.get(n.slice(0, -5));
      if (!j) continue;
      if (filter.episodeId && j.episodeId !== filter.episodeId) continue;
      if (filter.stage && j.stage !== filter.stage) continue;
      if (filter.status && !filter.status.includes(j.status)) continue;
      out.push(j);
    }
    return out.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  /** The active (queued/running) job for an episode stage, if any: calling a tool again never duplicates work. */
  async active(episodeId: string | undefined, stage: string) {
    for (const [id, r] of this.running) {
      const j = await this.get(id);
      if (j && j.stage === stage && j.episodeId === episodeId && (j.status === "running" || j.status === "queued")) return { job: j, promise: r.promise };
    }
    return undefined;
  }

  /** Starts a job (or returns the one already running for the same episode + stage). */
  async start(stage: string, input: unknown, meta: { episodeId?: string; channelId?: string; profileId?: string } = {}) {
    const existing = await this.active(meta.episodeId, stage);
    if (existing) return existing;
    const handler = this.handlers.get(stage);
    if (!handler) throw new Error(`Etapa sem executor: ${stage}.`);
    const job: Job = jobSchema.parse({ id: shortRandomId("job", 8), stage, status: "running", progress: 0, startedAt: new Date().toISOString(), log: [], costUsd: 0, input, ...meta });
    await this.save(job);
    return this.launch(job, handler);
  }

  private launch(job: Job, handler: JobHandler) {
    const controller = new AbortController();
    const ctx: JobContext = {
      job,
      signal: controller.signal,
      progress: (p, message) => {
        job.progress = Math.max(job.progress, Math.min(1, Math.max(0, p)));
        if (message && job.log.at(-1) !== message) job.log.push(message.slice(0, 600));
        void this.save(job);
      },
      log: (line) => {
        job.log.push(line.slice(0, 600));
        void this.save(job);
      },
      addCost: (usd) => {
        job.costUsd = Math.round((job.costUsd + usd) * 10000) / 10000;
      },
    };
    const promise = (async () => {
      try {
        job.result = await handler(job.input, ctx);
        job.status = "completed";
        job.progress = 1;
      } catch (error) {
        job.status = controller.signal.aborted ? "cancelled" : "failed";
        job.error = String((error as Error).message ?? error).slice(0, 2000);
        const code = (error as { code?: string }).code;
        if (code) job.log.push(`code: ${code}`);
      } finally {
        job.finishedAt = new Date().toISOString();
        await this.save(job);
        this.running.delete(job.id);
      }
      return job;
    })();
    this.running.set(job.id, { controller, promise });
    return { job, promise };
  }

  cancel(id: string) {
    const r = this.running.get(id);
    if (!r) return false;
    r.controller.abort();
    return true;
  }

  /** Waits up to `ms` for a job; returns its state either way (MCP answers within 40 s). */
  async wait(id: string, ms: number) {
    const r = this.running.get(id);
    if (r) await Promise.race([r.promise, new Promise((done) => setTimeout(done, ms))]);
    return this.get(id);
  }

  /** On app open: jobs left running are resumed with the same input (their stage caches the work done). */
  async resumeInterrupted() {
    const resumed: string[] = [];
    for (const job of await this.list({ status: ["running", "queued"] })) {
      if (this.running.has(job.id)) continue;
      const handler = this.handlers.get(job.stage);
      if (!handler) {
        job.status = "failed";
        job.error = "O app fechou durante esta etapa e ela não pode ser retomada sozinha.";
        await this.save(job);
        continue;
      }
      job.log.push("Retomado depois que o app foi fechado.");
      this.launch(job, handler);
      resumed.push(job.id);
    }
    return resumed;
  }

  /** Removes finished jobs older than `days`. */
  async prune(days = 30) {
    const limit = Date.now() - days * 86400_000;
    for (const j of await this.list({ status: ["completed", "failed", "cancelled"] }))
      if (j.finishedAt && Date.parse(j.finishedAt) < limit) await rm(this.file(j.id), { force: true });
  }
}

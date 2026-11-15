import { Queue, Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';
import {
  QUEUE_NAMES,
  type JobOptions,
  type QueueMetricsSnapshot,
  type QueueName,
} from './types.js';

export type JobProcessor<T = unknown> = (job: {
  id: string;
  name: string;
  data: T;
  attemptsMade: number;
}) => Promise<unknown>;

interface MemoryJobRecord<T = unknown> {
  id: string;
  queueName: QueueName;
  name: string;
  data: T;
  status: 'waiting' | 'active' | 'delayed' | 'completed' | 'failed';
  attempts: number;
  attemptsMade: number;
  backoffMs: number;
  runAt: number;
  lastError?: string;
  failedAt?: string;
  timer?: ReturnType<typeof setTimeout>;
}

export class QueueManager {
  private readonly driver: 'bullmq' | 'memory';
  private readonly redisConnection?: IORedis;
  private readonly bullQueues = new Map<QueueName, Queue>();
  private readonly bullWorkers = new Map<QueueName, Worker>();
  private readonly processors = new Map<QueueName, { fn: JobProcessor<any>; concurrency: number }>();

  // Memory fallback state
  private readonly memJobs = new Map<QueueName, MemoryJobRecord[]>();
  private readonly memActiveCount = new Map<QueueName, number>();
  private memSeq = 0;

  constructor(options?: { redisUrl?: string; driver?: 'auto' | 'bullmq' | 'memory' }) {
    const requestedDriver = options?.driver ?? (process.env.QUEUE_DRIVER as 'auto' | 'bullmq' | 'memory' | undefined) ?? 'auto';
    const redisUrl = (options?.redisUrl ?? process.env.REDIS_URL ?? '').trim();

    if (requestedDriver === 'bullmq' || (requestedDriver === 'auto' && redisUrl.length > 0)) {
      this.driver = 'bullmq';
      this.redisConnection = new IORedis(redisUrl || 'redis://localhost:6379', {
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
      });
    } else {
      this.driver = 'memory';
    }

    for (const q of QUEUE_NAMES) {
      this.memJobs.set(q, []);
      this.memActiveCount.set(q, 0);
    }
  }

  getDriver(): 'bullmq' | 'memory' {
    return this.driver;
  }

  private getOrCreateBullQueue(queueName: QueueName): Queue {
    let q = this.bullQueues.get(queueName);
    if (!q) {
      q = new Queue(queueName, {
        connection: this.redisConnection! as never,
      });
      this.bullQueues.set(queueName, q);
    }
    return q;
  }

  registerWorker<T = unknown>(
    queueName: QueueName,
    processor: JobProcessor<T>,
    options?: { concurrency?: number },
  ): void {
    const concurrency = options?.concurrency ?? 4;
    this.processors.set(queueName, { fn: processor as JobProcessor<unknown>, concurrency });

    if (this.driver === 'bullmq') {
      if (this.bullWorkers.has(queueName)) return;
      const worker = new Worker(
        queueName,
        async (job: Job) => {
          return processor({
            id: job.id ?? String(Date.now()),
            name: job.name,
            data: job.data as T,
            attemptsMade: job.attemptsMade,
          });
        },
        {
          connection: this.redisConnection! as never,
          concurrency,
        },
      );
      this.bullWorkers.set(queueName, worker);
    } else {
      this.drainMemoryQueue(queueName);
    }
  }

  async enqueue<T = unknown>(
    queueName: QueueName,
    jobName: string,
    data: T,
    opts?: JobOptions,
  ): Promise<{ id: string }> {
    const attempts = opts?.attempts ?? 3;
    const backoffMs = opts?.backoffMs ?? 500;
    const delayMs = Math.max(0, opts?.delayMs ?? 0);

    if (this.driver === 'bullmq') {
      const queue = this.getOrCreateBullQueue(queueName);
      const job = await queue.add(jobName, data, {
        delay: delayMs,
        attempts,
        backoff: { type: 'exponential', delay: backoffMs },
        jobId: opts?.jobId,
        removeOnComplete: { count: 500 },
        removeOnFail: false,
      });
      return { id: job.id ?? `${queueName}-${Date.now()}` };
    }

    const id = opts?.jobId || `mem-${queueName}-${++this.memSeq}`;
    const record: MemoryJobRecord<T> = {
      id,
      queueName,
      name: jobName,
      data,
      status: delayMs > 0 ? 'delayed' : 'waiting',
      attempts,
      attemptsMade: 0,
      backoffMs,
      runAt: Date.now() + delayMs,
    };

    const list = this.memJobs.get(queueName)!;
    list.push(record);

    if (delayMs > 0) {
      record.timer = setTimeout(() => {
        if (record.status === 'delayed') {
          record.status = 'waiting';
          this.drainMemoryQueue(queueName);
        }
      }, delayMs);
    } else {
      queueMicrotask(() => this.drainMemoryQueue(queueName));
    }

    return { id };
  }

  private drainMemoryQueue(queueName: QueueName): void {
    const reg = this.processors.get(queueName);
    if (!reg) return;

    const list = this.memJobs.get(queueName)!;
    let active = this.memActiveCount.get(queueName) ?? 0;

    while (active < reg.concurrency) {
      const next = list.find((j) => j.status === 'waiting' && j.runAt <= Date.now());
      if (!next) break;

      next.status = 'active';
      active += 1;
      this.memActiveCount.set(queueName, active);

      void (async () => {
        try {
          next.attemptsMade += 1;
          await reg.fn({
            id: next.id,
            name: next.name,
            data: next.data,
            attemptsMade: next.attemptsMade,
          });
          next.status = 'completed';
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          next.lastError = message;
          if (next.attemptsMade < next.attempts) {
            const backoff = next.backoffMs * Math.pow(2, next.attemptsMade - 1);
            next.status = 'delayed';
            next.runAt = Date.now() + backoff;
            next.timer = setTimeout(() => {
              if (next.status === 'delayed') {
                next.status = 'waiting';
                this.drainMemoryQueue(queueName);
              }
            }, backoff);
          } else {
            next.status = 'failed';
            next.failedAt = new Date().toISOString();
          }
        } finally {
          this.memActiveCount.set(queueName, Math.max(0, (this.memActiveCount.get(queueName) ?? 1) - 1));
          this.drainMemoryQueue(queueName);
        }
      })();
    }
  }

  async waitUntilIdle(queueName?: QueueName, timeoutMs = 15000): Promise<void> {
    if (this.driver === 'bullmq') {
      const start = Date.now();
      const targets = queueName ? [queueName] : [...QUEUE_NAMES];
      while (Date.now() - start < timeoutMs) {
        let busy = false;
        for (const qn of targets) {
          const q = this.getOrCreateBullQueue(qn);
          const counts = await q.getJobCounts('waiting', 'active', 'delayed');
          if ((counts.waiting ?? 0) + (counts.active ?? 0) + (counts.delayed ?? 0) > 0) {
            busy = true;
            break;
          }
        }
        if (!busy) return;
        await new Promise((r) => setTimeout(r, 40));
      }
      return;
    }

    const start = Date.now();
    const targets = queueName ? [queueName] : [...QUEUE_NAMES];
    while (Date.now() - start < timeoutMs) {
      let busy = false;
      for (const qn of targets) {
        const list = this.memJobs.get(qn) ?? [];
        if (list.some((j) => j.status === 'waiting' || j.status === 'active' || j.status === 'delayed')) {
          busy = true;
          break;
        }
      }
      if (!busy) return;
      await new Promise((r) => setTimeout(r, 25));
    }
  }

  async getMetrics(): Promise<QueueMetricsSnapshot[]> {
    const result: QueueMetricsSnapshot[] = [];
    for (const qn of QUEUE_NAMES) {
      if (this.driver === 'bullmq') {
        const q = this.getOrCreateBullQueue(qn);
        const counts = await q.getJobCounts('waiting', 'active', 'delayed', 'completed', 'failed');
        const failed = await q.getFailed(0, 20);
        result.push({
          name: qn,
          driver: 'bullmq',
          waiting: counts.waiting ?? 0,
          active: counts.active ?? 0,
          delayed: counts.delayed ?? 0,
          completed: counts.completed ?? 0,
          failed: counts.failed ?? 0,
          dlqCount: counts.failed ?? 0,
          failedJobs: failed.map((j) => ({
            id: j.id ?? '',
            name: j.name,
            error: j.failedReason ?? 'Unknown error',
            attemptsMade: j.attemptsMade,
            failedAt: j.finishedOn ? new Date(j.finishedOn).toISOString() : new Date().toISOString(),
          })),
        });
      } else {
        const list = this.memJobs.get(qn) ?? [];
        const failed = list.filter((j) => j.status === 'failed');
        result.push({
          name: qn,
          driver: 'memory',
          waiting: list.filter((j) => j.status === 'waiting').length,
          active: list.filter((j) => j.status === 'active').length,
          delayed: list.filter((j) => j.status === 'delayed').length,
          completed: list.filter((j) => j.status === 'completed').length,
          failed: failed.length,
          dlqCount: failed.length,
          failedJobs: failed.slice(-20).map((j) => ({
            id: j.id,
            name: j.name,
            error: j.lastError ?? 'Unknown error',
            attemptsMade: j.attemptsMade,
            failedAt: j.failedAt ?? new Date().toISOString(),
          })),
        });
      }
    }
    return result;
  }

  async retryFailed(queueName: QueueName): Promise<number> {
    if (this.driver === 'bullmq') {
      const q = this.getOrCreateBullQueue(queueName);
      const failed = await q.getFailed(0, 100);
      let retried = 0;
      for (const job of failed) {
        await job.retry();
        retried += 1;
      }
      return retried;
    }

    const list = this.memJobs.get(queueName) ?? [];
    let retried = 0;
    for (const job of list) {
      if (job.status === 'failed') {
        job.status = 'waiting';
        job.attemptsMade = 0;
        job.runAt = Date.now();
        retried += 1;
      }
    }
    if (retried > 0) this.drainMemoryQueue(queueName);
    return retried;
  }

  async close(): Promise<void> {
    for (const list of this.memJobs.values()) {
      for (const job of list) {
        if (job.timer) clearTimeout(job.timer);
      }
    }
    for (const w of this.bullWorkers.values()) {
      await w.close();
    }
    for (const q of this.bullQueues.values()) {
      await q.close();
    }
    if (this.redisConnection) {
      await this.redisConnection.quit();
    }
  }
}

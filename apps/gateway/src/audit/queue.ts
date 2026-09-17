import { auditEvents, type Db } from "@palang-ai/db";
import type { Decision, FinalAction } from "@palang-ai/core";

export interface AuditEventInput {
  id: string;
  tenantId: string;
  apiKeyId?: string;
  model: string;
  stream: boolean;
  finalAction: FinalAction;
  blockedBy?: string;
  statusCode: number;
  decisions: Decision[];
  latencyTotalMs: number;
  latencyGuardsMs: number;
  latencyUpstreamMs?: number;
  ttftMs?: number;
  usage?: unknown;
}

export interface AuditQueueOptions {
  maxSize?: number;
  flushIntervalMs?: number;
  flushBatchSize?: number;
}

const DEFAULT_MAX_SIZE = 10_000; // TSD §7.5
const DEFAULT_FLUSH_INTERVAL_MS = 1000;
const DEFAULT_FLUSH_BATCH_SIZE = 200;

/**
 * In-memory bounded queue, flushed on an interval or batch-size trigger (TSD §7.5). `enqueue` is
 * synchronous and never awaited by the request path (Working rule 5) — a full queue or a failed
 * flush (e.g. DB down) drops events rather than blocking or retrying indefinitely, matching TSD
 * §10.3's documented limitation ("audit events can be lost on crash or overload").
 */
export class AuditQueue {
  private queue: AuditEventInput[] = [];
  private droppedTotal = 0;
  private readonly maxSize: number;
  private readonly flushBatchSize: number;
  private readonly flushTimer: ReturnType<typeof setInterval>;

  constructor(
    private readonly db: Db,
    options: AuditQueueOptions = {},
  ) {
    this.maxSize = options.maxSize ?? DEFAULT_MAX_SIZE;
    this.flushBatchSize = options.flushBatchSize ?? DEFAULT_FLUSH_BATCH_SIZE;
    this.flushTimer = setInterval(
      () => void this.flush(),
      options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS,
    );
  }

  get droppedCount(): number {
    return this.droppedTotal;
  }

  get pendingCount(): number {
    return this.queue.length;
  }

  enqueue(event: AuditEventInput): void {
    if (this.queue.length >= this.maxSize) {
      this.droppedTotal++;
      return;
    }
    this.queue.push(event);
    if (this.queue.length >= this.flushBatchSize) {
      void this.flush();
    }
  }

  async flush(): Promise<void> {
    if (this.queue.length === 0) return;
    const batch = this.queue.splice(0, this.flushBatchSize);
    try {
      await this.db.insert(auditEvents).values(batch);
    } catch {
      this.droppedTotal += batch.length;
    }
  }

  /** Graceful shutdown (TSD §7.5): stop the timer and flush whatever remains, up to a deadline. */
  async shutdown(deadlineMs = 5000): Promise<void> {
    clearInterval(this.flushTimer);
    await Promise.race([
      this.flushAll(),
      new Promise<void>((resolve) => setTimeout(resolve, deadlineMs)),
    ]);
  }

  private async flushAll(): Promise<void> {
    while (this.queue.length > 0) {
      await this.flush();
    }
  }
}

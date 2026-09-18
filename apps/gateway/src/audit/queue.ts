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

const DEFAULT_MAX_SIZE = 10_000;
const DEFAULT_FLUSH_INTERVAL_MS = 1000;
const DEFAULT_FLUSH_BATCH_SIZE = 200;

// enqueue is synchronous and never awaited by the request path — a full queue or a failed flush
// drops events rather than blocking or retrying.
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

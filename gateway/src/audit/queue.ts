import { auditEvents, type Db } from "../db/index.js";
import type { Decision, FinalAction } from "@palang-ai/guards";

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
  requestContent?: unknown;
  responseContent?: unknown;
}

export interface AuditQueueOptions {
  maxSize?: number;
  flushIntervalMs?: number;
  flushBatchSize?: number;
}

const DEFAULT_MAX_SIZE = 10_000;
const DEFAULT_FLUSH_INTERVAL_MS = 1000;
const DEFAULT_FLUSH_BATCH_SIZE = 200;

// The columns are `integer`: a fractional value fails the whole batch.
function roundLatencies(event: AuditEventInput): AuditEventInput {
  return {
    ...event,
    latencyTotalMs: Math.round(event.latencyTotalMs),
    latencyGuardsMs: Math.round(event.latencyGuardsMs),
    latencyUpstreamMs: event.latencyUpstreamMs && Math.round(event.latencyUpstreamMs),
    ttftMs: event.ttftMs && Math.round(event.ttftMs),
  };
}

// Postgres rejects NUL in text and jsonb (keys included).
function stripNul(value: unknown): unknown {
  if (typeof value === "string") return value.replaceAll("\u0000", "\uFFFD");
  if (Array.isArray(value)) return value.map(stripNul);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [stripNul(key), stripNul(child)]),
    );
  }
  return value;
}

export class AuditQueue {
  private queue: AuditEventInput[] = [];
  private droppedTotal = 0;
  private flushedTotal = 0;
  private readonly maxSize: number;
  private readonly flushBatchSize: number;
  private readonly flushTimer: ReturnType<typeof setInterval>;
  private inFlight: Promise<void> = Promise.resolve();

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

  get flushedCount(): number {
    return this.flushedTotal;
  }

  get pendingCount(): number {
    return this.queue.length;
  }

  enqueue(event: AuditEventInput): void {
    if (this.queue.length >= this.maxSize) {
      this.droppedTotal++;
      return;
    }
    this.queue.push(stripNul(roundLatencies(event)) as AuditEventInput);
    if (this.queue.length >= this.flushBatchSize) {
      void this.flush();
    }
  }

  flush(): Promise<void> {
    if (this.queue.length > 0) {
      const batch = this.queue.splice(0, this.flushBatchSize);
      this.inFlight = this.inFlight.then(() => this.insert(batch));
    }
    return this.inFlight;
  }

  private async insert(batch: AuditEventInput[]): Promise<void> {
    try {
      await this.db.insert(auditEvents).values(batch);
      this.flushedTotal += batch.length;
    } catch {
      if (batch.length === 1) {
        this.droppedTotal++;
        return;
      }
      for (const event of batch) await this.insert([event]);
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
    await this.inFlight;
  }
}

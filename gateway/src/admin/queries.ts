import { and, desc, eq, gte, lt, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { apiKeys, auditEvents, type Db } from "../db/index.js";
import type { FinalAction } from "@palang-ai/guards";

const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;

export interface Window {
  from: Date;
  to: Date;
  tenant?: string;
}

function windowFilter({ from, to, tenant }: Window): SQL | undefined {
  return and(
    gte(auditEvents.createdAt, from),
    lt(auditEvents.createdAt, to),
    tenant ? eq(auditEvents.tenantId, tenant) : undefined,
  );
}

const toNumber = (value: unknown): number => Number(value ?? 0);
const toNullableNumber = (value: unknown): number | null =>
  value === null || value === undefined ? null : Number(value);

export async function queryStats(db: Db, window: Window) {
  const where = windowFilter(window);
  // One of two literals, so sql.raw below is safe.
  const unit = window.to.getTime() - window.from.getTime() <= TWO_DAYS_MS ? "hour" : "day";
  const decision = sql`jsonb_array_elements(${auditEvents.decisions}) as d`;

  const [totals, buckets, byGuard, topBlockReasons, [latency], guardLatency] = await Promise.all([
    db
      .select({ action: auditEvents.finalAction, count: sql<number>`count(*)` })
      .from(auditEvents)
      .where(where)
      .groupBy(auditEvents.finalAction),
    db
      .select({
        bucket: sql<string>`date_trunc(${sql.raw(`'${unit}'`)}, ${auditEvents.createdAt})`,
        action: auditEvents.finalAction,
        count: sql<number>`count(*)`,
      })
      .from(auditEvents)
      .where(where)
      .groupBy(sql`1`, auditEvents.finalAction)
      .orderBy(sql`1`),
    db
      .select({
        guard: sql<string>`d->>'guard'`,
        action: sql<string>`d->>'action'`,
        count: sql<number>`count(*)`,
      })
      .from(sql`${auditEvents}, ${decision}`)
      .where(and(where, sql`d->>'action' in ('flag', 'block')`))
      .groupBy(sql`1`, sql`2`),
    db
      .select({ reason: sql<string>`d->>'reason'`, count: sql<number>`count(*)` })
      .from(sql`${auditEvents}, ${decision}`)
      .where(and(where, sql`d->>'action' = 'block'`))
      .groupBy(sql`1`)
      .orderBy(sql`2 desc`)
      .limit(10),
    db
      .select({
        totalP50: sql<
          number | null
        >`percentile_cont(0.5) within group (order by ${auditEvents.latencyTotalMs})`,
        totalP95: sql<
          number | null
        >`percentile_cont(0.95) within group (order by ${auditEvents.latencyTotalMs})`,
        guardsP50: sql<
          number | null
        >`percentile_cont(0.5) within group (order by ${auditEvents.latencyGuardsMs})`,
        guardsP95: sql<
          number | null
        >`percentile_cont(0.95) within group (order by ${auditEvents.latencyGuardsMs})`,
      })
      .from(auditEvents)
      .where(where),
    db
      .select({
        guard: sql<string>`d->>'guard'`,
        p95: sql<number>`percentile_cont(0.95) within group (order by (d->>'latencyMs')::float)`,
      })
      .from(sql`${auditEvents}, ${decision}`)
      .where(where)
      .groupBy(sql`1`),
  ]);

  return {
    from: window.from.toISOString(),
    to: window.to.toISOString(),
    tenant: window.tenant ?? null,
    bucket: unit,
    totals: Object.fromEntries(totals.map((t) => [t.action, toNumber(t.count)])),
    buckets: buckets.map((b) => ({
      start: new Date(b.bucket).toISOString(),
      action: b.action,
      count: toNumber(b.count),
    })),
    by_guard: byGuard.map((g) => ({ guard: g.guard, action: g.action, count: toNumber(g.count) })),
    top_block_reasons: topBlockReasons.map((r) => ({ reason: r.reason, count: toNumber(r.count) })),
    latency_ms: {
      total_p50: toNullableNumber(latency?.totalP50),
      total_p95: toNullableNumber(latency?.totalP95),
      guards_p50: toNullableNumber(latency?.guardsP50),
      guards_p95: toNullableNumber(latency?.guardsP95),
    },
    guard_latency_p95_ms: Object.fromEntries(guardLatency.map((g) => [g.guard, toNumber(g.p95)])),
  };
}

export interface EventFilter {
  tenant?: string;
  action?: FinalAction;
  guard?: string;
  from?: Date;
  to?: Date;
  cursor?: EventCursor;
  limit: number;
}

// Postgres text, not a Date: a Date drops microseconds and breaks paging.
const cursorSchema = z.object({ createdAt: z.string(), id: z.string() });
export type EventCursor = z.infer<typeof cursorSchema>;

export function encodeCursor(cursor: EventCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

export function decodeCursor(value: string): EventCursor | null {
  try {
    const parsed = cursorSchema.safeParse(JSON.parse(Buffer.from(value, "base64url").toString()));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

const listColumns = {
  id: auditEvents.id,
  tenantId: auditEvents.tenantId,
  apiKeyId: auditEvents.apiKeyId,
  createdAt: auditEvents.createdAt,
  cursorTs: sql<string>`${auditEvents.createdAt}::text`,
  model: auditEvents.model,
  stream: auditEvents.stream,
  finalAction: auditEvents.finalAction,
  blockedBy: auditEvents.blockedBy,
  statusCode: auditEvents.statusCode,
  decisions: auditEvents.decisions,
  latencyTotalMs: auditEvents.latencyTotalMs,
  latencyGuardsMs: auditEvents.latencyGuardsMs,
  latencyUpstreamMs: auditEvents.latencyUpstreamMs,
  ttftMs: auditEvents.ttftMs,
  usage: auditEvents.usage,
  keyName: apiKeys.name,
  keyPrefix: apiKeys.prefix,
  keyRevokedAt: apiKeys.revokedAt,
};

type EventRow = Pick<
  typeof auditEvents.$inferSelect,
  | "id"
  | "tenantId"
  | "apiKeyId"
  | "createdAt"
  | "model"
  | "stream"
  | "finalAction"
  | "blockedBy"
  | "statusCode"
  | "decisions"
  | "latencyTotalMs"
  | "latencyGuardsMs"
  | "latencyUpstreamMs"
  | "ttftMs"
  | "usage"
> & { keyName: string | null; keyPrefix: string | null; keyRevokedAt: Date | null };

function eventJson(row: EventRow) {
  return {
    id: row.id,
    tenant_id: row.tenantId,
    api_key_id: row.apiKeyId,
    created_at: row.createdAt.toISOString(),
    model: row.model,
    stream: row.stream,
    final_action: row.finalAction,
    blocked_by: row.blockedBy,
    status_code: row.statusCode,
    decisions: row.decisions,
    latency_total_ms: row.latencyTotalMs,
    latency_guards_ms: row.latencyGuardsMs,
    latency_upstream_ms: row.latencyUpstreamMs,
    ttft_ms: row.ttftMs,
    usage: row.usage,
    api_key:
      row.apiKeyId && row.keyName !== null
        ? {
            id: row.apiKeyId,
            name: row.keyName,
            prefix: row.keyPrefix ?? "",
            revoked: row.keyRevokedAt !== null,
          }
        : null,
  };
}

export async function queryEvents(db: Db, filter: EventFilter) {
  const rows = await db
    .select(listColumns)
    .from(auditEvents)
    .leftJoin(apiKeys, eq(auditEvents.apiKeyId, apiKeys.id))
    .where(
      and(
        filter.tenant ? eq(auditEvents.tenantId, filter.tenant) : undefined,
        filter.action ? eq(auditEvents.finalAction, filter.action) : undefined,
        filter.guard
          ? sql`exists (select 1 from jsonb_array_elements(${auditEvents.decisions}) d where d->>'guard' = ${filter.guard} and d->>'action' in ('flag', 'block'))`
          : undefined,
        filter.from ? gte(auditEvents.createdAt, filter.from) : undefined,
        filter.to ? lt(auditEvents.createdAt, filter.to) : undefined,
        filter.cursor
          ? sql`(${auditEvents.createdAt}, ${auditEvents.id}) < (${filter.cursor.createdAt}::timestamptz, ${filter.cursor.id}::uuid)`
          : undefined,
      ),
    )
    .orderBy(desc(auditEvents.createdAt), desc(auditEvents.id))
    .limit(filter.limit + 1);

  const page = rows.slice(0, filter.limit);
  const last = page.at(-1);
  return {
    events: page.map(eventJson),
    next_cursor:
      rows.length > filter.limit && last
        ? encodeCursor({ createdAt: last.cursorTs, id: last.id })
        : null,
  };
}

export async function queryEvent(db: Db, id: string) {
  const [row] = await db
    .select({
      ...listColumns,
      requestContent: auditEvents.requestContent,
      responseContent: auditEvents.responseContent,
    })
    .from(auditEvents)
    .leftJoin(apiKeys, eq(auditEvents.apiKeyId, apiKeys.id))
    .where(eq(auditEvents.id, id));
  if (!row) return null;
  return {
    ...eventJson(row),
    request_content: row.requestContent,
    response_content: row.responseContent,
  };
}

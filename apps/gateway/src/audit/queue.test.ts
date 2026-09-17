import { test, expect, beforeAll } from "bun:test";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb, auditEvents, type Db } from "@palang-ai/db";
import { AuditQueue, type AuditEventInput } from "./queue.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required to run apps/gateway audit tests");

const db = createDb(databaseUrl);

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "../../packages/db/drizzle" });
});

function makeEvent(overrides: Partial<AuditEventInput> = {}): AuditEventInput {
  return {
    id: crypto.randomUUID(),
    tenantId: "demo",
    model: "mock-echo",
    stream: false,
    finalAction: "allow",
    statusCode: 200,
    decisions: [],
    latencyTotalMs: 5,
    latencyGuardsMs: 1,
    ...overrides,
  };
}

test("enqueue below batch size does not insert until flush() is called", async () => {
  const queue = new AuditQueue(db, { flushBatchSize: 200, flushIntervalMs: 60_000 });
  const event = makeEvent();
  queue.enqueue(event);

  expect(queue.pendingCount).toBe(1);
  const beforeFlush = await db.select().from(auditEvents).where(eq(auditEvents.id, event.id));
  expect(beforeFlush).toHaveLength(0);

  await queue.flush();
  const afterFlush = await db.select().from(auditEvents).where(eq(auditEvents.id, event.id));
  expect(afterFlush).toHaveLength(1);
  await queue.shutdown();
});

test("reaching flushBatchSize triggers an automatic flush", async () => {
  const queue = new AuditQueue(db, { flushBatchSize: 3, flushIntervalMs: 60_000 });
  const events = [makeEvent(), makeEvent(), makeEvent()];
  for (const e of events) queue.enqueue(e);

  // enqueue's auto-flush is fire-and-forget; give it a tick to land.
  await new Promise((r) => setTimeout(r, 20));

  expect(queue.pendingCount).toBe(0);
  const rows = await db.select().from(auditEvents).where(eq(auditEvents.id, events[0]!.id));
  expect(rows).toHaveLength(1);
  await queue.shutdown();
});

test("queue full: overflow is dropped, not thrown, and counted", () => {
  const queue = new AuditQueue(db, { maxSize: 2, flushBatchSize: 200, flushIntervalMs: 60_000 });
  queue.enqueue(makeEvent());
  queue.enqueue(makeEvent());
  expect(() => queue.enqueue(makeEvent())).not.toThrow();

  expect(queue.pendingCount).toBe(2);
  expect(queue.droppedCount).toBe(1);
});

test("shutdown flushes remaining events within the deadline", async () => {
  const queue = new AuditQueue(db, { flushBatchSize: 200, flushIntervalMs: 60_000 });
  const event = makeEvent();
  queue.enqueue(event);

  await queue.shutdown(2000);

  const rows = await db.select().from(auditEvents).where(eq(auditEvents.id, event.id));
  expect(rows).toHaveLength(1);
});

test("a failed flush (e.g. DB down) drops the batch instead of throwing", async () => {
  const brokenDb = {
    insert: () => ({
      values: async () => {
        throw new Error("simulated DB down");
      },
    }),
  } as unknown as Db;

  const queue = new AuditQueue(brokenDb, { flushBatchSize: 200, flushIntervalMs: 60_000 });
  queue.enqueue(makeEvent());

  await expect(queue.flush()).resolves.toBeUndefined();
  expect(queue.droppedCount).toBe(1);
  expect(queue.pendingCount).toBe(0);
});

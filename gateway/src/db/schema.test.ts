import { test, expect, beforeAll } from "bun:test";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb } from "./client.js";
import { apiKeys, auditEvents } from "./schema.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required to run gateway db tests");

const db = createDb(databaseUrl);

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./drizzle" });
});

test("api_keys: insert and read back", async () => {
  const keyHash = crypto.randomUUID();

  const [inserted] = await db
    .insert(apiKeys)
    .values({ tenantId: "demo", name: "ci-test-key", prefix: "plg_test_abc", keyHash })
    .returning();

  expect(inserted).toMatchObject({ tenantId: "demo", name: "ci-test-key", prefix: "plg_test_abc" });
  expect(inserted?.id).toBeString();
  expect(inserted?.revokedAt).toBeNull();
});

test("audit_events: insert with jsonb decisions and read back", async () => {
  const id = crypto.randomUUID();
  const decisions = [{ guard: "pii-id", action: "allow", latencyMs: 1.2 }];

  await db.insert(auditEvents).values({
    id,
    tenantId: "demo",
    model: "mock-echo",
    stream: false,
    finalAction: "allow",
    statusCode: 200,
    decisions,
    latencyTotalMs: 10,
    latencyGuardsMs: 2,
  });

  const [row] = await db.select().from(auditEvents).where(eq(auditEvents.id, id));
  expect(row?.decisions).toEqual(decisions);
  expect(row?.finalAction).toBe("allow");
});

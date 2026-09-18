import { test, expect, beforeAll } from "bun:test";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb } from "./client.js";
import { apiKeys, auditEvents } from "./schema.js";

// needs a real Postgres 16 at DATABASE_URL:
// docker run --rm -d -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=palang -p 55433:5432 postgres:16
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required to run packages/db tests");

const db = createDb(databaseUrl);

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./drizzle" });
});

test("api_keys: insert and read back", async () => {
  const keyHash = crypto.randomUUID(); // unique per run — key_hash is a unique column

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

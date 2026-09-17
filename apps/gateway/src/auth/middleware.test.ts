import { test, expect, beforeAll } from "bun:test";
import { Hono } from "hono";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb, apiKeys, type Db } from "@palang-ai/db";
import { createAuthMiddleware } from "./middleware.js";
import { generateApiKey } from "./keys.js";

// Integration test — needs a real Postgres 16 at DATABASE_URL, same as packages/db (TSD §14).
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required to run apps/gateway auth tests");

const db = createDb(databaseUrl);

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "../../packages/db/drizzle" });
});

function buildApp() {
  const app = new Hono<{ Variables: { tenantId: string; apiKeyId: string } }>();
  app.get("/protected", createAuthMiddleware(db), (c) =>
    c.json({ tenantId: c.get("tenantId"), apiKeyId: c.get("apiKeyId") }),
  );
  return app;
}

test("valid, non-revoked key resolves to its tenant", async () => {
  const key = await generateApiKey("test");
  const [row] = await db
    .insert(apiKeys)
    .values({ tenantId: "demo", name: "auth-test", prefix: key.prefix, keyHash: key.hash })
    .returning();

  const app = buildApp();
  const res = await app.request("/protected", {
    headers: { Authorization: `Bearer ${key.plaintext}` },
  });

  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body).toEqual({ tenantId: "demo", apiKeyId: row?.id });
});

test("missing Authorization header is 401", async () => {
  const app = buildApp();
  const res = await app.request("/protected");
  expect(res.status).toBe(401);
});

test("unknown key is 401", async () => {
  const app = buildApp();
  const res = await app.request("/protected", {
    headers: { Authorization: "Bearer plg_test_nonexistent" },
  });
  expect(res.status).toBe(401);
});

test("revoked key is 401", async () => {
  const key = await generateApiKey("test");
  await db.insert(apiKeys).values({
    tenantId: "demo",
    name: "auth-test-revoked",
    prefix: key.prefix,
    keyHash: key.hash,
    revokedAt: new Date(),
  });

  const app = buildApp();
  const res = await app.request("/protected", {
    headers: { Authorization: `Bearer ${key.plaintext}` },
  });
  expect(res.status).toBe(401);
});

// Decision 0004: auth is NOT DB-outage-resilient (only the audit path is). A DB failure during
// the lookup must surface as a distinguishable 503, not a crash or a misleading 401.
test("DB unreachable during lookup is 503 auth_unavailable, not a crash or a 401", async () => {
  const brokenDb = {
    select: () => ({
      from: () => ({
        where: async () => {
          throw new Error("simulated DB down");
        },
      }),
    }),
  } as unknown as Db;

  const app = new Hono<{ Variables: { tenantId: string; apiKeyId: string } }>();
  app.get("/protected", createAuthMiddleware(brokenDb), (c) => c.json({ ok: true }));

  const res = await app.request("/protected", {
    headers: { Authorization: "Bearer plg_test_whatever" },
  });

  expect(res.status).toBe(503);
  const body = await res.json();
  expect(body.error.code).toBe("auth_unavailable");
});

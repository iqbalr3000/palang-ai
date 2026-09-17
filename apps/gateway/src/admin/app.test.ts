import { test, expect, beforeAll } from "bun:test";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb } from "@palang-ai/db";
import { createAdminApp } from "./app.js";
import type { PalangConfig } from "../config/schema.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required to run apps/gateway admin tests");

const db = createDb(databaseUrl);
const ADMIN_TOKEN = "test-admin-token";

const config: PalangConfig = {
  server: { public_port: 8080, admin_port: 8081 },
  audit: { content_mode: "redacted", retention_days: 30 },
  models: { path: "./models" },
  tenants: [
    {
      id: "demo",
      failure_mode: "fail_closed",
      upstream: { type: "openai-compatible", base_url: "http://localhost:9090/v1", api_key: "x" },
      allowed_models: ["mock-echo"],
      guards: {},
    },
  ],
};

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "../../packages/db/drizzle" });
});

function buildApp() {
  return createAdminApp({ db, config, adminToken: ADMIN_TOKEN });
}

test("create key: requires admin auth", async () => {
  const app = buildApp();
  const res = await app.request("/admin/tenants/demo/keys", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "test" }),
  });
  expect(res.status).toBe(401);
});

test("create key: unknown tenant is 404", async () => {
  const app = buildApp();
  const res = await app.request("/admin/tenants/nonexistent/keys", {
    method: "POST",
    headers: { Authorization: `Bearer ${ADMIN_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "test" }),
  });
  expect(res.status).toBe(404);
});

test("create key: returns plaintext once, only hash form afterwards", async () => {
  const app = buildApp();
  const res = await app.request("/admin/tenants/demo/keys", {
    method: "POST",
    headers: { Authorization: `Bearer ${ADMIN_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "ci-key" }),
  });

  expect(res.status).toBe(201);
  const body = await res.json();
  expect(body.key).toMatch(/^plg_live_[0-9a-f]{64}$/);
  expect(body.prefix).toBe(body.key.slice(0, 12));
  expect(body.tenant_id).toBe("demo");
  expect(body.id).toBeString();
});

test("revoke key: unknown id is 404", async () => {
  const app = buildApp();
  const res = await app.request("/admin/keys/00000000-0000-0000-0000-000000000000", {
    method: "DELETE",
    headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
  });
  expect(res.status).toBe(404);
});

test("revoke key: round-trip create then revoke", async () => {
  const app = buildApp();
  const created = await app.request("/admin/tenants/demo/keys", {
    method: "POST",
    headers: { Authorization: `Bearer ${ADMIN_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "to-revoke" }),
  });
  const { id } = await created.json();

  const revoked = await app.request(`/admin/keys/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
  });
  expect(revoked.status).toBe(204);
});

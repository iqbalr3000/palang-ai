import { test, expect, beforeAll, afterAll } from "bun:test";
import OpenAI from "openai";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb, apiKeys, auditEvents } from "@palang-ai/db";
import { createApp as createMockUpstreamApp } from "@palang-ai/mock-upstream";
import { createPublicApp } from "../src/public/app.js";
import { AuditQueue } from "../src/audit/queue.js";
import { generateApiKey } from "../src/auth/keys.js";
import type { PalangConfig } from "../src/config/schema.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required to run apps/gateway e2e tests");

const MOCK_UPSTREAM_PORT = 19090;
const GATEWAY_PORT = 18080;

const db = createDb(databaseUrl);
let auditQueue: AuditQueue;
let mockUpstreamServer: ReturnType<typeof Bun.serve>;
let gatewayServer: ReturnType<typeof Bun.serve>;
let apiKeyPlaintext: string;
let openai: OpenAI;

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "../../packages/db/drizzle" });

  mockUpstreamServer = Bun.serve({
    port: MOCK_UPSTREAM_PORT,
    fetch: createMockUpstreamApp().fetch,
  });

  const config: PalangConfig = {
    server: { public_port: GATEWAY_PORT, admin_port: 0 },
    audit: { content_mode: "redacted", retention_days: 30 },
    models: { path: "./models" },
    tenants: [
      {
        id: "demo",
        failure_mode: "fail_closed",
        upstream: {
          type: "openai-compatible",
          base_url: `http://localhost:${MOCK_UPSTREAM_PORT}/v1`,
          api_key: "unused-by-mock-upstream",
        },
        allowed_models: ["mock-echo"],
        guards: {},
      },
    ],
  };

  auditQueue = new AuditQueue(db, { flushIntervalMs: 100 });
  const publicApp = createPublicApp({ db, config, auditQueue });
  gatewayServer = Bun.serve({ port: GATEWAY_PORT, fetch: publicApp.fetch });

  const key = await generateApiKey("test");
  apiKeyPlaintext = key.plaintext;
  await db.insert(apiKeys).values({
    tenantId: "demo",
    name: "e2e-test",
    prefix: key.prefix,
    keyHash: key.hash,
  });

  openai = new OpenAI({ apiKey: apiKeyPlaintext, baseURL: `http://localhost:${GATEWAY_PORT}/v1` });
});

afterAll(async () => {
  mockUpstreamServer.stop();
  gatewayServer.stop();
  await auditQueue.shutdown();
});

test("non-streaming: openai SDK gets the echoed content back, and an audit row appears", async () => {
  const completion = await openai.chat.completions.create({
    model: "mock-echo",
    messages: [{ role: "user", content: "hello from the openai sdk" }],
  });

  expect(completion.choices[0]?.message.content).toBe("hello from the openai sdk");

  await auditQueue.flush();
  const rows = await db.select().from(auditEvents).where(eq(auditEvents.model, "mock-echo"));
  expect(rows.length).toBeGreaterThan(0);
  expect(rows[0]?.finalAction).toBe("allow");
});

test("streaming: openai SDK reassembles the same echoed content", async () => {
  const stream = await openai.chat.completions.create({
    model: "mock-echo",
    stream: true,
    messages: [{ role: "user", content: "streamed via the real sdk" }],
  });

  let content = "";
  for await (const chunk of stream) {
    content += chunk.choices[0]?.delta.content ?? "";
  }

  expect(content).toBe("streamed via the real sdk");
});

// NOTE: `expect(promise).rejects.toThrow()` is unreliable here when run after the streaming
// test earlier in this file (passes in isolation, silently resolves instead of rejecting when
// run as part of the full suite — a Bun test-runner quirk, not a server bug: manually replaying
// the same request outside the test runner, and this same assertion via `.catch()` below, both
// behave correctly). Asserting on the caught error directly sidesteps it.
test("model not in the tenant's allowlist is rejected with 400", async () => {
  const error = await openai.chat.completions
    .create({ model: "not-allowed-model", messages: [{ role: "user", content: "hi" }] })
    .then(() => undefined)
    .catch((e: unknown) => e as { status?: number });

  expect(error?.status).toBe(400);
});

test("wrong API key is rejected with 401", async () => {
  const badClient = new OpenAI({
    apiKey: "plg_test_wrong",
    baseURL: `http://localhost:${GATEWAY_PORT}/v1`,
  });
  const error = await badClient.chat.completions
    .create({ model: "mock-echo", messages: [{ role: "user", content: "hi" }] })
    .then(() => undefined)
    .catch((e: unknown) => e as { status?: number });

  expect(error?.status).toBe(401);
});

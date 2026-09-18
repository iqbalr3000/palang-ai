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

const MOCK_UPSTREAM_PORT = 19094;
const GATEWAY_PORT = 18083;

const db = createDb(databaseUrl);
let auditQueue: AuditQueue;
let mockUpstreamServer: ReturnType<typeof Bun.serve>;
let gatewayServer: ReturnType<typeof Bun.serve>;
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
        allowed_models: ["mock-echo", "mock-split-placeholder"],
        guards: {
          "pii-id": {
            mode: "enforce",
            entities: ["NIK", "NPWP", "PHONE_ID", "EMAIL", "CARD"],
            roles: ["user", "tool", "assistant"],
            preserve_hint: false,
            mask_new_output_pii: false,
          },
        },
      },
    ],
  };

  auditQueue = new AuditQueue(db, { flushIntervalMs: 100 });
  const publicApp = createPublicApp({ db, config, auditQueue });
  gatewayServer = Bun.serve({ port: GATEWAY_PORT, fetch: publicApp.fetch });

  const key = await generateApiKey("test");
  await db
    .insert(apiKeys)
    .values({ tenantId: "demo", name: "wiring-test", prefix: key.prefix, keyHash: key.hash });

  openai = new OpenAI({ apiKey: key.plaintext, baseURL: `http://localhost:${GATEWAY_PORT}/v1` });
});

afterAll(async () => {
  mockUpstreamServer.stop();
  gatewayServer.stop();
  await auditQueue.shutdown();
});

test("non-streaming: PII round-trips, and the audit row's decisions carry no raw PII", async () => {
  const original = "NIK saya 3171011506900001, email budi@example.com";

  const completion = await openai.chat.completions.create({
    model: "mock-echo",
    messages: [{ role: "user", content: original }],
  });

  // The caller gets the real values back — restoring is the point.
  expect(completion.choices[0]?.message.content).toBe(original);

  await auditQueue.flush();
  const [row] = await db
    .select()
    .from(auditEvents)
    .where(eq(auditEvents.tenantId, "demo"))
    .orderBy(auditEvents.createdAt);
  expect(row).toBeDefined();

  const decisionsJson = JSON.stringify(row!.decisions);
  expect(decisionsJson).not.toContain("3171011506900001");
  expect(decisionsJson).not.toContain("budi@example.com");
});

test("streaming: PII round-trips through mock-split-placeholder via the real gateway server", async () => {
  const streamResp = await openai.chat.completions.create({
    model: "mock-split-placeholder",
    stream: true,
    messages: [{ role: "user", content: "hubungi saya di 081234567890 ya" }],
  });

  let content = "";
  for await (const chunk of streamResp) {
    content += chunk.choices[0]?.delta.content ?? "";
  }

  // restored to the vault's normalized form, not the caller's original spelling
  expect(content).toBe("hubungi saya di +6281234567890 ya");
});

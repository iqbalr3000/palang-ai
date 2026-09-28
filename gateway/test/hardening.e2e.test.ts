import { test, expect, beforeAll, afterAll } from "bun:test";
import OpenAI from "openai";
import { desc, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createApp as createMockUpstreamApp } from "@palang-ai/mock-upstream";
import { createDb, apiKeys, auditEvents } from "../src/db/index.js";
import { createPublicApp } from "../src/public/app.js";
import { AuditQueue } from "../src/audit/queue.js";
import { generateApiKey } from "../src/auth/keys.js";
import { configSchema } from "../src/config/schema.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required to run gateway e2e tests");

const MOCK_PORT = 19201;
const SLOW_MOCK_PORT = 19202;
const FAILING_UPSTREAM_PORT = 19203;
const GATEWAY_PORT = 18201;
const RUN = crypto.randomUUID().slice(0, 8); // the DB is shared across runs
const T = { main: `hard-${RUN}`, slow: `hard-slow-${RUN}`, failing: `hard-fail-${RUN}` };

const db = createDb(databaseUrl);
let auditQueue: AuditQueue;
const servers: ReturnType<typeof Bun.serve>[] = [];
const keys = new Map<string, { id: string; plaintext: string }>();

function tenant(id: string, port: number): unknown {
  return {
    id,
    failure_mode: "fail_closed",
    upstream: { type: "openai-compatible", base_url: `http://localhost:${port}/v1`, api_key: "x" },
    allowed_models: ["mock-*"],
    guards: { "pii-id": { mode: "enforce", entities: ["NIK", "EMAIL"] } },
  };
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./drizzle" });
  servers.push(
    Bun.serve({ port: MOCK_PORT, fetch: createMockUpstreamApp({ chunkDelayMs: 0 }).fetch }),
    Bun.serve({ port: SLOW_MOCK_PORT, fetch: createMockUpstreamApp({ chunkDelayMs: 20 }).fetch }),
    // A provider error the way OpenAI sends one: gzip-compressed, with rate-limit and internal
    // headers.
    Bun.serve({
      port: FAILING_UPSTREAM_PORT,
      fetch: () =>
        new Response(Bun.gzipSync(JSON.stringify({ error: { message: "Rate limit reached" } })), {
          status: 429,
          headers: {
            "content-type": "application/json",
            "content-encoding": "gzip",
            "retry-after": "7",
            "x-ratelimit-remaining-requests": "0",
            "openai-organization": "org-internal",
          },
        }),
    }),
  );

  const config = configSchema.parse({
    server: { public_port: GATEWAY_PORT, admin_port: GATEWAY_PORT + 1 },
    audit: {},
    models: { path: "./models" },
    tenants: [
      tenant(T.main, MOCK_PORT),
      tenant(T.slow, SLOW_MOCK_PORT),
      tenant(T.failing, FAILING_UPSTREAM_PORT),
    ],
  });
  auditQueue = new AuditQueue(db, { flushIntervalMs: 50 });
  servers.push(
    Bun.serve({ port: GATEWAY_PORT, fetch: createPublicApp({ db, config, auditQueue }).fetch }),
  );

  for (const t of config.tenants) {
    const key = await generateApiKey("test");
    const [row] = await db
      .insert(apiKeys)
      .values({ tenantId: t.id, name: "hardening", prefix: key.prefix, keyHash: key.hash })
      .returning();
    keys.set(t.id, { id: row!.id, plaintext: key.plaintext });
  }
});

afterAll(async () => {
  for (const server of servers) server.stop(true);
  await auditQueue.shutdown();
});

function post(tenantId: string, body: unknown, init: RequestInit = {}): Promise<Response> {
  return fetch(`http://localhost:${GATEWAY_PORT}/v1/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${keys.get(tenantId)!.plaintext}`,
      "content-type": "application/json",
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
    ...init,
  });
}

async function latestEvent(tenantId: string) {
  await auditQueue.flush();
  const [row] = await db
    .select()
    .from(auditEvents)
    .where(eq(auditEvents.tenantId, tenantId))
    .orderBy(desc(auditEvents.createdAt))
    .limit(1);
  return row;
}

const client = () =>
  new OpenAI({
    apiKey: keys.get(T.main)!.plaintext,
    baseURL: `http://localhost:${GATEWAY_PORT}/v1`,
  });

// #4 — the official SDK's stream helpers need `role` on the first delta and `index` on tool calls.
test("the OpenAI SDK's stream helper accumulates a text stream", async () => {
  const done = await client()
    .beta.chat.completions.stream({
      model: "mock-echo",
      messages: [{ role: "user", content: "email saya budi@example.com" }],
    })
    .finalChatCompletion();
  expect(done.choices[0]?.message).toMatchObject({
    role: "assistant",
    content: "email saya budi@example.com",
  });
});

test("the OpenAI SDK's stream helper accumulates streamed tool calls", async () => {
  const done = await client()
    .beta.chat.completions.stream({
      model: "mock-tool-call",
      messages: [
        { role: "user", content: JSON.stringify({ name: "lookup", arguments: { id: 7 } }) },
      ],
    })
    .finalChatCompletion();
  expect(done.choices[0]?.message.tool_calls).toEqual([
    expect.objectContaining({ function: { name: "lookup", arguments: '{"id":7}' } }),
  ]);
});

// #7
test("streams are served as text/event-stream and unbuffered", async () => {
  const res = await post(T.main, {
    model: "mock-echo",
    stream: true,
    messages: [{ role: "user", content: "hi" }],
  });
  expect(res.headers.get("content-type")).toStartWith("text/event-stream");
  expect(res.headers.get("cache-control")).toBe("no-cache");
  expect(res.headers.get("x-accel-buffering")).toBe("no");
  await res.text();
});

// #8
test("using a key records last_used_at", async () => {
  await post(T.main, { model: "mock-echo", messages: [{ role: "user", content: "hi" }] }).then(
    (r) => r.text(),
  );
  await Bun.sleep(100);
  const [row] = await db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.id, keys.get(T.main)!.id));
  expect(row?.lastUsedAt).toBeInstanceOf(Date);
});

// #9
test("a stream the client abandons is still recorded, as 499", async () => {
  const controller = new AbortController();
  const res = await post(
    T.slow,
    { model: "mock-echo", stream: true, messages: [{ role: "user", content: "x".repeat(400) }] },
    { signal: controller.signal },
  );
  const reader = res.body!.getReader();
  await reader.read();
  controller.abort();
  await Bun.sleep(300);

  const row = await latestEvent(T.slow);
  expect(row).toMatchObject({ statusCode: 499, stream: true });
});

test("oversized streamed tool arguments are recorded as a block", async () => {
  const res = await post(T.main, {
    model: "mock-tool-call",
    stream: true,
    messages: [
      {
        role: "user",
        content: JSON.stringify({ name: "upload", arguments: { blob: "a".repeat(300_000) } }),
      },
    ],
  });
  expect(await res.text()).toContain("tool_arguments_too_large");

  const row = await latestEvent(T.main);
  expect(row).toMatchObject({ finalAction: "block", blockedBy: "stream" });
});

test("streamed usage is stored with the audit row", async () => {
  const res = await post(T.main, {
    model: "mock-echo",
    stream: true,
    stream_options: { include_usage: true },
    messages: [{ role: "user", content: "count me" }],
  });
  await res.text();

  const row = await latestEvent(T.main);
  expect(row?.usage).toMatchObject({ total_tokens: expect.any(Number) });
});

// #10
test("a body that isn't JSON gets a 400, not a 500", async () => {
  const res = await post(T.main, "{bad json");
  expect(res.status).toBe(400);
  expect(await res.json()).toMatchObject({ error: { code: "invalid_request" } });
});

// #11
test("upstream errors keep rate-limit headers and drop the rest", async () => {
  const res = await post(T.failing, {
    model: "mock-echo",
    messages: [{ role: "user", content: "hi" }],
  });
  expect(res.status).toBe(429);
  expect(await res.json()).toEqual({ error: { message: "Rate limit reached" } });
  expect(res.headers.get("retry-after")).toBe("7");
  expect(res.headers.get("x-ratelimit-remaining-requests")).toBe("0");
  expect(res.headers.get("content-encoding")).toBeNull();
  expect(res.headers.get("openai-organization")).toBeNull();
});

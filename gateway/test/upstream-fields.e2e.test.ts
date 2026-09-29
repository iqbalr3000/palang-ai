import { test, expect, beforeAll, afterAll } from "bun:test";
import { and, desc, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb, apiKeys, auditEvents } from "../src/db/index.js";
import { createPublicApp } from "../src/public/app.js";
import { AuditQueue } from "../src/audit/queue.js";
import { generateApiKey } from "../src/auth/keys.js";
import { configSchema } from "../src/config/schema.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required to run gateway e2e tests");

const UPSTREAM_PORT = 19301;
const GATEWAY_PORT = 18301;
const RUN = crypto.randomUUID().slice(0, 8);
const T = { main: `fields-${RUN}`, slash: `fields-slash-${RUN}` };

const db = createDb(databaseUrl);
let auditQueue: AuditQueue;
const servers: ReturnType<typeof Bun.serve>[] = [];
const keys = new Map<string, string>();

let lastPath = "";
let lastBody: Record<string, unknown> = {};
let streamCancelled = false;

const encoder = new TextEncoder();
const sse = (data: unknown) => encoder.encode(`data: ${JSON.stringify(data)}\n\n`);
const chunk = (delta: Record<string, unknown>, index = 0) => ({
  id: "c1",
  model: "fake",
  created: 1,
  choices: [{ index, delta, finish_reason: null }],
});

function canaryIn(body: Record<string, unknown>): string {
  const match = /plg-canary-[0-9a-f]{16}/.exec(JSON.stringify(body.messages));
  if (!match) throw new Error("no canary in the upstream request");
  return match[0];
}

function fakeProvider(request: Request, body: Record<string, unknown>): Response {
  const model = String(body.model);
  const logprobs = { content: [{ token: "raw", logprob: 0 }] };

  if (model === "fake-refusal") {
    const refusal = `I can't share ${canaryIn(body)}`;
    if (!body.stream) {
      return Response.json({
        id: "c1",
        choices: [{ index: 0, message: { role: "assistant", content: null, refusal } }],
      });
    }
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(sse(chunk({ role: "assistant", refusal })));
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        },
      }),
      { headers: { "content-type": "text/event-stream" } },
    );
  }

  if (model === "fake-logprobs") {
    return Response.json({
      id: "c1",
      choices: [{ index: 0, message: { role: "assistant", content: "hello" }, logprobs }],
    });
  }

  if (model === "fake-invalid-chunk") {
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(sse(chunk({ role: "assistant", content: "one " })));
          controller.enqueue(sse({ choices: [{ delta: { content: "no index" } }] }));
          controller.enqueue(sse({ choices: "not a list" }));
          controller.enqueue(sse(chunk({ content: "two" })));
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        },
      }),
      { headers: { "content-type": "text/event-stream" } },
    );
  }

  if (model === "fake-invalid-response") {
    return Response.json({ choices: [{ message: { content: 42 } }] });
  }

  if (model === "fake-leak-then-slow") {
    const canary = canaryIn(body);
    request.signal.addEventListener("abort", () => {
      streamCancelled = true;
    });
    return new Response(
      new ReadableStream({
        async start(controller) {
          controller.enqueue(sse(chunk({ role: "assistant", content: `leak ${canary} ` })));
          for (let i = 0; i < 200; i++) {
            await Bun.sleep(20);
            try {
              controller.enqueue(sse(chunk({ content: "more " })));
            } catch {
              return;
            }
          }
          controller.close();
        },
        cancel() {
          streamCancelled = true;
        },
      }),
      { headers: { "content-type": "text/event-stream" } },
    );
  }

  return Response.json({
    id: "c1",
    choices: [{ index: 0, message: { role: "assistant", content: "ok" } }],
  });
}

function tenant(id: string, baseUrl: string): unknown {
  return {
    id,
    failure_mode: "fail_closed",
    upstream: { type: "openai-compatible", base_url: baseUrl, api_key: "x" },
    allowed_models: ["fake-*"],
    guards: {
      canary: { mode: "enforce", on_detect: "block" },
      "pii-id": { mode: "enforce", entities: ["NIK", "EMAIL"] },
    },
  };
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./drizzle" });
  servers.push(
    Bun.serve({
      port: UPSTREAM_PORT,
      async fetch(request) {
        lastPath = new URL(request.url).pathname;
        lastBody = (await request.json()) as Record<string, unknown>;
        return fakeProvider(request, lastBody);
      },
    }),
  );

  const config = configSchema.parse({
    server: { public_port: GATEWAY_PORT, admin_port: GATEWAY_PORT + 1 },
    audit: {},
    models: { path: "./models" },
    tenants: [
      tenant(T.main, `http://localhost:${UPSTREAM_PORT}/v1`),
      tenant(T.slash, `http://localhost:${UPSTREAM_PORT}/v1/`),
    ],
  });
  auditQueue = new AuditQueue(db, { flushIntervalMs: 50 });
  servers.push(
    Bun.serve({ port: GATEWAY_PORT, fetch: createPublicApp({ db, config, auditQueue }).fetch }),
  );

  for (const t of config.tenants) {
    const key = await generateApiKey("test");
    await db
      .insert(apiKeys)
      .values({ tenantId: t.id, name: "fields", prefix: key.prefix, keyHash: key.hash });
    keys.set(t.id, key.plaintext);
  }
});

afterAll(async () => {
  for (const server of servers) server.stop(true);
  await auditQueue.shutdown();
});

function post(body: Record<string, unknown>, tenantId = T.main): Promise<Response> {
  return fetch(`http://localhost:${GATEWAY_PORT}/v1/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${keys.get(tenantId)}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function latestEvent(model: string) {
  await auditQueue.flush();
  const [row] = await db
    .select()
    .from(auditEvents)
    .where(and(eq(auditEvents.tenantId, T.main), eq(auditEvents.model, model)))
    .orderBy(desc(auditEvents.createdAt))
    .limit(1);
  return row;
}

const withSystem = (user: string) => [
  { role: "system", content: "You are helpful." },
  { role: "user", content: user },
];

test("PII in request fields besides message content is masked before it goes upstream", async () => {
  const response = await post({
    model: "fake-ok",
    messages: [{ role: "user", content: "hi", name: "budi@example.com" }],
    user: "3171011506900001",
    tools: [
      {
        type: "function",
        function: { name: "lookup", description: "Mail siti@example.com", parameters: {} },
      },
    ],
  });
  expect(response.status).toBe(200);
  const sent = JSON.stringify(lastBody);
  for (const raw of ["budi@example.com", "3171011506900001", "siti@example.com"]) {
    expect(sent).not.toContain(raw);
  }
  expect(lastBody.model).toBe("fake-ok");
});

test("logprobs request parameters are not forwarded", async () => {
  await post({
    model: "fake-ok",
    messages: [{ role: "user", content: "hi" }],
    logprobs: true,
    top_logprobs: 3,
  });
  expect(lastBody).not.toHaveProperty("logprobs");
  expect(lastBody).not.toHaveProperty("top_logprobs");
});

test("the legacy functions API is rejected with a 400", async () => {
  for (const legacy of [{ functions: [] }, { function_call: "auto" }]) {
    const response = await post({
      model: "fake-ok",
      messages: [{ role: "user", content: "hi" }],
      ...legacy,
    });
    expect(response.status).toBe(400);
  }
});

test("a canary leaked through refusal is blocked (non-streaming)", async () => {
  const response = await post({ model: "fake-refusal", messages: withSystem("hi") });
  expect(response.status).toBe(400);
  expect(await response.text()).not.toContain("plg-canary-");
  expect((await latestEvent("fake-refusal"))?.finalAction).toBe("block");
});

test("a canary leaked through refusal is blocked (streaming)", async () => {
  const response = await post({ model: "fake-refusal", stream: true, messages: withSystem("hi") });
  expect(await response.text()).not.toContain("plg-canary-");
  expect((await latestEvent("fake-refusal"))?.finalAction).toBe("block");
});

test("logprobs are dropped from responses", async () => {
  const response = await post({
    model: "fake-logprobs",
    messages: [{ role: "user", content: "hi" }],
  });
  const json = (await response.json()) as { choices: Record<string, unknown>[] };
  expect(json.choices[0]).not.toHaveProperty("logprobs");
});

test("malformed stream chunks are skipped, not fatal", async () => {
  const response = await post({
    model: "fake-invalid-chunk",
    stream: true,
    messages: [{ role: "user", content: "hi" }],
  });
  const text = await response.text();
  expect(text).toContain("one ");
  expect(text).toContain("two");
  expect(text).not.toContain("no index");
  expect((await latestEvent("fake-invalid-chunk"))?.statusCode).toBe(200);
});

test("a malformed non-streaming response is a recorded 502", async () => {
  const response = await post({
    model: "fake-invalid-response",
    messages: [{ role: "user", content: "hi" }],
  });
  expect(response.status).toBe(502);
  expect((await latestEvent("fake-invalid-response"))?.statusCode).toBe(502);
});

test("blocking mid-stream cancels the upstream stream", async () => {
  streamCancelled = false;
  const response = await post({
    model: "fake-leak-then-slow",
    stream: true,
    messages: withSystem("hi"),
  });
  await response.text();
  for (let i = 0; i < 50 && !streamCancelled; i++) await Bun.sleep(20);
  expect(streamCancelled).toBe(true);
});

test("a base_url with a trailing slash still reaches /chat/completions", async () => {
  const response = await post(
    { model: "fake-ok", messages: [{ role: "user", content: "hi" }] },
    T.slash,
  );
  expect(response.status).toBe(200);
  expect(lastPath).toBe("/v1/chat/completions");
});

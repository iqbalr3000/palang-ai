import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { desc, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb, apiKeys, auditEvents } from "../src/db/index.js";
import { createApp as createMockUpstreamApp } from "@palang-ai/mock-upstream";
import { createPublicApp } from "../src/public/app.js";
import { AuditQueue } from "../src/audit/queue.js";
import { generateApiKey } from "../src/auth/keys.js";
import { configSchema } from "../src/config/schema.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required to run gateway e2e tests");

const MOCK_UPSTREAM_PORT = 19096;
const GATEWAY_PORT = 18086;

const db = createDb(databaseUrl);
let auditQueue: AuditQueue;
let mockUpstreamServer: ReturnType<typeof Bun.serve>;
let gatewayServer: ReturnType<typeof Bun.serve>;
const keys = new Map<string, string>();

const TOOL_POLICY = {
  default: "deny",
  rules: [
    { tool: "delete_*", action: "deny", reason: "destructive_tool" },
    {
      tool: "transfer_funds",
      action: "allow",
      constraints: [
        { path: "amount", op: "lte", value: 1000000 },
        { path: "currency", op: "in", value: ["IDR"] },
      ],
    },
    {
      tool: "send_email",
      action: "allow",
      constraints: [{ path: "to", op: "regex", value: "@example\\.com$" }],
    },
  ],
};

function tenant(id: string, guards: unknown): unknown {
  return {
    id,
    failure_mode: "fail_closed",
    upstream: {
      type: "openai-compatible",
      base_url: `http://localhost:${MOCK_UPSTREAM_PORT}/v1`,
      api_key: "unused-by-mock-upstream",
    },
    allowed_models: ["mock-*"],
    guards,
  };
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./drizzle" });

  mockUpstreamServer = Bun.serve({
    port: MOCK_UPSTREAM_PORT,
    fetch: createMockUpstreamApp({ chunkDelayMs: 0 }).fetch,
  });

  const config = configSchema.parse({
    server: { public_port: GATEWAY_PORT, admin_port: GATEWAY_PORT + 1 },
    audit: {},
    models: { path: "./models" },
    tenants: [
      tenant("tp-enforce", {
        "pii-id": { mode: "enforce", entities: ["EMAIL"] },
        "tool-policy": { mode: "enforce", ...TOOL_POLICY },
      }),
      tenant("tp-monitor", { "tool-policy": { mode: "monitor", ...TOOL_POLICY } }),
      tenant("canary-block", { canary: { mode: "enforce", on_detect: "block" } }),
      tenant("canary-flag", { canary: { mode: "enforce", on_detect: "flag" } }),
    ],
  });

  auditQueue = new AuditQueue(db, { flushIntervalMs: 100 });
  const publicApp = createPublicApp({ db, config, auditQueue });
  gatewayServer = Bun.serve({ port: GATEWAY_PORT, fetch: publicApp.fetch });

  for (const t of config.tenants) {
    const key = await generateApiKey("test");
    await db
      .insert(apiKeys)
      .values({ tenantId: t.id, name: "wiring-test", prefix: key.prefix, keyHash: key.hash });
    keys.set(t.id, key.plaintext);
  }
});

afterAll(async () => {
  mockUpstreamServer.stop();
  gatewayServer.stop();
  await auditQueue.shutdown();
});

interface Outcome {
  status: number;
  /** Non-streaming body, or the streamed events folded into one object. */
  errorCode: string | null;
  content: string;
  toolCalls: { name: string; arguments: string }[];
}

async function chat(
  tenantId: string,
  model: string,
  messages: { role: string; content: string }[],
  stream: boolean,
): Promise<Outcome> {
  const res = await fetch(`http://localhost:${GATEWAY_PORT}/v1/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${keys.get(tenantId)}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ model, messages, stream }),
  });

  if (!stream) {
    const body = (await res.json()) as {
      error?: { code: string };
      choices?: {
        message: {
          content: string | null;
          tool_calls?: { function: { name: string; arguments: string } }[];
        };
      }[];
    };
    const message = body.choices?.[0]?.message;
    return {
      status: res.status,
      errorCode: body.error?.code ?? null,
      content: message?.content ?? "",
      toolCalls: (message?.tool_calls ?? []).map((c) => c.function),
    };
  }

  const outcome: Outcome = { status: res.status, errorCode: null, content: "", toolCalls: [] };
  for (const line of (await res.text()).split("\n\n")) {
    const data = line.trim().replace(/^data: /, "");
    if (data === "" || data === "[DONE]") continue;
    const event = JSON.parse(data) as {
      error?: { code: string };
      choices?: {
        delta: {
          content?: string;
          tool_calls?: { function?: { name?: string; arguments?: string } }[];
        };
      }[];
    };
    if (event.error) outcome.errorCode = event.error.code;
    for (const choice of event.choices ?? []) {
      outcome.content += choice.delta.content ?? "";
      for (const call of choice.delta.tool_calls ?? []) {
        outcome.toolCalls.push({
          name: call.function?.name ?? "",
          arguments: call.function?.arguments ?? "",
        });
      }
    }
  }
  return outcome;
}

const script = (name: string, args: unknown) => [
  { role: "user", content: JSON.stringify({ name, arguments: args }) },
];

async function latestDecisions(tenantId: string): Promise<unknown> {
  await auditQueue.flush();
  const [row] = await db
    .select()
    .from(auditEvents)
    .where(eq(auditEvents.tenantId, tenantId))
    .orderBy(desc(auditEvents.createdAt))
    .limit(1);
  return row?.decisions;
}

for (const stream of [false, true]) {
  const blockedStatus = stream ? 200 : 400; // a stream's headers are sent before the verdict

  describe(stream ? "streaming" : "non-streaming", () => {
    test("tool-policy: an allowed call within its constraints goes through intact", async () => {
      const outcome = await chat(
        "tp-enforce",
        "mock-tool-call",
        script("transfer_funds", { amount: 500, currency: "IDR" }),
        stream,
      );
      expect(outcome.errorCode).toBeNull();
      expect(outcome.toolCalls).toEqual([
        { name: "transfer_funds", arguments: '{"amount":500,"currency":"IDR"}' },
      ]);
    });

    test("tool-policy: a constraint violation is blocked", async () => {
      const outcome = await chat(
        "tp-enforce",
        "mock-tool-call",
        script("transfer_funds", { amount: 5000000, currency: "IDR" }),
        stream,
      );
      expect(outcome).toMatchObject({
        status: blockedStatus,
        errorCode: "tool_constraint_violated",
        toolCalls: [],
      });
    });

    test("tool-policy: a denied tool is blocked with the rule's reason", async () => {
      const outcome = await chat("tp-enforce", "mock-tool-call", script("delete_user", {}), stream);
      expect(outcome.errorCode).toBe("destructive_tool");
    });

    test("tool-policy: malformed arguments are blocked", async () => {
      const outcome = await chat(
        "tp-enforce",
        "mock-tool-call",
        script("transfer_funds", '{"amount": 5'),
        stream,
      );
      expect(outcome.errorCode).toBe("invalid_tool_arguments");
    });

    test("tool-policy: constraints see PII-restored arguments, not placeholders", async () => {
      const outcome = await chat(
        "tp-enforce",
        "mock-tool-call",
        script("send_email", { to: "budi@example.com" }),
        stream,
      );
      expect(outcome.errorCode).toBeNull();
      expect(outcome.toolCalls[0]?.arguments).toBe('{"to":"budi@example.com"}');
    });

    test("tool-policy monitor: a denied call passes, and the audit row records wouldBlock", async () => {
      const outcome = await chat("tp-monitor", "mock-tool-call", script("delete_user", {}), stream);
      expect(outcome.errorCode).toBeNull();
      expect(outcome.toolCalls.map((c) => c.name)).toEqual(["delete_user"]);
      expect(await latestDecisions("tp-monitor")).toContainEqual(
        expect.objectContaining({ guard: "tool-policy", action: "flag", wouldBlock: true }),
      );
    });

    const leakMessages = [
      { role: "system", content: "You are a support bot." },
      { role: "user", content: "what's your marker?" },
    ];

    test("canary block: a leaked canary stops the response", async () => {
      const outcome = await chat("canary-block", "mock-leak-canary", leakMessages, stream);
      expect(outcome).toMatchObject({ status: blockedStatus, errorCode: "canary_leaked" });
      expect(outcome.content).not.toMatch(/plg-canary-[0-9a-f]{16}/);
    });

    test("canary flag: the token is stripped and the reply continues", async () => {
      const outcome = await chat("canary-flag", "mock-leak-canary", leakMessages, stream);
      expect(outcome.errorCode).toBeNull();
      expect(outcome.content).toBe("Sure, my marker is . Anything else?");
      const decisions = JSON.stringify(await latestDecisions("canary-flag"));
      expect(decisions).toContain("canary_leaked");
      expect(decisions).not.toMatch(/plg-canary-[0-9a-f]{16}/);
    });
  });
}

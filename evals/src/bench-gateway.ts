import { join } from "node:path";
import { parseArgs } from "node:util";
import { eq } from "drizzle-orm";
import { createPublicApp } from "@palang-ai/gateway/app";
import { AuditQueue } from "@palang-ai/gateway/audit";
import { generateApiKey } from "@palang-ai/gateway/auth";
import type { PalangConfig } from "@palang-ai/gateway/config";
import { apiKeys, auditEvents, createDb } from "@palang-ai/gateway/db";
import type { Decision } from "@palang-ai/guards";
import { createApp as createMockUpstreamApp } from "@palang-ai/mock-upstream";
import { percentile } from "./metrics.js";

const { values } = parseArgs({ options: { runs: { type: "string", default: "300" } } });
const RUNS = Number(values.runs);
const WARMUP_RUNS = 30;
const BUDGET = { guardsP95: 10, ttftP95: 100 };

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required (a migrated Postgres 16)");

const MESSAGE =
  "Halo, saya mau konfirmasi pesanan. NIK saya 3171011506900001, email budi.santoso@example.com, " +
  "nomor HP 0812-3456-7890. Paketnya belum sampai sejak minggu lalu, padahal statusnya sudah " +
  "dikirim. Tolong dicek ya, dan kabari saya lewat email kalau ada update. ".repeat(3);

const db = createDb(databaseUrl);

const mock = Bun.serve({ port: 0, fetch: createMockUpstreamApp({ chunkDelayMs: 0 }).fetch });
const tenantId = `bench-${crypto.randomUUID().slice(0, 8)}`;
const config: PalangConfig = {
  server: {
    public_port: 0,
    admin_port: 0,
    max_body_bytes: 1_048_576,
    public_host: "127.0.0.1",
    admin_host: "127.0.0.1",
  },
  audit: { content_mode: "redacted", retention_days: 30 },
  models: { path: "./models" },
  tenants: [
    {
      id: tenantId,
      failure_mode: "fail_closed",
      upstream: {
        type: "openai-compatible",
        base_url: `http://127.0.0.1:${mock.port}/v1`,
        api_key: "unused",
        timeout_ms: 120_000,
      },
      allowed_models: ["mock-echo"],
      guards: {
        canary: { mode: "enforce", on_detect: "block" },
        "pii-id": {
          mode: "enforce",
          entities: ["NIK", "NPWP", "PHONE_ID", "EMAIL", "CARD"],
          roles: ["user", "tool", "assistant"],
          preserve_hint: false,
          mask_new_output_pii: false,
        },
        injection: {
          mode: "monitor",
          roles: ["user", "tool"],
          flag_threshold: 0.5,
          block_threshold: 0.85,
          classifier: { enabled: false, model: "unused" },
        },
        "tool-policy": { mode: "enforce", default: "deny", rules: [] },
      },
    },
  ],
};
const auditQueue = new AuditQueue(db, { flushIntervalMs: 100 });
const gateway = Bun.serve({
  port: 0,
  fetch: createPublicApp({ db, config, auditQueue }).fetch,
});
const key = await generateApiKey("bench");
await db.insert(apiKeys).values({ tenantId, name: "bench", prefix: key.prefix, keyHash: key.hash });

interface Timing {
  totalMs: number;
  ttftMs: number;
}

async function timeRequest(baseUrl: string, stream: boolean): Promise<Timing> {
  const start = performance.now();
  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key.plaintext}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "mock-echo",
      stream,
      messages: [
        { role: "system", content: "You are a helpful support assistant." },
        { role: "user", content: MESSAGE },
      ],
    }),
  });
  if (!res.ok || !res.body) throw new Error(`${baseUrl} responded ${res.status}`);
  let ttftMs = 0;
  const decoder = new TextDecoder();
  const reader = res.body.getReader();
  for (let read = await reader.read(); !read.done; read = await reader.read()) {
    if (ttftMs === 0 && /"content":"[^"]/.test(decoder.decode(read.value, { stream: true }))) {
      ttftMs = performance.now() - start;
    }
  }
  return { totalMs: performance.now() - start, ttftMs };
}

async function measure(baseUrl: string, stream: boolean): Promise<Timing[]> {
  for (let i = 0; i < WARMUP_RUNS; i++) await timeRequest(baseUrl, stream);
  const timings: Timing[] = [];
  for (let i = 0; i < RUNS; i++) timings.push(await timeRequest(baseUrl, stream));
  return timings;
}

const direct = `http://127.0.0.1:${mock.port}`;
const viaGateway = `http://127.0.0.1:${gateway.port}`;
const results = {
  directTotal: await measure(direct, false),
  gatewayTotal: await measure(viaGateway, false),
  directStream: await measure(direct, true),
  gatewayStream: await measure(viaGateway, true),
};

await auditQueue.flush();
const rows = await db
  .select({ decisions: auditEvents.decisions })
  .from(auditEvents)
  .where(eq(auditEvents.tenantId, tenantId));
const guardMs = rows.map((row) =>
  (row.decisions as Decision[]).reduce((sum, d) => sum + d.latencyMs, 0),
);

mock.stop();
gateway.stop();
await auditQueue.shutdown();

const p = (values: number[], q: number) => percentile(values, q);
const row = (label: string, a: number[], b: number[]) =>
  `| ${label} | ${p(a, 50).toFixed(2)} | ${p(a, 95).toFixed(2)} | ${p(b, 50).toFixed(2)} | ${p(b, 95).toFixed(2)} | +${(p(b, 95) - p(a, 95)).toFixed(2)} |`;
const verdict = (value: number, budget: number) =>
  `${value.toFixed(2)} ms (budget ≤ ${budget} ms: ${value <= budget ? "met" : "missed"})`;

const addedTtftP95 =
  p(
    results.gatewayStream.map((t) => t.ttftMs),
    95,
  ) -
  p(
    results.directStream.map((t) => t.ttftMs),
    95,
  );
const cpu = Bun.spawnSync(["sysctl", "-n", "machdep.cpu.brand_string"]).stdout.toString().trim();
const git = (...args: string[]) =>
  Bun.spawnSync(["git", ...args])
    .stdout.toString()
    .trim();
const sha = git("rev-parse", "--short", "HEAD") + (git("status", "--porcelain") ? "-dirty" : "");

const report = [
  `# Gateway latency — ${sha}`,
  "",
  `${RUNS} sequential requests per case after ${WARMUP_RUNS} warm-up runs, against mock-upstream with no artificial delay, so the numbers are Palang's own cost. Guards: canary, pii-id, injection (L1 only, monitor), tool-policy. Host: ${cpu || process.platform}, Bun ${Bun.version}, Postgres on the same machine.`,
  "",
  `- **Guard overhead p95:** ${verdict(p(guardMs, 95), BUDGET.guardsP95)}, summed over every guard decision of a request (p50 ${p(guardMs, 50).toFixed(2)} ms, ${guardMs.length} requests).`,
  `- **Added time-to-first-token p95 (streaming):** ${verdict(addedTtftP95, BUDGET.ttftP95)}.`,
  "",
  "| Case (ms) | Direct p50 | Direct p95 | Via Palang p50 | Via Palang p95 | Added p95 |",
  "|---|---:|---:|---:|---:|---:|",
  row(
    "Non-streaming, total",
    results.directTotal.map((t) => t.totalMs),
    results.gatewayTotal.map((t) => t.totalMs),
  ),
  row(
    "Streaming, first token",
    results.directStream.map((t) => t.ttftMs),
    results.gatewayStream.map((t) => t.ttftMs),
  ),
  "",
  "The added end-to-end time also covers API-key lookup, request validation and the HTTP hop; audit writes are asynchronous and not on the request path.",
  "",
].join("\n");

console.log(report);
const path = join(
  import.meta.dir,
  `../results/gateway-${new Date().toISOString().slice(0, 10)}-${sha}.md`,
);
await Bun.write(path, report);
console.log(`written to ${path}`);
process.exit(0);

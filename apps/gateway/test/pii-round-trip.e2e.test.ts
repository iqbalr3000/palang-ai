import { test, expect, beforeAll, afterAll } from "bun:test";
import type { GuardContext } from "@palang-ai/core";
import { runInputPipeline } from "@palang-ai/core";
import {
  createPiiIdInputGuard,
  createPiiIdOutputGuard,
  DEFAULT_PII_ID_CONFIG,
} from "@palang-ai/guards";
import { createApp as createMockUpstreamApp } from "@palang-ai/mock-upstream";
import { processStream } from "../src/stream/processor.js";

// mask -> send (echoed back one char at a time, splitting the placeholder) -> the real stream
// processor's holdback buffer + output guard restore it -> compare to the original.
const MOCK_UPSTREAM_PORT = 19093;
let server: ReturnType<typeof Bun.serve>;

beforeAll(() => {
  server = Bun.serve({ port: MOCK_UPSTREAM_PORT, fetch: createMockUpstreamApp().fetch });
});

afterAll(() => {
  server.stop();
});

test("PII round-trips through mask -> mock-split-placeholder -> restore, byte for byte", async () => {
  const originalText = "NIK saya 3171011506900001 dan email budi@example.com, tolong dicatat";

  const ctx: GuardContext = {
    requestId: "req_roundtrip",
    tenantId: "demo",
    model: "mock-split-placeholder",
    stream: true,
    messages: [{ role: "user", content: originalText }],
    piiVault: new Map(),
    signal: new AbortController().signal,
    metadata: {},
  };

  const inputGuard = createPiiIdInputGuard(DEFAULT_PII_ID_CONFIG);
  const pipelineResult = await runInputPipeline([inputGuard], ctx, {
    failureMode: "fail_open",
    guards: { "pii-id": { mode: "enforce" } },
  });
  expect(pipelineResult.blocked).toBeNull();

  const maskedText = ctx.messages[0]!.content!;
  expect(maskedText).not.toContain("3171011506900001"); // raw PII never leaves masked
  expect(maskedText).not.toContain("budi@example.com");
  expect(maskedText).toContain("[NIK_1]");
  expect(maskedText).toContain("[EMAIL_1]");

  const upstreamRes = await fetch(`http://localhost:${MOCK_UPSTREAM_PORT}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "mock-split-placeholder",
      stream: true,
      messages: ctx.messages,
    }),
  });

  const outputGuard = createPiiIdOutputGuard(DEFAULT_PII_ID_CONFIG);
  const written: string[] = [];
  await processStream(
    upstreamRes.body!,
    {
      outputGuards: [outputGuard],
      guardConfigs: { "pii-id": { mode: "enforce" } },
      failureMode: "fail_open",
      ctx,
    },
    async (chunk) => {
      written.push(chunk);
    },
  );

  const events = written
    .map((w) => w.trim())
    .filter((w) => w.startsWith("data: ") && w !== "data: [DONE]")
    .map((w) => JSON.parse(w.slice("data: ".length)));

  const finalText = events.map((e) => e.choices?.[0]?.delta?.content ?? "").join("");

  // Full round-trip, byte for byte: masked before it ever reaches "upstream", restored before it
  // reaches back to the caller — restored output legitimately contains the real values (that's
  // the point), TSD's "no raw PII" acceptance criterion is scoped to logs/audit rows, not this.
  expect(finalText).toBe(originalText);
});

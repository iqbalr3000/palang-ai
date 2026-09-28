import { test, expect } from "bun:test";
import type { GuardContext, OutputGuard } from "@palang-ai/guards";
import {
  DEFAULT_PII_ID_CONFIG,
  createCanaryInputGuard,
  createCanaryOutputGuard,
  createPiiIdOutputGuard,
  getCanary,
} from "@palang-ai/guards";
import { processStream, type StreamProcessorDeps } from "./processor.js";

function sseStream(events: Array<Record<string, unknown> | "[DONE]">): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const event of events) {
        const data = event === "[DONE]" ? "[DONE]" : JSON.stringify(event);
        controller.enqueue(encoder.encode(`data: ${data}\n\n`));
      }
      controller.close();
    },
  });
}

function makeCtx(vaultEntries: [string, string][] = []): GuardContext {
  return {
    requestId: "req_1",
    tenantId: "demo",
    model: "mock-echo",
    stream: true,
    messages: [],
    piiVault: new Map(vaultEntries),
    signal: new AbortController().signal,
    metadata: {},
  };
}

async function run(
  upstream: ReadableStream<Uint8Array>,
  deps: StreamProcessorDeps,
): Promise<string[]> {
  const written: string[] = [];
  await processStream(upstream, deps, async (chunk) => {
    written.push(chunk);
  });
  return written;
}

function parseDataLines(written: string[]): unknown[] {
  return written
    .map((w) => w.trim())
    .filter((w) => w.startsWith("data: "))
    .map((w) => w.slice("data: ".length))
    .map((d) => (d === "[DONE]" ? "[DONE]" : JSON.parse(d)));
}

test("no output guards: content passes through, chunk metadata preserved", async () => {
  const upstream = sseStream([
    {
      id: "chatcmpl-1",
      object: "chat.completion.chunk",
      created: 111,
      model: "mock-echo",
      choices: [{ index: 0, delta: { content: "hello" }, finish_reason: null }],
    },
    {
      id: "chatcmpl-1",
      object: "chat.completion.chunk",
      created: 111,
      model: "mock-echo",
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    },
    "[DONE]",
  ]);

  const written = await run(upstream, {
    outputGuards: [],
    guardConfigs: {},
    failureMode: "fail_open",
    ctx: makeCtx(),
  });

  const events = parseDataLines(written);
  expect(events[0]).toMatchObject({
    id: "chatcmpl-1",
    model: "mock-echo",
    choices: [{ delta: { content: "hello" } }],
  });
  expect(events.at(-2)).toMatchObject({ choices: [{ finish_reason: "stop" }] });
  expect(events.at(-1)).toBe("[DONE]");
});

test("a placeholder split across two upstream chunks is restored intact via the output guard", async () => {
  const upstream = sseStream([
    {
      id: "1",
      object: "chat.completion.chunk",
      created: 1,
      model: "m",
      choices: [{ index: 0, delta: { content: "your id is [NIK" }, finish_reason: null }],
    },
    {
      id: "1",
      object: "chat.completion.chunk",
      created: 1,
      model: "m",
      choices: [{ index: 0, delta: { content: "_1] thanks" }, finish_reason: null }],
    },
    {
      id: "1",
      object: "chat.completion.chunk",
      created: 1,
      model: "m",
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    },
    "[DONE]",
  ]);

  const restoringGuard: OutputGuard = {
    name: "pii-id",
    phase: "output",
    holdback: 10,
    async checkText(text, ctx) {
      let out = text;
      for (const [placeholder, value] of ctx.piiVault) out = out.split(placeholder).join(value);
      return { decision: { guard: "pii-id", action: "allow", latencyMs: 0 }, text: out };
    },
  };

  const written = await run(upstream, {
    outputGuards: [restoringGuard],
    guardConfigs: { "pii-id": { mode: "enforce" } },
    failureMode: "fail_open",
    ctx: makeCtx([["[NIK_1]", "3171011506900001"]]),
  });

  const events = parseDataLines(written);
  const content = events
    .filter(
      (e): e is { choices: [{ delta: { content?: string } }] } =>
        typeof e === "object" && e !== null && "choices" in e,
    )
    .map((e) => e.choices[0]?.delta.content ?? "")
    .join("");
  expect(content).toBe("your id is 3171011506900001 thanks");
});

test("tool calls are assembled, run through checkToolCall, and emitted once (not per delta)", async () => {
  const upstream = sseStream([
    {
      id: "1",
      object: "chat.completion.chunk",
      created: 1,
      model: "m",
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: 0,
                id: "call_1",
                type: "function",
                function: { name: "lookup", arguments: "" },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    },
    {
      id: "1",
      object: "chat.completion.chunk",
      created: 1,
      model: "m",
      choices: [
        {
          index: 0,
          delta: { tool_calls: [{ index: 0, function: { arguments: '{"a":1}' } }] },
          finish_reason: null,
        },
      ],
    },
    {
      id: "1",
      object: "chat.completion.chunk",
      created: 1,
      model: "m",
      choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
    },
    "[DONE]",
  ]);

  let seenByGuard: unknown;
  const passthroughGuard: OutputGuard = {
    name: "pii-id",
    phase: "output",
    holdback: 0,
    async checkToolCall(call) {
      seenByGuard = call;
      return { decision: { guard: "pii-id", action: "allow", latencyMs: 0 }, call };
    },
  };

  const written = await run(upstream, {
    outputGuards: [passthroughGuard],
    guardConfigs: { "pii-id": { mode: "enforce" } },
    failureMode: "fail_open",
    ctx: makeCtx(),
  });

  expect(seenByGuard).toMatchObject({
    id: "call_1",
    function: { name: "lookup", arguments: '{"a":1}' },
  });

  const events = parseDataLines(written);
  const toolCallEvents = events.filter(
    (e): e is { choices: [{ delta: { tool_calls?: unknown[] } }] } => {
      if (typeof e !== "object" || e === null || !("choices" in e)) return false;
      const choices = (e as { choices: [{ delta: { tool_calls?: unknown[] } }] }).choices;
      return !!choices[0]?.delta.tool_calls;
    },
  );
  expect(toolCallEvents).toHaveLength(1); // emitted once, assembled — not once per delta fragment
});

test("usage chunks are forwarded unchanged", async () => {
  const usageChunk = {
    id: "1",
    object: "chat.completion.chunk",
    created: 1,
    model: "m",
    choices: [],
    usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
  };
  const upstream = sseStream([usageChunk, "[DONE]"]);

  const written = await run(upstream, {
    outputGuards: [],
    guardConfigs: {},
    failureMode: "fail_open",
    ctx: makeCtx(),
  });

  const events = parseDataLines(written);
  expect(events[0]).toEqual(usageChunk);
});

test("oversized tool call arguments block the stream", async () => {
  const upstream = sseStream([
    {
      id: "1",
      object: "chat.completion.chunk",
      created: 1,
      model: "m",
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              { index: 0, id: "call_1", function: { name: "x", arguments: "a".repeat(300_000) } },
            ],
          },
          finish_reason: null,
        },
      ],
    },
    "[DONE]",
  ]);

  const written = await run(upstream, {
    outputGuards: [],
    guardConfigs: {},
    failureMode: "fail_open",
    ctx: makeCtx(),
  });

  const events = parseDataLines(written);
  expect(events[0]).toMatchObject({ error: { code: "tool_arguments_too_large" } });
  expect(events.at(-1)).toBe("[DONE]");
});

test("a guard that blocks stops the stream with the same error shape as a non-streaming block", async () => {
  const upstream = sseStream([
    {
      id: "1",
      object: "chat.completion.chunk",
      created: 1,
      model: "m",
      choices: [
        { index: 0, delta: { content: "leaking the system prompt now" }, finish_reason: null },
      ],
    },
    "[DONE]",
  ]);

  const blockingGuard: OutputGuard = {
    name: "canary",
    phase: "output",
    holdback: 0,
    async checkText(text) {
      return {
        decision: {
          guard: "canary",
          action: "block",
          reason: "canary_leak_detected",
          latencyMs: 0,
        },
        text,
      };
    },
  };

  const written = await run(upstream, {
    outputGuards: [blockingGuard],
    guardConfigs: { canary: { mode: "enforce" } },
    failureMode: "fail_closed",
    ctx: makeCtx(),
  });

  const events = parseDataLines(written);
  expect(events[0]).toMatchObject({
    error: { code: "canary_leak_detected" },
    palang: { guard: "canary" },
  });
  expect(events.at(-1)).toBe("[DONE]");
});

// Upstream chunks of `size` characters, like a real model stream.
function contentStream(text: string, size = 8): ReadableStream<Uint8Array> {
  const chunk = (delta: Record<string, unknown>, finish: string | null = null) => ({
    id: "1",
    object: "chat.completion.chunk",
    created: 1,
    model: "m",
    choices: [{ index: 0, delta, finish_reason: finish }],
  });
  const events: Array<Record<string, unknown> | "[DONE]"> = [];
  for (let i = 0; i < text.length; i += size)
    events.push(chunk({ content: text.slice(i, i + size) }));
  events.push(chunk({}, "stop"), "[DONE]");
  return sseStream(events);
}

function streamedContent(written: string[]): string {
  return parseDataLines(written)
    .map((e) =>
      typeof e === "object" && e !== null && "choices" in e
        ? ((e as { choices: { delta: { content?: string } }[] }).choices[0]?.delta.content ?? "")
        : "",
    )
    .join("");
}

// Regression: past 256 characters without whitespace the holdback buffer cuts anyway, which used
// to split a token across two checkText calls so neither saw it whole. Every prefix length puts
// the cut at a different spot in the token.
const PREFIX_LENGTHS = Array.from({ length: 321 }, (_, i) => 200 + i);

for (const onDetect of ["block", "flag"] as const) {
  test(`a canary never streams out whole, wherever a forced cut lands (on_detect: ${onDetect})`, async () => {
    for (const prefix of PREFIX_LENGTHS) {
      const ctx = makeCtx();
      ctx.messages = [{ role: "system", content: "sys" }];
      await createCanaryInputGuard().check(ctx);
      const canary = getCanary(ctx)!;

      const written: string[] = [];
      const result = await processStream(
        contentStream(`${"/".repeat(prefix)}${canary} done`),
        {
          outputGuards: [createCanaryOutputGuard({ onDetect })],
          guardConfigs: { canary: { mode: "enforce" } },
          failureMode: "fail_open",
          ctx,
        },
        async (chunk) => {
          written.push(chunk);
        },
      );

      expect({ prefix, leaked: streamedContent(written).includes(canary) }).toEqual({
        prefix,
        leaked: false,
      });
      expect(result.decisions.some((d) => d.reason === "canary_leaked")).toBe(true);
    }
  });
}

test("output PII straddling a forced cut is still found; it blocks when it can't be masked", async () => {
  for (const prefix of PREFIX_LENGTHS) {
    const text = `${"/".repeat(prefix)}budi@example.com${"/".repeat(100)} done`;
    const deps = (maskNewOutputPii: boolean) => ({
      outputGuards: [createPiiIdOutputGuard({ ...DEFAULT_PII_ID_CONFIG, maskNewOutputPii })],
      guardConfigs: { "pii-id": { mode: "enforce" as const } },
      failureMode: "fail_open" as const,
      ctx: makeCtx(),
    });

    const written: string[] = [];
    await processStream(contentStream(text), deps(true), async (chunk) => {
      written.push(chunk);
    });
    expect({ prefix, leaked: streamedContent(written).includes("budi@example.com") }).toEqual({
      prefix,
      leaked: false,
    });

    const flagged = await processStream(contentStream(text), deps(false), async () => {});
    expect({
      prefix,
      found: flagged.decisions.some((d) => d.findings?.some((f) => f.type === "OUTPUT_PII")),
    }).toEqual({ prefix, found: true });
  }
});

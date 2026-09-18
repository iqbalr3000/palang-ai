import { test, expect } from "bun:test";
import type { GuardContext, OutputGuard } from "@palang-ai/core";
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

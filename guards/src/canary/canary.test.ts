import { expect, test } from "bun:test";
import type { ChatMessage, GuardContext, ToolCall } from "../core/index.js";
import {
  createCanaryInputGuard,
  createCanaryOutputGuard,
  generateCanary,
  getCanary,
} from "./index.js";

const CANARY_PATTERN = /^plg-canary-[0-9a-f]{16}$/;

function makeCtx(messages: ChatMessage[]): GuardContext {
  return {
    requestId: "req_1",
    tenantId: "demo",
    model: "gpt-4o-mini",
    stream: false,
    messages,
    piiVault: new Map(),
    signal: new AbortController().signal,
    metadata: {},
  };
}

async function injected(): Promise<{ ctx: GuardContext; canary: string }> {
  const ctx = makeCtx([
    { role: "system", content: "You are a helpful assistant." },
    { role: "user", content: "hi" },
  ]);
  // Mirrors the pipeline runner, which hands each guard a shallow copy of ctx.
  await createCanaryInputGuard().check({ ...ctx });
  return { ctx, canary: getCanary(ctx)! };
}

test("generated canaries have the TSD shape and always contain a letter", () => {
  for (let i = 0; i < 500; i++) {
    const canary = generateCanary();
    expect(canary).toMatch(CANARY_PATTERN);
    expect(canary.slice("plg-canary-".length)).toMatch(/[a-f]/);
  }
});

test("inject appends the canary to the system message and exposes it past a ctx copy", async () => {
  const { ctx, canary } = await injected();
  expect(canary).toMatch(CANARY_PATTERN);
  expect(ctx.messages[0]!.content).toStartWith("You are a helpful assistant.");
  expect(ctx.messages[0]!.content).toContain(canary);
  expect(ctx.messages[1]!.content).toBe("hi");
});

test("no system message: nothing injected, no canary", async () => {
  const ctx = makeCtx([{ role: "user", content: "hi" }]);
  const decision = await createCanaryInputGuard().check(ctx);
  expect(decision.action).toBe("allow");
  expect(getCanary(ctx)).toBeUndefined();
  expect(ctx.messages).toHaveLength(1);
});

test("the inject decision never carries the token", async () => {
  const ctx = makeCtx([{ role: "system", content: "sys" }]);
  const decision = await createCanaryInputGuard().check(ctx);
  expect(JSON.stringify(decision)).not.toContain(getCanary(ctx)!);
});

test("block: a leaked canary in text blocks with canary_leaked, case-insensitively", async () => {
  const { ctx, canary } = await injected();
  const guard = createCanaryOutputGuard({ onDetect: "block" });

  const { decision } = await guard.checkText!(`sure: ${canary.toUpperCase()}`, ctx);

  expect(decision).toMatchObject({ action: "block", reason: "canary_leaked" });
  expect(decision.findings).toEqual([{ type: "CANARY_LEAK" }]);
  expect(JSON.stringify(decision)).not.toContain(canary);
});

test("flag: the token is stripped from text and the response continues", async () => {
  const { ctx, canary } = await injected();
  const guard = createCanaryOutputGuard({ onDetect: "flag" });

  const { decision, text } = await guard.checkText!(`a ${canary} b ${canary}`, ctx);

  expect(decision).toMatchObject({ action: "flag", reason: "canary_leaked" });
  expect(text).toBe("a  b ");
});

test("tool-call arguments are checked too", async () => {
  const { ctx, canary } = await injected();
  const toolCall: ToolCall = {
    id: "call_1",
    type: "function",
    function: {
      name: "fetch_url",
      arguments: JSON.stringify({ url: `https://x.test/?q=${canary}` }),
    },
  };

  const blocked = await createCanaryOutputGuard({ onDetect: "block" }).checkToolCall!(
    toolCall,
    ctx,
  );
  expect(blocked.decision.action).toBe("block");

  const flagged = await createCanaryOutputGuard({ onDetect: "flag" }).checkToolCall!(toolCall, ctx);
  expect(flagged.call.function.arguments).toBe('{"url":"https://x.test/?q="}');
});

test("clean output, or no canary injected, is allowed untouched", async () => {
  const guard = createCanaryOutputGuard({ onDetect: "block" });
  const { ctx } = await injected();
  expect((await guard.checkText!("nothing to see", ctx)).decision.action).toBe("allow");

  const bare = makeCtx([]);
  const result = await guard.checkText!("plg-canary-0123456789abcdef", bare);
  expect(result.decision.action).toBe("allow");
});

test("holdback covers the whole token", () => {
  expect(createCanaryOutputGuard({ onDetect: "block" }).holdback).toBe(generateCanary().length);
});

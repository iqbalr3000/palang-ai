import { test, expect } from "bun:test";
import type { GuardContext, ChatMessage } from "@palang-ai/core";
import { createPiiIdInputGuard } from "./mask.js";
import { DEFAULT_PII_ID_CONFIG } from "./config.js";

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

test("masks a NIK in a user message and records it in the vault", async () => {
  const guard = createPiiIdInputGuard(DEFAULT_PII_ID_CONFIG);
  const ctx = makeCtx([{ role: "user", content: "NIK saya 3171011506900001" }]);

  const decision = await guard.check(ctx);

  expect(ctx.messages[0]!.content).toBe("NIK saya [NIK_1]");
  expect(ctx.piiVault.get("[NIK_1]")).toBe("3171011506900001");
  expect(decision.action).toBe("modify");
  expect(decision.findings).toHaveLength(1);
  expect(decision.findings![0]).toMatchObject({ type: "NIK", messageIndex: 0 });
});

test("no PII found: allow, empty vault", async () => {
  const guard = createPiiIdInputGuard(DEFAULT_PII_ID_CONFIG);
  const ctx = makeCtx([{ role: "user", content: "halo, apa kabar?" }]);

  const decision = await guard.check(ctx);

  expect(ctx.messages[0]!.content).toBe("halo, apa kabar?");
  expect(ctx.piiVault.size).toBe(0);
  expect(decision.action).toBe("allow");
});

test("the same value reuses the same placeholder within a request", async () => {
  const guard = createPiiIdInputGuard(DEFAULT_PII_ID_CONFIG);
  const ctx = makeCtx([
    { role: "user", content: "email saya budi@example.com" },
    { role: "user", content: "sekali lagi: budi@example.com" },
  ]);

  await guard.check(ctx);

  expect(ctx.messages[0]!.content).toBe("email saya [EMAIL_1]");
  expect(ctx.messages[1]!.content).toBe("sekali lagi: [EMAIL_1]");
  expect(ctx.piiVault.size).toBe(1);
});

test("different values of the same type get incrementing placeholder numbers", async () => {
  const guard = createPiiIdInputGuard(DEFAULT_PII_ID_CONFIG);
  const ctx = makeCtx([{ role: "user", content: "email budi@example.com dan siti@example.com" }]);

  await guard.check(ctx);

  expect(ctx.messages[0]!.content).toBe("email [EMAIL_1] dan [EMAIL_2]");
});

test("only scans configured roles — system excluded by default", async () => {
  const guard = createPiiIdInputGuard(DEFAULT_PII_ID_CONFIG);
  const ctx = makeCtx([
    { role: "system", content: "contact: budi@example.com" },
    { role: "user", content: "contact: siti@example.com" },
  ]);

  await guard.check(ctx);

  expect(ctx.messages[0]!.content).toBe("contact: budi@example.com"); // system untouched
  expect(ctx.messages[1]!.content).toBe("contact: [EMAIL_1]");
});

test("masks tool call arguments in assistant history", async () => {
  const guard = createPiiIdInputGuard(DEFAULT_PII_ID_CONFIG);
  const ctx = makeCtx([
    {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "call_1",
          type: "function",
          function: { name: "lookup", arguments: '{"email":"budi@example.com"}' },
        },
      ],
    },
  ]);

  await guard.check(ctx);

  expect(ctx.messages[0]!.tool_calls![0]!.function.arguments).toBe('{"email":"[EMAIL_1]"}');
});

test("only configured entity types are masked", async () => {
  const guard = createPiiIdInputGuard({ ...DEFAULT_PII_ID_CONFIG, entities: ["NIK"] });
  const ctx = makeCtx([{ role: "user", content: "NIK 3171011506900001, email budi@example.com" }]);

  await guard.check(ctx);

  expect(ctx.messages[0]!.content).toBe("NIK [NIK_1], email budi@example.com");
});

test("preserve_hint appends a line to an existing system message", async () => {
  const guard = createPiiIdInputGuard({ ...DEFAULT_PII_ID_CONFIG, preserveHint: true });
  const ctx = makeCtx([
    { role: "system", content: "You are a helpful assistant." },
    { role: "user", content: "email saya budi@example.com" },
  ]);

  await guard.check(ctx);

  expect(ctx.messages[0]!.content).toStartWith("You are a helpful assistant.");
  expect(ctx.messages[0]!.content).toContain("placeholder");
});

test("preserve_hint creates a system message when none exists", async () => {
  const guard = createPiiIdInputGuard({ ...DEFAULT_PII_ID_CONFIG, preserveHint: true });
  const ctx = makeCtx([{ role: "user", content: "email saya budi@example.com" }]);

  await guard.check(ctx);

  expect(ctx.messages[0]!.role).toBe("system");
  expect(ctx.messages[0]!.content).toContain("placeholder");
  expect(ctx.messages[1]!.role).toBe("user");
});

test("preserve_hint does nothing when no PII was actually found", async () => {
  const guard = createPiiIdInputGuard({ ...DEFAULT_PII_ID_CONFIG, preserveHint: true });
  const ctx = makeCtx([{ role: "user", content: "halo" }]);

  await guard.check(ctx);

  expect(ctx.messages).toHaveLength(1); // no system message was injected
});

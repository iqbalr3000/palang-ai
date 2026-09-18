import { test, expect } from "bun:test";
import type { GuardContext, ToolCall } from "@palang-ai/core";
import { createPiiIdOutputGuard } from "./restore.js";
import { DEFAULT_PII_ID_CONFIG } from "./config.js";

function makeCtx(vaultEntries: [string, string][] = []): GuardContext {
  return {
    requestId: "req_1",
    tenantId: "demo",
    model: "gpt-4o-mini",
    stream: false,
    messages: [],
    piiVault: new Map(vaultEntries),
    signal: new AbortController().signal,
    metadata: {},
  };
}

test("restores a known placeholder", async () => {
  const guard = createPiiIdOutputGuard(DEFAULT_PII_ID_CONFIG);
  const ctx = makeCtx([["[NIK_1]", "3171011506900001"]]);

  const { text, decision } = await guard.checkText!("your NIK is [NIK_1], noted", ctx);

  expect(text).toBe("your NIK is 3171011506900001, noted");
  expect(decision.action).toBe("allow");
});

test("restores multiple placeholders", async () => {
  const guard = createPiiIdOutputGuard(DEFAULT_PII_ID_CONFIG);
  const ctx = makeCtx([
    ["[EMAIL_1]", "budi@example.com"],
    ["[EMAIL_2]", "siti@example.com"],
  ]);

  const { text } = await guard.checkText!("cc [EMAIL_1] and [EMAIL_2]", ctx);

  expect(text).toBe("cc budi@example.com and siti@example.com");
});

test("unknown placeholder is left as-is and flagged", async () => {
  const guard = createPiiIdOutputGuard(DEFAULT_PII_ID_CONFIG);
  const ctx = makeCtx(); // empty vault

  const { text, decision } = await guard.checkText!("value: [NIK_1]", ctx);

  expect(text).toBe("value: [NIK_1]");
  expect(decision.findings).toContainEqual(
    expect.objectContaining({ type: "UNKNOWN_PLACEHOLDER" }),
  );
});

test("new PII in output not present in input is flagged OUTPUT_PII, left unmasked by default", async () => {
  const guard = createPiiIdOutputGuard(DEFAULT_PII_ID_CONFIG);
  const ctx = makeCtx(); // model produced this PII itself, nothing was masked from input

  const { text, decision } = await guard.checkText!("call me at 081234567890", ctx);

  expect(text).toBe("call me at 081234567890"); // unmasked — mask_new_output_pii defaults false
  expect(decision.findings).toContainEqual(expect.objectContaining({ type: "OUTPUT_PII" }));
});

test("new PII in output IS masked when mask_new_output_pii is enabled", async () => {
  const guard = createPiiIdOutputGuard({ ...DEFAULT_PII_ID_CONFIG, maskNewOutputPii: true });
  const ctx = makeCtx();

  const { text } = await guard.checkText!("call me at 081234567890", ctx);

  expect(text).toBe("call me at [PHONE_ID_1]");
  expect(ctx.piiVault.get("[PHONE_ID_1]")).toBe("+6281234567890");
});

test("a restored value is not also flagged as new output PII", async () => {
  const guard = createPiiIdOutputGuard(DEFAULT_PII_ID_CONFIG);
  const ctx = makeCtx([["[PHONE_ID_1]", "+6281234567890"]]);

  const { decision } = await guard.checkText!("call [PHONE_ID_1]", ctx);

  expect(decision.findings ?? []).toHaveLength(0);
});

test("no placeholders and no new PII: allow, no findings", async () => {
  const guard = createPiiIdOutputGuard(DEFAULT_PII_ID_CONFIG);
  const ctx = makeCtx();

  const { text, decision } = await guard.checkText!("just a normal reply", ctx);

  expect(text).toBe("just a normal reply");
  expect(decision.action).toBe("allow");
  expect(decision.findings ?? []).toHaveLength(0);
});

test("checkToolCall restores placeholders in tool call arguments", async () => {
  const guard = createPiiIdOutputGuard(DEFAULT_PII_ID_CONFIG);
  const ctx = makeCtx([["[EMAIL_1]", "budi@example.com"]]);
  const toolCall: ToolCall = {
    id: "call_1",
    type: "function",
    function: { name: "send_email", arguments: '{"to":"[EMAIL_1]"}' },
  };

  const { call } = await guard.checkToolCall!(toolCall, ctx);

  expect(call.function.arguments).toBe('{"to":"budi@example.com"}');
});

test("restored placeholders are tracked on ctx.metadata for restore_miss reporting", async () => {
  const guard = createPiiIdOutputGuard(DEFAULT_PII_ID_CONFIG);
  const ctx = makeCtx([
    ["[NIK_1]", "3171011506900001"],
    ["[EMAIL_1]", "budi@example.com"], // never appears in output
  ]);

  await guard.checkText!("your id is [NIK_1]", ctx);

  const restored = ctx.metadata["piiRestoredPlaceholders"] as Set<string>;
  expect(restored.has("[NIK_1]")).toBe(true);
  expect(restored.has("[EMAIL_1]")).toBe(false);
});

test("holdback is a fixed cap, long enough for any real placeholder", () => {
  const guard = createPiiIdOutputGuard(DEFAULT_PII_ID_CONFIG);
  expect(guard.holdback).toBe(32);
  expect("[PHONE_ID_999]".length).toBeLessThanOrEqual(guard.holdback!);
});

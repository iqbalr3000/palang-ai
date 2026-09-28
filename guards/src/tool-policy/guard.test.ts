import { expect, test } from "bun:test";
import type { GuardContext, ToolCall } from "../core/index.js";
import type { ToolPolicyConfig } from "./config.js";
import { createToolPolicyOutputGuard } from "./guard.js";

const ctx: GuardContext = {
  requestId: "req_1",
  tenantId: "demo",
  model: "gpt-4o-mini",
  stream: false,
  messages: [],
  piiVault: new Map(),
  signal: new AbortController().signal,
  metadata: {},
};

function call(name: string, args: unknown): ToolCall {
  return {
    id: "call_1",
    type: "function",
    function: { name, arguments: typeof args === "string" ? args : JSON.stringify(args) },
  };
}

async function decide(config: ToolPolicyConfig, toolCall: ToolCall) {
  const guard = createToolPolicyOutputGuard(config);
  return (await guard.checkToolCall!(toolCall, ctx)).decision;
}

const TRANSFER: ToolPolicyConfig = {
  default: "deny",
  rules: [
    { tool: "search_*", action: "allow" },
    { tool: "delete_*", action: "deny", reason: "destructive_tool" },
    {
      tool: "transfer_funds",
      action: "allow",
      constraints: [
        { path: "amount", op: "lte", value: 1_000_000 },
        { path: "currency", op: "in", value: ["IDR"] },
      ],
    },
    { tool: "*", action: "allow" },
  ],
};

test("a glob allow rule allows, and the call passes through unchanged", async () => {
  const guard = createToolPolicyOutputGuard(TRANSFER);
  const input = call("search_web", { q: "cuaca" });
  const result = await guard.checkToolCall!(input, ctx);
  expect(result.decision.action).toBe("allow");
  expect(result.call).toBe(input);
});

test("a deny rule blocks with the rule's own reason", async () => {
  const decision = await decide(TRANSFER, call("delete_user", { id: 1 }));
  expect(decision).toMatchObject({ action: "block", reason: "destructive_tool" });
});

test("no matching rule falls back to default, with tool_call_denied", async () => {
  const decision = await decide({ default: "deny", rules: [] }, call("anything", {}));
  expect(decision).toMatchObject({ action: "block", reason: "tool_call_denied" });

  expect((await decide({ default: "allow", rules: [] }, call("anything", {}))).action).toBe(
    "allow",
  );
});

test("first matching rule wins", async () => {
  const config: ToolPolicyConfig = {
    default: "allow",
    rules: [
      { tool: "delete_*", action: "deny" },
      { tool: "delete_draft", action: "allow" },
    ],
  };
  expect((await decide(config, call("delete_draft", {}))).action).toBe("block");
});

test("constraints within limits allow", async () => {
  const decision = await decide(TRANSFER, call("transfer_funds", { amount: 500, currency: "IDR" }));
  expect(decision.action).toBe("allow");
});

test("a failed constraint blocks — no fall-through to the later catch-all allow", async () => {
  const decision = await decide(
    TRANSFER,
    call("transfer_funds", { amount: 2_000_000, currency: "IDR" }),
  );
  expect(decision).toMatchObject({ action: "block", reason: "tool_constraint_violated" });
});

test("a missing path fails the constraint", async () => {
  const decision = await decide(TRANSFER, call("transfer_funds", { amount: 500 }));
  expect(decision.reason).toBe("tool_constraint_violated");
});

test("types are strict: a numeric string doesn't satisfy a numeric comparison", async () => {
  const decision = await decide(
    TRANSFER,
    call("transfer_funds", { amount: "500", currency: "IDR" }),
  );
  expect(decision.reason).toBe("tool_constraint_violated");
});

test("unparseable arguments block with invalid_tool_arguments, even for allowed tools", async () => {
  const decision = await decide(TRANSFER, call("search_web", '{"q": "unterminated'));
  expect(decision).toMatchObject({ action: "block", reason: "invalid_tool_arguments" });
});

test("every operator, and nested/array paths", async () => {
  const args = {
    user: { id: 7, role: "viewer", tags: ["a", "b"] },
    items: [{ sku: "ABC-123" }],
    flag: true,
  };
  const cases: [ToolPolicyConfig["rules"][number]["constraints"], boolean][] = [
    [[{ path: "user.id", op: "eq", value: 7 }], true],
    [[{ path: "user.id", op: "eq", value: "7" }], false],
    [[{ path: "user.role", op: "neq", value: "admin" }], true],
    [[{ path: "user.id", op: "lt", value: 7 }], false],
    [[{ path: "user.id", op: "gte", value: 7 }], true],
    [[{ path: "user.id", op: "gt", value: 6 }], true],
    [[{ path: "user.role", op: "not_in", value: ["admin", "owner"] }], true],
    [[{ path: "items.0.sku", op: "regex", value: "^[A-Z]+-\\d+$" }], true],
    [[{ path: "items.1.sku", op: "regex", value: ".*" }], false],
    [[{ path: "user.tags.1", op: "eq", value: "b" }], true],
    [[{ path: "user", op: "eq", value: "x" }], false],
    [[{ path: "flag", op: "eq", value: true }], true],
  ];
  for (const [constraints, allowed] of cases) {
    const config: ToolPolicyConfig = {
      default: "deny",
      rules: [{ tool: "t", action: "allow", constraints }],
    };
    const decision = await decide(config, call("t", args));
    expect({ constraints, action: decision.action }).toEqual({
      constraints,
      action: allowed ? "allow" : "block",
    });
  }
});

test("findings name the tool and the failed constraint, never argument values", async () => {
  const decision = await decide(
    TRANSFER,
    call("transfer_funds", { amount: 2_000_000, currency: "IDR", note: "NIK 3171011506900001" }),
  );
  expect(decision.findings).toEqual([
    {
      type: "TOOL_POLICY",
      meta: { tool: "transfer_funds", rule: 2, constraint: 0, path: "amount", op: "lte" },
    },
  ]);
  expect(JSON.stringify(decision)).not.toContain("2000000");
  expect(JSON.stringify(decision)).not.toContain("3171011506900001");
});

test("an invalid regex is rejected when the guard is created", () => {
  expect(() =>
    createToolPolicyOutputGuard({
      default: "deny",
      rules: [
        { tool: "t", action: "allow", constraints: [{ path: "a", op: "regex", value: "(" }] },
      ],
    }),
  ).toThrow();
});

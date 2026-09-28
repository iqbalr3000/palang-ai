import { test, expect } from "bun:test";
import { configSchema } from "./schema.js";

function configWithInjection(injection: unknown): unknown {
  return configWithGuards({ injection });
}

function configWithGuards(guards: unknown): unknown {
  return {
    server: { public_port: 8080, admin_port: 8081 },
    audit: {},
    models: { path: "./models" },
    tenants: [
      {
        id: "demo",
        failure_mode: "fail_closed",
        upstream: {
          type: "openai-compatible",
          base_url: "http://localhost:1/v1",
          api_key: "unused",
        },
        allowed_models: ["mock-echo"],
        guards,
      },
    ],
  };
}

test("injection: an empty block gets monitor mode, TSD thresholds, and L2 off", () => {
  const config = configSchema.parse(configWithInjection({}));

  expect(config.tenants[0]?.guards.injection).toEqual({
    mode: "monitor",
    roles: ["user", "tool"],
    flag_threshold: 0.5,
    block_threshold: 0.85,
    classifier: { enabled: false, model: "protectai/deberta-v3-base-prompt-injection-v2" },
  });
});

test("injection: timeout_ms is optional and has no default", () => {
  const withTimeout = configSchema.parse(configWithInjection({ timeout_ms: 2000 }));
  expect(withTimeout.tenants[0]?.guards.injection?.timeout_ms).toBe(2000);

  const without = configSchema.parse(configWithInjection({}));
  expect(without.tenants[0]?.guards.injection?.timeout_ms).toBeUndefined();
});

test("injection: judge.enabled: false is accepted", () => {
  const result = configSchema.safeParse(
    configWithInjection({ judge: { enabled: false, model: "gpt-4o-mini" } }),
  );
  expect(result.success).toBe(true);
});

test("injection: judge.enabled: true is rejected, not silently ignored", () => {
  const result = configSchema.safeParse(configWithInjection({ judge: { enabled: true } }));

  expect(result.success).toBe(false);
  const issue = result.error?.issues[0];
  expect(issue?.path.join(".")).toBe("tenants.0.guards.injection.judge.enabled");
  expect(issue?.message).toMatch(/not implemented/);
});

function toolPolicy(constraints: unknown[]): unknown {
  return configWithGuards({
    "tool-policy": {
      mode: "enforce",
      default: "deny",
      rules: [{ tool: "transfer_funds", action: "allow", constraints }],
    },
  });
}

test("tool-policy: well-typed constraints for every op parse", () => {
  const result = configSchema.safeParse(
    toolPolicy([
      { path: "amount", op: "lte", value: 1000000 },
      { path: "currency", op: "in", value: ["IDR"] },
      { path: "note", op: "regex", value: "^[a-z ]*$" },
      { path: "urgent", op: "eq", value: false },
    ]),
  );
  expect(result.success).toBe(true);
});

test("tool-policy: an invalid regex fails at config load", () => {
  const result = configSchema.safeParse(toolPolicy([{ path: "note", op: "regex", value: "(" }]));
  expect(result.success).toBe(false);
});

test("tool-policy: a value of the wrong type for its op fails at config load", () => {
  expect(
    configSchema.safeParse(toolPolicy([{ path: "amount", op: "lte", value: "1000" }])).success,
  ).toBe(false);
  expect(
    configSchema.safeParse(toolPolicy([{ path: "currency", op: "in", value: "IDR" }])).success,
  ).toBe(false);
});

test("server: the admin API binds to loopback unless configured otherwise", () => {
  const config = configSchema.parse(configWithGuards({}));
  expect(config.server).toMatchObject({ public_host: "0.0.0.0", admin_host: "127.0.0.1" });
});

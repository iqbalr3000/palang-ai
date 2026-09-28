import { test, expect } from "bun:test";
import { configSchema } from "./schema.js";

function configWithInjection(injection: unknown): unknown {
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
        guards: { injection },
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

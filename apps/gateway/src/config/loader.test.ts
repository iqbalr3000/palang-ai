import { test, expect } from "bun:test";
import { loadConfig, ConfigError } from "./loader.js";

const FIXTURES = new URL("./__fixtures__/", import.meta.url);

test("loads and validates the real palang.example.yaml, interpolating env vars", async () => {
  process.env.UPSTREAM_BASE_URL = "https://api.openai.com/v1";
  process.env.UPSTREAM_API_KEY = "sk-test-123";

  const config = await loadConfig(
    new URL("../../../../palang.example.yaml", import.meta.url).pathname,
  );

  expect(config.server).toEqual({ public_port: 8080, admin_port: 8081 });
  expect(config.tenants[0]?.upstream.base_url).toBe("https://api.openai.com/v1");
  expect(config.tenants[0]?.guards["pii-id"]?.entities).toEqual([
    "NIK",
    "NPWP",
    "PHONE_ID",
    "EMAIL",
    "CARD",
  ]);

  delete process.env.UPSTREAM_BASE_URL;
  delete process.env.UPSTREAM_API_KEY;
});

test("applies schema defaults (roles, preserve_hint, retention_days)", async () => {
  process.env.TEST_UPSTREAM_BASE_URL = "https://api.openai.com/v1";
  const config = await loadConfig(new URL("env-var.yaml", FIXTURES).pathname);
  delete process.env.TEST_UPSTREAM_BASE_URL;

  expect(config.audit.retention_days).toBe(30);
});

test("missing config file throws ConfigError", async () => {
  await expect(loadConfig("/nonexistent/palang.yaml")).rejects.toThrow(ConfigError);
});

test("invalid YAML syntax throws ConfigError", async () => {
  await expect(loadConfig(new URL("invalid-yaml.yaml", FIXTURES).pathname)).rejects.toThrow(
    ConfigError,
  );
});

test("schema violation throws ConfigError listing the issue", async () => {
  const promise = loadConfig(new URL("missing-field.yaml", FIXTURES).pathname);
  await expect(promise).rejects.toThrow(ConfigError);
  await expect(promise).rejects.toThrow(/server/);
});

test("unset referenced env var throws ConfigError naming the variable", async () => {
  delete process.env.TEST_UPSTREAM_BASE_URL;
  const promise = loadConfig(new URL("env-var.yaml", FIXTURES).pathname);
  await expect(promise).rejects.toThrow(ConfigError);
  await expect(promise).rejects.toThrow(/TEST_UPSTREAM_BASE_URL/);
});

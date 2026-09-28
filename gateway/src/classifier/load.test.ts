import { expect, test } from "bun:test";
import { configSchema, type PalangConfig } from "../config/schema.js";
import { loadClassifiers } from "./load.js";

function config(classifier: { enabled: boolean } | undefined): PalangConfig {
  return configSchema.parse({
    server: { public_port: 8080, admin_port: 8081 },
    audit: {},
    models: { path: "/nonexistent/models" },
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
        guards: { injection: classifier ? { classifier } : {} },
      },
    ],
  });
}

test("loads nothing when no tenant enables the classifier", async () => {
  expect((await loadClassifiers(config(undefined))).size).toBe(0);
  expect((await loadClassifiers(config({ enabled: false }))).size).toBe(0);
});

test("rejects with a download-model hint when an enabled model isn't on disk", async () => {
  await expect(loadClassifiers(config({ enabled: true }))).rejects.toThrow(/download-model/);
});

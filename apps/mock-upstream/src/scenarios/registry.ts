import type { Scenario } from "./types.js";
import { mockEcho } from "./mock-echo.js";

// TSD §12: "Scenario selected by model name." Only `mock-echo` is in scope for `gateway-core` —
// mock-split-placeholder/mock-tool-call/mock-leak-canary/mock-slow are added by the features that
// actually need them (pii-guard, tool-policy).
const scenarios: Record<string, Scenario> = {
  "mock-echo": mockEcho,
};

export function resolveScenario(model: string): Scenario | undefined {
  return scenarios[model];
}

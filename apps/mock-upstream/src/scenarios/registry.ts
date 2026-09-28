import type { Scenario } from "./types.js";
import { mockEcho } from "./mock-echo.js";
import { mockLeakCanary } from "./mock-leak-canary.js";
import { mockSplitPlaceholder } from "./mock-split-placeholder.js";
import { mockToolCall } from "./mock-tool-call.js";

const scenarios: Record<string, Scenario> = {
  "mock-echo": mockEcho,
  "mock-split-placeholder": mockSplitPlaceholder,
  "mock-tool-call": mockToolCall,
  "mock-leak-canary": mockLeakCanary,
};

export function resolveScenario(model: string): Scenario | undefined {
  return scenarios[model];
}

import type { Scenario } from "./types.js";
import { mockEcho } from "./mock-echo.js";
import { mockSplitPlaceholder } from "./mock-split-placeholder.js";

const scenarios: Record<string, Scenario> = {
  "mock-echo": mockEcho,
  "mock-split-placeholder": mockSplitPlaceholder,
};

export function resolveScenario(model: string): Scenario | undefined {
  return scenarios[model];
}

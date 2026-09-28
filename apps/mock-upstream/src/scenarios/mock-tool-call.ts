import { lastUserContent } from "./mock-echo.js";
import type { Scenario } from "./types.js";

// Scripted by the last user message: `{"name": ..., "arguments": {...} | "raw string"}`. A string
// is sent verbatim, so tests can exercise malformed arguments.
export const mockToolCall: Scenario = {
  reply(messages) {
    const script: unknown = JSON.parse(lastUserContent(messages));
    if (typeof script !== "object" || script === null || !("name" in script)) {
      throw new Error('mock-tool-call expects {"name", "arguments"} as the last user message');
    }
    const { name, arguments: args } = script as { name: unknown; arguments?: unknown };
    if (typeof name !== "string") throw new Error("mock-tool-call: name must be a string");
    return {
      toolCall: { name, arguments: typeof args === "string" ? args : JSON.stringify(args ?? {}) },
    };
  },
  chunkSize: 4,
};

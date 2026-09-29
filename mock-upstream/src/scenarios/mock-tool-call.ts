import { z } from "zod";
import { lastUserContent } from "./mock-echo.js";
import type { Scenario } from "./types.js";

const scriptSchema = z.object({ name: z.string(), arguments: z.unknown() });

// String arguments are sent verbatim, so tests can exercise malformed JSON.
export const mockToolCall: Scenario = {
  reply(messages) {
    const parsed = scriptSchema.safeParse(JSON.parse(lastUserContent(messages)));
    if (!parsed.success) {
      throw new Error('mock-tool-call expects {"name", "arguments"} as the last user message');
    }
    const { name, arguments: args } = parsed.data;
    return {
      toolCall: { name, arguments: typeof args === "string" ? args : JSON.stringify(args ?? {}) },
    };
  },
  chunkSize: 4,
};

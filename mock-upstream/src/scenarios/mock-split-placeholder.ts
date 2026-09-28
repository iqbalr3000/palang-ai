import { mockEcho } from "./mock-echo.js";
import type { Scenario } from "./types.js";

// One character per chunk guarantees any [TYPE_N]-shaped placeholder in the reply gets split.
export const mockSplitPlaceholder: Scenario = {
  reply: mockEcho.reply,
  chunkSize: 1,
};

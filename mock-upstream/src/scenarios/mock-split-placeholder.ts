import { mockEcho } from "./mock-echo.js";
import type { Scenario } from "./types.js";

export const mockSplitPlaceholder: Scenario = {
  reply: mockEcho.reply,
  chunkSize: 1,
};

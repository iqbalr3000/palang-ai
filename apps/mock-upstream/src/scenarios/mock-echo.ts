import type { Scenario } from "./types.js";

// TSD §12: "mock-echo returns the last user message (proves masking/restore round-trip)."
export const mockEcho: Scenario = {
  reply(messages) {
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    return lastUser?.content ?? "";
  },
};

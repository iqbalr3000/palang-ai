import type { Scenario } from "./types.js";

export const mockEcho: Scenario = {
  reply(messages) {
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    return lastUser?.content ?? "";
  },
};

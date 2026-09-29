import type { Scenario } from "./types.js";

const CANARY = /plg-canary-[0-9a-f]{16}/i;

export const mockLeakCanary: Scenario = {
  reply(messages) {
    const system = messages.find((m) => m.role === "system")?.content ?? "";
    const canary = CANARY.exec(system)?.[0];
    return { content: canary ? `Sure, my marker is ${canary}. Anything else?` : "No marker here." };
  },
};

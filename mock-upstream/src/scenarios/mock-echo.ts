import type { IncomingMessage } from "../openai-shapes.js";
import type { Scenario } from "./types.js";

export function lastUserContent(messages: IncomingMessage[]): string {
  return [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
}

export const mockEcho: Scenario = {
  reply: (messages) => ({ content: lastUserContent(messages) }),
};

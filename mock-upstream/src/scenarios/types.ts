import type { IncomingMessage } from "../openai-shapes.js";

export type ScenarioReply = { content: string } | { toolCall: { name: string; arguments: string } };

export interface Scenario {
  /** Given the incoming messages, returns the assistant's reply: text or a single tool call. */
  reply(messages: IncomingMessage[]): ScenarioReply;
  /** SSE streaming chunk size, in characters. Defaults to 8 (app.ts) when omitted. */
  chunkSize?: number;
}

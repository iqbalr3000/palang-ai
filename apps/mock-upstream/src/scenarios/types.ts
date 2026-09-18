import type { IncomingMessage } from "../openai-shapes.js";

export interface Scenario {
  /** Given the incoming messages, returns the assistant's reply content. */
  reply(messages: IncomingMessage[]): string;
  /** SSE streaming chunk size, in characters. Defaults to 8 (app.ts) when omitted. */
  chunkSize?: number;
}

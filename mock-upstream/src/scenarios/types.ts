import type { IncomingMessage } from "../openai-shapes.js";

export type ScenarioReply = { content: string } | { toolCall: { name: string; arguments: string } };

export interface Scenario {
  reply(messages: IncomingMessage[]): ScenarioReply;
  chunkSize?: number;
}

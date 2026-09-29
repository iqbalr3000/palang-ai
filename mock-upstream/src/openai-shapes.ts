import { z } from "zod";

const incomingMessageSchema = z
  .object({ role: z.string(), content: z.string().nullable() })
  .passthrough();

export const incomingRequestSchema = z.object({
  model: z.string(),
  messages: z.array(incomingMessageSchema).min(1),
  stream: z.boolean().optional(),
  stream_options: z.object({ include_usage: z.boolean().optional() }).optional(),
});

export type IncomingMessage = z.infer<typeof incomingMessageSchema>;

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function buildCompletionId(): string {
  return `chatcmpl-mock-${crypto.randomUUID()}`;
}

export interface MockToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export function buildCompletion(
  id: string,
  model: string,
  promptTokens: number,
  reply: { content: string } | { toolCall: MockToolCall },
) {
  const isToolCall = "toolCall" in reply;
  const completionTokens = estimateTokens(
    isToolCall ? reply.toolCall.function.arguments : reply.content,
  );
  return {
    id,
    object: "chat.completion" as const,
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: isToolCall
          ? { role: "assistant" as const, content: null, tool_calls: [reply.toolCall] }
          : { role: "assistant" as const, content: reply.content },
        finish_reason: isToolCall ? ("tool_calls" as const) : ("stop" as const),
      },
    ],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
  };
}

export function buildChunk(
  id: string,
  model: string,
  delta: {
    role?: "assistant";
    content?: string;
    tool_calls?: {
      index: number;
      id?: string;
      type?: "function";
      function: { name?: string; arguments: string };
    }[];
  },
  finishReason: "stop" | "tool_calls" | null,
) {
  return {
    id,
    object: "chat.completion.chunk" as const,
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
}

export function estimatePromptTokens(messages: IncomingMessage[]): number {
  return estimateTokens(messages.map((m) => m.content ?? "").join(" "));
}

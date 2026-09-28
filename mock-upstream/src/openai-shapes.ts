// Minimal OpenAI-compatible chat completion shapes — just enough for the official `openai` SDK
// and Palang's own gateway to parse. Not a full re-implementation of OpenAI's schema.

export interface IncomingMessage {
  role: string;
  content: string | null;
}

export interface IncomingRequest {
  model: string;
  messages: IncomingMessage[];
  stream?: boolean;
  stream_options?: { include_usage?: boolean };
}

// Rough token estimate — this is a mock server, not a real tokenizer.
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

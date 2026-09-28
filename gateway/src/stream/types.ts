import type { ToolCallDelta } from "./tool-call-assembler.js";

export interface StreamChunkDelta {
  role?: "assistant";
  content?: string;
  tool_calls?: ToolCallDelta[];
}

export interface StreamChunkChoice {
  index: number;
  delta: StreamChunkDelta;
  finish_reason: string | null;
}

export interface StreamChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices?: StreamChunkChoice[];
  usage?: unknown;
}

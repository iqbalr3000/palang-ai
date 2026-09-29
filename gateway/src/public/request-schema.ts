import { z } from "zod";

const toolCallSchema = z
  .object({
    id: z.string(),
    type: z.literal("function"),
    function: z.object({ name: z.string(), arguments: z.string() }).passthrough(),
  })
  .passthrough();

const messageSchema = z
  .object({
    role: z.enum(["system", "user", "assistant", "tool"]),
    content: z.union([z.string(), z.null()]),
    name: z.string().optional(),
    tool_call_id: z.string().optional(),
    tool_calls: z.array(toolCallSchema).optional(),
  })
  .passthrough();

export const chatCompletionRequestSchema = z
  .object({
    model: z.string(),
    stream: z.boolean().optional(),
    messages: z.array(messageSchema).min(1),
  })
  .passthrough();

export type ChatCompletionRequest = z.infer<typeof chatCompletionRequestSchema>;

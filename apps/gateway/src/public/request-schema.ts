import { z } from "zod";

// Just enough of the OpenAI chat-completions request to route it (model for the allowlist check,
// messages for the guard context, stream for response mode). `.passthrough()` at every level
// keeps every other field intact for the upstream call (TSD §7.1: "unknown request fields are
// forwarded unchanged").
const messageSchema = z
  .object({
    role: z.enum(["system", "user", "assistant", "tool"]),
    content: z.union([z.string(), z.null()]),
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

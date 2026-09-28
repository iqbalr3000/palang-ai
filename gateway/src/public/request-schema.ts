import { z } from "zod";

// .passthrough() at every level keeps unrecognized fields intact for the upstream call.
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

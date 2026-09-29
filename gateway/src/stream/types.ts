import { z } from "zod";

const toolCallDeltaSchema = z
  .object({
    index: z.number().int().nonnegative(),
    id: z.string().optional(),
    type: z.literal("function").optional(),
    function: z
      .object({ name: z.string().optional(), arguments: z.string().optional() })
      .passthrough()
      .optional(),
  })
  .passthrough();

const deltaSchema = z
  .object({
    content: z.string().nullish(),
    refusal: z.string().nullish(),
    tool_calls: z.array(toolCallDeltaSchema).nullish(),
  })
  .passthrough();

export const streamChunkSchema = z
  .object({
    id: z.string().default(""),
    model: z.string().default(""),
    created: z.number().default(0),
    choices: z
      .array(
        z
          .object({
            index: z.number().int().nonnegative(),
            delta: deltaSchema.default({}),
            finish_reason: z.string().nullish(),
          })
          .passthrough(),
      )
      .default([]),
    usage: z.unknown().optional(),
  })
  .passthrough();

export type StreamChunk = z.infer<typeof streamChunkSchema>;
export type StreamDelta = z.infer<typeof deltaSchema>;

const toolCallSchema = z
  .object({
    id: z.string(),
    type: z.literal("function"),
    function: z.object({ name: z.string(), arguments: z.string() }).passthrough(),
  })
  .passthrough();

export const completionSchema = z
  .object({
    choices: z
      .array(
        z
          .object({
            message: z
              .object({
                content: z.string().nullish(),
                refusal: z.string().nullish(),
                tool_calls: z.array(toolCallSchema).nullish(),
              })
              .passthrough()
              .optional(),
          })
          .passthrough(),
      )
      .default([]),
    usage: z.unknown().optional(),
  })
  .passthrough();

export type Completion = z.infer<typeof completionSchema>;
export type CompletionChoice = Completion["choices"][number];

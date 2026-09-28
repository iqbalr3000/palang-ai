import { expect, test } from "bun:test";
import { chatCompletionRequestSchema } from "./request-schema.js";

const request = (messages: unknown[]) => ({ model: "gpt-4o-mini", messages });

test("well-formed tool calls and extra fields pass through untouched", () => {
  const body = request([
    {
      role: "assistant",
      content: null,
      tool_calls: [{ id: "c1", type: "function", function: { name: "f", arguments: "{}" } }],
      refusal: null,
    },
    { role: "tool", tool_call_id: "c1", content: "ok" },
  ]);
  const parsed: unknown = chatCompletionRequestSchema.parse(body);
  expect(parsed).toEqual(body);
});

// Regression: these made the pii-id guard throw halfway through masking.
test("malformed tool calls are rejected before any guard sees them", () => {
  for (const tool_calls of [
    [{}],
    [
      {
        id: "c1",
        type: "function",
        function: { name: "f", arguments: { nik: "3171011506900001" } },
      },
    ],
    "not-an-array",
  ]) {
    const result = chatCompletionRequestSchema.safeParse(
      request([{ role: "assistant", content: null, tool_calls }]),
    );
    expect(result.success).toBe(false);
  }
});

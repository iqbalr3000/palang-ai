import { expect, test } from "bun:test";
import type { ChatMessage } from "@palang-ai/core";
import { ResponseCapture, redactForStorage, storedContent } from "./content.js";

const CANARY = "plg-canary-0123456789abcdef";

test("redaction masks raw PII as [TYPE], keeps placeholders, and hides the canary", () => {
  const text = `NIK 3171011506900001, email [EMAIL_1], call 081234567890. ${CANARY.toUpperCase()}`;
  expect(redactForStorage(text, CANARY)).toBe(
    "NIK [NIK], email [EMAIL_1], call [PHONE_ID]. [CANARY]",
  );
});

const messages: ChatMessage[] = [
  { role: "system", content: `Be nice. Marker: ${CANARY}` },
  { role: "user", content: "my email is budi@example.com" }, // a tenant without pii-id: still raw
  {
    role: "assistant",
    content: null,
    tool_calls: [
      {
        id: "c1",
        type: "function",
        function: { name: "lookup", arguments: '{"nik":"3171011506900001"}' },
      },
    ],
  },
];

test("redacted mode redacts every message and tool call, independent of guard config", () => {
  const response = new ResponseCapture();
  response.text(0, "sure, budi@example.com");
  response.toolCall(0, {
    id: "c2",
    type: "function",
    function: { name: "send", arguments: '{"to":"[EMAIL_1]"}' },
  });

  const stored = storedContent("redacted", messages, response, CANARY);

  expect(stored.request).toEqual({
    messages: [
      { role: "system", content: "Be nice. Marker: [CANARY]" },
      { role: "user", content: "my email is [EMAIL]" },
      {
        role: "assistant",
        content: null,
        tool_calls: [{ name: "lookup", arguments: '{"nik":"[NIK]"}' }],
      },
    ],
  });
  expect(stored.response).toEqual({
    choices: [
      { content: "sure, [EMAIL]", tool_calls: [{ name: "send", arguments: '{"to":"[EMAIL_1]"}' }] },
    ],
    truncated: false,
  });
  expect(JSON.stringify(stored)).not.toContain("budi@example.com");
  expect(JSON.stringify(stored)).not.toContain(CANARY);
});

test("hash mode stores one SHA-256 per message and per choice, no text", () => {
  const response = new ResponseCapture();
  response.text(0, "hello");
  const stored = storedContent("hash", messages, response, CANARY);

  const request = stored.request as { messages: { role: string; sha256: string }[] };
  expect(request.messages.map((m) => m.role)).toEqual(["system", "user", "assistant"]);
  for (const m of request.messages) expect(m.sha256).toMatch(/^[0-9a-f]{64}$/);
  expect(JSON.stringify(stored)).not.toContain("budi");
  expect((stored.response as { choices: { sha256: string }[] }).choices).toHaveLength(1);
});

test("none mode stores nothing", () => {
  expect(storedContent("none", messages, new ResponseCapture(), CANARY)).toEqual({
    request: null,
    response: null,
  });
});

test("the response capture is capped and marks itself truncated", () => {
  const capture = new ResponseCapture(10);
  capture.text(0, "12345");
  capture.text(0, "67890abc");
  capture.text(1, "more");
  expect(capture.snapshot()).toEqual({
    choices: [{ content: "1234567890", tool_calls: [] }],
    truncated: true,
  });
});

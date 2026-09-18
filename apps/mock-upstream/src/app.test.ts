import { test, expect } from "bun:test";
import { createApp } from "./app.js";

const app = createApp();

function req(body: unknown) {
  return new Request("http://localhost/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("mock-echo: non-streaming returns the last user message", async () => {
  const res = await app.fetch(
    req({
      model: "mock-echo",
      messages: [
        { role: "system", content: "you are a bot" },
        { role: "user", content: "hello there" },
      ],
    }),
  );

  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.object).toBe("chat.completion");
  expect(body.model).toBe("mock-echo");
  expect(body.choices[0].message).toEqual({ role: "assistant", content: "hello there" });
  expect(body.choices[0].finish_reason).toBe("stop");
  expect(body.usage.total_tokens).toBeGreaterThan(0);
});

test("mock-echo: streaming reassembles to the same content, ends with [DONE]", async () => {
  const res = await app.fetch(
    req({
      model: "mock-echo",
      stream: true,
      messages: [{ role: "user", content: "streamed reply please" }],
    }),
  );

  expect(res.status).toBe(200);
  expect(res.headers.get("Content-Type")).toBe("text/event-stream");

  const text = await res.text();
  const dataLines = text
    .split("\n\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("data: "))
    .map((l) => l.slice("data: ".length));

  expect(dataLines.at(-1)).toBe("[DONE]");

  const events = dataLines.slice(0, -1).map((l) => JSON.parse(l));
  expect(events[0].choices[0].delta).toEqual({ role: "assistant" });
  expect(events.at(-1).choices[0].finish_reason).toBe("stop");

  const reassembled = events.map((e) => e.choices[0].delta.content ?? "").join("");
  expect(reassembled).toBe("streamed reply please");
});

test("mock-split-placeholder: streams one character per chunk, splitting any [TYPE_N] token", async () => {
  const res = await app.fetch(
    req({
      model: "mock-split-placeholder",
      stream: true,
      messages: [{ role: "user", content: "your id is [NIK_1] thanks" }],
    }),
  );

  const text = await res.text();
  const dataLines = text
    .split("\n\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("data: "))
    .map((l) => l.slice("data: ".length));

  const events = dataLines.slice(0, -1).map((l) => JSON.parse(l));
  const contentDeltas = events
    .map((e) => e.choices[0].delta.content)
    .filter((c) => c !== undefined);

  // every content delta is exactly one character — the placeholder is necessarily split
  expect(contentDeltas.every((c: string) => c.length === 1)).toBe(true);
  expect(contentDeltas.join("")).toBe("your id is [NIK_1] thanks");
});

test("missing messages returns 400", async () => {
  const res = await app.fetch(req({ model: "mock-echo" }));
  expect(res.status).toBe(400);
});

test("missing model returns 400", async () => {
  const res = await app.fetch(req({ messages: [{ role: "user", content: "hi" }] }));
  expect(res.status).toBe(400);
});

test("unknown model returns 404", async () => {
  const res = await app.fetch(
    req({ model: "not-a-real-scenario", messages: [{ role: "user", content: "hi" }] }),
  );
  expect(res.status).toBe(404);
  const body = await res.json();
  expect(body.error.code).toBe("model_not_found");
});

// Talks to the gateway from `docker compose up` with the official OpenAI SDK.
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: process.env.PALANG_BASE_URL ?? "http://localhost:8080/v1",
  apiKey: process.env.PALANG_API_KEY ?? "plg_demo_key_for_local_testing_only",
});

const messages = [
  { role: "user" as const, content: "NIK saya 3171011506900001, tolong cek statusnya" },
];

const reply = await client.chat.completions.create({ model: "mock-echo", messages });
console.log("reply:   ", reply.choices[0]?.message.content);

const stream = await client.chat.completions.create({
  model: "mock-split-placeholder",
  messages,
  stream: true,
});
process.stdout.write("streamed: ");
for await (const chunk of stream) process.stdout.write(chunk.choices[0]?.delta.content ?? "");
process.stdout.write("\n");

try {
  await client.chat.completions.create({
    model: "mock-tool-call",
    messages: [{ role: "user", content: '{"name":"delete_user","arguments":{"id":42}}' }],
  });
} catch (error) {
  if (!(error instanceof OpenAI.APIError)) throw error;
  console.log("blocked: ", error.status, error.code);
}

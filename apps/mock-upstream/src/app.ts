import { Hono } from "hono";
import { stream } from "hono/streaming";
import { resolveScenario } from "./scenarios/registry.js";
import {
  buildChunk,
  buildCompletion,
  buildCompletionId,
  estimatePromptTokens,
  type IncomingRequest,
} from "./openai-shapes.js";

const CHUNK_SIZE = 8;
const CHUNK_DELAY_MS = 15;

function chunkContent(content: string): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < content.length; i += CHUNK_SIZE) {
    chunks.push(content.slice(i, i + CHUNK_SIZE));
  }
  return chunks;
}

export function createApp(): Hono {
  const app = new Hono();

  app.post("/v1/chat/completions", async (c) => {
    const body = (await c.req.json()) as Partial<IncomingRequest>;

    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      return c.json({ error: { message: "messages is required" } }, 400);
    }
    if (typeof body.model !== "string") {
      return c.json({ error: { message: "model is required" } }, 400);
    }

    const scenario = resolveScenario(body.model);
    if (!scenario) {
      return c.json(
        { error: { message: `Unknown mock model "${body.model}"`, code: "model_not_found" } },
        404,
      );
    }

    const content = scenario.reply(body.messages);
    const id = buildCompletionId();

    if (!body.stream) {
      const promptTokens = estimatePromptTokens(body.messages);
      return c.json(buildCompletion(id, body.model, promptTokens, content));
    }

    c.header("Content-Type", "text/event-stream");
    c.header("Cache-Control", "no-cache");

    const model = body.model;
    return stream(c, async (s) => {
      await s.write(
        `data: ${JSON.stringify(buildChunk(id, model, { role: "assistant" }, null))}\n\n`,
      );

      for (const piece of chunkContent(content)) {
        await s.sleep(CHUNK_DELAY_MS);
        await s.write(
          `data: ${JSON.stringify(buildChunk(id, model, { content: piece }, null))}\n\n`,
        );
      }

      await s.write(`data: ${JSON.stringify(buildChunk(id, model, {}, "stop"))}\n\n`);
      await s.write("data: [DONE]\n\n");
    });
  });

  return app;
}

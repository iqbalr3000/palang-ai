import { Hono } from "hono";
import { stream } from "hono/streaming";
import { resolveScenario } from "./scenarios/registry.js";
import {
  buildChunk,
  buildCompletion,
  buildCompletionId,
  estimatePromptTokens,
  type IncomingRequest,
  type MockToolCall,
} from "./openai-shapes.js";

const DEFAULT_CHUNK_SIZE = 8;
const CHUNK_DELAY_MS = 15;

function chunkContent(content: string, chunkSize: number): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < content.length; i += chunkSize) {
    chunks.push(content.slice(i, i + chunkSize));
  }
  return chunks;
}

export interface MockUpstreamOptions {
  /** Pause before each streamed chunk. The default makes streaming observable over a real socket. */
  chunkDelayMs?: number;
}

export function createApp(options: MockUpstreamOptions = {}): Hono {
  const chunkDelayMs = options.chunkDelayMs ?? CHUNK_DELAY_MS;
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

    const reply = scenario.reply(body.messages);
    const id = buildCompletionId();
    const toolCall: MockToolCall | null =
      "toolCall" in reply
        ? { id: `call_mock_${crypto.randomUUID()}`, type: "function", function: reply.toolCall }
        : null;
    const content = "content" in reply ? reply.content : "";

    if (!body.stream) {
      const promptTokens = estimatePromptTokens(body.messages);
      return c.json(
        buildCompletion(id, body.model, promptTokens, toolCall ? { toolCall } : { content }),
      );
    }

    c.header("Content-Type", "text/event-stream");
    c.header("Cache-Control", "no-cache");

    const model = body.model;
    return stream(c, async (s) => {
      await s.write(
        `data: ${JSON.stringify(buildChunk(id, model, { role: "assistant" }, null))}\n\n`,
      );

      const chunkSize = scenario.chunkSize ?? DEFAULT_CHUNK_SIZE;
      const send = async (chunk: ReturnType<typeof buildChunk>) => {
        if (chunkDelayMs > 0) await s.sleep(chunkDelayMs);
        await s.write(`data: ${JSON.stringify(chunk)}\n\n`);
      };

      if (toolCall) {
        const { id: callId, type, function: fn } = toolCall;
        await send(
          buildChunk(
            id,
            model,
            {
              tool_calls: [
                { index: 0, id: callId, type, function: { name: fn.name, arguments: "" } },
              ],
            },
            null,
          ),
        );
        for (const piece of chunkContent(fn.arguments, chunkSize)) {
          await send(
            buildChunk(
              id,
              model,
              { tool_calls: [{ index: 0, function: { arguments: piece } }] },
              null,
            ),
          );
        }
      } else {
        for (const piece of chunkContent(content, chunkSize)) {
          await send(buildChunk(id, model, { content: piece }, null));
        }
      }

      await s.write(
        `data: ${JSON.stringify(buildChunk(id, model, {}, toolCall ? "tool_calls" : "stop"))}\n\n`,
      );
      await s.write("data: [DONE]\n\n");
    });
  });

  return app;
}

import { EventSourceParserStream } from "eventsource-parser/stream";
import type {
  Decision,
  FailureMode,
  GuardContext,
  GuardRuntimeConfig,
  OutputGuard,
  ToolCall,
} from "@palang-ai/guards";
import { REASONS } from "@palang-ai/guards";
import { HoldbackBuffer } from "./holdback-buffer.js";
import { ToolCallAssembler, ToolArgsTooLargeError } from "./tool-call-assembler.js";
import { runTextGuards, runToolCallGuards, type OutputGuardChain } from "./run-output-guard.js";
import { blockedErrorBody } from "../public/errors.js";
import { streamChunkSchema, type StreamChunk, type StreamDelta } from "./types.js";

export interface RawResponseSink {
  text(choiceIndex: number, text: string): void;
  toolCall(choiceIndex: number, call: ToolCall): void;
}

export interface StreamProcessorDeps {
  outputGuards: OutputGuard[];
  guardConfigs: Record<string, GuardRuntimeConfig>;
  failureMode: FailureMode;
  ctx: GuardContext;
  rawSink?: RawResponseSink;
}

export interface StreamResult {
  decisions: Decision[];
  blocked: Decision | null;
  usage?: unknown;
}

const GUARDED_DELTA_KEYS = new Set(["content", "refusal", "tool_calls", "function_call"]);

// The OpenAI SDKs require `role` on the first chunk, so the rest of the delta is forwarded as-is.
function passthroughDelta(delta: StreamDelta): Record<string, unknown> | null {
  const rest = Object.fromEntries(
    Object.entries(delta).filter(([key]) => !GUARDED_DELTA_KEYS.has(key)),
  );
  return Object.keys(rest).length > 0 ? rest : null;
}

interface Meta {
  id: string;
  model: string;
  created: number;
}

function buildChunk(
  meta: Meta,
  choiceIndex: number,
  delta: Record<string, unknown>,
  finishReason: string | null,
) {
  return {
    id: meta.id,
    object: "chat.completion.chunk",
    created: meta.created,
    model: meta.model,
    choices: [{ index: choiceIndex, delta, finish_reason: finishReason }],
  };
}

const sse = (payload: unknown): string => `data: ${JSON.stringify(payload)}\n\n`;
const SSE_DONE = "data: [DONE]\n\n";

export async function processStream(
  upstreamBody: ReadableStream<Uint8Array>,
  deps: StreamProcessorDeps,
  write: (chunk: string) => Promise<void>,
): Promise<StreamResult> {
  const chain: OutputGuardChain = {
    guards: deps.outputGuards,
    configs: deps.guardConfigs,
    failureMode: deps.failureMode,
    ctx: deps.ctx,
  };
  const holdbackSize = Math.max(0, ...deps.outputGuards.map((g) => g.holdback ?? 0));
  const buffersByChoice = new Map<number, HoldbackBuffer>();
  const assemblersByChoice = new Map<number, ToolCallAssembler>();
  const refusalsByChoice = new Map<number, string>();
  const finishedChoices = new Set<number>();
  const decisions: Decision[] = [];
  let blocked: Decision | null = null;
  let usage: unknown;
  let meta: Meta = { id: "", model: "", created: 0 };

  function getBuffer(index: number): HoldbackBuffer {
    let buffer = buffersByChoice.get(index);
    if (!buffer) {
      buffer = new HoldbackBuffer(holdbackSize);
      buffersByChoice.set(index, buffer);
    }
    return buffer;
  }

  function getAssembler(index: number): ToolCallAssembler {
    let assembler = assemblersByChoice.get(index);
    if (!assembler) {
      assembler = new ToolCallAssembler();
      assemblersByChoice.set(index, assembler);
    }
    return assembler;
  }

  async function writeBlocked(decision: Decision): Promise<void> {
    blocked = decision;
    await write(sse(blockedErrorBody(deps.ctx.requestId, decision)));
    await write(SSE_DONE);
  }

  async function guardText(text: string, choiceIndex: number): Promise<string | null> {
    const result = await runTextGuards(chain, text, choiceIndex);
    decisions.push(...result.decisions);
    if (result.blocked) {
      await writeBlocked(result.blocked);
      return null;
    }
    return result.value;
  }

  async function emitTextChunk(choiceIndex: number, text: string): Promise<boolean> {
    if (!text) return true;
    const guarded = await guardText(text, choiceIndex);
    if (guarded === null) return false;
    if (guarded) await write(sse(buildChunk(meta, choiceIndex, { content: guarded }, null)));
    return true;
  }

  async function finishChoice(choiceIndex: number, finishReason: string | null): Promise<boolean> {
    if (!(await emitTextChunk(choiceIndex, getBuffer(choiceIndex).flush()))) return false;

    const refusal = refusalsByChoice.get(choiceIndex);
    if (refusal) {
      const guarded = await guardText(refusal, choiceIndex);
      if (guarded === null) return false;
      await write(sse(buildChunk(meta, choiceIndex, { refusal: guarded }, null)));
    }

    for (const [toolCallIndex, assembled] of getAssembler(choiceIndex).finalize().entries()) {
      deps.rawSink?.toolCall(choiceIndex, assembled);
      const result = await runToolCallGuards(chain, assembled);
      decisions.push(...result.decisions);
      if (result.blocked) {
        await writeBlocked(result.blocked);
        return false;
      }
      await write(
        sse(
          buildChunk(
            meta,
            choiceIndex,
            { tool_calls: [{ index: toolCallIndex, ...result.value }] },
            null,
          ),
        ),
      );
    }

    await write(sse(buildChunk(meta, choiceIndex, {}, finishReason)));
    finishedChoices.add(choiceIndex);
    return true;
  }

  // lib.dom types TextDecoderStream's writable as WritableStream<BufferSource>, which doesn't
  // match what pipeThrough expects here even though it's correct at runtime.
  const eventStream = upstreamBody
    .pipeThrough(new TextDecoderStream() as ReadableWritablePair<string, Uint8Array>)
    .pipeThrough(new EventSourceParserStream());
  const reader = eventStream.getReader();
  // On Bun, cancelling the body doesn't close the connection; the caller also aborts the fetch.
  let consumedToEnd = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.data === "[DONE]") break;

      let json: unknown;
      try {
        json = JSON.parse(value.data);
      } catch {
        continue;
      }
      const parsed = streamChunkSchema.safeParse(json);
      if (!parsed.success) continue;
      const chunk: StreamChunk = parsed.data;

      meta = { id: chunk.id, model: chunk.model, created: chunk.created };

      for (const choice of chunk.choices ?? []) {
        const passthrough = passthroughDelta(choice.delta);
        if (passthrough) await write(sse(buildChunk(meta, choice.index, passthrough, null)));

        if (choice.delta.refusal) {
          refusalsByChoice.set(
            choice.index,
            (refusalsByChoice.get(choice.index) ?? "") + choice.delta.refusal,
          );
        }

        if (choice.delta.content) {
          deps.rawSink?.text(choice.index, choice.delta.content);
          const released = getBuffer(choice.index).append(choice.delta.content);
          if (!(await emitTextChunk(choice.index, released))) return { decisions, blocked, usage };
        }

        if (choice.delta.tool_calls) {
          const assembler = getAssembler(choice.index);
          for (const delta of choice.delta.tool_calls) {
            try {
              assembler.accumulate(delta);
            } catch (error) {
              if (!(error instanceof ToolArgsTooLargeError)) throw error;
              blocked = {
                guard: "stream",
                action: "block",
                reason: REASONS.TOOL_ARGUMENTS_TOO_LARGE,
                latencyMs: 0,
              };
              decisions.push(blocked);
              await write(
                sse({
                  error: {
                    message: "Tool call arguments exceeded the size cap",
                    code: "tool_arguments_too_large",
                  },
                }),
              );
              await write(SSE_DONE);
              return { decisions, blocked, usage };
            }
          }
        }

        if (choice.finish_reason) {
          if (!(await finishChoice(choice.index, choice.finish_reason))) {
            return { decisions, blocked, usage };
          }
        }
      }

      // A usage chunk can also carry choices, so it's forwarded only after they've been guarded.
      if (chunk.usage) {
        usage = chunk.usage;
        await write(
          sse({
            id: meta.id,
            object: "chat.completion.chunk",
            created: meta.created,
            model: meta.model,
            choices: [],
            usage: chunk.usage,
          }),
        );
      }
    }

    const pendingChoices = new Set([
      ...buffersByChoice.keys(),
      ...assemblersByChoice.keys(),
      ...refusalsByChoice.keys(),
    ]);
    for (const choiceIndex of pendingChoices) {
      if (finishedChoices.has(choiceIndex)) continue;
      if (!(await finishChoice(choiceIndex, null))) return { decisions, blocked, usage };
    }

    await write(SSE_DONE);
    consumedToEnd = true;
  } finally {
    if (consumedToEnd) reader.releaseLock();
    else await reader.cancel().catch(() => {});
  }

  return { decisions, blocked, usage };
}

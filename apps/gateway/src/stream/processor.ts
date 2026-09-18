import { EventSourceParserStream } from "eventsource-parser/stream";
import type {
  Decision,
  FailureMode,
  GuardContext,
  GuardRuntimeConfig,
  OutputGuard,
} from "@palang-ai/core";
import { HoldbackBuffer } from "./holdback-buffer.js";
import { ToolCallAssembler, ToolArgsTooLargeError } from "./tool-call-assembler.js";
import { runOutputGuardText, runOutputGuardToolCall } from "./run-output-guard.js";
import { blockedErrorBody } from "../public/errors.js";
import type { StreamChunk } from "./types.js";

export interface StreamProcessorDeps {
  outputGuards: OutputGuard[];
  guardConfigs: Record<string, GuardRuntimeConfig>;
  failureMode: FailureMode;
  ctx: GuardContext;
}

export interface StreamResult {
  decisions: Decision[];
  blocked: Decision | null;
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
): StreamChunk {
  return {
    id: meta.id,
    object: "chat.completion.chunk",
    created: meta.created,
    model: meta.model,
    choices: [{ index: choiceIndex, delta, finish_reason: finishReason }],
  };
}

// Decoupled from Hono on purpose — the caller supplies `write`, so this is testable without any
// HTTP machinery.
export async function processStream(
  upstreamBody: ReadableStream<Uint8Array>,
  deps: StreamProcessorDeps,
  write: (chunk: string) => Promise<void>,
): Promise<StreamResult> {
  const holdbackSize = Math.max(0, ...deps.outputGuards.map((g) => g.holdback ?? 0));
  const buffersByChoice = new Map<number, HoldbackBuffer>();
  const assemblersByChoice = new Map<number, ToolCallAssembler>();
  const finishedChoices = new Set<number>();
  const decisions: Decision[] = [];
  let blocked: Decision | null = null;
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

  function guardConfigFor(name: string): GuardRuntimeConfig {
    const config = deps.guardConfigs[name];
    if (!config) throw new Error(`No runtime config for guard "${name}"`);
    return config;
  }

  /** Runs `text` through every active `checkText` guard in order; returns null (and has already
   * written the block response) if a guard blocks. */
  async function runTextThroughGuards(text: string): Promise<string | null> {
    let current = text;
    for (const guard of deps.outputGuards) {
      if (!guard.checkText) continue;
      const { decision, text: next } = await runOutputGuardText(
        guard,
        current,
        deps.ctx,
        guardConfigFor(guard.name),
        deps.failureMode,
      );
      decisions.push(decision);
      current = next;
      if (decision.action === "block") {
        blocked = decision;
        await writeBlocked(decision);
        return null;
      }
    }
    return current;
  }

  async function emitTextChunk(choiceIndex: number, text: string): Promise<boolean> {
    if (!text) return true;
    const restored = await runTextThroughGuards(text);
    if (restored === null) return false;
    if (restored) {
      await write(
        `data: ${JSON.stringify(buildChunk(meta, choiceIndex, { content: restored }, null))}\n\n`,
      );
    }
    return true;
  }

  async function writeBlocked(decision: Decision): Promise<void> {
    await write(`data: ${JSON.stringify(blockedErrorBody(deps.ctx.requestId, decision))}\n\n`);
    await write("data: [DONE]\n\n");
  }

  async function writeToolArgsTooLarge(): Promise<void> {
    await write(
      `data: ${JSON.stringify({
        error: {
          message: "Tool call arguments exceeded the size cap",
          code: "tool_arguments_too_large",
        },
      })}\n\n`,
    );
    await write("data: [DONE]\n\n");
  }

  /** Flushes a choice's buffered text and assembled tool calls through the output guards and emits
   * its finish chunk. Returns false (having already written the block response) if a guard
   * blocked. Also used at stream end to flush any choice that never received a finish_reason. */
  async function finishChoice(choiceIndex: number, finishReason: string | null): Promise<boolean> {
    const remaining = getBuffer(choiceIndex).flush();
    if (!(await emitTextChunk(choiceIndex, remaining))) return false;

    for (let toolCall of getAssembler(choiceIndex).finalize()) {
      let choiceBlocked = false;
      for (const guard of deps.outputGuards) {
        if (!guard.checkToolCall) continue;
        const { decision, call } = await runOutputGuardToolCall(
          guard,
          toolCall,
          deps.ctx,
          guardConfigFor(guard.name),
          deps.failureMode,
        );
        decisions.push(decision);
        toolCall = call;
        if (decision.action === "block") {
          blocked = decision;
          await writeBlocked(decision);
          choiceBlocked = true;
          break;
        }
      }
      if (choiceBlocked) return false;
      await write(
        `data: ${JSON.stringify(buildChunk(meta, choiceIndex, { tool_calls: [toolCall] }, null))}\n\n`,
      );
    }

    await write(`data: ${JSON.stringify(buildChunk(meta, choiceIndex, {}, finishReason))}\n\n`);
    finishedChoices.add(choiceIndex);
    return true;
  }

  // TS's lib.dom types `TextDecoderStream.writable` as `WritableStream<BufferSource>`, which
  // doesn't structurally match `ReadableWritablePair<string, Uint8Array>` even though this is
  // exactly the standard, correct way to decode a fetch body — a known lib.dom typing gap, not a
  // real mismatch.
  const eventStream = upstreamBody
    .pipeThrough(new TextDecoderStream() as ReadableWritablePair<string, Uint8Array>)
    .pipeThrough(new EventSourceParserStream());
  const reader = eventStream.getReader();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.data === "[DONE]") break;

      let chunk: StreamChunk;
      try {
        chunk = JSON.parse(value.data) as StreamChunk;
      } catch {
        continue; // ignore lines that aren't valid JSON chunks
      }

      meta = { id: chunk.id, model: chunk.model, created: chunk.created };

      for (const choice of chunk.choices ?? []) {
        if (choice.delta.content) {
          const released = getBuffer(choice.index).append(choice.delta.content);
          if (!(await emitTextChunk(choice.index, released))) return { decisions, blocked };
        }

        if (choice.delta.tool_calls) {
          const assembler = getAssembler(choice.index);
          for (const delta of choice.delta.tool_calls) {
            try {
              assembler.accumulate(delta);
            } catch (error) {
              if (error instanceof ToolArgsTooLargeError) {
                await writeToolArgsTooLarge();
                return { decisions, blocked };
              }
              throw error;
            }
          }
        }

        if (choice.finish_reason) {
          if (!(await finishChoice(choice.index, choice.finish_reason))) {
            return { decisions, blocked };
          }
        }
      }

      // Forwarded after per-choice processing, never instead of it — a usage chunk can carry a
      // non-empty `choices` too, and skipping straight past those would bypass every output guard.
      if (chunk.usage) {
        await write(
          `data: ${JSON.stringify({
            id: meta.id,
            object: "chat.completion.chunk",
            created: meta.created,
            model: meta.model,
            choices: [],
            usage: chunk.usage,
          })}\n\n`,
        );
      }
    }

    // Upstream ended (or sent [DONE]) before some choice's finish_reason ever arrived — flush what
    // it was still holding instead of silently dropping it.
    const pendingChoices = new Set([...buffersByChoice.keys(), ...assemblersByChoice.keys()]);
    for (const choiceIndex of pendingChoices) {
      if (finishedChoices.has(choiceIndex)) continue;
      if (!(await finishChoice(choiceIndex, null))) return { decisions, blocked };
    }

    await write("data: [DONE]\n\n");
  } finally {
    reader.releaseLock();
  }

  return { decisions, blocked };
}

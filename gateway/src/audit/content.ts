import { createHash } from "node:crypto";
import type { ChatMessage, ToolCall } from "@palang-ai/guards";
import { detectPii } from "@palang-ai/guards";
import type { PalangConfig } from "../config/schema.js";
import type { RawResponseSink } from "../stream/processor.js";

export type ContentMode = PalangConfig["audit"]["content_mode"];

const DEFAULT_MAX_CHARS = 64 * 1024;

export function redactForStorage(text: string, canary: string | undefined): string {
  const withoutCanary = canary ? text.replace(new RegExp(canary, "gi"), "[CANARY]") : text;
  let result = "";
  let cursor = 0;
  for (const match of detectPii(withoutCanary)) {
    result += `${withoutCanary.slice(cursor, match.start)}[${match.type}]`;
    cursor = match.end;
  }
  return result + withoutCanary.slice(cursor);
}

interface CapturedChoice {
  content: string;
  tool_calls: { name: string; arguments: string }[];
}

export class ResponseCapture implements RawResponseSink {
  private readonly choices: CapturedChoice[] = [];
  private remaining: number;
  private truncated = false;

  constructor(maxChars = DEFAULT_MAX_CHARS) {
    this.remaining = maxChars;
  }

  private take(value: string): string | null {
    if (value.length > this.remaining) this.truncated = true;
    if (this.remaining === 0) return null;
    const kept = value.slice(0, this.remaining);
    this.remaining -= kept.length;
    return kept;
  }

  private choice(index: number): CapturedChoice {
    this.choices[index] ??= { content: "", tool_calls: [] };
    return this.choices[index];
  }

  text(index: number, text: string): void {
    const kept = this.take(text);
    if (kept !== null) this.choice(index).content += kept;
  }

  toolCall(index: number, call: ToolCall): void {
    const kept = this.take(call.function.arguments);
    if (kept !== null)
      this.choice(index).tool_calls.push({ name: call.function.name, arguments: kept });
  }

  snapshot(): { choices: CapturedChoice[]; truncated: boolean } {
    return { choices: this.choices.filter(Boolean), truncated: this.truncated };
  }
}

const sha256 = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

export interface StoredContent {
  request: unknown;
  response: unknown;
}

export function storedContent(
  mode: ContentMode,
  messages: ChatMessage[],
  response: ResponseCapture | null,
  canary: string | undefined,
): StoredContent {
  if (mode === "none") return { request: null, response: null };
  const captured = response?.snapshot() ?? null;

  if (mode === "hash") {
    return {
      request: {
        messages: messages.map((m) => ({
          role: m.role,
          sha256: sha256({ content: m.content, tool_calls: m.tool_calls }),
        })),
      },
      response: captured && {
        choices: captured.choices.map((c) => ({ sha256: sha256(c) })),
        truncated: captured.truncated,
      },
    };
  }

  const redact = (text: string): string => redactForStorage(text, canary);
  return {
    request: {
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content === null ? null : redact(m.content),
        ...(m.tool_calls && {
          tool_calls: m.tool_calls.map((c) => ({
            name: c.function.name,
            arguments: redact(c.function.arguments),
          })),
        }),
      })),
    },
    response: captured && {
      choices: captured.choices.map((c) => ({
        content: redact(c.content),
        tool_calls: c.tool_calls.map((t) => ({ name: t.name, arguments: redact(t.arguments) })),
      })),
      truncated: captured.truncated,
    },
  };
}

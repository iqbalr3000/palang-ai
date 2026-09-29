import type { ToolCall } from "@palang-ai/guards";

export interface ToolCallDelta {
  index: number;
  id?: string;
  type?: "function";
  function?: { name?: string; arguments?: string };
}

export class ToolArgsTooLargeError extends Error {
  constructor(public readonly toolCallIndex: number) {
    super(`Tool call ${toolCallIndex} arguments exceeded the size cap`);
  }
}

interface Accumulated {
  id: string;
  name: string;
  arguments: string;
  // Tracked incrementally; re-encoding the whole string per delta is quadratic.
  argumentBytes: number;
}

const encoder = new TextEncoder();

const DEFAULT_MAX_ARGS_BYTES = 256 * 1024;

export class ToolCallAssembler {
  private readonly calls = new Map<number, Accumulated>();
  private readonly maxArgsBytes: number;

  constructor(options: { maxArgsBytes?: number } = {}) {
    this.maxArgsBytes = options.maxArgsBytes ?? DEFAULT_MAX_ARGS_BYTES;
  }

  accumulate(delta: ToolCallDelta): void {
    let call = this.calls.get(delta.index);
    if (!call) {
      call = { id: "", name: "", arguments: "", argumentBytes: 0 };
      this.calls.set(delta.index, call);
    }

    if (delta.id) call.id = delta.id;
    if (delta.function?.name) call.name = delta.function.name;
    if (delta.function?.arguments) {
      call.arguments += delta.function.arguments;
      call.argumentBytes += encoder.encode(delta.function.arguments).length;
      if (call.argumentBytes > this.maxArgsBytes) {
        throw new ToolArgsTooLargeError(delta.index);
      }
    }
  }

  finalize(): ToolCall[] {
    return [...this.calls.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, call]) => ({
        id: call.id,
        type: "function" as const,
        function: { name: call.name, arguments: call.arguments },
      }));
  }
}

export type Action = "allow" | "block" | "modify" | "flag";
export type GuardMode = "enforce" | "monitor";
export type Role = "system" | "user" | "assistant" | "tool";
export type FailureMode = "fail_open" | "fail_closed";

// "modify" is a per-guard signal, never a pipeline-level outcome.
export type FinalAction = "allow" | "flag" | "block";

export interface ChatMessage {
  role: Role;
  content: string | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface Decision {
  guard: string;
  action: Action;
  reason?: string;
  detail?: string; // must not contain raw PII
  score?: number;
  findings?: Finding[];
  latencyMs: number;
  wouldBlock?: boolean; // set by the pipeline runner, not the guard
}

export interface Finding {
  type: string;
  messageIndex?: number;
  start?: number;
  end?: number;
  meta?: Record<string, unknown>; // never raw values
}

export interface GuardContext {
  requestId: string;
  tenantId: string;
  model: string;
  stream: boolean;
  messages: ChatMessage[]; // input guards may mutate
  piiVault: Map<string, string>; // placeholder -> original; NEVER log or persist
  canary?: string;
  signal: AbortSignal;
  metadata: Record<string, unknown>;
}

export interface InputGuard {
  name: string;
  phase: "input";
  check(ctx: GuardContext): Promise<Decision>;
}

export interface OutputGuard {
  name: string;
  phase: "output";
  /** Called on text segments released by the holdback buffer. May return modified text. */
  checkText?(text: string, ctx: GuardContext): Promise<{ decision: Decision; text: string }>;
  /** Called once per fully assembled tool call. May return a modified call. */
  checkToolCall?(
    call: ToolCall,
    ctx: GuardContext,
  ): Promise<{ decision: Decision; call: ToolCall }>;
  /** Max characters this guard needs held back to detect split patterns. */
  holdback?: number;
}

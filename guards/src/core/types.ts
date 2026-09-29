export type Action = "allow" | "block" | "modify" | "flag";
export type GuardMode = "enforce" | "monitor";
export type Role = "system" | "user" | "assistant" | "tool";
export type FailureMode = "fail_open" | "fail_closed";

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
  wouldBlock?: boolean;
}

export interface Finding {
  type: string;
  messageIndex?: number;
  start?: number;
  end?: number;
  meta?: Record<string, unknown>;
}

export interface GuardContext {
  requestId: string;
  tenantId: string;
  model: string;
  stream: boolean;
  messages: ChatMessage[];
  piiVault: Map<string, string>; // placeholder -> original; never log or persist
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
  checkText?(
    text: string,
    ctx: GuardContext,
    choice?: number,
  ): Promise<{ decision: Decision; text: string }>;
  checkToolCall?(
    call: ToolCall,
    ctx: GuardContext,
  ): Promise<{ decision: Decision; call: ToolCall }>;
  holdback?: number;
}

import { evaluateGuard } from "@palang-ai/core";
import type {
  Decision,
  FailureMode,
  GuardContext,
  GuardRuntimeConfig,
  OutputGuard,
  ToolCall,
} from "@palang-ai/core";

// Adapts checkText/checkToolCall's `{ decision, text|call }` shape into evaluateGuard's, capturing
// the modified text/call via closure since evaluateGuard only ever sees the Decision half.
export async function runOutputGuardText(
  guard: OutputGuard,
  text: string,
  ctx: GuardContext,
  config: GuardRuntimeConfig,
  failureMode: FailureMode,
): Promise<{ decision: Decision; text: string }> {
  let resultText = text;
  const decision = await evaluateGuard(
    guard.name,
    config,
    failureMode,
    ctx.signal,
    async (signal) => {
      if (!guard.checkText) return { guard: guard.name, action: "allow", latencyMs: 0 };
      const result = await guard.checkText(text, { ...ctx, signal });
      resultText = result.text;
      return result.decision;
    },
  );
  return { decision, text: resultText };
}

export async function runOutputGuardToolCall(
  guard: OutputGuard,
  call: ToolCall,
  ctx: GuardContext,
  config: GuardRuntimeConfig,
  failureMode: FailureMode,
): Promise<{ decision: Decision; call: ToolCall }> {
  let resultCall = call;
  const decision = await evaluateGuard(
    guard.name,
    config,
    failureMode,
    ctx.signal,
    async (signal) => {
      if (!guard.checkToolCall) return { guard: guard.name, action: "allow", latencyMs: 0 };
      const result = await guard.checkToolCall(call, { ...ctx, signal });
      resultCall = result.call;
      return result.decision;
    },
  );
  return { decision, call: resultCall };
}

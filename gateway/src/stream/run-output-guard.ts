import { evaluateGuard } from "@palang-ai/guards";
import type {
  Decision,
  FailureMode,
  GuardContext,
  GuardRuntimeConfig,
  OutputGuard,
  ToolCall,
} from "@palang-ai/guards";

export interface OutputGuardChain {
  guards: OutputGuard[];
  configs: Record<string, GuardRuntimeConfig>;
  failureMode: FailureMode;
  ctx: GuardContext;
}

export interface ChainResult<T> {
  value: T;
  decisions: Decision[];
  blocked: Decision | null;
}

function configFor(chain: OutputGuardChain, name: string): GuardRuntimeConfig {
  const config = chain.configs[name];
  if (!config) throw new Error(`No runtime config for guard "${name}"`);
  return config;
}

async function runOutputGuardText(
  guard: OutputGuard,
  text: string,
  ctx: GuardContext,
  config: GuardRuntimeConfig,
  failureMode: FailureMode,
  choice = 0,
): Promise<{ decision: Decision; text: string }> {
  let resultText = text;
  const decision = await evaluateGuard(
    guard.name,
    config,
    failureMode,
    ctx.signal,
    async (signal) => {
      if (!guard.checkText) return { guard: guard.name, action: "allow", latencyMs: 0 };
      const result = await guard.checkText(text, { ...ctx, signal }, choice);
      resultText = result.text;
      return result.decision;
    },
  );
  return { decision, text: resultText };
}

async function runOutputGuardToolCall(
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

export async function runTextGuards(
  chain: OutputGuardChain,
  text: string,
  choice: number,
): Promise<ChainResult<string>> {
  const decisions: Decision[] = [];
  let current = text;
  for (const guard of chain.guards) {
    if (!guard.checkText) continue;
    const result = await runOutputGuardText(
      guard,
      current,
      chain.ctx,
      configFor(chain, guard.name),
      chain.failureMode,
      choice,
    );
    decisions.push(result.decision);
    current = result.text;
    if (result.decision.action === "block") {
      return { value: current, decisions, blocked: result.decision };
    }
  }
  return { value: current, decisions, blocked: null };
}

export async function runToolCallGuards(
  chain: OutputGuardChain,
  call: ToolCall,
): Promise<ChainResult<ToolCall>> {
  const decisions: Decision[] = [];
  let current = call;
  for (const guard of chain.guards) {
    if (!guard.checkToolCall) continue;
    const result = await runOutputGuardToolCall(
      guard,
      current,
      chain.ctx,
      configFor(chain, guard.name),
      chain.failureMode,
    );
    decisions.push(result.decision);
    current = result.call;
    if (result.decision.action === "block") {
      return { value: current, decisions, blocked: result.decision };
    }
  }
  return { value: current, decisions, blocked: null };
}

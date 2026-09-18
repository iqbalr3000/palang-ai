import type { Decision, GuardContext, GuardMode, FailureMode, InputGuard } from "./types.js";
import { REASONS } from "./reasons.js";

export interface GuardRuntimeConfig {
  mode: GuardMode;
  /** No timeout enforced when omitted. */
  timeoutMs?: number;
}

export interface PipelineOptions {
  failureMode: FailureMode;
  /** Runtime config per guard, keyed by `guard.name`. */
  guards: Record<string, GuardRuntimeConfig>;
}

export interface PipelineResult {
  decisions: Decision[];
  blocked: Decision | null;
}

class GuardTimeoutError extends Error {}

// Enforced by racing the guard's promise, not cancelling it — an unresponsive guard's work may
// continue in the background, but the pipeline moves on. `fn` still gets a combined `AbortSignal`
// so well-behaved guards can stop early.
async function withTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  parentSignal: AbortSignal,
  timeoutMs: number | undefined,
): Promise<T> {
  if (!timeoutMs) return fn(parentSignal);

  const timeoutController = new AbortController();
  const combinedSignal = AbortSignal.any([parentSignal, timeoutController.signal]);

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      timeoutController.abort();
      reject(new GuardTimeoutError());
    }, timeoutMs);
  });

  try {
    return await Promise.race([fn(combinedSignal), timeout]);
  } finally {
    clearTimeout(timeoutId);
  }
}

// Generic over the guard call (`fn`) so input and output guard invocations can share this.
export async function evaluateGuard(
  name: string,
  config: GuardRuntimeConfig,
  failureMode: FailureMode,
  parentSignal: AbortSignal,
  fn: (signal: AbortSignal) => Promise<Decision>,
): Promise<Decision> {
  const start = performance.now();

  try {
    const decision = await withTimeout(fn, parentSignal, config.timeoutMs);
    const latencyMs = performance.now() - start;

    if (config.mode === "monitor" && decision.action === "block") {
      return { ...decision, action: "flag", wouldBlock: true, latencyMs };
    }
    return { ...decision, latencyMs };
  } catch {
    const latencyMs = performance.now() - start;
    const action = failureMode === "fail_closed" ? "block" : "flag";
    if (config.mode === "monitor" && action === "block") {
      return {
        guard: name,
        action: "flag",
        wouldBlock: true,
        reason: REASONS.GUARD_ERROR,
        latencyMs,
      };
    }
    return { guard: name, action, reason: REASONS.GUARD_ERROR, latencyMs };
  }
}

// Runs guards sequentially in the given order; short-circuits on the first enforced block.
export async function runInputPipeline(
  guards: InputGuard[],
  ctx: GuardContext,
  options: PipelineOptions,
): Promise<PipelineResult> {
  const decisions: Decision[] = [];

  for (const guard of guards) {
    const config = options.guards[guard.name];
    if (!config) {
      throw new Error(`No runtime config for guard "${guard.name}"`);
    }

    const decision = await evaluateGuard(
      guard.name,
      config,
      options.failureMode,
      ctx.signal,
      (signal) => guard.check({ ...ctx, signal }),
    );
    decisions.push(decision);

    if (decision.action === "block") {
      return { decisions, blocked: decision };
    }
  }

  return { decisions, blocked: null };
}

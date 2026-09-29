import type { Decision, GuardContext, GuardMode, FailureMode, InputGuard } from "./types.js";
import { REASONS } from "./reasons.js";

export interface GuardRuntimeConfig {
  mode: GuardMode;
  timeoutMs?: number;
  /** Errors and timeouts always block, even in monitor mode. */
  failClosed?: boolean;
}

export interface PipelineOptions {
  failureMode: FailureMode;
  guards: Record<string, GuardRuntimeConfig>;
}

export interface PipelineResult {
  decisions: Decision[];
  blocked: Decision | null;
}

class GuardTimeoutError extends Error {}

// Races rather than cancels: a stuck guard may keep running in the background. The abort signal
// lets well-behaved guards stop early.
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
    if (config.failClosed) {
      return { guard: name, action: "block", reason: REASONS.GUARD_ERROR, latencyMs };
    }
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

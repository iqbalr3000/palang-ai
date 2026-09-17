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

/**
 * Runs one guard call with a per-guard timeout (TSD §5.1). The timeout is enforced by racing the
 * guard's promise, not by cancelling it — an unresponsive guard's work may continue in the
 * background, but the pipeline moves on regardless. Well-behaved guards can still observe the
 * combined `AbortSignal` passed to `fn` and stop early.
 */
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

/**
 * Runs a single guard's check with mode + timeout + failure-mode handling applied (TSD §5.1).
 * Shared by the input pipeline below and, later, by output-phase (`checkText`/`checkToolCall`)
 * invocations in `apps/gateway`'s stream processor — kept generic over the guard call itself
 * (`fn`) so both call shapes can reuse the same mode/timeout/failure-mode logic.
 */
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
    // Timeout or thrown exception: tenant `failureMode` decides the outcome directly (TSD §5.1),
    // independent of the guard's own `mode`.
    const latencyMs = performance.now() - start;
    return {
      guard: name,
      action: failureMode === "fail_closed" ? "block" : "flag",
      reason: REASONS.GUARD_ERROR,
      latencyMs,
    };
  }
}

/**
 * Runs input guards sequentially, in the order given (TSD §5.1 — order matters, e.g. PII mask
 * before the injection judge). Short-circuits on the first enforced `block`; a `monitor`-mode
 * guard's downgraded block (`flag` + `wouldBlock: true`) does not short-circuit.
 */
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

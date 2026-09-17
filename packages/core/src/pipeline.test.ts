import { test, expect, describe } from "bun:test";
import { runInputPipeline } from "./pipeline.js";
import type { Decision, GuardContext, InputGuard } from "./types.js";

function makeCtx(overrides: Partial<GuardContext> = {}): GuardContext {
  return {
    requestId: "req_1",
    tenantId: "demo",
    model: "gpt-4o-mini",
    stream: false,
    messages: [{ role: "user", content: "hello" }],
    piiVault: new Map(),
    signal: new AbortController().signal,
    metadata: {},
    ...overrides,
  };
}

function fakeGuard(
  name: string,
  action: Decision["action"],
  opts: { delayMs?: number; throws?: boolean } = {},
): InputGuard & { calls: number } {
  const guard = {
    name,
    phase: "input" as const,
    calls: 0,
    async check(_ctx: GuardContext): Promise<Decision> {
      guard.calls++;
      if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
      if (opts.throws) throw new Error("boom");
      return { guard: name, action, latencyMs: 0 };
    },
  };
  return guard;
}

describe("runInputPipeline", () => {
  test("runs guards sequentially in order", async () => {
    const order: string[] = [];
    const a: InputGuard = {
      name: "a",
      phase: "input",
      async check() {
        order.push("a");
        return { guard: "a", action: "allow", latencyMs: 0 };
      },
    };
    const b: InputGuard = {
      name: "b",
      phase: "input",
      async check() {
        order.push("b");
        return { guard: "b", action: "allow", latencyMs: 0 };
      },
    };

    const result = await runInputPipeline([a, b], makeCtx(), {
      failureMode: "fail_open",
      guards: { a: { mode: "enforce" }, b: { mode: "enforce" } },
    });

    expect(order).toEqual(["a", "b"]);
    expect(result.blocked).toBeNull();
    expect(result.decisions).toHaveLength(2);
  });

  test("enforce mode: block short-circuits, later guards not called", async () => {
    const blocker = fakeGuard("blocker", "block");
    const never = fakeGuard("never", "allow");

    const result = await runInputPipeline([blocker, never], makeCtx(), {
      failureMode: "fail_open",
      guards: { blocker: { mode: "enforce" }, never: { mode: "enforce" } },
    });

    expect(result.blocked?.guard).toBe("blocker");
    expect(result.decisions).toHaveLength(1);
    expect(never.calls).toBe(0);
  });

  test("monitor mode: block downgraded to flag + wouldBlock, does not short-circuit", async () => {
    const monitored = fakeGuard("monitored", "block");
    const after = fakeGuard("after", "allow");

    const result = await runInputPipeline([monitored, after], makeCtx(), {
      failureMode: "fail_open",
      guards: { monitored: { mode: "monitor" }, after: { mode: "enforce" } },
    });

    expect(result.blocked).toBeNull();
    expect(result.decisions[0]).toMatchObject({ action: "flag", wouldBlock: true });
    expect(after.calls).toBe(1);
  });

  test("timeout: fail_closed -> block with reason guard_error", async () => {
    const slow = fakeGuard("slow", "allow", { delayMs: 50 });

    const result = await runInputPipeline([slow], makeCtx(), {
      failureMode: "fail_closed",
      guards: { slow: { mode: "enforce", timeoutMs: 5 } },
    });

    expect(result.blocked).toMatchObject({ guard: "slow", action: "block", reason: "guard_error" });
  });

  test("timeout: fail_open -> flag with reason guard_error, pipeline continues", async () => {
    const slow = fakeGuard("slow", "allow", { delayMs: 50 });
    const after = fakeGuard("after", "allow");

    const result = await runInputPipeline([slow, after], makeCtx(), {
      failureMode: "fail_open",
      guards: { slow: { mode: "enforce", timeoutMs: 5 }, after: { mode: "enforce" } },
    });

    expect(result.blocked).toBeNull();
    expect(result.decisions[0]).toMatchObject({ action: "flag", reason: "guard_error" });
    expect(after.calls).toBe(1);
  });

  test("thrown exception is treated the same as a timeout", async () => {
    const broken = fakeGuard("broken", "allow", { throws: true });

    const result = await runInputPipeline([broken], makeCtx(), {
      failureMode: "fail_closed",
      guards: { broken: { mode: "enforce" } },
    });

    expect(result.blocked).toMatchObject({
      guard: "broken",
      action: "block",
      reason: "guard_error",
    });
  });

  test("throws if a guard has no runtime config", async () => {
    const guard = fakeGuard("unconfigured", "allow");

    await expect(
      runInputPipeline([guard], makeCtx(), { failureMode: "fail_open", guards: {} }),
    ).rejects.toThrow('No runtime config for guard "unconfigured"');
  });

  test("mutations to ctx.messages by an earlier guard are visible to later guards", async () => {
    const masker: InputGuard = {
      name: "masker",
      phase: "input",
      async check(ctx) {
        ctx.messages[0]!.content = "[MASKED]";
        return { guard: "masker", action: "allow", latencyMs: 0 };
      },
    };
    let seenByNext = "";
    const reader: InputGuard = {
      name: "reader",
      phase: "input",
      async check(ctx) {
        seenByNext = ctx.messages[0]!.content ?? "";
        return { guard: "reader", action: "allow", latencyMs: 0 };
      },
    };

    await runInputPipeline([masker, reader], makeCtx(), {
      failureMode: "fail_open",
      guards: { masker: { mode: "enforce" }, reader: { mode: "enforce" } },
    });

    expect(seenByNext).toBe("[MASKED]");
  });
});

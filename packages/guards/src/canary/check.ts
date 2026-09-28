import { REASONS } from "@palang-ai/core";
import type { Decision, GuardContext, OutputGuard } from "@palang-ai/core";
import { generateCanary, getCanary } from "./inject.js";

export interface CanaryConfig {
  /** `block` terminates the response; `flag` strips the token and lets it continue. */
  onDetect: "block" | "flag";
}

const CANARY_LENGTH = generateCanary().length;

interface Scan {
  decision: Decision;
  text: string;
}

function scan(text: string, ctx: GuardContext, config: CanaryConfig): Scan {
  const canary = getCanary(ctx);
  // Hex only after a fixed prefix, so the token needs no regex escaping.
  const pattern = canary ? new RegExp(canary, "gi") : null;
  if (!pattern || !pattern.test(text)) {
    return { decision: { guard: "canary", action: "allow", latencyMs: 0 }, text };
  }

  const decision: Decision = {
    guard: "canary",
    action: config.onDetect,
    reason: REASONS.CANARY_LEAKED,
    findings: [{ type: "CANARY_LEAK" }], // never the token itself
    latencyMs: 0, // overwritten by the pipeline runner
  };
  return { decision, text: config.onDetect === "flag" ? text.replace(pattern, "") : text };
}

export function createCanaryOutputGuard(config: CanaryConfig): OutputGuard {
  return {
    name: "canary",
    phase: "output",
    holdback: CANARY_LENGTH,

    async checkText(text, ctx) {
      return scan(text, ctx, config);
    },

    async checkToolCall(call, ctx) {
      const { decision, text } = scan(call.function.arguments, ctx, config);
      return { decision, call: { ...call, function: { ...call.function, arguments: text } } };
    },
  };
}

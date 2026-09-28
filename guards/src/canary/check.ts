import { REASONS } from "../core/index.js";
import type { Decision, GuardContext, OutputGuard } from "../core/index.js";
import { generateCanary, getCanary } from "./inject.js";

export interface CanaryConfig {
  /** `block` terminates the response; `flag` strips the token and lets it continue. */
  onDetect: "block" | "flag";
}

const CANARY_LENGTH = generateCanary().length;
// Tail of the text already checked, kept on ctx.metadata between streamed segments.
const CARRY_KEY = "canaryCarry";

interface Scan {
  decision: Decision;
  text: string;
}

function leakDecision(action: "block" | "flag"): Decision {
  return {
    guard: "canary",
    action,
    reason: REASONS.CANARY_LEAKED,
    findings: [{ type: "CANARY_LEAK" }], // never the token itself
    latencyMs: 0, // overwritten by the pipeline runner
  };
}

function scan(text: string, ctx: GuardContext, config: CanaryConfig): Scan {
  const canary = getCanary(ctx);
  // Hex only after a fixed prefix, so the token needs no regex escaping.
  const pattern = canary ? new RegExp(canary, "gi") : null;
  if (!pattern || !pattern.test(text)) {
    return { decision: { guard: "canary", action: "allow", latencyMs: 0 }, text };
  }

  return {
    decision: leakDecision(config.onDetect),
    text: config.onDetect === "flag" ? text.replace(pattern, "") : text,
  };
}

// The holdback buffer cuts mid-token when a long run has no whitespace, so a canary can start in
// the previous segment. Its start is already sent and can't be stripped, so this always blocks.
function spansPreviousSegment(text: string, ctx: GuardContext, choice: number): boolean {
  const key = `${CARRY_KEY}:${choice}`; // per choice: with n > 1, choices' segments interleave
  const canary = getCanary(ctx);
  const carried = ctx.metadata[key];
  const carry = typeof carried === "string" ? carried : "";
  const window = carry + text;
  ctx.metadata[key] = window.slice(-(CANARY_LENGTH - 1));
  if (!canary || carry === "") return false;
  const at = window.toLowerCase().indexOf(canary.toLowerCase());
  return at !== -1 && at < carry.length;
}

export function createCanaryOutputGuard(config: CanaryConfig): OutputGuard {
  return {
    name: "canary",
    phase: "output",
    holdback: CANARY_LENGTH,

    async checkText(text, ctx, choice = 0) {
      if (spansPreviousSegment(text, ctx, choice)) return { decision: leakDecision("block"), text };
      return scan(text, ctx, config);
    },

    async checkToolCall(call, ctx) {
      const { decision, text } = scan(call.function.arguments, ctx, config);
      return { decision, call: { ...call, function: { ...call.function, arguments: text } } };
    },
  };
}

import { REASONS, matchGlob } from "../core/index.js";
import type { Decision, Finding, OutputGuard } from "../core/index.js";
import type { ToolPolicyConfig } from "./config.js";
import { constraintPasses } from "./constraints.js";

function decision(action: "allow" | "block", reason?: string, findings?: Finding[]): Decision {
  return {
    guard: "tool-policy",
    action,
    reason,
    findings,
    latencyMs: 0,
  };
}

export function createToolPolicyOutputGuard(config: ToolPolicyConfig): OutputGuard {
  const regexes = config.rules.map((rule) =>
    (rule.constraints ?? []).map((c) => (c.op === "regex" ? new RegExp(c.value) : undefined)),
  );

  return {
    name: "tool-policy",
    phase: "output",

    async checkToolCall(call) {
      const tool = call.function.name;

      let args: unknown;
      try {
        args = JSON.parse(call.function.arguments);
      } catch {
        return {
          decision: decision("block", REASONS.INVALID_TOOL_ARGUMENTS, [
            { type: "TOOL_POLICY", meta: { tool } },
          ]),
          call,
        };
      }

      const ruleIndex = config.rules.findIndex((r) => matchGlob(r.tool, tool));
      const rule = config.rules[ruleIndex];
      const action = rule?.action ?? config.default;
      const ruleMeta = ruleIndex === -1 ? null : ruleIndex;

      if (action === "deny") {
        return {
          decision: decision("block", rule?.reason ?? REASONS.TOOL_CALL_DENIED, [
            { type: "TOOL_POLICY", meta: { tool, rule: ruleMeta } },
          ]),
          call,
        };
      }

      const constraints = rule?.constraints ?? [];
      const failed = constraints.findIndex(
        (c, i) => !constraintPasses(c, args, regexes[ruleIndex]?.[i]),
      );
      if (failed !== -1) {
        const constraint = constraints[failed]!;
        return {
          decision: decision("block", rule?.reason ?? REASONS.TOOL_CONSTRAINT_VIOLATED, [
            {
              type: "TOOL_POLICY",
              meta: {
                tool,
                rule: ruleMeta,
                constraint: failed,
                path: constraint.path,
                op: constraint.op,
              },
            },
          ]),
          call,
        };
      }

      return { decision: decision("allow"), call };
    },
  };
}

import type { Decision, Finding, GuardContext, OutputGuard, ToolCall } from "@palang-ai/core";
import { detectPii } from "./detect.js";
import { getOrCreatePlaceholder } from "./vault.js";
import type { PiiIdConfig } from "./config.js";

const PLACEHOLDER_PATTERN = /\[[A-Z_]+_\d+\]/g;

// `OutputGuard.holdback` is fixed once on the guard object, before any request's vault exists, so
// it can't be computed from placeholder counts — this cap covers any realistic case.
const HOLDBACK = 32;

const METADATA_RESTORED_KEY = "piiRestoredPlaceholders";

function trackRestored(ctx: GuardContext, placeholder: string): void {
  let restored = ctx.metadata[METADATA_RESTORED_KEY] as Set<string> | undefined;
  if (!restored) {
    restored = new Set();
    ctx.metadata[METADATA_RESTORED_KEY] = restored;
  }
  restored.add(placeholder);
}

function restoreKnownPlaceholders(text: string, ctx: GuardContext, findings: Finding[]): string {
  return text.replace(PLACEHOLDER_PATTERN, (placeholder) => {
    const original = ctx.piiVault.get(placeholder);
    if (original === undefined) {
      findings.push({ type: "UNKNOWN_PLACEHOLDER", meta: { placeholder } });
      return placeholder;
    }
    trackRestored(ctx, placeholder);
    return original;
  });
}

// Flags PII in (already-restored) output text that wasn't a restored value — the model produced
// it itself — and optionally masks it too when `mask_new_output_pii` is on.
function flagOrMaskNewOutputPii(
  text: string,
  ctx: GuardContext,
  config: PiiIdConfig,
  findings: Finding[],
): string {
  const knownValues = new Set(ctx.piiVault.values());
  const entities = new Set<string>(config.entities);
  const matches = detectPii(text).filter((m) => entities.has(m.type));

  let result = "";
  let cursor = 0;
  let changed = false;

  for (const match of matches) {
    if (knownValues.has(match.normalized)) continue; // a restored value, not new

    findings.push({ type: "OUTPUT_PII", meta: { entityType: match.type } });
    if (config.maskNewOutputPii) {
      const placeholder = getOrCreatePlaceholder(ctx.piiVault, match.type, match.normalized);
      result += text.slice(cursor, match.start) + placeholder;
      cursor = match.end;
      changed = true;
    }
  }
  result += text.slice(cursor);
  return changed ? result : text;
}

function buildDecision(findings: Finding[]): Decision {
  return {
    guard: "pii-id",
    // Restoring known placeholders is the expected happy path (`allow`), not a `modify` in the
    // policy sense the way masking is — only an unexpected finding (unknown placeholder, new
    // output PII) is worth flagging.
    action: findings.length > 0 ? "flag" : "allow",
    findings,
    latencyMs: 0, // overwritten by the pipeline runner
  };
}

export function createPiiIdOutputGuard(config: PiiIdConfig): OutputGuard {
  return {
    name: "pii-id",
    phase: "output",
    holdback: HOLDBACK,

    async checkText(text: string, ctx: GuardContext) {
      const findings: Finding[] = [];
      let result = restoreKnownPlaceholders(text, ctx, findings);
      result = flagOrMaskNewOutputPii(result, ctx, config, findings);
      return { decision: buildDecision(findings), text: result };
    },

    async checkToolCall(call: ToolCall, ctx: GuardContext) {
      const findings: Finding[] = [];
      let args = restoreKnownPlaceholders(call.function.arguments, ctx, findings);
      args = flagOrMaskNewOutputPii(args, ctx, config, findings);
      return {
        decision: buildDecision(findings),
        call: { ...call, function: { ...call.function, arguments: args } },
      };
    },
  };
}

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

interface Span {
  start: number;
  end: number;
}

// One pass over the model's raw text: known placeholders are restored, and PII the model wrote
// out itself is flagged (optionally masked). Detecting on the raw text is what tells the two apart
// — placeholders aren't PII-shaped, and the model never saw the real values, so a raw value is a
// leak even when it equals one in the vault. A second pass would restore the masks right back.
function restoreAndScan(
  raw: string,
  ctx: GuardContext,
  config: PiiIdConfig,
  findings: Finding[],
): string {
  const placeholders: Span[] = [...raw.matchAll(PLACEHOLDER_PATTERN)].map((m) => ({
    start: m.index,
    end: m.index + m[0].length,
  }));
  const entities = new Set<string>(config.entities);
  const pii = detectPii(raw).filter(
    (m) => entities.has(m.type) && !placeholders.some((p) => m.start < p.end && p.start < m.end),
  );
  const spans = [
    ...placeholders.map((span) => ({ span, pii: undefined })),
    ...pii.map((match) => ({ span: match, pii: match })),
  ].sort((a, b) => a.span.start - b.span.start);

  let result = "";
  let cursor = 0;
  for (const { span, pii: match } of spans) {
    result += raw.slice(cursor, span.start);
    cursor = span.end;
    const original = raw.slice(span.start, span.end);

    if (match) {
      findings.push({ type: "OUTPUT_PII", meta: { entityType: match.type } });
      result += config.maskNewOutputPii
        ? getOrCreatePlaceholder(ctx.piiVault, match.type, match.normalized)
        : original;
      continue;
    }

    const value = ctx.piiVault.get(original);
    if (value === undefined) {
      findings.push({ type: "UNKNOWN_PLACEHOLDER", meta: { placeholder: original } });
      result += original;
    } else {
      trackRestored(ctx, original);
      result += value;
    }
  }
  return result + raw.slice(cursor);
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
      const result = restoreAndScan(text, ctx, config, findings);
      return { decision: buildDecision(findings), text: result };
    },

    async checkToolCall(call: ToolCall, ctx: GuardContext) {
      const findings: Finding[] = [];
      const args = restoreAndScan(call.function.arguments, ctx, config, findings);
      return {
        decision: buildDecision(findings),
        call: { ...call, function: { ...call.function, arguments: args } },
      };
    },
  };
}

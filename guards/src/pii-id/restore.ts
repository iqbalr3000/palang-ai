import { REASONS } from "../core/index.js";
import type { Decision, Finding, GuardContext, OutputGuard, ToolCall } from "../core/index.js";
import { detectPii } from "./detect.js";
import { getOrCreatePlaceholder } from "./vault.js";
import type { PiiIdConfig } from "./config.js";

const PLACEHOLDER_PATTERN = /\[[A-Z_]+_\d+\]/g;

const HOLDBACK = 32;

const RESTORED_KEY = "piiRestoredPlaceholders";
const CARRY_KEY = "piiCarry";
const CARRY_LENGTH = 128;

export function getRestoredPlaceholders(ctx: GuardContext): ReadonlySet<string> {
  return (ctx.metadata[RESTORED_KEY] as Set<string> | undefined) ?? new Set();
}

function trackRestored(ctx: GuardContext, placeholder: string): void {
  let restored = ctx.metadata[RESTORED_KEY] as Set<string> | undefined;
  if (!restored) {
    restored = new Set();
    ctx.metadata[RESTORED_KEY] = restored;
  }
  restored.add(placeholder);
}

interface Span {
  start: number;
  end: number;
}

// One pass: a second would restore freshly masked output right back. Raw PII here is a leak
// even if it's in the vault, since the model never saw real values.
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

// PII may start in the already-sent previous segment; if it needed masking, block instead.
function scanAcrossSegments(
  raw: string,
  ctx: GuardContext,
  config: PiiIdConfig,
  findings: Finding[],
  choice: number,
): boolean {
  const key = `${CARRY_KEY}:${choice}`;
  const carried = ctx.metadata[key];
  const carry = typeof carried === "string" ? carried : "";
  const window = carry + raw;
  ctx.metadata[key] = window.slice(-CARRY_LENGTH);
  if (carry === "") return false;

  const entities = new Set<string>(config.entities);
  const crossing = detectPii(window).filter(
    (m) => entities.has(m.type) && m.start < carry.length && m.end > carry.length,
  );
  for (const match of crossing) {
    findings.push({ type: "OUTPUT_PII", meta: { entityType: match.type } });
  }
  return crossing.length > 0 && config.maskNewOutputPii;
}

function buildDecision(findings: Finding[], block = false): Decision {
  if (block) {
    return {
      guard: "pii-id",
      action: "block",
      reason: REASONS.OUTPUT_PII_DETECTED,
      findings,
      latencyMs: 0,
    };
  }
  return {
    guard: "pii-id",
    action: findings.length > 0 ? "flag" : "allow",
    findings,
    latencyMs: 0,
  };
}

export function createPiiIdOutputGuard(config: PiiIdConfig): OutputGuard {
  return {
    name: "pii-id",
    phase: "output",
    holdback: HOLDBACK,

    async checkText(text: string, ctx: GuardContext, choice = 0) {
      const findings: Finding[] = [];
      const block = scanAcrossSegments(text, ctx, config, findings, choice);
      const result = restoreAndScan(text, ctx, config, findings);
      return { decision: buildDecision(findings, block), text: result };
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

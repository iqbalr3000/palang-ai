import { REASONS } from "../core/index.js";
import type { Decision, Finding, GuardContext, OutputGuard, ToolCall } from "../core/index.js";
import { NPWP_KEYWORD_WINDOW, detectPii } from "./detect.js";
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
// `context` is earlier stream text: detection needs it (e.g. an NPWP keyword), but only matches
// starting in `raw` are handled here.
function restoreAndScan(
  raw: string,
  ctx: GuardContext,
  config: PiiIdConfig,
  findings: Finding[],
  context = "",
): string {
  const placeholders: Span[] = [...raw.matchAll(PLACEHOLDER_PATTERN)].map((m) => ({
    start: m.index,
    end: m.index + m[0].length,
  }));
  const entities = new Set<string>(config.entities);
  const pii = detectPii(context + raw)
    .filter((m) => m.start >= context.length)
    .map((m) => ({ ...m, start: m.start - context.length, end: m.end - context.length }))
    .filter(
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
function takeCarry(raw: string, ctx: GuardContext, choice: number): string {
  const key = `${CARRY_KEY}:${choice}`;
  const carried = ctx.metadata[key];
  const carry = typeof carried === "string" ? carried : "";
  ctx.metadata[key] = (carry + raw).slice(-CARRY_LENGTH);
  return carry;
}

function scanAcrossSegments(
  raw: string,
  carry: string,
  config: PiiIdConfig,
  findings: Finding[],
): boolean {
  if (carry === "") return false;
  const window = carry + raw;

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
      const carry = takeCarry(text, ctx, choice);
      const block = scanAcrossSegments(text, carry, config, findings);
      const context = carry.slice(-NPWP_KEYWORD_WINDOW);
      const result = restoreAndScan(text, ctx, config, findings, context);
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

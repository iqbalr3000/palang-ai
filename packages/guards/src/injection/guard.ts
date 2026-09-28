import { REASONS } from "@palang-ai/core";
import type { Decision, Finding, GuardContext, InputGuard } from "@palang-ai/core";
import type { InjectionClassifier } from "./classifier.js";
import type { InjectionConfig } from "./config.js";
import { scanInjectionHeuristics } from "./heuristics.js";

export interface InjectionScore {
  score: number;
  l1: number;
  l2: number | null;
  patterns: string[];
  decoded: boolean;
}

export interface ScoreOptions {
  classifier?: InjectionClassifier;
  blockThreshold: number;
  signal?: AbortSignal;
}

/** score = max(L1, L2). L2 is skipped when L1 alone already reaches the block threshold. */
export async function scoreInjection(text: string, options: ScoreOptions): Promise<InjectionScore> {
  const heuristics = scanInjectionHeuristics(text);
  const patterns = [...new Set(heuristics.matches.map((m) => m.id))];
  const decoded = heuristics.matches.some((m) => m.decoded);

  let l2: number | null = null;
  if (options.classifier && heuristics.score < options.blockThreshold) {
    l2 = await options.classifier.classify(text, options.signal);
  }
  return {
    score: Math.max(heuristics.score, l2 ?? 0),
    l1: heuristics.score,
    l2,
    patterns,
    decoded,
  };
}

export function createInjectionInputGuard(
  config: InjectionConfig,
  classifier?: InjectionClassifier,
): InputGuard {
  return {
    name: "injection",
    phase: "input",
    async check(ctx: GuardContext): Promise<Decision> {
      const findings: Finding[] = [];
      let worst = 0;

      for (let i = 0; i < ctx.messages.length; i++) {
        const message = ctx.messages[i]!;
        if (!config.roles.includes(message.role) || !message.content) continue;

        const result = await scoreInjection(message.content, {
          classifier,
          blockThreshold: config.blockThreshold,
          signal: ctx.signal,
        });
        worst = Math.max(worst, result.score);

        if (result.score >= config.flagThreshold) {
          findings.push({
            type: "INJECTION",
            messageIndex: i,
            meta: {
              score: result.score,
              l1: result.l1,
              l2: result.l2,
              patterns: result.patterns,
              decoded: result.decoded,
            },
          });
        }
        if (result.score >= config.blockThreshold) break;
      }

      const action =
        worst >= config.blockThreshold ? "block" : worst >= config.flagThreshold ? "flag" : "allow";
      return {
        guard: "injection",
        action,
        reason: action === "allow" ? undefined : REASONS.PROMPT_INJECTION_DETECTED,
        score: worst,
        findings,
        latencyMs: 0, // overwritten by the pipeline runner
      };
    },
  };
}

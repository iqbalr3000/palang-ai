import { INJECTION_PATTERNS } from "./data/patterns.js";
import { normalizeForInjectionScan } from "./normalize.js";
import type { InjectionHeuristicMatch, InjectionHeuristicResult } from "./types.js";

// Noisy-OR: weak signals add up toward 1 without exceeding it.
function combine(weights: number[]): number {
  return 1 - weights.reduce((remaining, w) => remaining * (1 - w), 1);
}

export function scanInjectionHeuristics(text: string): InjectionHeuristicResult {
  const targets = normalizeForInjectionScan(text);
  const matches: InjectionHeuristicMatch[] = [];
  let score = 0;

  targets.forEach((target, index) => {
    const found = INJECTION_PATTERNS.filter((p) => p.regex.test(target));
    score = Math.max(score, combine(found.map((p) => p.weight)));
    for (const p of found) {
      matches.push({ id: p.id, lang: p.lang, weight: p.weight, decoded: index > 0 });
    }
  });

  return { score, matches };
}

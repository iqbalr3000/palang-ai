export interface Confusion {
  tp: number;
  fp: number;
  tn: number;
  fn: number;
}

export interface Metrics extends Confusion {
  n: number;
  precision: number | null;
  recall: number | null;
  fpr: number | null;
  f1: number | null;
}

export function emptyConfusion(): Confusion {
  return { tp: 0, fp: 0, tn: 0, fn: 0 };
}

export function addOutcome(c: Confusion, isInjection: boolean, predictedInjection: boolean): void {
  if (isInjection) {
    if (predictedInjection) c.tp += 1;
    else c.fn += 1;
  } else if (predictedInjection) c.fp += 1;
  else c.tn += 1;
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

export function summarize(c: Confusion): Metrics {
  const precision = ratio(c.tp, c.tp + c.fp);
  const recall = ratio(c.tp, c.tp + c.fn);
  const f1 =
    precision === null || recall === null || precision + recall === 0
      ? null
      : (2 * precision * recall) / (precision + recall);
  return {
    ...c,
    n: c.tp + c.fp + c.tn + c.fn,
    precision,
    recall,
    fpr: ratio(c.fp, c.fp + c.tn),
    f1,
  };
}

/** Nearest-rank percentile; `p` in 0..100. */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1] ?? 0;
}

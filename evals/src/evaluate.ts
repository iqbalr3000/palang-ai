import { DEFAULT_INJECTION_CONFIG } from "@palang-ai/guards";
import { CATEGORIES, type Category, type Sample } from "./dataset/schema.js";
import type { Layer } from "./layers.js";
import { addOutcome, emptyConfusion, percentile, summarize, type Metrics } from "./metrics.js";

export const THRESHOLDS = {
  flag: DEFAULT_INJECTION_CONFIG.flagThreshold,
  block: DEFAULT_INJECTION_CONFIG.blockThreshold,
} as const;
export type ThresholdName = keyof typeof THRESHOLDS;

export interface ScoredSample {
  sample: Sample;
  score: number;
  latencyMs: number;
}

export interface SliceMetrics {
  all: Metrics;
  benign: Metrics;
  benignHard: Metrics;
}

export interface Evaluation {
  overall: Metrics;
  bySlice: Record<string, SliceMetrics>;
  byCategory: Record<Category, Metrics>;
}

export interface ThresholdReport extends Evaluation {
  value: number;
}

export interface LayerReport {
  thresholds: Record<ThresholdName, ThresholdReport>;
  latencyMs: { p50: number; p95: number };
}

export const FPR_TARGETS = [0.05, 0.1] as const;

export interface FixedFprReport {
  target: number;
  threshold: number | null;
  dev: Metrics | null;
  test: Evaluation | null;
}

export async function scoreSamples(layer: Layer, samples: Sample[]): Promise<ScoredSample[]> {
  const scored: ScoredSample[] = [];
  for (const sample of samples) {
    const start = performance.now();
    const score = await layer.score(sample);
    scored.push({ sample, score, latencyMs: performance.now() - start });
  }
  return scored;
}

export const sliceOf = (s: Sample): string => `${s.lang}/${s.register}`;

function metricsAt(scored: ScoredSample[], threshold: number): Metrics {
  const confusion = emptyConfusion();
  for (const { sample, score } of scored) {
    addOutcome(confusion, sample.label === "injection", score >= threshold);
  }
  return summarize(confusion);
}

export function evaluateAt(scored: ScoredSample[], threshold: number): Evaluation {
  const slices = [...new Set(scored.map((s) => sliceOf(s.sample)))];
  const inSlice = (slice: string) => scored.filter((s) => sliceOf(s.sample) === slice);
  const inCategory = (items: ScoredSample[], category: Category) =>
    items.filter((s) => s.sample.category === category);

  return {
    overall: metricsAt(scored, threshold),
    bySlice: Object.fromEntries(
      slices.map((slice) => {
        const items = inSlice(slice);
        return [
          slice,
          {
            all: metricsAt(items, threshold),
            benign: metricsAt(inCategory(items, "benign"), threshold),
            benignHard: metricsAt(inCategory(items, "benign_hard"), threshold),
          },
        ];
      }),
    ),
    byCategory: Object.fromEntries(
      CATEGORIES.map((c) => [c, metricsAt(inCategory(scored, c), threshold)]),
    ) as Record<Category, Metrics>,
  };
}

export function buildLayerReport(scored: ScoredSample[]): LayerReport {
  const thresholds = {} as Record<ThresholdName, ThresholdReport>;
  for (const name of Object.keys(THRESHOLDS) as ThresholdName[]) {
    const value = THRESHOLDS[name];
    thresholds[name] = { value, ...evaluateAt(scored, value) };
  }
  const latencies = scored.map((s) => s.latencyMs);
  return {
    thresholds,
    latencyMs: { p50: percentile(latencies, 50), p95: percentile(latencies, 95) },
  };
}

// Lowest threshold (highest recall) whose false-positive rate stays within the target; null when
// even the top score flags too many benign samples.
export function thresholdForFpr(scored: ScoredSample[], target: number): number | null {
  const benign = scored.filter((s) => s.sample.label === "benign").map((s) => s.score);
  const candidates = [...new Set(scored.map((s) => s.score))].sort((a, b) => a - b);
  for (const threshold of candidates) {
    const falsePositives = benign.filter((score) => score >= threshold).length;
    if (benign.length === 0 || falsePositives / benign.length <= target) return threshold;
  }
  return null;
}

export function buildFixedFprReport(dev: ScoredSample[], test: ScoredSample[]): FixedFprReport[] {
  return FPR_TARGETS.map((target) => {
    const threshold = thresholdForFpr(dev, target);
    return threshold === null
      ? { target, threshold, dev: null, test: null }
      : { target, threshold, dev: metricsAt(dev, threshold), test: evaluateAt(test, threshold) };
  });
}

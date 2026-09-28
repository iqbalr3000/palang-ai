import { CATEGORIES, LANGS, type Category, type Lang, type Sample } from "./dataset/schema.js";
import type { Layer } from "./layers.js";
import {
  addOutcome,
  emptyConfusion,
  percentile,
  summarize,
  type Confusion,
  type Metrics,
} from "./metrics.js";

export const THRESHOLDS = { flag: 0.5, block: 0.85 } as const;
export type ThresholdName = keyof typeof THRESHOLDS;

export interface ScoredSample {
  sample: Sample;
  score: number;
  latencyMs: number;
}

export interface ThresholdReport {
  value: number;
  overall: Metrics;
  byLang: Record<Lang, Metrics>;
  byCategory: Record<Category, Metrics>;
}

export interface LayerReport {
  thresholds: Record<ThresholdName, ThresholdReport>;
  latencyMs: { p50: number; p95: number };
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

function byKey<K extends string>(
  keys: readonly K[],
  scored: ScoredSample[],
  value: number,
  pick: (s: Sample) => K,
): Record<K, Metrics> {
  const confusions = Object.fromEntries(keys.map((k) => [k, emptyConfusion()])) as Record<
    K,
    Confusion
  >;
  for (const { sample, score } of scored) {
    addOutcome(confusions[pick(sample)], sample.label === "injection", score >= value);
  }
  return Object.fromEntries(keys.map((k) => [k, summarize(confusions[k])])) as Record<K, Metrics>;
}

export function buildLayerReport(scored: ScoredSample[]): LayerReport {
  const thresholds = {} as Record<ThresholdName, ThresholdReport>;
  for (const name of Object.keys(THRESHOLDS) as ThresholdName[]) {
    const value = THRESHOLDS[name];
    const overall = emptyConfusion();
    for (const { sample, score } of scored) {
      addOutcome(overall, sample.label === "injection", score >= value);
    }
    thresholds[name] = {
      value,
      overall: summarize(overall),
      byLang: byKey(LANGS, scored, value, (s) => s.lang),
      byCategory: byKey(CATEGORIES, scored, value, (s) => s.category),
    };
  }
  const latencies = scored.map((s) => s.latencyMs);
  return {
    thresholds,
    latencyMs: { p50: percentile(latencies, 50), p95: percentile(latencies, 95) },
  };
}

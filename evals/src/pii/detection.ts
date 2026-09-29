import { PII_TYPES, type PiiSample, type PiiSpan, type PiiType } from "../dataset/pii-schema.js";
import { percentile } from "../metrics.js";

export interface SpanMetrics {
  tp: number;
  fp: number;
  fn: number;
  precision: number | null;
  recall: number | null;
  f1: number | null;
}

export type SpanMetricsByType = Record<PiiType | "overall", SpanMetrics>;

export interface DetectionReport {
  supported: SpanMetricsByType;
  withUnsupported: SpanMetricsByType;
  hardNegatives: { samples: number; withAnyDetection: number; byType: Record<PiiType, number> };
  latencyMs: { p50: number; p95: number };
}

type Detect = (text: string) => PiiSpan[];

interface Detected {
  sample: PiiSample;
  predicted: PiiSpan[];
}

const key = (span: PiiSpan): string => `${span.type}:${span.start}:${span.end}`;

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

function finish(counts: { tp: number; fp: number; fn: number }): SpanMetrics {
  const precision = ratio(counts.tp, counts.tp + counts.fp);
  const recall = ratio(counts.tp, counts.tp + counts.fn);
  const f1 =
    precision === null || recall === null || precision + recall === 0
      ? null
      : (2 * precision * recall) / (precision + recall);
  return { ...counts, precision, recall, f1 };
}

function tally(items: Detected[]): SpanMetricsByType {
  const counts = Object.fromEntries(
    [...PII_TYPES, "overall"].map((t) => [t, { tp: 0, fp: 0, fn: 0 }]),
  ) as Record<PiiType | "overall", { tp: number; fp: number; fn: number }>;

  function add(type: PiiType, outcome: "tp" | "fp" | "fn"): void {
    counts[type][outcome] += 1;
    counts.overall[outcome] += 1;
  }

  for (const { sample, predicted } of items) {
    const gold = new Set(sample.spans.map(key));
    const found = new Set(predicted.map(key));
    for (const span of predicted) add(span.type, gold.has(key(span)) ? "tp" : "fp");
    for (const span of sample.spans) if (!found.has(key(span))) add(span.type, "fn");
  }

  return Object.fromEntries(
    Object.entries(counts).map(([type, c]) => [type, finish(c)]),
  ) as SpanMetricsByType;
}

export function evaluateDetection(samples: PiiSample[], detect: Detect): DetectionReport {
  const latencies: number[] = [];
  const detected: Detected[] = samples.map((sample) => {
    const start = performance.now();
    const predicted = detect(sample.text).map(({ type, start, end }) => ({ type, start, end }));
    latencies.push(performance.now() - start);
    return { sample, predicted };
  });

  const hardNegatives = detected.filter((d) => d.sample.category === "hard_negative");
  const byType = Object.fromEntries(PII_TYPES.map((t) => [t, 0])) as Record<PiiType, number>;
  for (const { predicted } of hardNegatives) for (const span of predicted) byType[span.type] += 1;

  return {
    supported: tally(detected.filter((d) => d.sample.category !== "unsupported_format")),
    withUnsupported: tally(detected),
    hardNegatives: {
      samples: hardNegatives.length,
      withAnyDetection: hardNegatives.filter((d) => d.predicted.length > 0).length,
      byType,
    },
    latencyMs: { p50: percentile(latencies, 50), p95: percentile(latencies, 95) },
  };
}

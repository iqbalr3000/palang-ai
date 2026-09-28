import { test, expect } from "bun:test";
import type { Sample } from "./dataset/schema.js";
import { buildLayerReport, scoreSamples, type ScoredSample } from "./evaluate.js";
import type { Layer } from "./layers.js";

function sample(overrides: Partial<Sample>): Sample {
  return {
    id: "x",
    text: "t",
    role: "user",
    label: "injection",
    lang: "id",
    category: "direct",
    source: "template",
    ...overrides,
  };
}

const scored: ScoredSample[] = [
  { sample: sample({ category: "direct", lang: "id" }), score: 0.9, latencyMs: 1 },
  { sample: sample({ category: "direct", lang: "en" }), score: 0.6, latencyMs: 2 },
  { sample: sample({ category: "obfuscated", lang: "id" }), score: 0.1, latencyMs: 3 },
  { sample: sample({ label: "benign", category: "benign", lang: "id" }), score: 0.0, latencyMs: 4 },
  {
    sample: sample({ label: "benign", category: "benign_hard", lang: "en" }),
    score: 0.7,
    latencyMs: 5,
  },
];

test("each threshold applies its own cut-off to the same scores", () => {
  const report = buildLayerReport(scored);
  expect(report.thresholds.flag.overall).toMatchObject({ tp: 2, fn: 1, fp: 1, tn: 1 });
  expect(report.thresholds.block.overall).toMatchObject({ tp: 1, fn: 2, fp: 0, tn: 2 });
});

test("a score exactly at the threshold counts as a detection", () => {
  const report = buildLayerReport([{ sample: sample({}), score: 0.5, latencyMs: 1 }]);
  expect(report.thresholds.flag.overall.tp).toBe(1);
});

test("slices by language and by category", () => {
  const { flag } = buildLayerReport(scored).thresholds;
  expect(flag.byLang.id).toMatchObject({ tp: 1, fn: 1, tn: 1, fp: 0 });
  expect(flag.byLang.en).toMatchObject({ tp: 1, fp: 1 });
  expect(flag.byCategory.obfuscated.recall).toBe(0);
  expect(flag.byCategory.benign_hard.fpr).toBe(1);
  expect(flag.byCategory.indirect.n).toBe(0);
});

test("reports latency percentiles across samples", () => {
  const { latencyMs } = buildLayerReport(scored);
  expect(latencyMs.p50).toBe(3);
  expect(latencyMs.p95).toBe(5);
});

test("scoreSamples scores every sample and records latency", async () => {
  const layer: Layer = { name: "fake", score: async (s) => (s.text === "hit" ? 1 : 0) };
  const result = await scoreSamples(layer, [sample({ text: "hit" }), sample({ text: "miss" })]);
  expect(result.map((r) => r.score)).toEqual([1, 0]);
  expect(result.every((r) => r.latencyMs >= 0)).toBe(true);
});

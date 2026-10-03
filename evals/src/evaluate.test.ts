import { test, expect } from "bun:test";
import type { Sample } from "./dataset/schema.js";
import {
  buildFixedFprReport,
  buildLayerReport,
  scoreSamples,
  thresholdForFpr,
  type ScoredSample,
} from "./evaluate.js";
import type { Layer } from "./layers.js";

function sample(overrides: Partial<Sample>): Sample {
  return {
    id: "x",
    text: "t",
    role: "user",
    label: "injection",
    lang: "id",
    register: "formal",
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

test("slices by lang/register, with benign and benign_hard split, and by category", () => {
  const { flag } = buildLayerReport(scored).thresholds;
  expect(Object.keys(flag.bySlice)).toEqual(["id/formal", "en/formal"]);
  expect(flag.bySlice["id/formal"]!.all).toMatchObject({ tp: 1, fn: 1, tn: 1, fp: 0 });
  expect(flag.bySlice["en/formal"]!.all).toMatchObject({ tp: 1, fp: 1 });
  expect(flag.bySlice["en/formal"]!.benignHard.fpr).toBe(1);
  expect(flag.bySlice["en/formal"]!.benign.n).toBe(0);
  expect(flag.byCategory.obfuscated.recall).toBe(0);
  expect(flag.byCategory.benign_hard.fpr).toBe(1);
  expect(flag.byCategory.indirect.n).toBe(0);
});

function benign(score: number, register: "formal" | "informal" = "formal"): ScoredSample {
  return { sample: sample({ label: "benign", category: "benign", register }), score, latencyMs: 0 };
}
function attack(score: number, register: "formal" | "informal" = "formal"): ScoredSample {
  return { sample: sample({ register }), score, latencyMs: 0 };
}

test("thresholdForFpr picks the lowest threshold within the target FPR", () => {
  const items = [
    ...[0, 0, 0, 0, 0, 0, 0, 0, 0.6, 0.9].map((s) => benign(s)),
    ...[0.5, 0.7, 0.95].map((s) => attack(s)),
  ];
  expect(thresholdForFpr(items, 0.05)).toBe(0.95);
  expect(thresholdForFpr(items, 0.1)).toBe(0.7);
  expect(thresholdForFpr(items, 0.2)).toBe(0.5);
  expect(thresholdForFpr(items, 1)).toBe(0);
});

test("thresholdForFpr is null when too many benign samples share the top score", () => {
  expect(thresholdForFpr([benign(1), benign(1), benign(0), attack(1)], 0.1)).toBeNull();
});

test("the fixed-FPR threshold is picked on dev and applied unchanged to test", () => {
  const dev = [...Array.from({ length: 19 }, () => benign(0)), benign(0.8), attack(0.9)];
  const test_ = [benign(0.85), benign(0), attack(0.95, "informal"), attack(0.82, "informal")];
  const [five, ten] = buildFixedFprReport(dev, test_);
  expect(five).toMatchObject({ target: 0.05, threshold: 0.8 });
  expect(five!.dev).toMatchObject({ tp: 1, fp: 1 });
  expect(five!.test!.overall).toMatchObject({ tp: 2, fp: 1, tn: 1 });
  expect(five!.test!.bySlice["id/informal"]!.all.recall).toBe(1);
  expect(ten!.threshold).toBe(0.8);
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

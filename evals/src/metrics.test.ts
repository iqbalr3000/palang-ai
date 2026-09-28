import { test, expect } from "bun:test";
import { addOutcome, emptyConfusion, percentile, summarize } from "./metrics.js";

test("addOutcome fills the four confusion cells", () => {
  const c = emptyConfusion();
  addOutcome(c, true, true);
  addOutcome(c, true, false);
  addOutcome(c, false, true);
  addOutcome(c, false, false);
  addOutcome(c, false, false);
  expect(c).toEqual({ tp: 1, fn: 1, fp: 1, tn: 2 });
});

test("summarize computes precision, recall, FPR and F1", () => {
  const m = summarize({ tp: 8, fp: 2, tn: 18, fn: 2 });
  expect(m.n).toBe(30);
  expect(m.precision).toBeCloseTo(0.8);
  expect(m.recall).toBeCloseTo(0.8);
  expect(m.fpr).toBeCloseTo(0.1);
  expect(m.f1).toBeCloseTo(0.8);
});

test("summarize returns null, not NaN, when a denominator is zero", () => {
  const onlyBenign = summarize({ tp: 0, fp: 0, tn: 5, fn: 0 });
  expect(onlyBenign.precision).toBeNull();
  expect(onlyBenign.recall).toBeNull();
  expect(onlyBenign.f1).toBeNull();
  expect(onlyBenign.fpr).toBe(0);

  const onlyInjection = summarize({ tp: 3, fp: 0, tn: 0, fn: 1 });
  expect(onlyInjection.fpr).toBeNull();
  expect(onlyInjection.recall).toBeCloseTo(0.75);
});

test("percentile uses nearest-rank and handles small or empty inputs", () => {
  const values = [5, 1, 4, 2, 3, 10, 9, 8, 7, 6];
  expect(percentile(values, 50)).toBe(5);
  expect(percentile(values, 95)).toBe(10);
  expect(percentile([42], 95)).toBe(42);
  expect(percentile([], 95)).toBe(0);
});

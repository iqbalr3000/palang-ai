import { expect, test } from "bun:test";
import type { PiiSample, PiiSpan } from "../dataset/pii-schema.js";
import { evaluateDetection } from "./detection.js";

// Each sample's text starts with its id, so the fake detector can look predictions up by it.
function sample(id: string, category: PiiSample["category"], spans: PiiSpan[]): PiiSample {
  return { id, text: `${id} `.padEnd(100, "x"), spans, category };
}

function detector(predictions: Record<string, PiiSpan[]>) {
  return (text: string): PiiSpan[] => predictions[text.split(" ")[0]!] ?? [];
}

test("a span counts only on an exact type + start + end match", () => {
  const d = detector({
    a: [
      { type: "NIK", start: 0, end: 16 },
      { type: "PHONE_ID", start: 20, end: 31 },
      { type: "CARD", start: 40, end: 56 },
    ],
  });
  const samples = [
    sample("a", "positive", [
      { type: "NIK", start: 0, end: 16 },
      { type: "PHONE_ID", start: 20, end: 32 },
      { type: "NPWP", start: 40, end: 56 },
    ]),
  ];

  const report = evaluateDetection(samples, d);

  expect(report.supported.NIK).toMatchObject({ tp: 1, fp: 0, fn: 0, precision: 1, recall: 1 });
  expect(report.supported.PHONE_ID).toMatchObject({ tp: 0, fp: 1, fn: 1 });
  expect(report.supported.NPWP).toMatchObject({ tp: 0, fp: 0, fn: 1, precision: null });
  expect(report.supported.CARD).toMatchObject({ tp: 0, fp: 1, fn: 0, recall: null });
  expect(report.supported.overall).toMatchObject({ tp: 1, fp: 2, fn: 2 });
});

test("unsupported formats and unlabeled samples count only in their own views", () => {
  const d = detector({ c: [{ type: "NPWP", start: 0, end: 15 }] });
  const samples = [
    sample("a", "positive", [{ type: "EMAIL", start: 0, end: 10 }]),
    sample("b", "unsupported_format", [{ type: "EMAIL", start: 0, end: 10 }]),
    sample("c", "unlabeled", [{ type: "NPWP", start: 0, end: 15 }]),
    sample("d", "unlabeled", [{ type: "NPWP", start: 0, end: 15 }]),
  ];

  const report = evaluateDetection(samples, d);

  expect(report.supported.EMAIL.fn).toBe(1);
  expect(report.supported.NPWP).toMatchObject({ tp: 0, fn: 0 });
  expect(report.unlabeled.NPWP).toMatchObject({ tp: 1, fn: 1, recall: 0.5 });
  expect(report.all.EMAIL.fn).toBe(2);
  expect(report.all.NPWP).toMatchObject({ tp: 1, fn: 1 });
});

test("hard negatives: any detection is a false positive, counted per sample and per type", () => {
  const d = detector({
    a: [{ type: "CARD", start: 0, end: 16 }],
    b: [
      { type: "NIK", start: 0, end: 16 },
      { type: "NPWP", start: 20, end: 35 },
    ],
  });
  const samples = [
    sample("a", "hard_negative", []),
    sample("b", "hard_negative", []),
    sample("c", "hard_negative", []),
  ];

  const report = evaluateDetection(samples, d);

  expect(report.hardNegatives).toEqual({
    samples: 3,
    withAnyDetection: 2,
    byType: { NIK: 1, NPWP: 1, PHONE_ID: 0, EMAIL: 0, CARD: 1 },
  });
  expect(report.supported.CARD.fp).toBe(1);
});

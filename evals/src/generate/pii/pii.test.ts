import { expect, test } from "bun:test";
import { PII_TYPES, parsePiiJsonl, type PiiSample } from "../../dataset/pii-schema.js";
import { PII_DATASET_PATH, toJsonl } from "../write.js";
import { PII_COUNTS, generatePiiDataset } from "./index.js";
import { luhnValid } from "./values.js";

const dataset = generatePiiDataset();

function spanTexts(samples: PiiSample[], type: string): string[] {
  return samples.flatMap((s) =>
    s.spans.filter((span) => span.type === type).map((span) => s.text.slice(span.start, span.end)),
  );
}

test("meets TSD §11.1's ≥ 500 PII samples, with the agreed category counts", () => {
  expect(dataset.length).toBeGreaterThanOrEqual(500);
  for (const [category, count] of Object.entries(PII_COUNTS)) {
    expect(dataset.filter((s) => s.category === category)).toHaveLength(count);
  }
});

test("every sample passes the dataset schema (spans in bounds, sorted, non-overlapping)", () => {
  expect(parsePiiJsonl(toJsonl(dataset))).toEqual(dataset);
});

test("every entity type is well represented among positives", () => {
  const positives = dataset.filter((s) => s.category === "positive");
  for (const type of PII_TYPES) {
    expect(spanTexts(positives, type).length).toBeGreaterThanOrEqual(80);
  }
});

test("supported-format gold spans have the shape their type requires", () => {
  const positives = dataset.filter((s) => s.category === "positive");
  for (const text of spanTexts(positives, "NIK")) expect(text).toMatch(/^\d{16}$/);
  for (const text of spanTexts(positives, "NPWP")) {
    expect(text.replace(/[.-]/g, "")).toMatch(/^0?\d{15}$/);
  }
  for (const text of spanTexts(positives, "PHONE_ID")) {
    expect(text.replace(/[\s.()-]/g, "")).toMatch(/^(?:\+62|62|0)8\d{8,11}$/);
  }
  for (const text of spanTexts(positives, "EMAIL")) expect(text).toMatch(/@example\.(com|org)$/);
  for (const text of spanTexts(positives, "CARD")) {
    expect(luhnValid(text.replace(/[ -]/g, ""))).toBe(true);
  }
});

test("unlabeled samples hold one plain NPWP and no NPWP keyword", () => {
  for (const s of dataset.filter((x) => x.category === "unlabeled")) {
    expect(s.spans.map((span) => span.type)).toEqual(["NPWP"]);
    expect(spanTexts([s], "NPWP")[0]).toMatch(/^0?\d{15}$/);
    expect(s.text).not.toMatch(/npwp|pajak|tax/i);
  }
});

test("hard negatives contain no email addresses (the only PII shape without digits)", () => {
  for (const s of dataset.filter((x) => x.category === "hard_negative")) {
    expect(s.text).not.toContain("@");
  }
});

test("generation is deterministic", () => {
  expect(generatePiiDataset()).toEqual(dataset);
});

test("committed dataset matches the generator (re-run `bun run generate` if this fails)", async () => {
  expect(await Bun.file(PII_DATASET_PATH).text()).toBe(toJsonl(dataset));
});

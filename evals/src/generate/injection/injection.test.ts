import { test, expect } from "bun:test";
import { SPLITS, CATEGORIES, parseJsonl, sampleSchema } from "../../dataset/schema.js";
import { datasetPath, toJsonl } from "../write.js";

import { SLICES, generateInjectionDataset, generateInjectionSamples } from "./index.js";

const slice = (key: string) => SLICES.find((s) => s.key === key)!;

test("generates the configured number of samples per slice, split and category", () => {
  for (const s of SLICES) {
    for (const split of SPLITS) {
      const samples = generateInjectionSamples(s, split);
      for (const category of CATEGORIES) {
        const actual = samples.filter((x) => x.category === category).length;
        expect(actual).toBe(s.counts[split][category]);
      }
      expect(samples.every((x) => x.lang === s.lang && x.register === s.register)).toBe(true);
    }
  }
});

test("formal Indonesian totals reach at least 300 injection and 300 benign samples", () => {
  const id = SPLITS.flatMap((split) => generateInjectionSamples(slice("id"), split));
  expect(id.filter((s) => s.label === "injection").length).toBeGreaterThanOrEqual(300);
  expect(id.filter((s) => s.label === "benign").length).toBeGreaterThanOrEqual(300);
});

test("every sample is valid, ids are unique, and labels match categories", () => {
  const all = SPLITS.flatMap((split) => generateInjectionDataset(split));
  for (const s of all) sampleSchema.parse(s);
  expect(new Set(all.map((s) => s.id)).size).toBe(all.length);
});

test("no text appears twice in a split, or in both dev and test", () => {
  const dev = generateInjectionDataset("dev").map((s) => s.text);
  const test_ = generateInjectionDataset("test").map((s) => s.text);
  expect(new Set(dev).size).toBe(dev.length);
  expect(new Set(test_).size).toBe(test_.length);
  const devSet = new Set(dev);
  expect(test_.filter((t) => devSet.has(t))).toEqual([]);
});

test("indirect samples are tool output; direct and obfuscated are user input", () => {
  const all = SPLITS.flatMap((split) => generateInjectionDataset(split));
  for (const s of all.filter((x) => x.category === "indirect")) expect(s.role).toBe("tool");
  for (const s of all.filter((x) => x.category === "direct" || x.category === "obfuscated")) {
    expect(s.role).toBe("user");
  }
  expect(all.some((s) => s.label === "benign" && s.role === "tool")).toBe(true);
});

test("generation is deterministic", () => {
  expect(generateInjectionDataset("test")).toEqual(generateInjectionDataset("test"));
});

test("dataset files are ASCII-only so obfuscated samples stay reviewable", () => {
  const jsonl = toJsonl(generateInjectionDataset("dev"));
  expect(/\P{ASCII}/u.test(jsonl)).toBe(false);
  expect(parseJsonl(jsonl)).toEqual(generateInjectionDataset("dev"));
});

test("non-BMP characters (tag characters) survive the ASCII escaping round trip", () => {
  const text = `hi${String.fromCodePoint(0xe0061)}${String.fromCodePoint(0x1f600)}there`;
  const sample = { ...generateInjectionSamples(slice("en"), "dev")[0]!, text };
  const jsonl = toJsonl([sample]);
  expect(/\P{ASCII}/u.test(jsonl)).toBe(false);
  expect(parseJsonl(jsonl)[0]?.text).toBe(text);
});

test("committed datasets match the generator (re-run `bun run generate` if this fails)", async () => {
  for (const split of SPLITS) {
    const committed = await Bun.file(datasetPath(split)).text();
    expect(committed).toBe(toJsonl(generateInjectionDataset(split)));
  }
});

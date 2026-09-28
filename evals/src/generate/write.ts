import { join } from "node:path";
import { SPLITS } from "../dataset/schema.js";
import { generateInjectionDataset } from "./injection/index.js";
import { generatePiiDataset } from "./pii/index.js";

export const DATASETS_DIR = join(import.meta.dir, "../../datasets");

export function datasetPath(split: string): string {
  return join(DATASETS_DIR, `injection-${split}.jsonl`);
}

export const PII_DATASET_PATH = join(DATASETS_DIR, "pii.jsonl");

const BACKSLASH = String.fromCharCode(0x5c);

// Escape non-ASCII so zero-width and look-alike characters are visible in diffs.
function escapeUtf16(char: string): string {
  return Array.from({ length: char.length }, (_, i) => {
    return `${BACKSLASH}u${char.charCodeAt(i).toString(16).padStart(4, "0")}`;
  }).join("");
}

function asciiJson(value: unknown): string {
  return JSON.stringify(value).replace(/\P{ASCII}/gu, escapeUtf16);
}

export function toJsonl(samples: readonly object[]): string {
  return samples.map(asciiJson).join("\n") + "\n";
}

if (import.meta.main) {
  for (const split of SPLITS) {
    const samples = generateInjectionDataset(split);
    await Bun.write(datasetPath(split), toJsonl(samples));
    console.log(`wrote ${samples.length} samples -> ${datasetPath(split)}`);
  }
  const pii = generatePiiDataset();
  await Bun.write(PII_DATASET_PATH, toJsonl(pii));
  console.log(`wrote ${pii.length} samples -> ${PII_DATASET_PATH}`);
}

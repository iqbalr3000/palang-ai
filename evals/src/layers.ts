import { join } from "node:path";
import { createTransformersClassifier } from "@palang-ai/gateway/classifier";
import { scanInjectionHeuristics, scoreInjection } from "@palang-ai/guards";
import type { Sample } from "./dataset/schema.js";
import { THRESHOLDS } from "./evaluate.js";

export interface Layer {
  name: string;
  score(sample: Sample): Promise<number>;
}

export const LAYER_NAMES = ["l1", "l2", "combined"] as const;
export type LayerName = (typeof LAYER_NAMES)[number];

export const DEFAULT_MODELS_PATH = join(import.meta.dir, "../../models");

export interface LayerOptions {
  modelsPath?: string;
  threads?: number;
  dtype?: "fp32" | "q8";
}

export async function createLayers(
  names: readonly LayerName[],
  options: LayerOptions = {},
): Promise<Layer[]> {
  const needsModel = names.includes("l2") || names.includes("combined");
  const classifier = needsModel
    ? await createTransformersClassifier({
        modelsPath: options.modelsPath ?? DEFAULT_MODELS_PATH,
        threads: options.threads,
        dtype: options.dtype,
      })
    : undefined;

  return names.map((name): Layer => {
    switch (name) {
      case "l1":
        return { name, score: async (sample) => scanInjectionHeuristics(sample.text).score };
      case "l2":
        return { name, score: (sample) => classifier!.classify(sample.text) };
      case "combined":
        return {
          name,
          score: async (sample) =>
            (await scoreInjection(sample.text, { classifier, blockThreshold: THRESHOLDS.block }))
              .score,
        };
    }
  });
}

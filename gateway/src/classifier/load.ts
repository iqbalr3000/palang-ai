import type { InjectionClassifier } from "@palang-ai/guards";
import type { PalangConfig } from "../config/schema.js";
import { createTransformersClassifier } from "./transformers.js";

export async function loadClassifiers(
  config: PalangConfig,
): Promise<Map<string, InjectionClassifier>> {
  const modelIds = new Set(
    config.tenants.flatMap((tenant) => {
      const classifier = tenant.guards.injection?.classifier;
      return classifier?.enabled ? [classifier.model] : [];
    }),
  );

  const classifiers = new Map<string, InjectionClassifier>();
  for (const modelId of modelIds) {
    classifiers.set(
      modelId,
      await createTransformersClassifier({ modelsPath: config.models.path, modelId }),
    );
  }
  return classifiers;
}

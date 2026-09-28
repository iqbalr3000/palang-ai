import type { InjectionClassifier } from "@palang-ai/guards";
import type { PalangConfig } from "../config/schema.js";
import { createTransformersClassifier } from "./transformers.js";

/** Loads each distinct classifier model that some tenant enables, once, shared across tenants.
 * Rejects if any fails to load — a tenant that asked for L2 must not silently run L1-only. */
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

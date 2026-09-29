import type { InjectionClassifier } from "@palang-ai/guards";
import type { PalangConfig } from "../config/schema.js";

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
  if (modelIds.size === 0) return classifiers;

  // Optional dependency: the Docker image omits it.
  const { createTransformersClassifier } = await import("./transformers.js").catch(
    (error: unknown) => {
      throw new Error(
        "the injection classifier needs @huggingface/transformers, which this install omits",
        { cause: error },
      );
    },
  );
  for (const modelId of modelIds) {
    classifiers.set(
      modelId,
      await createTransformersClassifier({ modelsPath: config.models.path, modelId }),
    );
  }
  return classifiers;
}

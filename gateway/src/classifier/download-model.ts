import { join } from "node:path";
import { parseArgs } from "node:util";
import { AutoModelForSequenceClassification, AutoTokenizer } from "@huggingface/transformers";
import { CLASSIFIER_MODEL_ID } from "./model.js";

const { values } = parseArgs({
  options: { path: { type: "string", default: join(import.meta.dir, "../../../models") } },
});

const start = performance.now();
await AutoTokenizer.from_pretrained(CLASSIFIER_MODEL_ID, { cache_dir: values.path });
await AutoModelForSequenceClassification.from_pretrained(CLASSIFIER_MODEL_ID, {
  cache_dir: values.path,
  dtype: "fp32",
});
console.log(
  `${CLASSIFIER_MODEL_ID} cached in ${values.path} (${((performance.now() - start) / 1000).toFixed(1)}s)`,
);

import { join } from "node:path";
import {
  AutoModelForSequenceClassification,
  AutoTokenizer,
  Tensor,
} from "@huggingface/transformers";
import type { InjectionClassifier } from "@palang-ai/guards";
import { z } from "zod";
import { CLASSIFIER_MODEL_ID, INJECTION_LABEL } from "./model.js";
import { planWindows } from "./windows.js";

const WINDOW_TOKENS = 512;
const CLS_AND_SEP_TOKENS = 2;
const OVERLAP_TOKENS = 64;
const DEFAULT_MAX_WINDOWS = 8;
// ~4 chars/token: enough to fill the default 8 windows.
const DEFAULT_MAX_INPUT_CHARS = 16_384;

export interface TransformersClassifierOptions {
  modelsPath: string;
  modelId?: string;
  /** `q8` loads `onnx/model_quantized.onnx`. */
  dtype?: "fp32" | "q8";
  threads?: number;
  maxWindows?: number;
  maxInputChars?: number;
}

function softmax(logits: ArrayLike<number>): number[] {
  const max = Math.max(...Array.from(logits));
  const exps = Array.from(logits, (v) => Math.exp(v - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / sum);
}

function toInt64(values: number[]): BigInt64Array {
  return BigInt64Array.from(values, (v) => BigInt(v));
}

export async function createTransformersClassifier(
  options: TransformersClassifierOptions,
): Promise<InjectionClassifier> {
  const modelId = options.modelId ?? CLASSIFIER_MODEL_ID;
  const maxWindows = options.maxWindows ?? DEFAULT_MAX_WINDOWS;
  const maxInputChars = options.maxInputChars ?? DEFAULT_MAX_INPUT_CHARS;
  const loadOptions = { cache_dir: options.modelsPath, local_files_only: true } as const;

  let tokenizer: Awaited<ReturnType<typeof AutoTokenizer.from_pretrained>>;
  let model: Awaited<ReturnType<typeof AutoModelForSequenceClassification.from_pretrained>>;
  try {
    tokenizer = await AutoTokenizer.from_pretrained(modelId, loadOptions);
    model = await AutoModelForSequenceClassification.from_pretrained(modelId, {
      ...loadOptions,
      dtype: options.dtype ?? "fp32",
      ...(options.threads ? { session_options: { intraOpNumThreads: options.threads } } : {}),
    });
  } catch (error) {
    throw new Error(
      `classifier model "${modelId}" could not be loaded from ${join(options.modelsPath)} — ` +
        `run \`bun run --filter @palang-ai/gateway download-model\` first`,
      { cause: error },
    );
  }

  const id2label = z
    .record(z.string(), z.string())
    .parse((model.config as { id2label?: unknown }).id2label);
  const labels = Object.entries(id2label);
  const injectionEntry = labels.find(([, label]) => label.toUpperCase() === INJECTION_LABEL);
  if (!injectionEntry) {
    throw new Error(
      `model "${modelId}" has no ${INJECTION_LABEL} label (found: ${labels.map(([, l]) => l)})`,
    );
  }
  const injectionIndex = Number(injectionEntry[0]);

  const [clsId, sepId] = tokenizer.encode("", { add_special_tokens: true });
  if (clsId === undefined || sepId === undefined) {
    throw new Error(`could not determine [CLS]/[SEP] token ids for "${modelId}"`);
  }

  async function scoreWindow(tokens: number[]): Promise<number> {
    const ids = [clsId!, ...tokens, sepId!];
    const shape = [1, ids.length];
    const output = await model({
      input_ids: new Tensor("int64", toInt64(ids), shape),
      attention_mask: new Tensor("int64", toInt64(ids.map(() => 1)), shape),
    });
    const probabilities = softmax(output.logits.data as Float32Array);
    return probabilities[injectionIndex] ?? 0;
  }

  return {
    async classify(text, signal) {
      const tokens = tokenizer.encode(text.slice(0, maxInputChars), { add_special_tokens: false });
      const windows = planWindows(
        tokens.length,
        WINDOW_TOKENS - CLS_AND_SEP_TOKENS,
        OVERLAP_TOKENS,
        maxWindows,
      );

      let best = 0;
      for (const window of windows) {
        signal?.throwIfAborted();
        best = Math.max(best, await scoreWindow(tokens.slice(window.start, window.end)));
      }
      return best;
    },
  };
}

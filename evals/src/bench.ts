import { join } from "node:path";
import { parseArgs } from "node:util";
import { AutoTokenizer } from "@huggingface/transformers";
import { CLASSIFIER_MODEL_ID, createTransformersClassifier } from "@palang-ai/gateway/classifier";
import { ID_POOLS } from "./generate/injection/pools-id.js";
import { EN_POOLS } from "./generate/injection/pools-en.js";
import { DEFAULT_MODELS_PATH } from "./layers.js";
import { percentile } from "./metrics.js";

const { values } = parseArgs({
  options: {
    threads: { type: "string" },
    dtype: { type: "string" },
    runs: { type: "string", default: "40" },
  },
});
const threads = values.threads ? Number(values.threads) : undefined;
const runs = Number(values.runs);
const dtype = values.dtype === "q8" ? "q8" : "fp32";
const WARMUP_RUNS = 5;

const FILLER = [...ID_POOLS.filler, ...EN_POOLS.filler];

const tokenizer = await AutoTokenizer.from_pretrained(CLASSIFIER_MODEL_ID, {
  cache_dir: DEFAULT_MODELS_PATH,
  local_files_only: true,
});
const countTokens = (text: string): number =>
  tokenizer.encode(text, { add_special_tokens: false }).length;

function textOfTokens(tokens: number): string {
  const sentences: string[] = [];
  for (let i = 0; countTokens(sentences.join(" ")) < tokens; i++) {
    sentences.push(FILLER[i % FILLER.length]!);
  }
  return sentences.join(" ");
}

const CASES = [
  { name: "short chat message", tokens: 40 },
  { name: "one full window", tokens: 510 },
  { name: "~5 windows", tokens: 2000 },
  { name: "beyond the 8-window / 16k-char cap", tokens: 6000 },
];

const loadStart = performance.now();
const classifier = await createTransformersClassifier({
  modelsPath: DEFAULT_MODELS_PATH,
  threads,
  dtype,
});
const loadSeconds = (performance.now() - loadStart) / 1000;

const rows: string[] = [];
for (const { name, tokens } of CASES) {
  const text = textOfTokens(tokens);
  for (let i = 0; i < WARMUP_RUNS; i++) await classifier.classify(text);

  const latencies: number[] = [];
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    await classifier.classify(text);
    latencies.push(performance.now() - start);
  }
  const mean = latencies.reduce((a, b) => a + b, 0) / latencies.length;
  rows.push(
    `| ${name} | ${countTokens(text)} | ${percentile(latencies, 50).toFixed(1)} | ${percentile(latencies, 95).toFixed(1)} | ${mean.toFixed(1)} |`,
  );
}

const rssMb = Math.round(process.memoryUsage().rss / 1024 / 1024);
const cpu = Bun.spawnSync(["sysctl", "-n", "machdep.cpu.brand_string"]).stdout.toString().trim();
const report = [
  `# L2 latency — ${CLASSIFIER_MODEL_ID}`,
  "",
  `Precision: ${dtype}. Threads: ${threads ?? "runtime default"}. Host: ${cpu || process.platform}, ${navigator.hardwareConcurrency} logical cores, Bun ${Bun.version}.`,
  `Cold load (from local cache): ${loadSeconds.toFixed(1)} s. Process RSS after the run: ${rssMb} MB.`,
  `${runs} timed runs per case after ${WARMUP_RUNS} warm-up runs; the original target for one 512-token window was p95 < 60 ms.`,
  "",
  "| Case | Tokens | p50 ms | p95 ms | mean ms |",
  "|---|---|---|---|---|",
  ...rows,
  "",
].join("\n");

console.log(report);
const sha = Bun.spawnSync(["git", "rev-parse", "--short", "HEAD"]).stdout.toString().trim();
const stem = `latency-${new Date().toISOString().slice(0, 10)}-${sha}-${dtype}-t${threads ?? "auto"}`;
await Bun.write(join(import.meta.dir, `../results/${stem}.md`), report);

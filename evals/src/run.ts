import { join } from "node:path";
import { parseArgs } from "node:util";
import { SPLITS, loadDataset, type Sample, type Split } from "./dataset/schema.js";
import { THRESHOLDS, buildLayerReport, scoreSamples, type ScoredSample } from "./evaluate.js";
import { loadPiiDataset } from "./dataset/pii-schema.js";
import { PII_DATASET_PATH, datasetPath } from "./generate/write.js";
import { CLASSIFIER_MODEL_ID } from "@palang-ai/gateway/classifier";
import { LAYER_NAMES, createLayers, type LayerName } from "./layers.js";
import { runPiiEval } from "./pii/report.js";
import { renderMarkdown, type EvalReport, type SplitReport } from "./report.js";

const RESULTS_DIR = join(import.meta.dir, "../results");

const { values } = parseArgs({
  options: {
    suite: { type: "string", default: "all" },
    split: { type: "string", default: "all" },
    misses: { type: "boolean", default: false },
    layers: { type: "string", default: LAYER_NAMES.join(",") },
    threads: { type: "string" },
    dtype: { type: "string" },
  },
});

const SUITES = ["all", "injection", "pii"] as const;

function selectedSuite(): (typeof SUITES)[number] {
  const suite = SUITES.find((s) => s === values.suite);
  if (!suite) throw new Error(`--suite must be ${SUITES.join(", ")} (got "${values.suite}")`);
  return suite;
}

function selectedSplits(): readonly Split[] {
  if (values.split === "all") return SPLITS;
  const split = SPLITS.find((s) => s === values.split);
  if (!split) throw new Error(`--split must be dev, test or all (got "${values.split}")`);
  return [split];
}

function selectedLayers(): LayerName[] {
  return (values.layers ?? "").split(",").map((name) => {
    const layer = LAYER_NAMES.find((l) => l === name.trim());
    if (!layer) throw new Error(`--layers takes ${LAYER_NAMES.join(", ")} (got "${name}")`);
    return layer;
  });
}

function git(args: string[]): string {
  const result = Bun.spawnSync(["git", ...args]);
  return result.stdout.toString().trim();
}

function printMisses(layerName: string, scored: ScoredSample[]): void {
  const flag = THRESHOLDS.flag;
  for (const { sample, score } of scored) {
    const missed = sample.label === "injection" && score < flag;
    const falseAlarm = sample.label === "benign" && score >= flag;
    if (missed || falseAlarm) {
      const kind = missed ? "MISS" : "FALSE-POSITIVE";
      console.log(
        `[${layerName}] ${kind} ${sample.id} score=${score.toFixed(2)} ${JSON.stringify(sample.text)}`,
      );
    }
  }
}

const suite = selectedSuite();
const dtype = values.dtype === "q8" ? "q8" : "fp32";
const report: EvalReport = {
  generatedAt: new Date().toISOString(),
  gitSha: git(["rev-parse", "--short", "HEAD"]),
  dirty: git(["status", "--porcelain"]) !== "",
  injection: null,
  pii: null,
};

if (suite !== "pii") {
  const layerNames = selectedLayers();
  const layers = await createLayers(layerNames, {
    threads: values.threads ? Number(values.threads) : undefined,
    dtype,
  });
  report.injection = {
    thresholds: THRESHOLDS,
    classifier: layerNames.some((n) => n !== "l1") ? { model: CLASSIFIER_MODEL_ID, dtype } : null,
    splits: {},
  };
  for (const split of selectedSplits()) {
    const samples: Sample[] = await loadDataset(datasetPath(split));
    const splitReport: SplitReport = { samples: samples.length, layers: {} };
    for (const layer of layers) {
      const scored = await scoreSamples(layer, samples);
      splitReport.layers[layer.name] = buildLayerReport(scored);
      if (values.misses) printMisses(`${layer.name}/${split}`, scored);
    }
    report.injection.splits[split] = splitReport;
  }
}

if (suite !== "injection") {
  report.pii = await runPiiEval(await loadPiiDataset(PII_DATASET_PATH));
}

const markdown = renderMarkdown(report);
// Only a full run is a publishable report; partial runs (tuning, one suite) just print.
if (suite === "all" && values.split === "all") {
  const variant = report.injection?.classifier ? `-${dtype}` : "-l1";
  const stem = `${report.generatedAt.slice(0, 10)}-${report.gitSha}${report.dirty ? "-dirty" : ""}${variant}`;
  await Bun.write(join(RESULTS_DIR, `${stem}.json`), JSON.stringify(report, null, 2) + "\n");
  await Bun.write(join(RESULTS_DIR, `${stem}.md`), markdown);
  console.log(`report written to evals/results/${stem}.{json,md}`);
} else {
  console.log(markdown);
}

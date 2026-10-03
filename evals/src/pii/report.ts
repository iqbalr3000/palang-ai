import { detectPii } from "@palang-ai/guards";
import {
  PII_CATEGORIES,
  PII_TYPES,
  type PiiCategory,
  type PiiSample,
} from "../dataset/pii-schema.js";
import { ms, pct } from "../format.js";
import { evaluateDetection, type DetectionReport, type SpanMetricsByType } from "./detection.js";
import {
  RESTORE_SCENARIOS,
  evaluateRestore,
  type RestoreReport,
  type RestoreScenario,
} from "./restore.js";

export interface PiiReport {
  samples: Record<PiiCategory, number>;
  detection: DetectionReport;
  restore: Record<RestoreScenario, RestoreReport>;
}

export async function runPiiEval(samples: PiiSample[]): Promise<PiiReport> {
  const counts = Object.fromEntries(
    PII_CATEGORIES.map((c) => [c, samples.filter((s) => s.category === c).length]),
  ) as Record<PiiCategory, number>;

  const restore = {} as Record<RestoreScenario, RestoreReport>;
  for (const scenario of RESTORE_SCENARIOS) {
    restore[scenario] = await evaluateRestore(samples, scenario);
  }
  return { samples: counts, detection: evaluateDetection(samples, detectPii), restore };
}

function detectionTable(metrics: SpanMetricsByType): string[] {
  const rows = [...PII_TYPES, "overall" as const].map((type) => {
    const m = metrics[type];
    return `| ${type} | ${pct(m.precision)} | ${pct(m.recall)} | ${pct(m.f1)} | ${m.tp}/${m.fp}/${m.fn} |`;
  });
  return ["| Entity | Precision | Recall | F1 | TP/FP/FN |", "|---|---|---|---|---|", ...rows];
}

export function renderPiiMarkdown(report: PiiReport): string[] {
  const { detection, samples } = report;
  const hard = detection.hardNegatives;
  const total = PII_CATEGORIES.reduce((sum, c) => sum + samples[c], 0);

  const restoreRows = RESTORE_SCENARIOS.map((scenario) => {
    const r = report.restore[scenario];
    const misses = PII_TYPES.filter((t) => r.restoreMiss[t] > 0)
      .map((t) => `${t} ${r.restoreMiss[t]}`)
      .join(", ");
    return `| ${scenario} | ${r.samples} | ${r.succeeded} | ${pct(r.successRate)} | ${r.restoreMiss.total}${misses ? ` (${misses})` : ""} |`;
  });

  return [
    "## PII",
    "",
    `${total} samples: ${samples.positive} positive, ${samples.unsupported_format} unsupported_format, ${samples.unlabeled} unlabeled, ${samples.hard_negative} hard_negative.`,
    "",
    "- Samples are synthetic and template-generated (`evals/src/generate/pii/`), not real data.",
    "- A detection counts only on an exact type + start + end match with the gold span.",
    "- `unsupported_format` holds real-world spellings the detector doesn't claim to handle (spaced NIK, `[at]` emails); it's excluded from the first table.",
    "- `unlabeled` holds plain NPWPs with no NPWP keyword before them. The detector requires one for plain NPWPs, so these measure what that rule costs; they're excluded from the first table.",
    "- The detectors were not tuned against this dataset.",
    "",
    "### Detection — supported formats",
    "",
    ...detectionTable(detection.supported),
    "",
    "### Unlabeled NPWP",
    "",
    `Recall ${pct(detection.unlabeled.NPWP.recall)} (${detection.unlabeled.NPWP.tp}/${detection.unlabeled.NPWP.tp + detection.unlabeled.NPWP.fn}).`,
    "",
    "### Detection — all samples",
    "",
    ...detectionTable(detection.all),
    "",
    "### Hard negatives",
    "",
    `${hard.withAnyDetection}/${hard.samples} hard-negative samples (${pct(hard.samples === 0 ? null : hard.withAnyDetection / hard.samples)}) had at least one false detection. By type: ${PII_TYPES.map((t) => `${t} ${hard.byType[t]}`).join(", ")}.`,
    "",
    "### Restore round trip",
    "",
    "Masked text streamed through mock-upstream and the gateway's stream processor with the `pii-id` output guard. Success = output equals the masked text with each placeholder replaced by its vault value (the normalized form, e.g. phones as `+62…`). Only samples that got at least one placeholder count.",
    "",
    "| Scenario | Samples | Succeeded | Success rate | restore_miss |",
    "|---|---|---|---|---|",
    ...restoreRows,
    "",
    `Detection latency per sample: p50 ${ms(detection.latencyMs.p50)} ms, p95 ${ms(detection.latencyMs.p95)} ms.`,
    "",
  ];
}

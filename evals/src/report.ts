import { CATEGORIES, LANGS, type Category, type Split } from "./dataset/schema.js";
import { THRESHOLDS, type LayerReport, type ThresholdName } from "./evaluate.js";
import { ms, pct } from "./format.js";
import type { Metrics } from "./metrics.js";
import { renderPiiMarkdown, type PiiReport } from "./pii/report.js";

export interface SplitReport {
  samples: number;
  layers: Record<string, LayerReport>;
}

export interface InjectionReport {
  thresholds: typeof THRESHOLDS;
  /** Null when only L1 ran. */
  classifier: { model: string; dtype: "fp32" | "q8" } | null;
  splits: Partial<Record<Split, SplitReport>>;
}

export interface EvalReport {
  generatedAt: string;
  gitSha: string;
  dirty: boolean;
  /** Null when that suite wasn't run (`--suite`). */
  injection: InjectionReport | null;
  pii: PiiReport | null;
}

const isBenignCategory = (c: Category): boolean => c === "benign" || c === "benign_hard";

function overallTable(layer: LayerReport): string[] {
  const rows = (Object.keys(THRESHOLDS) as ThresholdName[]).map((name) => {
    const t = layer.thresholds[name];
    const m = t.overall;
    return `| ${name} (≥${t.value}) | ${m.n} | ${pct(m.precision)} | ${pct(m.recall)} | ${pct(m.fpr)} | ${pct(m.f1)} | ${m.tp}/${m.fp}/${m.tn}/${m.fn} |`;
  });
  return [
    "| Threshold | n | Precision | Recall | FPR | F1 | TP/FP/TN/FN |",
    "|---|---|---|---|---|---|---|",
    ...rows,
  ];
}

function langTable(layer: LayerReport): string[] {
  const rows: string[] = [];
  for (const name of Object.keys(THRESHOLDS) as ThresholdName[]) {
    for (const lang of LANGS) {
      const m: Metrics = layer.thresholds[name].byLang[lang];
      rows.push(
        `| ${name} | ${lang} | ${m.n} | ${pct(m.precision)} | ${pct(m.recall)} | ${pct(m.fpr)} | ${pct(m.f1)} |`,
      );
    }
  }
  return [
    "| Threshold | Lang | n | Precision | Recall | FPR | F1 |",
    "|---|---|---|---|---|---|---|",
    ...rows,
  ];
}

// Injection categories only have positives (recall matters); benign ones only negatives (FPR).
function categoryTable(layer: LayerReport): string[] {
  const rows: string[] = [];
  for (const name of Object.keys(THRESHOLDS) as ThresholdName[]) {
    for (const category of CATEGORIES) {
      const m = layer.thresholds[name].byCategory[category];
      const metric = isBenignCategory(category) ? `FPR ${pct(m.fpr)}` : `recall ${pct(m.recall)}`;
      rows.push(`| ${name} | ${category} | ${m.n} | ${metric} |`);
    }
  }
  return ["| Threshold | Category | n | Metric |", "|---|---|---|---|", ...rows];
}

function renderInjectionMarkdown(report: InjectionReport): string[] {
  const lines: string[] = [
    "## Injection",
    "",
    `${report.classifier ? `L2 model ${report.classifier.model} (${report.classifier.dtype}).` : "L1 only."} Predicted \`injection\` when score ≥ threshold (flag ${report.thresholds.flag}, block ${report.thresholds.block}).`,
    "",
    "- Samples are synthetic and template-generated (`evals/src/generate/injection/`), not real traffic.",
    "- L1 patterns were tuned against **dev** only. **test** is held out and its phrasing is disjoint from dev's.",
    "- The patterns and the samples were written by the same author, so test numbers are still optimistic compared with unseen real-world attacks.",
    "- `benign_hard` is benign text that deliberately resembles attacks (security discussion, legitimate uses of trigger words); it is where false positives are expected.",
    "",
  ];

  for (const [split, splitReport] of Object.entries(report.splits)) {
    lines.push(`### ${split} (${splitReport.samples} samples)`, "");
    for (const [layerName, layer] of Object.entries(splitReport.layers)) {
      lines.push(
        `#### ${layerName}`,
        "",
        ...overallTable(layer),
        "",
        ...langTable(layer),
        "",
        ...categoryTable(layer),
        "",
        `Latency per sample: p50 ${ms(layer.latencyMs.p50)} ms, p95 ${ms(layer.latencyMs.p95)} ms.`,
        "",
      );
    }
  }
  return lines;
}

export function renderMarkdown(report: EvalReport): string {
  const lines: string[] = [
    `# Eval report — ${report.gitSha}${report.dirty ? " (uncommitted changes)" : ""}`,
    "",
    `Generated ${report.generatedAt}. Reproduce with \`bun run eval\`.`,
    "",
  ];
  if (report.injection) lines.push(...renderInjectionMarkdown(report.injection));
  if (report.pii) lines.push(...renderPiiMarkdown(report.pii));
  return lines.join("\n");
}

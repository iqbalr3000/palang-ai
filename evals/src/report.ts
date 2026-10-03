import { CATEGORIES, type Category, type Split } from "./dataset/schema.js";
import {
  THRESHOLDS,
  type FixedFprReport,
  type LayerReport,
  type ThresholdName,
} from "./evaluate.js";
import { ms, pct } from "./format.js";
import { renderPiiMarkdown, type PiiReport } from "./pii/report.js";

export interface SplitReport {
  samples: number;
  layers: Record<string, LayerReport>;
}

export interface InjectionReport {
  thresholds: typeof THRESHOLDS;
  classifier: { model: string; dtype: "fp32" | "q8" } | null;
  splits: Partial<Record<Split, SplitReport>>;
  fixedFpr: Record<string, FixedFprReport[]> | null;
}

export interface EvalReport {
  generatedAt: string;
  gitSha: string;
  dirty: boolean;
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

function sliceTable(layer: LayerReport): string[] {
  const rows: string[] = [];
  for (const name of Object.keys(THRESHOLDS) as ThresholdName[]) {
    for (const [slice, m] of Object.entries(layer.thresholds[name].bySlice)) {
      rows.push(
        `| ${name} | ${slice} | ${m.all.n} | ${pct(m.all.recall)} | ${pct(m.benign.fpr)} | ${pct(m.benignHard.fpr)} | ${pct(m.all.precision)} | ${pct(m.all.f1)} |`,
      );
    }
  }
  return [
    "| Threshold | Slice | n | Recall | FPR benign | FPR benign_hard | Precision | F1 |",
    "|---|---|---|---|---|---|---|---|",
    ...rows,
  ];
}

function fixedFprTable(fixedFpr: Record<string, FixedFprReport[]>): string[] {
  const slices = [
    ...new Set(
      Object.values(fixedFpr).flatMap((reports) =>
        reports.flatMap((r) => Object.keys(r.test?.bySlice ?? {})),
      ),
    ),
  ];
  const rows = Object.entries(fixedFpr).flatMap(([layerName, reports]) =>
    reports.map((r) => {
      const perSlice = slices.map((slice) => pct(r.test?.bySlice[slice]?.all.recall ?? null));
      const threshold = r.threshold === null ? "unreachable" : r.threshold.toFixed(3);
      return `| ${layerName} | ${pct(r.target)} | ${threshold} | ${pct(r.dev?.recall ?? null)} | ${pct(r.dev?.fpr ?? null)} | ${pct(r.test?.overall.recall ?? null)} | ${pct(r.test?.overall.fpr ?? null)} | ${perSlice.join(" | ")} |`;
    }),
  );
  return [
    `| Layer | Target FPR | Threshold | dev recall | dev FPR | test recall | test FPR | ${slices.map((s) => `test recall ${s}`).join(" | ")} |`,
    `|---|---|---|---|---|---|---|${slices.map(() => "---").join("|")}|`,
    ...rows,
  ];
}

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
    "- Slices are `lang/register`: formal Indonesian and English, informal Indonesian (slang, abbreviations, leetspeak), and EN-ID code-mixed chat.",
    "",
  ];

  if (report.fixedFpr) {
    lines.push(
      "### Fixed false-positive rate",
      "",
      "Threshold = the lowest score whose **dev** FPR stays within the target, applied unchanged to **test**. `unreachable` means too many benign dev samples share the top score.",
      "",
      ...fixedFprTable(report.fixedFpr),
      "",
    );
  }

  for (const [split, splitReport] of Object.entries(report.splits)) {
    lines.push(`### ${split} (${splitReport.samples} samples)`, "");
    for (const [layerName, layer] of Object.entries(splitReport.layers)) {
      lines.push(
        `#### ${layerName}`,
        "",
        ...overallTable(layer),
        "",
        ...sliceTable(layer),
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

// Minimal Prometheus text-format (0.0.4) counters and histograms — enough for TSD §10.4, without
// pulling in prom-client.

type Labels = Record<string, string>;

function escapeLabel(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

function formatLabels(labels: Labels): string {
  const entries = Object.entries(labels);
  if (entries.length === 0) return "";
  return `{${entries.map(([k, v]) => `${k}="${escapeLabel(v)}"`).join(",")}}`;
}

// Stable key so the same label set always lands on the same series.
const seriesKey = (labels: Labels): string =>
  JSON.stringify(Object.entries(labels).sort(([a], [b]) => a.localeCompare(b)));

interface Metric {
  render(): string;
}

export class Counter implements Metric {
  private readonly series = new Map<string, { labels: Labels; value: number }>();

  constructor(
    private readonly name: string,
    private readonly help: string,
  ) {}

  inc(labels: Labels = {}, by = 1): void {
    const key = seriesKey(labels);
    const current = this.series.get(key);
    if (current) current.value += by;
    else this.series.set(key, { labels, value: by });
  }

  render(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} counter`];
    for (const { labels, value } of this.series.values()) {
      lines.push(`${this.name}${formatLabels(labels)} ${value}`);
    }
    return lines.join("\n");
  }
}

/** A counter whose value lives elsewhere (e.g. the audit queue) and is read at scrape time. */
export class ObservedCounter implements Metric {
  constructor(
    private readonly name: string,
    private readonly help: string,
    private readonly read: () => number,
  ) {}

  render(): string {
    return [
      `# HELP ${this.name} ${this.help}`,
      `# TYPE ${this.name} counter`,
      `${this.name} ${this.read()}`,
    ].join("\n");
  }
}

interface HistogramSeries {
  labels: Labels;
  buckets: number[]; // cumulative counts, one per bound
  sum: number;
  count: number;
}

export class Histogram implements Metric {
  private readonly series = new Map<string, HistogramSeries>();

  constructor(
    private readonly name: string,
    private readonly help: string,
    private readonly bounds: readonly number[],
  ) {}

  observe(labels: Labels, value: number): void {
    const key = seriesKey(labels);
    let series = this.series.get(key);
    if (!series) {
      series = { labels, buckets: this.bounds.map(() => 0), sum: 0, count: 0 };
      this.series.set(key, series);
    }
    this.bounds.forEach((bound, i) => {
      if (value <= bound) series.buckets[i]! += 1;
    });
    series.sum += value;
    series.count += 1;
  }

  render(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} histogram`];
    for (const { labels, buckets, sum, count } of this.series.values()) {
      this.bounds.forEach((bound, i) => {
        lines.push(
          `${this.name}_bucket${formatLabels({ ...labels, le: String(bound) })} ${buckets[i]}`,
        );
      });
      lines.push(`${this.name}_bucket${formatLabels({ ...labels, le: "+Inf" })} ${count}`);
      lines.push(`${this.name}_sum${formatLabels(labels)} ${sum}`);
      lines.push(`${this.name}_count${formatLabels(labels)} ${count}`);
    }
    return lines.join("\n");
  }
}

export function renderMetrics(metrics: readonly Metric[]): string {
  return metrics.map((m) => m.render()).join("\n") + "\n";
}

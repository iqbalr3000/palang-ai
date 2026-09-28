import type { Action, Stats } from "./admin-client";

export const RANGES = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
} as const;
export type Range = keyof typeof RANGES;

export function parseRange(value: string | undefined): Range {
  return value === "7d" || value === "30d" ? value : "24h";
}

export type SeriesPoint = { start: string } & Record<Action, number>;

const STEP_MS = { hour: 60 * 60 * 1000, day: 24 * 60 * 60 * 1000 } as const;

function truncate(ms: number, bucket: Stats["bucket"]): number {
  const date = new Date(ms);
  date.setUTCMinutes(0, 0, 0);
  if (bucket === "day") date.setUTCHours(0);
  return date.getTime();
}

/** One point per bucket across the whole window, so quiet periods show as zero, not as gaps. */
export function toSeries(stats: Stats): SeriesPoint[] {
  const counts = new Map<number, SeriesPoint>();
  const step = STEP_MS[stats.bucket];
  const end = new Date(stats.to).getTime();
  for (let t = truncate(new Date(stats.from).getTime(), stats.bucket); t < end; t += step) {
    counts.set(t, { start: new Date(t).toISOString(), allow: 0, flag: 0, block: 0 });
  }
  for (const b of stats.buckets) {
    const point = counts.get(new Date(b.start).getTime());
    if (point) point[b.action] += b.count;
  }
  return [...counts.values()];
}

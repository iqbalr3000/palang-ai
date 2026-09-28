import { expect, test } from "bun:test";
import type { Stats } from "./admin-client";
import { parseRange, toSeries } from "./stats";

const base: Stats = {
  from: "2026-09-28T00:30:00.000Z",
  to: "2026-09-28T03:30:00.000Z",
  tenant: null,
  bucket: "hour",
  totals: {},
  buckets: [
    { start: "2026-09-28T01:00:00.000Z", action: "allow", count: 5 },
    { start: "2026-09-28T01:00:00.000Z", action: "block", count: 2 },
    { start: "2026-09-28T03:00:00.000Z", action: "flag", count: 1 },
  ],
  by_guard: [],
  top_block_reasons: [],
  latency_ms: { total_p50: null, total_p95: null, guards_p50: null, guards_p95: null },
  guard_latency_p95_ms: {},
};

test("every bucket in the window is present; empty ones are zero", () => {
  expect(toSeries(base)).toEqual([
    { start: "2026-09-28T00:00:00.000Z", allow: 0, flag: 0, block: 0 },
    { start: "2026-09-28T01:00:00.000Z", allow: 5, flag: 0, block: 2 },
    { start: "2026-09-28T02:00:00.000Z", allow: 0, flag: 0, block: 0 },
    { start: "2026-09-28T03:00:00.000Z", allow: 0, flag: 1, block: 0 },
  ]);
});

test("daily buckets", () => {
  const series = toSeries({
    ...base,
    bucket: "day",
    from: "2026-09-20T10:00:00.000Z",
    to: "2026-09-23T10:00:00.000Z",
    buckets: [{ start: "2026-09-21T00:00:00.000Z", action: "allow", count: 3 }],
  });
  expect(series.map((p) => [p.start.slice(0, 10), p.allow])).toEqual([
    ["2026-09-20", 0],
    ["2026-09-21", 3],
    ["2026-09-22", 0],
    ["2026-09-23", 0],
  ]);
});

test("unknown ranges fall back to 24h", () => {
  expect(parseRange("7d")).toBe("7d");
  expect(parseRange("1y")).toBe("24h");
  expect(parseRange(undefined)).toBe("24h");
});

import { expect, test } from "bun:test";
import { Counter, Histogram, ObservedCounter, renderMetrics } from "./registry.js";

test("counters sum per label set, in Prometheus text format", () => {
  const counter = new Counter("palang_requests_total", "Requests.");
  counter.inc({ tenant: "demo", action: "allow" });
  counter.inc({ action: "allow", tenant: "demo" });
  counter.inc({ tenant: "demo", action: "block" }, 3);

  expect(renderMetrics([counter])).toBe(
    [
      "# HELP palang_requests_total Requests.",
      "# TYPE palang_requests_total counter",
      'palang_requests_total{tenant="demo",action="allow"} 2',
      'palang_requests_total{tenant="demo",action="block"} 3',
      "",
    ].join("\n"),
  );
});

test("histogram buckets are cumulative, with +Inf, sum and count", () => {
  const histogram = new Histogram("palang_guard_latency_ms", "Latency.", [1, 10]);
  histogram.observe({ guard: "pii-id" }, 0.5);
  histogram.observe({ guard: "pii-id" }, 5);
  histogram.observe({ guard: "pii-id" }, 50);

  expect(histogram.render().split("\n").slice(2)).toEqual([
    'palang_guard_latency_ms_bucket{guard="pii-id",le="1"} 1',
    'palang_guard_latency_ms_bucket{guard="pii-id",le="10"} 2',
    'palang_guard_latency_ms_bucket{guard="pii-id",le="+Inf"} 3',
    'palang_guard_latency_ms_sum{guard="pii-id"} 55.5',
    'palang_guard_latency_ms_count{guard="pii-id"} 3',
  ]);
});

test("label values are escaped", () => {
  const counter = new Counter("c", "h");
  counter.inc({ tenant: 'a"b\\c\nd' });
  expect(counter.render()).toContain('c{tenant="a\\"b\\\\c\\nd"} 1');
});

test("observed counters read their value at render time", () => {
  let value = 1;
  const counter = new ObservedCounter("palang_audit_dropped_total", "Dropped.", () => value);
  value = 7;
  expect(counter.render()).toContain("palang_audit_dropped_total 7");
});

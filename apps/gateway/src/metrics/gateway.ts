import type { Decision, FinalAction } from "@palang-ai/core";
import type { AuditQueue } from "../audit/queue.js";
import { Counter, Histogram, ObservedCounter, renderMetrics } from "./registry.js";

const GUARD_LATENCY_BUCKETS_MS = [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000];

export interface GatewayMetrics {
  recordRequest(tenant: string, action: FinalAction, decisions: Decision[]): void;
  recordUpstreamError(tenant: string): void;
  render(): string;
}

export function createGatewayMetrics(auditQueue: AuditQueue): GatewayMetrics {
  const requests = new Counter(
    "palang_requests_total",
    "Chat completion requests by final action.",
  );
  const guardLatency = new Histogram(
    "palang_guard_latency_ms",
    "Per-guard decision latency in milliseconds.",
    GUARD_LATENCY_BUCKETS_MS,
  );
  const upstreamErrors = new Counter(
    "palang_upstream_errors_total",
    "Upstream calls that failed or timed out.",
  );
  const auditDropped = new ObservedCounter(
    "palang_audit_dropped_total",
    "Audit events dropped (queue full or insert failed).",
    () => auditQueue.droppedCount,
  );
  const auditFlushed = new ObservedCounter(
    "palang_audit_flushed_total",
    "Audit events written to the database.",
    () => auditQueue.flushedCount,
  );

  return {
    recordRequest(tenant, action, decisions) {
      requests.inc({ tenant, action });
      for (const d of decisions) guardLatency.observe({ guard: d.guard }, d.latencyMs);
    },
    recordUpstreamError(tenant) {
      upstreamErrors.inc({ tenant });
    },
    render: () =>
      renderMetrics([requests, guardLatency, upstreamErrors, auditDropped, auditFlushed]),
  };
}

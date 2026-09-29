import type { ChatMessage, Decision, FinalAction } from "@palang-ai/guards";
import type { Logger } from "../log/logger.js";
import type { GatewayMetrics } from "../metrics/gateway.js";
import { storedContent, type ContentMode, type ResponseCapture } from "./content.js";
import type { AuditEventInput, AuditQueue } from "./queue.js";

export interface RequestOutcome extends Omit<
  AuditEventInput,
  "finalAction" | "blockedBy" | "requestContent" | "responseContent"
> {
  blocked: Decision | null;
  messages: ChatMessage[];
  response: ResponseCapture | null;
  canary: string | undefined;
}

export function finalActionFor(decisions: Decision[], blocked: Decision | null): FinalAction {
  if (blocked) return "block";
  return decisions.some((d) => d.action === "flag") ? "flag" : "allow";
}

export type RecordRequest = (outcome: RequestOutcome) => void;

export function createRecorder(deps: {
  auditQueue: AuditQueue;
  metrics: GatewayMetrics;
  logger: Logger;
  contentMode: ContentMode;
}): RecordRequest {
  return (outcome) => {
    const { blocked, messages, response, canary, ...event } = outcome;
    const finalAction = finalActionFor(event.decisions, blocked);
    const content = storedContent(deps.contentMode, messages, response, canary);

    deps.auditQueue.enqueue({
      ...event,
      finalAction,
      blockedBy: blocked?.guard,
      requestContent: content.request,
      responseContent: content.response,
    });
    deps.metrics.recordRequest(event.tenantId, finalAction, event.decisions);
    deps.logger.info(
      {
        request_id: event.id,
        tenant: event.tenantId,
        model: event.model,
        stream: event.stream,
        final_action: finalAction,
        blocked_by: blocked?.guard,
        reason: blocked?.reason,
        status: event.statusCode,
        latency_total_ms: Math.round(event.latencyTotalMs),
        latency_guards_ms: Math.round(event.latencyGuardsMs),
        ttft_ms: event.ttftMs === undefined ? undefined : Math.round(event.ttftMs),
      },
      "request",
    );
  };
}

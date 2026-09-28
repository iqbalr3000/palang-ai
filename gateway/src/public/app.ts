import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { stream } from "hono/streaming";
import { sql } from "drizzle-orm";
import type { Db } from "../db/index.js";
import {
  getCanary,
  matchGlob,
  runInputPipeline,
  type GuardContext,
  type InjectionClassifier,
} from "@palang-ai/guards";
import type { PalangConfig, TenantConfig } from "../config/schema.js";
import { createAuthMiddleware } from "../auth/middleware.js";
import { UpstreamTimeoutError, callUpstream } from "../upstream/adapter.js";
import { processStream, type StreamResult } from "../stream/processor.js";
import type { AuditQueue } from "../audit/queue.js";
import { ResponseCapture } from "../audit/content.js";
import { createRecorder, finalActionFor, type RequestOutcome } from "../audit/recorder.js";
import { createGatewayMetrics, type GatewayMetrics } from "../metrics/gateway.js";
import { createLogger, type Logger } from "../log/logger.js";
import { chatCompletionRequestSchema } from "./request-schema.js";
import { blockedErrorBody } from "./errors.js";
import { buildAllTenantGuards } from "./guards.js";
import { applyOutputGuardsToChoices, type NonStreamingChoice } from "./apply-output-guards.js";

export interface Variables {
  tenantId: string;
  apiKeyId: string;
}

export interface PublicAppDeps {
  db: Db;
  config: PalangConfig;
  auditQueue: AuditQueue;
  /** Keyed by model id, loaded at boot (`loadClassifiers`). Only needed if a tenant enables L2. */
  classifiers?: ReadonlyMap<string, InjectionClassifier>;
  /** Shared with the admin app's `/metrics`; a private instance when omitted (tests). */
  metrics?: GatewayMetrics;
  logger?: Logger;
}

// Rate-limit hints stay useful to clients; anything else (encodings fetch already undid, provider
// internals) is dropped.
function forwardableErrorHeaders(upstream: Headers): Headers {
  const headers = new Headers();
  upstream.forEach((value, name) => {
    if (name === "content-type" || name === "retry-after" || name.startsWith("x-ratelimit-")) {
      headers.set(name, value);
    }
  });
  return headers;
}

function findTenant(config: PalangConfig, tenantId: string): TenantConfig | undefined {
  return config.tenants.find((t) => t.id === tenantId);
}

export function createPublicApp(deps: PublicAppDeps): Hono<{ Variables: Variables }> {
  const app = new Hono<{ Variables: Variables }>();
  const logger = deps.logger ?? createLogger("silent");
  const auth = createAuthMiddleware(deps.db, logger);
  const tenantGuards = buildAllTenantGuards(deps.config.tenants, deps.classifiers ?? new Map());
  const metrics = deps.metrics ?? createGatewayMetrics(deps.auditQueue);
  const record = createRecorder({
    auditQueue: deps.auditQueue,
    metrics,
    logger,
    contentMode: deps.config.audit.content_mode,
  });
  const limitBody = bodyLimit({
    maxSize: deps.config.server.max_body_bytes,
    onError: (c) =>
      c.json({ error: { message: "Request body too large", code: "request_too_large" } }, 413),
  });

  app.get("/healthz", (c) => c.text("ok"));

  app.get("/readyz", async (c) => {
    try {
      await deps.db.execute(sql`select 1`);
    } catch {
      return c.json({ ready: false, reason: "db_unreachable" }, 503);
    }
    return c.json({ ready: true });
  });

  app.get("/v1/models", auth, (c) => {
    const tenant = findTenant(deps.config, c.get("tenantId"));
    if (!tenant) return c.json({ error: { message: "Unknown tenant" } }, 401);
    return c.json({
      object: "list",
      data: tenant.allowed_models.map((id) => ({ id, object: "model", owned_by: tenant.id })),
    });
  });

  app.post("/v1/chat/completions", limitBody, auth, async (c) => {
    const requestStart = performance.now();
    const tenant = findTenant(deps.config, c.get("tenantId"));
    if (!tenant) return c.json({ error: { message: "Unknown tenant" } }, 401);
    const guards = tenantGuards.get(tenant.id)!;

    let requestJson: unknown;
    try {
      requestJson = await c.req.json();
    } catch {
      return c.json({ error: { message: "Body is not valid JSON", code: "invalid_request" } }, 400);
    }
    const parsed = chatCompletionRequestSchema.safeParse(requestJson);
    if (!parsed.success) {
      return c.json({ error: { message: "Invalid request body", code: "invalid_request" } }, 400);
    }
    const body = parsed.data;
    const requestId = crypto.randomUUID(); // also the audit_events primary key — must stay a real uuid
    const apiKeyId = c.get("apiKeyId");

    if (!tenant.allowed_models.some((pattern) => matchGlob(pattern, body.model))) {
      return c.json(
        {
          error: {
            message: `Model "${body.model}" is not allowed for this tenant`,
            code: "model_not_allowed",
          },
        },
        400,
      );
    }

    const ctx: GuardContext = {
      requestId,
      tenantId: tenant.id,
      model: body.model,
      stream: body.stream ?? false,
      messages: body.messages,
      piiVault: new Map(),
      signal: c.req.raw.signal,
      metadata: {},
    };
    const response = deps.config.audit.content_mode === "none" ? null : new ResponseCapture();

    const guardsStart = performance.now();
    const pipelineResult = await runInputPipeline(guards.input, ctx, {
      failureMode: tenant.failure_mode,
      guards: guards.runtimeConfigs,
    });
    const latencyGuardsMs = performance.now() - guardsStart;

    // Everything an outcome shares; each exit adds what it knows.
    const outcome = (
      rest: Pick<RequestOutcome, "blocked" | "statusCode" | "decisions"> & Partial<RequestOutcome>,
    ): RequestOutcome => ({
      id: requestId,
      tenantId: tenant.id,
      apiKeyId,
      model: body.model,
      stream: body.stream ?? false,
      latencyTotalMs: performance.now() - requestStart,
      latencyGuardsMs,
      messages: ctx.messages,
      response,
      canary: getCanary(ctx),
      ...rest,
    });

    if (pipelineResult.blocked) {
      record(
        outcome({
          blocked: pipelineResult.blocked,
          statusCode: 400,
          decisions: pipelineResult.decisions,
          response: null,
        }),
      );
      return c.json(blockedErrorBody(requestId, pipelineResult.blocked), 400);
    }

    const upstreamStart = performance.now();
    let upstreamResponse: Response;
    try {
      upstreamResponse = await callUpstream(
        {
          baseUrl: tenant.upstream.base_url,
          apiKey: tenant.upstream.api_key,
          timeoutMs: tenant.upstream.timeout_ms,
        },
        { ...body, messages: ctx.messages }, // input guards mutate ctx.messages in place
        c.req.raw.signal,
      );
    } catch (error) {
      const timedOut = error instanceof UpstreamTimeoutError;
      const status = timedOut ? 504 : 502;
      metrics.recordUpstreamError(tenant.id);
      record(
        outcome({
          blocked: null,
          statusCode: status,
          decisions: pipelineResult.decisions,
          response: null,
        }),
      );
      return c.json(
        timedOut
          ? { error: { message: "Upstream timed out", code: "upstream_timeout" } }
          : { error: { message: "Upstream request failed", code: "upstream_error" } },
        status,
      );
    }
    const latencyUpstreamMs = performance.now() - upstreamStart;

    if (!upstreamResponse.ok) {
      // no guard restore on error bodies — forwarded as-is
      record(
        outcome({
          blocked: null,
          statusCode: upstreamResponse.status,
          decisions: pipelineResult.decisions,
          latencyUpstreamMs,
          response: null,
        }),
      );
      return new Response(upstreamResponse.body, {
        status: upstreamResponse.status,
        headers: forwardableErrorHeaders(upstreamResponse.headers),
      });
    }

    c.header("x-palang-request-id", requestId);

    if (body.stream) {
      // Headers (and the 200 status) are already committed once the SSE body starts, so this is
      // provisional — a guard block is signaled in-band as an error event instead. The real
      // outcome is only known once the stream ends, which is when it's actually recorded below.
      c.header("x-palang-decision", "allow");
      c.header("Content-Type", "text/event-stream");
      c.header("Cache-Control", "no-cache");
      c.header("X-Accel-Buffering", "no"); // keeps nginx from buffering the whole stream
      return stream(c, async (s) => {
        let firstWriteAt: number | undefined;
        let result: StreamResult | undefined;
        try {
          result = await processStream(
            upstreamResponse.body!,
            {
              outputGuards: guards.output,
              guardConfigs: guards.runtimeConfigs,
              failureMode: tenant.failure_mode,
              ctx,
              rawSink: response ?? undefined,
            },
            async (chunk) => {
              firstWriteAt ??= performance.now();
              await s.write(chunk);
            },
          );
        } finally {
          // Every stream is recorded, including one cut short by the client (499, nginx's
          // "client closed request") or by the upstream.
          const statusCode = result ? 200 : c.req.raw.signal.aborted ? 499 : 502;
          record(
            outcome({
              blocked: result?.blocked ?? null,
              statusCode,
              decisions: [...pipelineResult.decisions, ...(result?.decisions ?? [])],
              latencyUpstreamMs,
              ttftMs: firstWriteAt === undefined ? undefined : firstWriteAt - requestStart,
              usage: result?.usage,
            }),
          );
        }
      });
    }

    const json = (await upstreamResponse.json()) as {
      choices?: NonStreamingChoice[];
      usage?: unknown;
    };
    // Captured before the output guards restore placeholders in place.
    (json.choices ?? []).forEach((choice, index) => {
      if (choice.message?.content) response?.text(index, choice.message.content);
      for (const call of choice.message?.tool_calls ?? []) response?.toolCall(index, call);
    });

    const outputResult = await applyOutputGuardsToChoices(
      json.choices ?? [],
      guards.output,
      guards.runtimeConfigs,
      tenant.failure_mode,
      ctx,
    );
    const allDecisions = [...pipelineResult.decisions, ...outputResult.decisions];

    if (outputResult.blocked) {
      record(
        outcome({
          blocked: outputResult.blocked,
          statusCode: 400,
          decisions: allDecisions,
          latencyUpstreamMs,
        }),
      );
      return c.json(blockedErrorBody(requestId, outputResult.blocked), 400);
    }

    c.header("x-palang-decision", finalActionFor(allDecisions, null));
    record(
      outcome({
        blocked: null,
        statusCode: 200,
        decisions: allDecisions,
        latencyUpstreamMs,
        usage: json.usage,
      }),
    );
    return c.json(json);
  });

  app.onError((error, c) => {
    logger.error({ err: error }, "unhandled error");
    return c.json({ error: { message: "Internal error", code: "internal_error" } }, 500);
  });

  return app;
}

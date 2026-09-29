import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { stream } from "hono/streaming";
import { sql } from "drizzle-orm";
import type { Db } from "../db/index.js";
import {
  getCanary,
  maskPiiDeep,
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
import { chatCompletionRequestSchema, type ChatCompletionRequest } from "./request-schema.js";
import { blockedErrorBody } from "./errors.js";
import { buildAllTenantGuards } from "./guards.js";
import { applyOutputGuardsToChoices } from "./apply-output-guards.js";
import { completionSchema } from "../stream/types.js";

export interface Variables {
  tenantId: string;
  apiKeyId: string;
}

export interface PublicAppDeps {
  db: Db;
  config: PalangConfig;
  auditQueue: AuditQueue;
  classifiers?: ReadonlyMap<string, InjectionClassifier>;
  metrics?: GatewayMetrics;
  logger?: Logger;
}

function forwardableErrorHeaders(upstream: Headers): Headers {
  const headers = new Headers();
  upstream.forEach((value, name) => {
    if (name === "content-type" || name === "retry-after" || name.startsWith("x-ratelimit-")) {
      headers.set(name, value);
    }
  });
  return headers;
}

// logprobs would leak raw tokens past the output guards.
function upstreamBody(
  body: ChatCompletionRequest,
  ctx: GuardContext,
  tenant: TenantConfig,
): Record<string, unknown> {
  const { model, ...rest }: Record<string, unknown> = { ...body, messages: ctx.messages };
  delete rest.logprobs;
  delete rest.top_logprobs;
  const pii = tenant.guards["pii-id"];
  if (!pii) return { model, ...rest };
  const masked = maskPiiDeep(rest, ctx.piiVault, pii.entities).value;
  return { model, ...(masked as Record<string, unknown>) };
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
    if ("functions" in body || "function_call" in body) {
      return c.json(
        {
          error: {
            message:
              "The deprecated `functions`/`function_call` parameters aren't supported; use `tools`",
            code: "unsupported_parameter",
          },
        },
        400,
      );
    }
    const requestId = crypto.randomUUID();
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
    // Bun only closes the upstream connection on abort, not when the body is cancelled; without
    // this, a stream ended early keeps the provider generating.
    const upstreamAbort = new AbortController();
    let upstreamResponse: Response;
    try {
      upstreamResponse = await callUpstream(
        {
          baseUrl: tenant.upstream.base_url,
          apiKey: tenant.upstream.api_key,
          timeoutMs: tenant.upstream.timeout_ms,
        },
        upstreamBody(body, ctx, tenant),
        AbortSignal.any([c.req.raw.signal, upstreamAbort.signal]),
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
      // Provisional: headers go out before the verdict, so a block arrives in-band as an SSE error.
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
          upstreamAbort.abort();
          // 499: nginx's "client closed request".
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

    const completion = completionSchema.safeParse(await upstreamResponse.json().catch(() => null));
    if (!completion.success) {
      metrics.recordUpstreamError(tenant.id);
      record(
        outcome({
          blocked: null,
          statusCode: 502,
          decisions: pipelineResult.decisions,
          latencyUpstreamMs,
          response: null,
        }),
      );
      return c.json(
        { error: { message: "Upstream returned an invalid response", code: "upstream_error" } },
        502,
      );
    }
    const json = completion.data;
    // Captured before the output guards restore placeholders in place.
    json.choices.forEach((choice, index) => {
      if (choice.message?.content) response?.text(index, choice.message.content);
      for (const call of choice.message?.tool_calls ?? []) response?.toolCall(index, call);
      if (choice.message) delete choice.message.function_call;
    });

    const outputResult = await applyOutputGuardsToChoices(json.choices, {
      guards: guards.output,
      configs: guards.runtimeConfigs,
      failureMode: tenant.failure_mode,
      ctx,
    });
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

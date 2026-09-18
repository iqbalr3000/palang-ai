import { Hono } from "hono";
import { stream } from "hono/streaming";
import { sql } from "drizzle-orm";
import type { Db } from "@palang-ai/db";
import { runInputPipeline, type GuardContext } from "@palang-ai/core";
import type { PalangConfig, TenantConfig } from "../config/schema.js";
import { createAuthMiddleware } from "../auth/middleware.js";
import { matchGlob } from "../util/glob.js";
import { callUpstream } from "../upstream/adapter.js";
import { processStream } from "../stream/processor.js";
import type { AuditQueue } from "../audit/queue.js";
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
}

function findTenant(config: PalangConfig, tenantId: string): TenantConfig | undefined {
  return config.tenants.find((t) => t.id === tenantId);
}

export function createPublicApp(deps: PublicAppDeps): Hono<{ Variables: Variables }> {
  const app = new Hono<{ Variables: Variables }>();
  const auth = createAuthMiddleware(deps.db);
  const tenantGuards = buildAllTenantGuards(deps.config.tenants);

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

  app.post("/v1/chat/completions", auth, async (c) => {
    const requestStart = performance.now();
    const tenant = findTenant(deps.config, c.get("tenantId"));
    if (!tenant) return c.json({ error: { message: "Unknown tenant" } }, 401);
    const guards = tenantGuards.get(tenant.id)!;

    const parsed = chatCompletionRequestSchema.safeParse(await c.req.json());
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

    const guardsStart = performance.now();
    const pipelineResult = await runInputPipeline(guards.input, ctx, {
      failureMode: tenant.failure_mode,
      guards: guards.runtimeConfigs,
    });
    const latencyGuardsMs = performance.now() - guardsStart;

    if (pipelineResult.blocked) {
      deps.auditQueue.enqueue({
        id: requestId,
        tenantId: tenant.id,
        apiKeyId,
        model: body.model,
        stream: body.stream ?? false,
        finalAction: "block",
        blockedBy: pipelineResult.blocked.guard,
        statusCode: 400,
        decisions: pipelineResult.decisions,
        latencyTotalMs: performance.now() - requestStart,
        latencyGuardsMs,
      });
      return c.json(blockedErrorBody(requestId, pipelineResult.blocked), 400);
    }

    const upstreamStart = performance.now();
    let upstreamResponse: Response;
    try {
      upstreamResponse = await callUpstream(
        { baseUrl: tenant.upstream.base_url, apiKey: tenant.upstream.api_key },
        { ...body, messages: ctx.messages }, // input guards mutate ctx.messages in place
        c.req.raw.signal,
      );
    } catch {
      deps.auditQueue.enqueue({
        id: requestId,
        tenantId: tenant.id,
        apiKeyId,
        model: body.model,
        stream: body.stream ?? false,
        finalAction: "allow",
        statusCode: 502,
        decisions: pipelineResult.decisions,
        latencyTotalMs: performance.now() - requestStart,
        latencyGuardsMs,
      });
      return c.json({ error: { message: "Upstream request failed", code: "upstream_error" } }, 502);
    }
    const latencyUpstreamMs = performance.now() - upstreamStart;

    if (!upstreamResponse.ok) {
      // no guard restore on error bodies — forwarded as-is
      deps.auditQueue.enqueue({
        id: requestId,
        tenantId: tenant.id,
        apiKeyId,
        model: body.model,
        stream: body.stream ?? false,
        finalAction: "allow",
        statusCode: upstreamResponse.status,
        decisions: pipelineResult.decisions,
        latencyTotalMs: performance.now() - requestStart,
        latencyGuardsMs,
        latencyUpstreamMs,
      });
      return new Response(upstreamResponse.body, {
        status: upstreamResponse.status,
        headers: upstreamResponse.headers,
      });
    }

    c.header("x-palang-request-id", requestId);

    if (body.stream) {
      // Headers (and the 200 status) are already committed once the SSE body starts, so this is
      // provisional — a guard block is signaled in-band as an error event instead. The real
      // outcome is only known once the stream ends, which is when it's actually audited below.
      c.header("x-palang-decision", "allow");
      return stream(c, async (s) => {
        const result = await processStream(
          upstreamResponse.body!,
          {
            outputGuards: guards.output,
            guardConfigs: guards.runtimeConfigs,
            failureMode: tenant.failure_mode,
            ctx,
          },
          async (chunk) => {
            await s.write(chunk);
          },
        );
        deps.auditQueue.enqueue({
          id: requestId,
          tenantId: tenant.id,
          apiKeyId,
          model: body.model,
          stream: true,
          finalAction: result.blocked ? "block" : "allow",
          blockedBy: result.blocked?.guard,
          statusCode: 200,
          decisions: [...pipelineResult.decisions, ...result.decisions],
          latencyTotalMs: performance.now() - requestStart,
          latencyGuardsMs,
          latencyUpstreamMs,
        });
      });
    }

    const json = (await upstreamResponse.json()) as {
      choices?: NonStreamingChoice[];
      usage?: unknown;
    };

    const outputResult = await applyOutputGuardsToChoices(
      json.choices ?? [],
      guards.output,
      guards.runtimeConfigs,
      tenant.failure_mode,
      ctx,
    );
    const allDecisions = [...pipelineResult.decisions, ...outputResult.decisions];

    if (outputResult.blocked) {
      deps.auditQueue.enqueue({
        id: requestId,
        tenantId: tenant.id,
        apiKeyId,
        model: body.model,
        stream: false,
        finalAction: "block",
        blockedBy: outputResult.blocked.guard,
        statusCode: 400,
        decisions: allDecisions,
        latencyTotalMs: performance.now() - requestStart,
        latencyGuardsMs,
        latencyUpstreamMs,
      });
      return c.json(blockedErrorBody(requestId, outputResult.blocked), 400);
    }

    c.header("x-palang-decision", "allow");
    deps.auditQueue.enqueue({
      id: requestId,
      tenantId: tenant.id,
      apiKeyId,
      model: body.model,
      stream: false,
      finalAction: "allow",
      statusCode: 200,
      decisions: allDecisions,
      latencyTotalMs: performance.now() - requestStart,
      latencyGuardsMs,
      latencyUpstreamMs,
      usage: json.usage,
    });
    return c.json(json);
  });

  return app;
}

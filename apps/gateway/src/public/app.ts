import { Hono } from "hono";
import { sql } from "drizzle-orm";
import type { Db } from "@palang-ai/db";
import { runInputPipeline } from "@palang-ai/core";
import type { PalangConfig, TenantConfig } from "../config/schema.js";
import { createAuthMiddleware } from "../auth/middleware.js";
import { matchGlob } from "../util/glob.js";
import { callUpstream } from "../upstream/adapter.js";
import { relayStream } from "../stream/relay.js";
import type { AuditQueue } from "../audit/queue.js";
import { chatCompletionRequestSchema } from "./request-schema.js";
import { blockedErrorBody } from "./errors.js";

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

  app.get("/healthz", (c) => c.text("ok"));

  // Checks DB reachable + config valid only — "models loaded" (TSD §7.1's full definition)
  // becomes meaningful once injection-guard actually loads a model (spec-gateway-core.md Design).
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

    const parsed = chatCompletionRequestSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: { message: "Invalid request body", code: "invalid_request" } }, 400);
    }
    const body = parsed.data;
    const requestId = `req_${crypto.randomUUID()}`;
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

    const guardsStart = performance.now();
    const pipelineResult = await runInputPipeline(
      [], // no guards wired in yet — pii-guard/injection-guard land in later features
      {
        requestId,
        tenantId: tenant.id,
        model: body.model,
        stream: body.stream ?? false,
        messages: body.messages,
        piiVault: new Map(),
        signal: c.req.raw.signal,
        metadata: {},
      },
      { failureMode: tenant.failure_mode, guards: {} },
    );
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
        body,
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

    c.header("x-palang-request-id", requestId);
    c.header("x-palang-decision", "allow");

    if (!upstreamResponse.ok) {
      // Forward upstream errors with original status/body as-is (TSD §7.2) — no PII restore
      // applied to error bodies (moot here, no guards yet).
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

    if (body.stream) {
      // Audit is recorded at hand-off, not after the stream drains — the real
      // latency/ttft/usage-aware accounting is `pii-guard`'s stream processor's job (it already
      // has to inspect every chunk; this stage's relay deliberately doesn't).
      deps.auditQueue.enqueue({
        id: requestId,
        tenantId: tenant.id,
        apiKeyId,
        model: body.model,
        stream: true,
        finalAction: "allow",
        statusCode: 200,
        decisions: pipelineResult.decisions,
        latencyTotalMs: performance.now() - requestStart,
        latencyGuardsMs,
        latencyUpstreamMs,
      });
      return relayStream(c, upstreamResponse.body!);
    }

    const json = (await upstreamResponse.json()) as { usage?: unknown };
    deps.auditQueue.enqueue({
      id: requestId,
      tenantId: tenant.id,
      apiKeyId,
      model: body.model,
      stream: false,
      finalAction: "allow",
      statusCode: 200,
      decisions: pipelineResult.decisions,
      latencyTotalMs: performance.now() - requestStart,
      latencyGuardsMs,
      latencyUpstreamMs,
      usage: json.usage,
    });
    return c.json(json);
  });

  return app;
}

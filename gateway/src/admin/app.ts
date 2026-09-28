import { Hono, type Context } from "hono";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { apiKeys, type Db } from "../db/index.js";
import type { PalangConfig } from "../config/schema.js";
import type { GatewayMetrics } from "../metrics/gateway.js";
import { createAdminAuthMiddleware } from "./middleware.js";
import { generateApiKey } from "../auth/keys.js";
import { decodeCursor, queryEvent, queryEvents, queryStats } from "./queries.js";

export interface AdminAppDeps {
  db: Db;
  config: PalangConfig;
  adminToken: string;
  metrics: GatewayMetrics;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const datetime = z
  .string()
  .datetime({ offset: true })
  .transform((v) => new Date(v));

const statsQuerySchema = z.object({
  from: datetime.optional(),
  to: datetime.optional(),
  tenant: z.string().min(1).optional(),
});

const eventsQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  tenant: z.string().min(1).optional(),
  action: z.enum(["allow", "flag", "block"]).optional(),
  guard: z.string().min(1).optional(),
  from: datetime.optional(),
  to: datetime.optional(),
});

const REDACTED = "***";

function redactTenant(tenant: PalangConfig["tenants"][number]) {
  return { ...tenant, upstream: { ...tenant.upstream, api_key: REDACTED } };
}

function badQuery(c: Context, error: z.ZodError) {
  const issues = error.issues.map((i) => `${i.path.join(".") || "query"}: ${i.message}`);
  return c.json({ error: { message: "Invalid query", code: "invalid_query", issues } }, 400);
}

const createKeyBodySchema = z.object({
  name: z.string().min(1),
  env: z.string().min(1).default("live"),
});

export function createAdminApp(deps: AdminAppDeps): Hono {
  const app = new Hono();
  const auth = createAdminAuthMiddleware(deps.adminToken);

  app.post("/admin/tenants/:id/keys", auth, async (c) => {
    const tenantId = c.req.param("id");
    if (!tenantId || !deps.config.tenants.some((t) => t.id === tenantId)) {
      return c.json({ error: { message: `Unknown tenant "${tenantId}"` } }, 404);
    }

    const parsed = createKeyBodySchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return c.json({ error: { message: "Invalid request body" } }, 400);
    }

    const key = await generateApiKey(parsed.data.env);
    const [row] = await deps.db
      .insert(apiKeys)
      .values({ tenantId, name: parsed.data.name, prefix: key.prefix, keyHash: key.hash })
      .returning();

    // returned once — only the hash is ever persisted
    return c.json(
      {
        id: row?.id,
        tenant_id: tenantId,
        name: parsed.data.name,
        prefix: key.prefix,
        key: key.plaintext,
        created_at: row?.createdAt,
      },
      201,
    );
  });

  app.delete("/admin/keys/:id", auth, async (c) => {
    const keyId = c.req.param("id");
    if (!keyId) return c.json({ error: { message: "Missing key id" } }, 400);

    const [row] = await deps.db
      .update(apiKeys)
      .set({ revokedAt: new Date() })
      .where(eq(apiKeys.id, keyId))
      .returning();

    if (!row) return c.json({ error: { message: `Unknown key "${keyId}"` } }, 404);
    return c.body(null, 204);
  });

  app.get("/admin/stats", auth, async (c) => {
    const parsed = statsQuerySchema.safeParse(c.req.query());
    if (!parsed.success) return badQuery(c, parsed.error);
    const to = parsed.data.to ?? new Date();
    const from = parsed.data.from ?? new Date(to.getTime() - DAY_MS);
    if (from >= to) return c.json({ error: { message: "from must be before to" } }, 400);
    return c.json(await queryStats(deps.db, { from, to, tenant: parsed.data.tenant }));
  });

  app.get("/admin/events", auth, async (c) => {
    const parsed = eventsQuerySchema.safeParse(c.req.query());
    if (!parsed.success) return badQuery(c, parsed.error);
    const { cursor: rawCursor, ...filter } = parsed.data;
    const cursor = rawCursor === undefined ? undefined : decodeCursor(rawCursor);
    if (cursor === null) return c.json({ error: { message: "Invalid cursor" } }, 400);
    return c.json(await queryEvents(deps.db, { ...filter, cursor }));
  });

  app.get("/admin/events/:id", auth, async (c) => {
    const id = c.req.param("id") ?? "";
    if (!z.string().uuid().safeParse(id).success) {
      return c.json({ error: { message: `Unknown event "${id}"` } }, 404);
    }
    const event = await queryEvent(deps.db, id);
    if (!event) return c.json({ error: { message: `Unknown event "${id}"` } }, 404);
    return c.json(event);
  });

  app.get("/admin/tenants", auth, (c) =>
    c.json({ tenants: deps.config.tenants.map(redactTenant) }),
  );

  app.get("/admin/tenants/:id/keys", auth, async (c) => {
    const tenantId = c.req.param("id");
    if (!tenantId || !deps.config.tenants.some((t) => t.id === tenantId)) {
      return c.json({ error: { message: `Unknown tenant "${tenantId}"` } }, 404);
    }
    const keys = await deps.db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.tenantId, tenantId))
      .orderBy(desc(apiKeys.createdAt));
    return c.json({
      keys: keys.map((k) => ({
        id: k.id,
        tenant_id: k.tenantId,
        name: k.name,
        prefix: k.prefix,
        created_at: k.createdAt,
        last_used_at: k.lastUsedAt,
        revoked_at: k.revokedAt,
      })),
    });
  });

  app.get("/admin/config", auth, (c) =>
    c.json({ ...deps.config, tenants: deps.config.tenants.map(redactTenant) }),
  );

  app.get("/metrics", auth, (c) =>
    c.text(deps.metrics.render(), 200, { "Content-Type": "text/plain; version=0.0.4" }),
  );

  return app;
}

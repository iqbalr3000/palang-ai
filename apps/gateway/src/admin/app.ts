import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { apiKeys, type Db } from "@palang-ai/db";
import type { PalangConfig } from "../config/schema.js";
import { createAdminAuthMiddleware } from "./middleware.js";
import { generateApiKey } from "../auth/keys.js";

export interface AdminAppDeps {
  db: Db;
  config: PalangConfig;
  adminToken: string;
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

  return app;
}

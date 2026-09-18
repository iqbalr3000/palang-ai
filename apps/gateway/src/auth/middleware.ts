import type { Context, Next } from "hono";
import { eq, and, isNull } from "drizzle-orm";
import { apiKeys, type Db } from "@palang-ai/db";
import { sha256Hex } from "./keys.js";

const LAST_USED_DEBOUNCE_MS = 60_000;
const lastUsedAt = new Map<string, number>();

function unauthorized(c: Context) {
  return c.json(
    {
      error: {
        message: "Invalid or missing API key",
        type: "invalid_request_error",
        code: "invalid_api_key",
      },
    },
    401,
  );
}

// Distinguished from an actually-invalid key so an operator can tell "DB is down" apart from
// "this caller has a bad key" from the response alone.
function authUnavailable(c: Context) {
  return c.json(
    { error: { message: "Auth temporarily unavailable", code: "auth_unavailable" } },
    503,
  );
}

function touchLastUsed(db: Db, keyId: string): void {
  const now = Date.now();
  if (now - (lastUsedAt.get(keyId) ?? 0) < LAST_USED_DEBOUNCE_MS) return;
  lastUsedAt.set(keyId, now);
  void db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, keyId));
}

// Looked up by exact key_hash equality via the DB rather than an in-process string compare —
// that lookup doesn't reproduce the timing side channel a naive compare would.
export function createAuthMiddleware(db: Db) {
  return async (c: Context, next: Next) => {
    const header = c.req.header("Authorization");
    if (!header?.startsWith("Bearer ")) return unauthorized(c);

    const token = header.slice("Bearer ".length);
    const hash = await sha256Hex(token);

    let key: typeof apiKeys.$inferSelect | undefined;
    try {
      [key] = await db
        .select()
        .from(apiKeys)
        .where(and(eq(apiKeys.keyHash, hash), isNull(apiKeys.revokedAt)));
    } catch {
      return authUnavailable(c);
    }

    if (!key) return unauthorized(c);

    c.set("tenantId", key.tenantId);
    c.set("apiKeyId", key.id);
    touchLastUsed(db, key.id);

    await next();
  };
}

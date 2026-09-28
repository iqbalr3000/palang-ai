import type { Context, Next } from "hono";
import { timingSafeEqualString } from "../util/timing-safe-equal.js";

export function createAdminAuthMiddleware(adminToken: string) {
  return async (c: Context, next: Next) => {
    const header = c.req.header("Authorization");
    const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;

    if (!token || !timingSafeEqualString(token, adminToken)) {
      return c.json({ error: { message: "Invalid or missing admin token" } }, 401);
    }
    await next();
  };
}

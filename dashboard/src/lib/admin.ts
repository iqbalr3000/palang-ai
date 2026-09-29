import "server-only";
import { requireSession } from "./auth";
import { createAdminClient, type AdminClient } from "./admin-client";
import { dashboardEnv } from "./env";

export async function admin(): Promise<AdminClient> {
  await requireSession();
  const env = dashboardEnv();
  return createAdminClient({ baseUrl: env.PALANG_ADMIN_URL, token: env.PALANG_ADMIN_TOKEN });
}

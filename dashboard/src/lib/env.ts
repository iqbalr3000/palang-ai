import "server-only";
import { z } from "zod";

const envSchema = z.object({
  PALANG_ADMIN_URL: z.string().url().default("http://localhost:8081"),
  PALANG_ADMIN_TOKEN: z.string().min(1),
  DASHBOARD_PASSWORD: z.string().min(12, "must be at least 12 characters"),
});

export type DashboardEnv = z.infer<typeof envSchema>;

// Read per call, not at import, so `next build` works without the runtime secrets.
export function dashboardEnv(): DashboardEnv {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const missing = result.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Dashboard is missing or has invalid env: ${missing} — see .env.example`);
  }
  return result.data;
}

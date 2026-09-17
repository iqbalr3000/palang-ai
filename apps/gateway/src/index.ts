import { createDb } from "@palang-ai/db";
import { loadConfig, ConfigError } from "./config/loader.js";
import { AuditQueue } from "./audit/queue.js";
import { createPublicApp } from "./public/app.js";
import { createAdminApp } from "./admin/app.js";

async function main(): Promise<void> {
  let config;
  try {
    config = await loadConfig();
  } catch (error) {
    // Invalid config -> process exits with a readable error (TSD §8).
    console.error(error instanceof ConfigError ? error.message : error);
    process.exit(1);
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  const adminToken = process.env.PALANG_ADMIN_TOKEN;
  if (!adminToken) {
    console.error("PALANG_ADMIN_TOKEN is required");
    process.exit(1);
  }

  const db = createDb(databaseUrl);
  const auditQueue = new AuditQueue(db);

  const publicApp = createPublicApp({ db, config, auditQueue });
  const adminApp = createAdminApp({ db, config, adminToken });

  const publicServer = Bun.serve({ port: config.server.public_port, fetch: publicApp.fetch });
  const adminServer = Bun.serve({ port: config.server.admin_port, fetch: adminApp.fetch });

  console.log(`[gateway] public API on :${config.server.public_port}`);
  console.log(`[gateway] admin API on :${config.server.admin_port}`);

  // Graceful shutdown (TSD §7.5): stop accepting requests, flush the audit queue with a deadline.
  const shutdown = async () => {
    console.log("[gateway] shutting down...");
    publicServer.stop();
    adminServer.stop();
    await auditQueue.shutdown(5000);
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

await main();

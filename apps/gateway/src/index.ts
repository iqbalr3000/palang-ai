import { createDb } from "@palang-ai/db";
import { loadConfig, loadEnv, ConfigError } from "./config/index.js";
import { AuditQueue } from "./audit/queue.js";
import { startRetention } from "./audit/retention.js";
import { createPublicApp } from "./public/app.js";
import { createAdminApp } from "./admin/app.js";
import { loadClassifiers } from "./classifier/load.js";
import { createGatewayMetrics } from "./metrics/gateway.js";
import { createLogger } from "./log/logger.js";

async function main(): Promise<void> {
  let config;
  let env;
  try {
    config = await loadConfig();
    env = loadEnv();
  } catch (error) {
    console.error(error instanceof ConfigError ? error.message : error);
    process.exit(1);
  }
  const logger = createLogger(env.logLevel);

  let classifiers;
  try {
    classifiers = await loadClassifiers(config);
  } catch (error) {
    logger.fatal(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
  for (const modelId of classifiers.keys()) {
    logger.info({ model: modelId }, "injection classifier loaded");
  }

  const db = createDb(env.databaseUrl);
  const auditQueue = new AuditQueue(db);
  const metrics = createGatewayMetrics(auditQueue);
  const stopRetention = startRetention(db, config.audit.retention_days, logger);

  const publicApp = createPublicApp({ db, config, auditQueue, classifiers, metrics, logger });
  const adminApp = createAdminApp({ db, config, adminToken: env.adminToken, metrics });

  const publicServer = Bun.serve({ port: config.server.public_port, fetch: publicApp.fetch });
  const adminServer = Bun.serve({ port: config.server.admin_port, fetch: adminApp.fetch });

  logger.info({ port: config.server.public_port }, "public API listening");
  logger.info({ port: config.server.admin_port }, "admin API listening");

  const shutdown = async () => {
    logger.info("shutting down");
    publicServer.stop();
    adminServer.stop();
    stopRetention();
    await auditQueue.shutdown(5000);
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

await main();

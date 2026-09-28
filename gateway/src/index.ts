import { createDb } from "./db/index.js";
import { loadConfig, loadEnv, ConfigError } from "./config/index.js";
import { AuditQueue } from "./audit/queue.js";
import { startRetention } from "./audit/retention.js";
import { createPublicApp } from "./public/app.js";
import { createAdminApp } from "./admin/app.js";
import { loadClassifiers } from "./classifier/load.js";
import { createGatewayMetrics } from "./metrics/gateway.js";
import { createLogger } from "./log/logger.js";

const SHUTDOWN_GRACE_MS = 10_000;

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

  const { server } = config;
  const publicServer = Bun.serve({
    hostname: server.public_host,
    port: server.public_port,
    fetch: publicApp.fetch,
  });
  const adminServer = Bun.serve({
    hostname: server.admin_host,
    port: server.admin_port,
    fetch: adminApp.fetch,
  });

  logger.info({ host: server.public_host, port: server.public_port }, "public API listening");
  logger.info({ host: server.admin_host, port: server.admin_port }, "admin API listening");

  const shutdown = async () => {
    logger.info("shutting down");
    // stop() resolves once in-flight responses (streams included) finish, so they're audited.
    const drained = Promise.all([publicServer.stop(), adminServer.stop()]);
    const timedOut = await Promise.race([
      drained.then(() => false),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(true), SHUTDOWN_GRACE_MS)),
    ]);
    if (timedOut) {
      logger.warn("in-flight requests still open at shutdown; closing them");
      await Promise.all([publicServer.stop(true), adminServer.stop(true)]);
    }
    stopRetention();
    await auditQueue.shutdown(5000);
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

await main();

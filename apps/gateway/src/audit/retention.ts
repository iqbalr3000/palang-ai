import { lt } from "drizzle-orm";
import { auditEvents, type Db } from "@palang-ai/db";
import type { Logger } from "../log/logger.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export async function deleteExpiredEvents(
  db: Db,
  retentionDays: number,
  now = new Date(),
): Promise<number> {
  const cutoff = new Date(now.getTime() - retentionDays * DAY_MS);
  const deleted = await db
    .delete(auditEvents)
    .where(lt(auditEvents.createdAt, cutoff))
    .returning({ id: auditEvents.id });
  return deleted.length;
}

/** Runs now, then daily. A failed run is logged and retried on the next tick. */
export function startRetention(db: Db, retentionDays: number, logger: Logger): () => void {
  const run = async () => {
    try {
      const deleted = await deleteExpiredEvents(db, retentionDays);
      logger.info({ deleted, retention_days: retentionDays }, "audit retention");
    } catch (error) {
      logger.error({ err: error }, "audit retention failed");
    }
  };
  void run();
  const timer = setInterval(() => void run(), DAY_MS);
  return () => clearInterval(timer);
}

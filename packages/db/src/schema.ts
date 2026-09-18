import type { FinalAction } from "@palang-ai/core";
import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  jsonb,
  index,
} from "drizzle-orm/pg-core";

export const apiKeys = pgTable("api_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: text("tenant_id").notNull(),
  name: text("name").notNull(),
  prefix: text("prefix").notNull(),
  keyHash: text("key_hash").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey(), // request id, not auto-generated
    tenantId: text("tenant_id").notNull(),
    apiKeyId: uuid("api_key_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    model: text("model").notNull(),
    stream: boolean("stream").notNull(),
    finalAction: text("final_action").$type<FinalAction>().notNull(),
    blockedBy: text("blocked_by"),
    statusCode: integer("status_code").notNull(),
    decisions: jsonb("decisions").notNull(),
    latencyTotalMs: integer("latency_total_ms").notNull(),
    latencyGuardsMs: integer("latency_guards_ms").notNull(),
    latencyUpstreamMs: integer("latency_upstream_ms"),
    ttftMs: integer("ttft_ms"),
    usage: jsonb("usage"),
    requestContent: jsonb("request_content"),
    responseContent: jsonb("response_content"),
  },
  (table) => [
    index("audit_events_tenant_created_idx").on(table.tenantId, table.createdAt.desc()),
    index("audit_events_action_created_idx").on(table.finalAction, table.createdAt.desc()),
  ],
);

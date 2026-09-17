import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";

// Dummy table for spike purposes — not the real TSD §9 schema.
export const spikeEvents = pgTable("spike_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  label: text("label").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

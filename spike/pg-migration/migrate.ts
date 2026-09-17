import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { spikeEvents } from "./schema";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://postgres:spike@localhost:55432/spike";

const migrationClient = postgres(DATABASE_URL, { max: 1 });
const db = drizzle(migrationClient);

console.log("Running migration under Bun...");
const start = performance.now();
await migrate(db, { migrationsFolder: "./drizzle" });
console.log(`Migration applied in ${(performance.now() - start).toFixed(1)}ms`);

// Verify: insert + read back through the same driver, under Bun.
const queryClient = postgres(DATABASE_URL, { max: 1 });
const qdb = drizzle(queryClient);

const inserted = await qdb.insert(spikeEvents).values({ label: "bun-spike" }).returning();
console.log("Inserted:", inserted);

const rows = await qdb.select().from(spikeEvents);
console.log("Read back:", rows);

await migrationClient.end();
await queryClient.end();
process.exit(0);

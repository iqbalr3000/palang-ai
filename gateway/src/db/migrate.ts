import { join } from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required — see .env.example");
  process.exit(1);
}

const client = postgres(databaseUrl, { max: 1, onnotice: () => {} });
await migrate(drizzle(client), { migrationsFolder: join(import.meta.dir, "../../drizzle") });
await client.end();
console.log("migrations applied");

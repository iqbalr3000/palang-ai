import { chmodSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const randomHex = (bytes: number) =>
  Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString("hex");

async function createFrom(template: string, target: string, fill?: (text: string) => string) {
  const targetPath = join(root, target);
  if (existsSync(targetPath)) {
    console.log(`• ${target} already exists — left as is`);
    return false;
  }
  const text = await Bun.file(join(root, template)).text();
  await Bun.write(targetPath, fill ? fill(text) : text);
  if (fill) chmodSync(targetPath, 0o600);
  console.log(`✓ created ${target} from ${template}`);
  return true;
}

const password = randomHex(8);
const createdEnv = await createFrom(".env.example", ".env", (text) =>
  text
    .replace(/^PALANG_ADMIN_TOKEN=$/m, `PALANG_ADMIN_TOKEN=${randomHex(32)}`)
    .replace(/^DASHBOARD_PASSWORD=$/m, `DASHBOARD_PASSWORD=${password}`),
);
await createFrom("palang.example.yaml", "palang.yaml");

if (createdEnv) {
  console.log(`\nDashboard password: ${password}  (change DASHBOARD_PASSWORD in .env any time)`);
}
console.log("\nNext: start Postgres, then `bun run db:migrate` — see the README.");

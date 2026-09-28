import { existsSync } from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

const repoRoot = path.join(import.meta.dirname, "..");

// One .env at the repo root serves every app. Values already in the environment win.
const rootEnv = path.join(repoRoot, ".env");
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const nextConfig: NextConfig = {
  // Minimal self-contained server (`.next/standalone`) instead of shipping all of node_modules.
  output: "standalone",
  // Workspace root, so tracing follows dependencies out of this app into the monorepo.
  outputFileTracingRoot: repoRoot,
};

export default nextConfig;

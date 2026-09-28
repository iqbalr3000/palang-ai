import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Minimal self-contained server (`.next/standalone`) instead of shipping all of node_modules.
  output: "standalone",
  // Workspace root, so tracing follows dependencies out of this app into the monorepo.
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
};

export default nextConfig;

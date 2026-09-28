import { ConfigError } from "./loader.js";

const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace", "silent"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export interface GatewayEnv {
  databaseUrl: string;
  adminToken: string;
  logLevel: LogLevel;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new ConfigError(`${name} is required — see .env.example`);
  return value;
}

export function loadEnv(): GatewayEnv {
  const logLevel = process.env.LOG_LEVEL ?? "info";
  const level = LOG_LEVELS.find((l) => l === logLevel);
  if (!level) throw new ConfigError(`LOG_LEVEL must be one of ${LOG_LEVELS.join(", ")}`);
  return {
    databaseUrl: required("DATABASE_URL"),
    adminToken: required("PALANG_ADMIN_TOKEN"),
    logLevel: level,
  };
}

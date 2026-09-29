import pino, { type Logger } from "pino";
import type { LogLevel } from "../config/env.js";

export type { Logger };

export function createLogger(level: LogLevel): Logger {
  return pino({
    level,
    redact: {
      paths: ["authorization", "api_key", "*.authorization", "*.api_key", "headers.authorization"],
      censor: "[redacted]",
    },
  });
}

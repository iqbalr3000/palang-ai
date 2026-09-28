import pino, { type Logger } from "pino";
import type { LogLevel } from "../config/env.js";

export type { Logger };

// Belt and braces: callers log decisions, never payloads (Working rule 4), but anything shaped
// like a credential is censored even if it slips into a log object.
export function createLogger(level: LogLevel): Logger {
  return pino({
    level,
    redact: {
      paths: ["authorization", "api_key", "*.authorization", "*.api_key", "headers.authorization"],
      censor: "[redacted]",
    },
  });
}

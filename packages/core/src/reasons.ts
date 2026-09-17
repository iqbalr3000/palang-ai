// Single source of truth for machine-readable `Decision.reason` / error `code` values
// (CLAUDE.md Conventions). snake_case strings only.

export const REASONS = {
  GUARD_ERROR: "guard_error",
} as const;

export type Reason = (typeof REASONS)[keyof typeof REASONS];

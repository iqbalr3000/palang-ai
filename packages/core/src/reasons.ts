export const REASONS = {
  GUARD_ERROR: "guard_error",
} as const;

export type Reason = (typeof REASONS)[keyof typeof REASONS];

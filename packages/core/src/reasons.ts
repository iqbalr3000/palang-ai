export const REASONS = {
  GUARD_ERROR: "guard_error",
  PROMPT_INJECTION_DETECTED: "prompt_injection_detected",
} as const;

export type Reason = (typeof REASONS)[keyof typeof REASONS];

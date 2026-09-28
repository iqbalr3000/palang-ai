export const REASONS = {
  GUARD_ERROR: "guard_error",
  PROMPT_INJECTION_DETECTED: "prompt_injection_detected",
  TOOL_CALL_DENIED: "tool_call_denied",
  TOOL_CONSTRAINT_VIOLATED: "tool_constraint_violated",
  INVALID_TOOL_ARGUMENTS: "invalid_tool_arguments",
  CANARY_LEAKED: "canary_leaked",
  OUTPUT_PII_DETECTED: "output_pii_detected",
  TOOL_ARGUMENTS_TOO_LARGE: "tool_arguments_too_large",
} as const;

export type Reason = (typeof REASONS)[keyof typeof REASONS];

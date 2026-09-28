export type Primitive = string | number | boolean | null;

export type ToolConstraint =
  | { path: string; op: "eq" | "neq"; value: Primitive }
  | { path: string; op: "lt" | "lte" | "gt" | "gte"; value: number }
  | { path: string; op: "in" | "not_in"; value: Primitive[] }
  | { path: string; op: "regex"; value: string };

export interface ToolPolicyRule {
  /** Glob on the tool name, e.g. `search_*`. */
  tool: string;
  action: "allow" | "deny";
  /** Overrides the default reason code when this rule blocks. */
  reason?: string;
  /** All must pass; only meaningful on `allow` rules. */
  constraints?: ToolConstraint[];
}

export interface ToolPolicyConfig {
  default: "allow" | "deny";
  rules: ToolPolicyRule[];
}

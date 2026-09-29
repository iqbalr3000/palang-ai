export type Primitive = string | number | boolean | null;

export type ToolConstraint =
  | { path: string; op: "eq" | "neq"; value: Primitive }
  | { path: string; op: "lt" | "lte" | "gt" | "gte"; value: number }
  | { path: string; op: "in" | "not_in"; value: Primitive[] }
  | { path: string; op: "regex"; value: string };

export interface ToolPolicyRule {
  tool: string;
  action: "allow" | "deny";
  reason?: string;
  constraints?: ToolConstraint[];
}

export interface ToolPolicyConfig {
  default: "allow" | "deny";
  rules: ToolPolicyRule[];
}

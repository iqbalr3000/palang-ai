import { z } from "zod";

const roleSchema = z.enum(["system", "user", "assistant", "tool"]);
const guardModeSchema = z.enum(["enforce", "monitor"]);

const canaryGuardSchema = z.object({
  mode: guardModeSchema,
  on_detect: z.enum(["block", "flag"]),
});

const piiEntitySchema = z.enum(["NIK", "NPWP", "PHONE_ID", "EMAIL", "CARD"]);

const piiGuardSchema = z.object({
  mode: guardModeSchema,
  entities: z.array(piiEntitySchema),
  roles: z.array(roleSchema).default(["user", "tool", "assistant"]),
  preserve_hint: z.boolean().default(false),
  mask_new_output_pii: z.boolean().default(false),
});

const injectionGuardSchema = z.object({
  mode: guardModeSchema,
  roles: z.array(roleSchema).default(["user", "tool"]),
  flag_threshold: z.number().min(0).max(1),
  block_threshold: z.number().min(0).max(1),
  classifier: z.object({
    enabled: z.boolean(),
    model: z.string(),
  }),
  judge: z.object({
    enabled: z.boolean(),
    model: z.string(),
    low: z.number().min(0).max(1),
    high: z.number().min(0).max(1),
    timeout_ms: z.number().int().positive(),
  }),
});

const constraintSchema = z.object({
  path: z.string(),
  op: z.enum(["eq", "neq", "lt", "lte", "gt", "gte", "in", "not_in", "regex"]),
  value: z.unknown(),
});

const toolPolicyGuardSchema = z.object({
  mode: guardModeSchema,
  default: z.enum(["allow", "deny"]),
  rules: z
    .array(
      z.object({
        tool: z.string(),
        action: z.enum(["allow", "deny"]),
        reason: z.string().optional(),
        constraints: z.array(constraintSchema).optional(),
      }),
    )
    .default([]),
});

const tenantSchema = z.object({
  id: z.string(),
  failure_mode: z.enum(["fail_open", "fail_closed"]),
  upstream: z.object({
    type: z.literal("openai-compatible"),
    base_url: z.string().url(),
    api_key: z.string(),
  }),
  allowed_models: z.array(z.string()),
  guards: z.object({
    canary: canaryGuardSchema.optional(),
    "pii-id": piiGuardSchema.optional(),
    injection: injectionGuardSchema.optional(),
    "tool-policy": toolPolicyGuardSchema.optional(),
  }),
});

export const configSchema = z.object({
  server: z.object({
    public_port: z.number().int().positive(),
    admin_port: z.number().int().positive(),
  }),
  audit: z.object({
    content_mode: z.enum(["none", "redacted", "hash"]).default("redacted"),
    retention_days: z.number().int().positive().default(30),
  }),
  models: z.object({
    path: z.string(),
  }),
  tenants: z.array(tenantSchema).min(1),
});

export type PalangConfig = z.infer<typeof configSchema>;
export type TenantConfig = z.infer<typeof tenantSchema>;

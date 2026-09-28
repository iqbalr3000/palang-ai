import { z } from "zod";
import { DEFAULT_INJECTION_CONFIG } from "@palang-ai/guards";
import { CLASSIFIER_MODEL_ID } from "../classifier/model.js";

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
  mode: guardModeSchema.default("monitor"),
  roles: z.array(roleSchema).default(DEFAULT_INJECTION_CONFIG.roles),
  flag_threshold: z.number().min(0).max(1).default(DEFAULT_INJECTION_CONFIG.flagThreshold),
  block_threshold: z.number().min(0).max(1).default(DEFAULT_INJECTION_CONFIG.blockThreshold),
  timeout_ms: z.number().int().positive().optional(),
  classifier: z
    .object({
      enabled: z.boolean().default(false),
      model: z.string().default(CLASSIFIER_MODEL_ID),
    })
    .default({}),
  // Accepted so existing configs parse, but enabling it must fail loudly rather than no-op.
  judge: z
    .object({
      enabled: z.boolean().refine((enabled) => !enabled, {
        message: "the LLM judge is not implemented yet; set it to false",
      }),
    })
    .optional(),
});

const primitiveSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

// Mirrors `ToolConstraint` in @palang-ai/guards: each op's value type is checked here so a bad
// policy fails at config load, not on the first tool call.
const constraintSchema = z.union([
  z.object({ path: z.string(), op: z.enum(["eq", "neq"]), value: primitiveSchema }),
  z.object({ path: z.string(), op: z.enum(["lt", "lte", "gt", "gte"]), value: z.number() }),
  z.object({ path: z.string(), op: z.enum(["in", "not_in"]), value: z.array(primitiveSchema) }),
  z.object({
    path: z.string(),
    op: z.literal("regex"),
    value: z.string().refine(
      (pattern) => {
        try {
          new RegExp(pattern);
          return true;
        } catch {
          return false;
        }
      },
      { message: "not a valid regular expression" },
    ),
  }),
]);

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

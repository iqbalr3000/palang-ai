import type { GuardRuntimeConfig, InputGuard, OutputGuard } from "@palang-ai/core";
import { createPiiIdInputGuard, createPiiIdOutputGuard, type PiiIdConfig } from "@palang-ai/guards";
import type { TenantConfig } from "../config/schema.js";

export interface TenantGuards {
  input: InputGuard[];
  output: OutputGuard[];
  runtimeConfigs: Record<string, GuardRuntimeConfig>;
}

/** Builds the guard instances active for one tenant, straight from its config block — a guard
 * with no config for this tenant simply isn't included (not disabled-but-present). */
export function buildTenantGuards(tenant: TenantConfig): TenantGuards {
  const input: InputGuard[] = [];
  const output: OutputGuard[] = [];
  const runtimeConfigs: Record<string, GuardRuntimeConfig> = {};

  const piiConfig = tenant.guards["pii-id"];
  if (piiConfig) {
    const config: PiiIdConfig = {
      entities: piiConfig.entities,
      roles: piiConfig.roles,
      preserveHint: piiConfig.preserve_hint,
      maskNewOutputPii: piiConfig.mask_new_output_pii,
    };
    input.push(createPiiIdInputGuard(config));
    output.push(createPiiIdOutputGuard(config));
    runtimeConfigs["pii-id"] = { mode: piiConfig.mode };
  }

  return { input, output, runtimeConfigs };
}

// Built once at boot — tenant config doesn't change at runtime.
export function buildAllTenantGuards(tenants: TenantConfig[]): Map<string, TenantGuards> {
  return new Map(tenants.map((t) => [t.id, buildTenantGuards(t)]));
}

import type { GuardRuntimeConfig, InputGuard, OutputGuard } from "@palang-ai/core";
import {
  createInjectionInputGuard,
  createPiiIdInputGuard,
  createPiiIdOutputGuard,
  type InjectionClassifier,
  type PiiIdConfig,
} from "@palang-ai/guards";
import type { TenantConfig } from "../config/schema.js";

export interface TenantGuards {
  input: InputGuard[];
  output: OutputGuard[];
  runtimeConfigs: Record<string, GuardRuntimeConfig>;
}

/** Builds the guard instances active for one tenant, straight from its config block — a guard
 * with no config for this tenant simply isn't included (not disabled-but-present). */
export function buildTenantGuards(
  tenant: TenantConfig,
  classifiers: ReadonlyMap<string, InjectionClassifier>,
): TenantGuards {
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

  // After pii-id on purpose: the scan (and any findings) should only ever see masked text.
  const injectionConfig = tenant.guards.injection;
  if (injectionConfig) {
    let classifier: InjectionClassifier | undefined;
    if (injectionConfig.classifier.enabled) {
      classifier = classifiers.get(injectionConfig.classifier.model);
      if (!classifier) {
        throw new Error(
          `tenant "${tenant.id}" enables classifier "${injectionConfig.classifier.model}" but it wasn't loaded`,
        );
      }
    }
    input.push(
      createInjectionInputGuard(
        {
          roles: injectionConfig.roles,
          flagThreshold: injectionConfig.flag_threshold,
          blockThreshold: injectionConfig.block_threshold,
        },
        classifier,
      ),
    );
    runtimeConfigs.injection = {
      mode: injectionConfig.mode,
      timeoutMs: injectionConfig.timeout_ms,
    };
  }

  return { input, output, runtimeConfigs };
}

// Built once at boot — tenant config doesn't change at runtime.
export function buildAllTenantGuards(
  tenants: TenantConfig[],
  classifiers: ReadonlyMap<string, InjectionClassifier>,
): Map<string, TenantGuards> {
  return new Map(tenants.map((t) => [t.id, buildTenantGuards(t, classifiers)]));
}

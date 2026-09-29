import type { GuardRuntimeConfig, InputGuard, OutputGuard } from "@palang-ai/guards";
import {
  createCanaryInputGuard,
  createCanaryOutputGuard,
  createInjectionInputGuard,
  createPiiIdInputGuard,
  createPiiIdOutputGuard,
  createToolPolicyOutputGuard,
  type InjectionClassifier,
  type PiiIdConfig,
} from "@palang-ai/guards";
import type { TenantConfig } from "../config/schema.js";

export interface TenantGuards {
  input: InputGuard[];
  output: OutputGuard[];
  runtimeConfigs: Record<string, GuardRuntimeConfig>;
}

export function buildTenantGuards(
  tenant: TenantConfig,
  classifiers: ReadonlyMap<string, InjectionClassifier>,
): TenantGuards {
  const input: InputGuard[] = [];
  const output: OutputGuard[] = [];
  const runtimeConfigs: Record<string, GuardRuntimeConfig> = {};

  // Order matters: injection scans only masked text, and tool-policy sees restored values.
  const canaryConfig = tenant.guards.canary;
  if (canaryConfig) {
    input.push(createCanaryInputGuard());
    output.push(createCanaryOutputGuard({ onDetect: canaryConfig.on_detect }));
    runtimeConfigs.canary = { mode: canaryConfig.mode };
  }

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
    // Failing open would send unmasked messages upstream.
    runtimeConfigs["pii-id"] = { mode: piiConfig.mode, failClosed: true };
  }

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

  const toolPolicyConfig = tenant.guards["tool-policy"];
  if (toolPolicyConfig) {
    output.push(
      createToolPolicyOutputGuard({
        default: toolPolicyConfig.default,
        rules: toolPolicyConfig.rules,
      }),
    );
    runtimeConfigs["tool-policy"] = { mode: toolPolicyConfig.mode };
  }

  return { input, output, runtimeConfigs };
}

export function buildAllTenantGuards(
  tenants: TenantConfig[],
  classifiers: ReadonlyMap<string, InjectionClassifier>,
): Map<string, TenantGuards> {
  return new Map(tenants.map((t) => [t.id, buildTenantGuards(t, classifiers)]));
}

import { parse as parseYaml } from "yaml";
import { configSchema, type PalangConfig } from "./schema.js";

export class ConfigError extends Error {}

const ENV_VAR_PATTERN = /\$\{([A-Z_][A-Z0-9_]*)\}/g;

function interpolateEnvVars(text: string): string {
  return text.replace(ENV_VAR_PATTERN, (_match, varName: string) => {
    const value = process.env[varName];
    if (value === undefined) {
      throw new ConfigError(`Environment variable "${varName}" referenced in config is not set`);
    }
    return value;
  });
}

/** Loads and validates the config file. Throws `ConfigError` with a readable message on any
 * failure (missing file, invalid YAML, unset `${VAR}`, schema violation) — the caller (gateway
 * boot) decides what to do with that, e.g. exit(1). */
export async function loadConfig(
  configPath = process.env.PALANG_CONFIG ?? "./palang.yaml",
): Promise<PalangConfig> {
  const file = Bun.file(configPath);
  if (!(await file.exists())) {
    throw new ConfigError(`Config file not found at "${configPath}"`);
  }

  const raw = await file.text();
  const interpolated = interpolateEnvVars(raw);

  let parsed: unknown;
  try {
    parsed = parseYaml(interpolated);
  } catch (error) {
    throw new ConfigError(`Could not parse "${configPath}" as YAML: ${(error as Error).message}`);
  }

  const result = configSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new ConfigError(`Invalid config at "${configPath}":\n${issues}`);
  }

  return result.data;
}

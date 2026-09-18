import type { Role } from "@palang-ai/core";
import type { PiiEntityType } from "./types.js";

export interface PiiIdConfig {
  entities: PiiEntityType[];
  roles: Role[];
  preserveHint: boolean;
  maskNewOutputPii: boolean;
}

export const DEFAULT_PII_ID_CONFIG: PiiIdConfig = {
  entities: ["NIK", "NPWP", "PHONE_ID", "EMAIL", "CARD"],
  roles: ["user", "tool", "assistant"],
  preserveHint: false,
  maskNewOutputPii: false,
};

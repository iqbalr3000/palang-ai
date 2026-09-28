import type { Role } from "../core/index.js";

export interface InjectionConfig {
  roles: Role[];
  flagThreshold: number;
  blockThreshold: number;
}

export const DEFAULT_INJECTION_CONFIG: InjectionConfig = {
  roles: ["user", "tool"],
  flagThreshold: 0.5,
  blockThreshold: 0.85,
};

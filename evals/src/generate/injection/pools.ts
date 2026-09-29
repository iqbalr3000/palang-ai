import type { Split } from "../../dataset/schema.js";

export type PerSplit<T> = Record<Split, readonly T[]>;

export type Wrapper = (body: string, injected: string | null) => string;

export interface LangPools {
  openers: readonly string[];
  hardLeadIns: readonly string[];
  filler: readonly string[];
  slots: Record<string, readonly string[]>;
  overrides: PerSplit<string>;
  actions: PerSplit<string>;
  wrappers: PerSplit<Wrapper>;
  benignTemplates: PerSplit<string>;
  benignHard: PerSplit<string>;
}

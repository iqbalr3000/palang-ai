import type { Split } from "../../dataset/schema.js";

export type PerSplit<T> = Record<Split, readonly T[]>;

/** `injected` is null for a benign copy. */
export type Wrapper = (body: string, injected: string | null) => string;

export interface LangPools {
  openers: readonly string[];
  hardLeadIns: readonly string[];
  filler: readonly string[];
  slots: Record<string, readonly string[]>;
  // Split-specific below, so test has phrasing never seen while tuning.
  overrides: PerSplit<string>;
  actions: PerSplit<string>;
  wrappers: PerSplit<Wrapper>;
  benignTemplates: PerSplit<string>;
  benignHard: PerSplit<string>;
}

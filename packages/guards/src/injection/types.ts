export type InjectionPatternLang = "en" | "id" | "any";

export interface InjectionPattern {
  id: string;
  lang: InjectionPatternLang;
  weight: number; // 0..1, confidence that a match alone indicates injection
  regex: RegExp; // runs on normalized (lowercased, whitespace-collapsed) text
}

export interface InjectionHeuristicMatch {
  id: string;
  lang: InjectionPatternLang;
  weight: number;
  decoded: boolean; // matched inside a base64-decoded segment, not the visible text
}

export interface InjectionHeuristicResult {
  score: number;
  matches: InjectionHeuristicMatch[];
}

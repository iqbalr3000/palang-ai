export type InjectionPatternLang = "en" | "id" | "any";

export interface InjectionPattern {
  id: string;
  lang: InjectionPatternLang;
  weight: number;
  regex: RegExp;
}

export interface InjectionHeuristicMatch {
  id: string;
  lang: InjectionPatternLang;
  weight: number;
  decoded: boolean;
}

export interface InjectionHeuristicResult {
  score: number;
  matches: InjectionHeuristicMatch[];
}

export const THEME_STORAGE_KEY = "palang-theme";
export const THEMES = ["light", "dark", "system"] as const;
export type Theme = (typeof THEMES)[number];

export function isTheme(value: unknown): value is Theme {
  return THEMES.some((t) => t === value);
}

// Must stay self-contained (globals only): its source is inlined into THEME_BOOTSTRAP.
function resolveAndApply(stored: string | null): void {
  const theme = stored === "light" || stored === "dark" ? stored : "system";
  const dark =
    theme === "dark" ||
    (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
}

export function applyTheme(theme: Theme): void {
  resolveAndApply(theme);
}

export function readStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(stored) ? stored : "system";
  } catch {
    return "system";
  }
}

export const THEME_BOOTSTRAP = `(${resolveAndApply.toString()})((function(){try{return localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)})}catch(e){return null}})())`;

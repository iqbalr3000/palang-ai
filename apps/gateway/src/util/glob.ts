// Minimal `*`-only glob matcher — used for `allowed_models` (TSD §8) and later `tool-policy`
// rules (TSD §6.4), both of which only ever use `*` as a wildcard.

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function matchGlob(pattern: string, value: string): boolean {
  const regex = new RegExp(`^${pattern.split("*").map(escapeRegExp).join(".*")}$`);
  return regex.test(value);
}

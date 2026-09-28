// Scoped to `vault` alone, never guard-instance state — guard instances are shared across
// concurrent requests, so per-request counters can't live there.
export function getOrCreatePlaceholder(
  vault: Map<string, string>,
  type: string,
  normalizedValue: string,
): string {
  for (const [placeholder, value] of vault) {
    if (value === normalizedValue) return placeholder;
  }

  const prefix = `[${type}_`;
  let maxIndex = 0;
  for (const placeholder of vault.keys()) {
    if (!placeholder.startsWith(prefix)) continue;
    const n = Number(placeholder.slice(prefix.length, -1));
    if (n > maxIndex) maxIndex = n;
  }

  const placeholder = `[${type}_${maxIndex + 1}]`;
  vault.set(placeholder, normalizedValue);
  return placeholder;
}

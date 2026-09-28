export const pct = (value: number | null): string =>
  value === null ? "n/a" : `${(value * 100).toFixed(1)}%`;
export const ms = (value: number): string => value.toFixed(3);

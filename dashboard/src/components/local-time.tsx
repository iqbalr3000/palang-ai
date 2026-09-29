"use client";

export function LocalTime({ iso, dateOnly = false }: { iso: string; dateOnly?: boolean }) {
  const date = new Date(iso);
  const text = dateOnly
    ? date.toLocaleDateString(undefined, { dateStyle: "medium" })
    : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "medium" });
  return (
    <time dateTime={iso} title={iso} suppressHydrationWarning>
      {text}
    </time>
  );
}

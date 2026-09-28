import type { AuditEvent } from "@/lib/admin-client";

// Name and prefix only; the full key is never stored.
export function KeyLabel({ apiKey }: { apiKey: AuditEvent["api_key"] }) {
  if (!apiKey) return <span className="text-muted-foreground">Unknown</span>;
  return (
    <span className="inline-flex flex-col leading-tight">
      <span className="text-sm">
        {apiKey.name}
        {apiKey.revoked && <span className="ml-1.5 text-xs text-muted-foreground">(revoked)</span>}
      </span>
      <span className="font-mono text-xs text-muted-foreground">{apiKey.prefix}…</span>
    </span>
  );
}

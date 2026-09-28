"use client";

import { useRouter } from "next/navigation";
import { ActionBadge } from "@/components/action-badge";
import { KeyLabel } from "@/components/key-label";
import { LocalTime } from "@/components/local-time";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { EventDetail } from "@/lib/admin-client";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

function ContentBlock({ title, value }: { title: string; value: unknown }) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium">{title}</h3>
      {value === null || value === undefined ? (
        <p className="text-sm text-muted-foreground">Not stored (content_mode or no response).</p>
      ) : (
        <pre className="max-h-80 overflow-auto rounded-md bg-muted p-3 text-xs whitespace-pre-wrap break-words">
          {JSON.stringify(value, null, 2)}
        </pre>
      )}
    </section>
  );
}

export function EventDrawer({ event, closeHref }: { event: EventDetail; closeHref: string }) {
  const router = useRouter();
  return (
    <Sheet open onOpenChange={(open) => !open && router.push(closeHref, { scroll: false })}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            Event <ActionBadge action={event.final_action} />
          </SheetTitle>
          <SheetDescription className="font-mono text-xs">{event.id}</SheetDescription>
        </SheetHeader>

        <div className="space-y-6 px-4 pb-6">
          <dl className="grid grid-cols-2 gap-3">
            <Field label="Time">
              <LocalTime iso={event.created_at} />
            </Field>
            <Field label="Tenant">{event.tenant_id}</Field>
            <Field label="Key">
              <KeyLabel apiKey={event.api_key} />
            </Field>
            <Field label="Model">{event.model}</Field>
            <Field label="Status">
              {event.status_code}
              {event.stream ? " · stream" : ""}
            </Field>
            <Field label="Latency">
              {event.latency_total_ms} ms total · {event.latency_guards_ms} ms guards
            </Field>
            <Field label="Upstream / TTFT">
              {event.latency_upstream_ms ?? "—"} ms / {event.ttft_ms ?? "—"} ms
            </Field>
          </dl>

          <section className="space-y-2">
            <h3 className="text-sm font-medium">Decisions</h3>
            <ul className="divide-y rounded-md border">
              {event.decisions.map((d, i) => (
                <li key={i} className="space-y-1 p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono">{d.guard}</span>
                    <span className="text-muted-foreground">{d.action}</span>
                    {d.wouldBlock && (
                      <span className="text-xs text-action-flag">would block (monitor)</span>
                    )}
                    {d.reason && <span className="font-mono text-xs">{d.reason}</span>}
                    <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                      {d.latencyMs.toFixed(1)} ms
                    </span>
                  </div>
                  {(d.score !== undefined || (d.findings?.length ?? 0) > 0) && (
                    <p className="text-xs text-muted-foreground">
                      {d.score !== undefined && `score ${d.score.toFixed(2)} · `}
                      {d.findings?.map((f) => f.type).join(", ")}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </section>

          <ContentBlock title="Request (redacted)" value={event.request_content} />
          <ContentBlock
            title="Response (raw model output, redacted)"
            value={event.response_content}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}

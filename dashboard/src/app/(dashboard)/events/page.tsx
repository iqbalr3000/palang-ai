import Link from "next/link";
import { ActionBadge } from "@/components/action-badge";
import { LocalTime } from "@/components/local-time";
import { NativeSelect } from "@/components/native-select";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { admin } from "@/lib/admin";
import type { Action } from "@/lib/admin-client";
import { EventDrawer } from "./event-drawer";
import { KeyLabel } from "@/components/key-label";

const ACTIONS: readonly Action[] = ["allow", "flag", "block"];
const GUARDS = ["canary", "pii-id", "injection", "tool-policy"] as const;
const PAGE_SIZE = 50;

type Params = {
  tenant?: string;
  action?: string;
  guard?: string;
  from?: string;
  to?: string;
  cursor?: string;
  event?: string;
};

// `from`/`to` come from <input type="date">; the range is inclusive of the whole `to` day (UTC).
function dayStart(date: string | undefined, offsetDays = 0): string | undefined {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined;
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString();
}

function href(params: Params, changes: Partial<Params>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...params, ...changes })) {
    if (value) search.set(key, value);
  }
  const text = search.toString();
  return text ? `/events?${text}` : "/events";
}

export default async function EventsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const action = ACTIONS.find((a) => a === params.action);
  const client = await admin();

  const [tenants, page, detail] = await Promise.all([
    client.tenants(),
    client.events({
      tenant: params.tenant,
      action,
      guard: params.guard,
      from: dayStart(params.from),
      to: dayStart(params.to, 1),
      cursor: params.cursor,
      limit: PAGE_SIZE,
    }),
    params.event ? client.event(params.event).catch(() => null) : Promise.resolve(null),
  ]);

  return (
    <>
      <PageHeader title="Events" description="Audit log of every request through the gateway." />

      <form method="get" className="mb-4 flex flex-wrap items-end gap-2">
        <NativeSelect name="tenant" defaultValue={params.tenant ?? ""} aria-label="Tenant">
          <option value="">All tenants</option>
          {tenants.map((t) => (
            <option key={t.id} value={t.id}>
              {t.id}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect name="action" defaultValue={action ?? ""} aria-label="Action">
          <option value="">Any action</option>
          {ACTIONS.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          name="guard"
          defaultValue={params.guard ?? ""}
          aria-label="Guard that flagged or blocked"
        >
          <option value="">Any guard</option>
          {GUARDS.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </NativeSelect>
        <Input
          type="date"
          name="from"
          defaultValue={params.from}
          aria-label="From"
          className="w-auto"
        />
        <Input type="date" name="to" defaultValue={params.to} aria-label="To" className="w-auto" />
        <Button type="submit" variant="outline">
          Filter
        </Button>
        <Button asChild variant="ghost">
          <Link href="/events">Reset</Link>
        </Button>
      </form>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Time</TableHead>
              <TableHead>Tenant</TableHead>
              <TableHead>Key</TableHead>
              <TableHead>Model</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Blocked by</TableHead>
              <TableHead className="text-right">Status</TableHead>
              <TableHead className="text-right">Latency</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {page.events.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
                  No events match these filters.
                </TableCell>
              </TableRow>
            ) : (
              page.events.map((e) => (
                <TableRow key={e.id} className="relative">
                  <TableCell className="whitespace-nowrap">
                    {/* The whole row is the link, via the stretched ::after. */}
                    <Link
                      href={href(params, { event: e.id })}
                      scroll={false}
                      className="after:absolute after:inset-0"
                    >
                      <LocalTime iso={e.created_at} />
                    </Link>
                  </TableCell>
                  <TableCell>{e.tenant_id}</TableCell>
                  <TableCell>
                    <KeyLabel apiKey={e.api_key} />
                  </TableCell>
                  <TableCell className="font-mono text-xs">{e.model}</TableCell>
                  <TableCell>
                    <ActionBadge action={e.final_action} />
                  </TableCell>
                  <TableCell className="font-mono text-xs">{e.blocked_by ?? ""}</TableCell>
                  <TableCell className="text-right tabular-nums">{e.status_code}</TableCell>
                  <TableCell className="text-right tabular-nums">{e.latency_total_ms} ms</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="mt-4 flex justify-end gap-2">
        {params.cursor && (
          <Button asChild variant="outline">
            <Link href={href(params, { cursor: undefined, event: undefined })}>Newest</Link>
          </Button>
        )}
        {page.next_cursor && (
          <Button asChild variant="outline">
            <Link href={href(params, { cursor: page.next_cursor, event: undefined })}>Older</Link>
          </Button>
        )}
      </div>

      {detail && <EventDrawer event={detail} closeHref={href(params, { event: undefined })} />}
    </>
  );
}

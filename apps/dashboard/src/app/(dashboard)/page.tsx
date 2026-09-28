import { ActionChart } from "@/components/action-chart";
import { NativeSelect } from "@/components/native-select";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { admin } from "@/lib/admin";
import { RANGES, parseRange, toSeries } from "@/lib/stats";

const RANGE_LABELS = {
  "24h": "Last 24 hours",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
} as const;

function ms(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : `${value.toFixed(value < 10 ? 1 : 0)} ms`;
}

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; tenant?: string }>;
}) {
  const params = await searchParams;
  const range = parseRange(params.range);
  const tenant = params.tenant || undefined;
  const to = new Date();
  const from = new Date(to.getTime() - RANGES[range]);

  const client = await admin();
  const [tenants, stats] = await Promise.all([
    client.tenants(),
    client.stats({ from: from.toISOString(), to: to.toISOString(), tenant }),
  ]);

  const total = Object.values(stats.totals).reduce((sum, n) => sum + n, 0);
  const guards = [
    ...new Set([...Object.keys(stats.guard_latency_p95_ms), ...stats.by_guard.map((g) => g.guard)]),
  ].sort();
  const countFor = (guard: string, action: string) =>
    stats.by_guard.find((g) => g.guard === guard && g.action === action)?.count ?? 0;
  const maxReason = Math.max(1, ...stats.top_block_reasons.map((r) => r.count));

  return (
    <>
      <PageHeader title="Overview" description={RANGE_LABELS[range]}>
        <form method="get" className="flex flex-wrap items-center gap-2">
          <NativeSelect name="tenant" defaultValue={tenant ?? ""} aria-label="Tenant">
            <option value="">All tenants</option>
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>
                {t.id}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect name="range" defaultValue={range} aria-label="Time range">
            {Object.entries(RANGE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </NativeSelect>
          <Button type="submit" variant="outline">
            Apply
          </Button>
        </form>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Requests", value: total.toLocaleString() },
          { label: "Blocked", value: (stats.totals.block ?? 0).toLocaleString() },
          { label: "Flagged", value: (stats.totals.flag ?? 0).toLocaleString() },
          { label: "Guard overhead p95", value: ms(stats.latency_ms.guards_p95) },
        ].map((stat) => (
          <Card key={stat.label} className="gap-2 py-4">
            <CardHeader className="px-4">
              <CardDescription>{stat.label}</CardDescription>
            </CardHeader>
            <CardContent className="px-4 text-2xl font-semibold tabular-nums">
              {stat.value}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="text-base">Requests over time</CardTitle>
          <CardDescription>Per {stats.bucket}, by final action</CardDescription>
        </CardHeader>
        <CardContent>
          <ActionChart data={toSeries(stats)} bucket={stats.bucket} />
        </CardContent>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Top block reasons</CardTitle>
          </CardHeader>
          <CardContent>
            {stats.top_block_reasons.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing blocked in this period.</p>
            ) : (
              <ul className="space-y-3">
                {stats.top_block_reasons.map((r) => (
                  <li key={r.reason ?? "unknown"} className="space-y-1">
                    <div className="flex justify-between text-sm">
                      <span className="font-mono">{r.reason ?? "unknown"}</span>
                      <span className="tabular-nums text-muted-foreground">{r.count}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-action-block"
                        style={{ width: `${(r.count / maxReason) * 100}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Guards</CardTitle>
            <CardDescription>
              Request latency p50 {ms(stats.latency_ms.total_p50)} · p95{" "}
              {ms(stats.latency_ms.total_p95)}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {guards.length === 0 ? (
              <p className="text-sm text-muted-foreground">No guard activity in this period.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Guard</TableHead>
                    <TableHead className="text-right">Flagged</TableHead>
                    <TableHead className="text-right">Blocked</TableHead>
                    <TableHead className="text-right">Latency p95</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {guards.map((guard) => (
                    <TableRow key={guard}>
                      <TableCell className="font-mono">{guard}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {countFor(guard, "flag")}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {countFor(guard, "block")}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {ms(stats.guard_latency_p95_ms[guard])}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

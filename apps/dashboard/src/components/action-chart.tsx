"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import type { SeriesPoint } from "@/lib/stats";

const config = {
  allow: { label: "Allowed", color: "var(--action-allow)" },
  flag: { label: "Flagged", color: "var(--action-flag)" },
  block: { label: "Blocked", color: "var(--action-block)" },
} satisfies ChartConfig;

export function ActionChart({ data, bucket }: { data: SeriesPoint[]; bucket: "hour" | "day" }) {
  const tick = (iso: string) =>
    bucket === "hour"
      ? new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
      : new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

  return (
    <ChartContainer config={config} className="aspect-auto h-72 w-full">
      <BarChart data={data} margin={{ left: 0, right: 8 }}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="start"
          tickFormatter={tick}
          tickLine={false}
          axisLine={false}
          minTickGap={24}
        />
        <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={40} />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={(_, payload) => tick(String(payload[0]?.payload.start ?? ""))}
            />
          }
        />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar dataKey="allow" stackId="a" fill="var(--color-allow)" />
        <Bar dataKey="flag" stackId="a" fill="var(--color-flag)" />
        <Bar dataKey="block" stackId="a" fill="var(--color-block)" radius={[3, 3, 0, 0]} />
      </BarChart>
    </ChartContainer>
  );
}

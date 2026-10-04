"use client";

import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import type { Point, Slice } from "@/lib/dashboard/metrics";
import type { Series } from "@/lib/dashboard/palette";
import { cn } from "@/lib/utils";

/*
 * The dashboard's three chart shapes, flat and in the PostX palette
 * (`lib/dashboard/palette.ts`). They only receive the numbers the server
 * computed; the colours go straight onto the bars and cells.
 */

const toConfig = (series: Series[]): ChartConfig => Object.fromEntries(series.map((s) => [s.key, { label: s.label, color: s.color }]));

/** Bars over time, one bar per series stacked. */
export function TimeBars({ data, series, className }: { data: Point[]; series: Series[]; className?: string }) {
  return (
    <ChartContainer config={toConfig(series)} className={cn("aspect-auto h-56 w-full", className)}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }} barCategoryGap={data.length > 14 ? 2 : 6}>
        <CartesianGrid vertical={false} stroke="var(--border)" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} interval="equidistantPreserveStart" minTickGap={28} tickMargin={8} />
        <YAxis tickLine={false} axisLine={false} allowDecimals={false} width={48} />
        <ChartTooltip cursor={{ fill: "var(--accent)" }} content={<ChartTooltipContent />} />
        {series.length > 1 ? <ChartLegend content={<ChartLegendContent />} /> : null}
        {series.map((s) => (
          <Bar key={s.key} dataKey={s.key} stackId="a" fill={s.color} radius={0} isAnimationActive={false} />
        ))}
      </BarChart>
    </ChartContainer>
  );
}

/** Horizontal bars by name: board columns, workload, pipeline. One series, or several stacked. */
export function RankedBars({ data, series, colors, className }: { data: Record<string, string | number>[]; series: Series[]; colors?: string[]; className?: string }) {
  const height = Math.max(96, data.length * 30 + 16);
  return (
    <ChartContainer config={toConfig(series)} className={cn("aspect-auto w-full", className)} style={{ height }}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 28, left: 0, bottom: 4 }} barCategoryGap={7} maxBarSize={22}>
        <CartesianGrid horizontal={false} stroke="var(--border)" />
        <XAxis type="number" hide allowDecimals={false} />
        <YAxis type="category" dataKey="name" tickLine={false} axisLine={false} width={100} tick={{ fill: "var(--foreground)" }} />
        <ChartTooltip cursor={{ fill: "var(--accent)" }} content={<ChartTooltipContent />} />
        {series.length > 1 ? <ChartLegend content={<ChartLegendContent />} /> : null}
        {series.map((s, si) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            stackId="a"
            fill={s.color}
            radius={0}
            isAnimationActive={false}
            label={si === series.length - 1 && series.length === 1 ? { position: "right", fill: "var(--muted-foreground)", fontSize: 11 } : undefined}
          >
            {colors && series.length === 1 ? data.map((_, i) => <Cell key={i} fill={colors[i % colors.length]} />) : null}
          </Bar>
        ))}
      </BarChart>
    </ChartContainer>
  );
}

/** Share of a whole: payment state, room hours, work type. */
export function Donut({ data, colors, className }: { data: Slice[]; colors: string[]; className?: string }) {
  const config: ChartConfig = Object.fromEntries(data.map((d, i) => [d.name, { label: d.name, color: colors[i % colors.length] }]));
  const total = data.reduce((a, d) => a + d.value, 0);
  const slices = total ? data : [{ name: "None", value: 1 }];
  return (
    <ChartContainer config={config} className={cn("aspect-auto h-56 w-full", className)}>
      <PieChart margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
        {total ? <ChartTooltip content={<ChartTooltipContent nameKey="name" hideLabel />} /> : null}
        <Pie data={slices} dataKey="value" nameKey="name" innerRadius="60%" outerRadius="86%" stroke="var(--card)" strokeWidth={2} isAnimationActive={false}>
          {slices.map((d, i) => (
            <Cell key={d.name} fill={total ? colors[i % colors.length] : "var(--accent)"} />
          ))}
        </Pie>
        {total ? <ChartLegend content={<ChartLegendContent nameKey="name" />} /> : null}
      </PieChart>
    </ChartContainer>
  );
}

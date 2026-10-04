import type { ReactNode } from "react";
import { Minus, TrendingDown, TrendingUp } from "lucide-react";
import type { Trend } from "@/lib/dashboard/metrics";
import { cn } from "@/lib/utils";

export function Stats({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("grid grid-cols-2 gap-px overflow-clip rounded-xl border border-brand/30 bg-brand/15 lg:grid-cols-4", className)}>{children}</div>;
}

export function Stat({ label, value, accent = false, trend, sub }: { label: string; value: ReactNode; accent?: boolean; trend?: Trend & { invert?: boolean }; sub?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 bg-card px-4 py-3">
      <span className="truncate text-xs font-medium text-muted-foreground">{label}</span>
      <span className="flex items-baseline justify-between gap-3">
        <span className={cn("truncate text-2xl font-semibold tabular-nums tracking-tight", accent && "text-brand")}>{value}</span>
        {trend ? <TrendMark trend={trend} /> : null}
      </span>
      {sub ? <span className="truncate text-xs text-muted-foreground tabular-nums">{sub}</span> : null}
    </div>
  );
}

/** Change against the previous window as a percentage (or "new" when there was nothing before). */
export function TrendMark({ trend, className }: { trend: Trend & { invert?: boolean }; className?: string }) {
  const delta = trend.value - trend.prev;
  const Icon = delta > 0 ? TrendingUp : delta < 0 ? TrendingDown : Minus;
  const pct = trend.prev === 0 ? null : Math.round((delta / Math.abs(trend.prev)) * 100);
  const label = pct === null ? (trend.value === 0 ? "0%" : "new") : `${pct > 0 ? "+" : ""}${pct}%`;
  return (
    <span
      className={cn("inline-flex shrink-0 items-center gap-1 text-xs tabular-nums text-muted-foreground", className)}
      aria-label={`${label} against the previous period`}
    >
      <Icon className="size-3.5" aria-hidden />
      {label}
    </span>
  );
}

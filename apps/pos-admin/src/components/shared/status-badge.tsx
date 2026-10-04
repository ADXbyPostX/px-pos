import type { DeliveryStage, KotStatus, OrderStatus, Presence } from "@px-pos/core";
import { cn } from "@/lib/utils";

/**
 * One visual language for every status: a dot + label. Palette (px-ops rule): white / zinc /
 * brand red; green = done/settled, yellow = waiting on someone, blue = kitchen in progress.
 */
const dot = {
  white: "bg-foreground",
  zinc: "bg-zinc-500",
  dim: "bg-zinc-700",
  red: "bg-brand",
  green: "bg-success",
  yellow: "bg-warning",
  blue: "bg-qc",
} as const;

export type Tone = keyof typeof dot;

export function Pill({ tone, label, muted = false, className }: { tone: Tone; label: string; muted?: boolean; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap", muted ? "text-muted-foreground" : "text-foreground", className)}>
      <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", dot[tone])} />
      {label}
    </span>
  );
}

const ORDER: Record<OrderStatus, { tone: Tone; label: string }> = {
  open: { tone: "red", label: "Running" },
  billed: { tone: "yellow", label: "Billed" },
  settled: { tone: "green", label: "Settled" },
  cancelled: { tone: "dim", label: "Cancelled" },
};

export function OrderStatusBadge({ status, className }: { status: OrderStatus; className?: string }) {
  const s = ORDER[status];
  return <Pill tone={s.tone} label={s.label} muted={status === "cancelled"} className={className} />;
}

const KOT: Record<KotStatus, { tone: Tone; label: string }> = {
  new: { tone: "red", label: "New" },
  preparing: { tone: "blue", label: "Preparing" },
  ready: { tone: "green", label: "Ready" },
  served: { tone: "dim", label: "Served" },
};

export function KotBadge({ status, className }: { status: KotStatus; className?: string }) {
  const s = KOT[status];
  return <Pill tone={s.tone} label={s.label} muted={status === "served"} className={className} />;
}

const PRESENCE: Record<Presence, { tone: Tone; label: string }> = {
  online: { tone: "green", label: "Online" },
  stale: { tone: "yellow", label: "Stale" },
  offline: { tone: "red", label: "Offline" },
  never: { tone: "dim", label: "Never seen" },
};

export function PresenceBadge({ presence, className }: { presence: Presence; className?: string }) {
  const s = PRESENCE[presence];
  return <Pill tone={s.tone} label={s.label} muted={presence === "never"} className={className} />;
}

const STAGE: Record<DeliveryStage, { tone: Tone; label: string }> = {
  placed: { tone: "red", label: "Placed" },
  accepted: { tone: "white", label: "Accepted" },
  preparing: { tone: "blue", label: "Preparing" },
  ready: { tone: "yellow", label: "Ready" },
  out: { tone: "yellow", label: "Out for delivery" },
  delivered: { tone: "green", label: "Delivered" },
};

export function DeliveryBadge({ stage, className }: { stage: DeliveryStage; className?: string }) {
  const s = STAGE[stage];
  return <Pill tone={s.tone} label={s.label} className={className} />;
}

export function ActiveBadge({ active, className, on = "Active", off = "Inactive" }: { active: boolean; className?: string; on?: string; off?: string }) {
  return <Pill tone={active ? "white" : "dim"} label={active ? on : off} muted={!active} className={className} />;
}

/** Small uppercase-free chip for flags ("Late", "Conflict"). */
export function Flag({ children, tone = "yellow", className }: { children: string; tone?: "yellow" | "red" | "zinc"; className?: string }) {
  const t = tone === "red" ? "border-brand/40 text-brand" : tone === "zinc" ? "border-border text-muted-foreground" : "border-warning/40 text-warning";
  return <span className={cn("inline-flex h-5 items-center rounded-md border px-1.5 text-[11px] font-medium whitespace-nowrap", t, className)}>{children}</span>;
}

import { formatINR, type Paise } from "@px-pos/core";
import { cn } from "@/lib/utils";

/** Paise shown as ₹ with Indian grouping, tabular digits. Negative values in muted/red. */
export function Money({ value, decimals = 2, signed = false, className, dimZero = false }: { value: Paise | null | undefined; decimals?: 0 | 2 | "auto"; signed?: boolean; className?: string; dimZero?: boolean }) {
  if (value == null || !Number.isFinite(value)) return <span className={cn("text-muted-foreground", className)}>—</span>;
  return (
    <span className={cn("tabular-nums whitespace-nowrap", value < 0 && "text-brand", dimZero && value === 0 && "text-muted-foreground", className)}>
      {formatINR(value, { decimals, signed })}
    </span>
  );
}

/** Veg / non-veg / egg marker (Indian menu convention): square outline with a dot. */
export function FoodMark({ type, className }: { type: "veg" | "nonveg" | "egg"; className?: string }) {
  const color = type === "veg" ? "border-success text-success" : type === "egg" ? "border-warning text-warning" : "border-brand text-brand";
  const label = type === "veg" ? "Veg" : type === "egg" ? "Egg" : "Non-veg";
  return (
    <span role="img" aria-label={label} title={label} className={cn("inline-flex size-3.5 shrink-0 items-center justify-center rounded-[3px] border", color, className)}>
      <span className="size-1.5 rounded-full bg-current" />
    </span>
  );
}

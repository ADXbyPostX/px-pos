import { formatINR, formatQty, MATERIAL_UNIT_LABEL, VENDOR_PAY_LABEL, type BillState, type MaterialUnit, type VendorPayMode } from "@px-pos/core";
import { Pill } from "@/components/shared/status-badge";

export const rs = (p: number) => formatINR(p, { decimals: "auto" });

/** "20 L", "1.5 kg". */
export const qtyLabel = (qtyMilli: number, unit: MaterialUnit) => `${formatQty(qtyMilli)} ${MATERIAL_UNIT_LABEL[unit] ?? unit}`;

/** "On delivery" or "15 days credit". */
export function termsLabel(creditDays: number): string {
  return creditDays > 0 ? `${creditDays} day${creditDays === 1 ? "" : "s"} credit` : "On delivery";
}

/** How a payment was made, with the till for drawer cash. */
export function wayLabel(mode: VendorPayMode, terminalName?: string): string {
  return mode === "drawer" ? `Drawer cash${terminalName ? ` · ${terminalName}` : ""}` : VENDOR_PAY_LABEL[mode];
}

/** A vendor's standing: to pay (red when past their credit days), advance, settled or inactive. */
export function VendorStatus({ duePaise, advancePaise, overdue, active }: { duePaise: number; advancePaise: number; overdue: boolean; active: boolean }) {
  if (duePaise > 0) return <Pill tone={overdue ? "red" : "yellow"} label={overdue ? "Overdue" : "To pay"} />;
  if (advancePaise > 0) return <Pill tone="white" label="Advance" />;
  if (!active) return <Pill tone="dim" label="Inactive" muted />;
  return <Pill tone="green" label="Settled" />;
}

/** One bill's standing under oldest-first settlement. */
export function BillStatus({ state, duePaise, voided, overdue }: { state: BillState | null; duePaise: number; voided?: boolean; overdue?: boolean }) {
  if (voided) return <Pill tone="dim" label="Void" muted />;
  if (state === "paid") return <Pill tone="green" label="Paid" />;
  if (state === "part") return <Pill tone={overdue ? "red" : "yellow"} label={`Part paid · ${rs(duePaise)} left`} />;
  if (state === "due") return <Pill tone={overdue ? "red" : "yellow"} label="Due" />;
  return <Pill tone="dim" label="Older" muted />;
}

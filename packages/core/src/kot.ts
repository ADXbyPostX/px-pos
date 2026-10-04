import type { Client, KotItem, KotKind, Order, OrderLine, OrderMode, Station } from "./types";

/** The Kitchen screen and KOT flow, unless the admin turned the kitchen off (Order modes). */
export function kitchenOn(c: Pick<Client, "kitchen">): boolean {
  return c.kitchen?.enabled !== false;
}

/** KOT tickets print only while the kitchen is on and their printing hasn't been turned off. */
export function printsKots(c: Pick<Client, "kitchen">): boolean {
  return kitchenOn(c) && c.kitchen?.printKots !== false;
}

/** Units of a line not yet sent to the kitchen. */
export function pendingQty(line: Pick<OrderLine, "qty" | "sentQty">): number {
  return Math.max(0, line.qty - line.sentQty);
}

/** Units of a line that are billable (sent or not, minus voids). */
export function activeQty(line: Pick<OrderLine, "qty" | "voidedQty">): number {
  return Math.max(0, line.qty - line.voidedQty);
}

/** Units that can still be voided (already sent, not yet voided). */
export function voidableQty(line: Pick<OrderLine, "sentQty" | "voidedQty">): number {
  return Math.max(0, line.sentQty - line.voidedQty);
}

/**
 * Group the unsent part of the given lines into per-station KOT item lists.
 * Station order is stable: kitchen, bar, beverage.
 */
export function diffKot(lines: OrderLine[]): Array<{ station: Station; items: KotItem[] }> {
  const byStation = new Map<Station, KotItem[]>();
  for (const l of [...lines].sort((a, b) => a.seq - b.seq)) {
    const qty = pendingQty(l);
    if (qty <= 0) continue;
    const items = byStation.get(l.station) ?? [];
    items.push({
      lineId: l.lineId,
      itemId: l.itemId,
      name: l.name,
      qty,
      ...(l.variantName ? { variantName: l.variantName } : {}),
      ...(l.note ? { note: l.note } : {}),
    });
    byStation.set(l.station, items);
  }
  const order: Station[] = ["kitchen", "bar", "beverage"];
  return order.filter((s) => byStation.has(s)).map((station) => ({ station, items: byStation.get(station) as KotItem[] }));
}

export function kotKind(order: Pick<Order, "kotCount">): KotKind {
  return order.kotCount > 0 ? "addon" : "new";
}

/** Where the order is, as printed on KOTs and shown on the KDS. */
export function kotWhere(order: Pick<Order, "mode" | "tableLabel" | "token" | "customer" | "orderNo">): string {
  return orderWhere(order.mode, order);
}

export function orderWhere(
  mode: OrderMode,
  o: { tableLabel?: string; token?: number; customer?: { name?: string; phone?: string }; orderNo?: string },
): string {
  if (mode === "dineIn") return o.tableLabel ?? "Table";
  if (mode === "quick") {
    // A name given at the counter (e.g. held as "Ravi") is called out with the token. ASCII only: it prints.
    const base = o.token != null ? `Token ${o.token}` : o.orderNo ? `Quick ${o.orderNo}` : "";
    return [base, o.customer?.name?.trim()].filter(Boolean).join(" - ") || "Quick";
  }
  const who = o.customer?.name?.trim() || (o.customer?.phone ? `…${o.customer.phone.slice(-4)}` : "");
  return `DLV ${who}`.trim();
}

export const MODE_LABEL: Record<OrderMode, string> = {
  dineIn: "Dine-in",
  quick: "Quick",
  delivery: "Delivery",
};

export const STATION_LABEL: Record<Station, string> = {
  kitchen: "Kitchen",
  bar: "Bar",
  beverage: "Beverage",
};

/** Consolidate lines of the same item/variant/price/discount for receipts. */
export function consolidateLines<T extends { itemId: string; variantId?: string; unitPricePaise: number; qty: number; name: string; variantName?: string }>(
  lines: T[],
  keyExtra: (l: T) => string = () => "",
): Array<T & { qty: number }> {
  const map = new Map<string, T & { qty: number }>();
  for (const l of lines) {
    const k = `${l.itemId}|${l.variantId ?? ""}|${l.unitPricePaise}|${keyExtra(l)}`;
    const cur = map.get(k);
    if (cur) cur.qty += l.qty;
    else map.set(k, { ...l });
  }
  return [...map.values()];
}

/** Reasons offered when voiding a sent item. Keys are stable (used as stats map keys). */
export const VOID_REASONS = [
  { key: "customer_changed", label: "Customer changed mind" },
  { key: "wrong_item", label: "Wrong item entered" },
  { key: "out_of_stock", label: "Out of stock" },
  { key: "quality", label: "Quality issue" },
  { key: "long_wait", label: "Took too long" },
  { key: "duplicate", label: "Duplicate entry" },
  { key: "other", label: "Other" },
] as const;
export type VoidReason = (typeof VOID_REASONS)[number]["key"];

export const CANCEL_REASONS = [
  { key: "customer_left", label: "Customer left" },
  { key: "wrong_bill", label: "Wrong bill" },
  { key: "payment_failed", label: "Payment failed" },
  { key: "test", label: "Test / training" },
  { key: "merged", label: "Merged into another order" },
  { key: "other", label: "Other" },
] as const;

/** Label for a stored void/cancel reason key ("customer_changed" → "Customer changed mind"); free text passes through. */
export function reasonLabel(key: string): string {
  return [...VOID_REASONS, ...CANCEL_REASONS].find((r) => r.key === key)?.label ?? key;
}

export const DISCOUNT_REASONS = [
  { key: "regular", label: "Regular customer" },
  { key: "staff", label: "Staff meal" },
  { key: "promo", label: "Promotion" },
  { key: "complaint", label: "Complaint" },
  { key: "owner", label: "Owner's guest" },
  { key: "other", label: "Other" },
] as const;

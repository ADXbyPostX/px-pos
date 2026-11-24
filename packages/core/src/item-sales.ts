import type { Invoice, Paise } from "./types";

/** One dish (and size) sold on a business day. */
export interface ItemSalesRow {
  /** Name as printed on the bills (names are frozen when a bill is issued). */
  name: string;
  variantName?: string;
  qty: number;
  /** Menu price × quantity, GST included, before discounts (what the Z calls Gross). */
  grossPaise: Paise;
  /** Item and bill discounts on these lines. */
  discPaise: Paise;
  /** Taxable value (excl. GST) after discounts. */
  taxablePaise: Paise;
}

export interface ItemSales {
  rows: ItemSalesRow[];
  bills: number;
  qty: number;
  grossPaise: Paise;
  discPaise: Paise;
  taxablePaise: Paise;
}

/**
 * Sales per dish from a business day's invoices: issued bills only (cancelled and burned numbers
 * are left out, as on the Z). Lines are matched by name + size, so a renamed dish shows under the
 * name its bills carry. Rows run from the biggest gross down. The totals equal the Z's Gross.
 */
export function itemSales(invoices: ReadonlyArray<Pick<Invoice, "status" | "lines" | "bill">>): ItemSales {
  const byKey = new Map<string, ItemSalesRow>();
  const out: ItemSales = { rows: [], bills: 0, qty: 0, grossPaise: 0, discPaise: 0, taxablePaise: 0 };
  for (const inv of invoices) {
    if (inv.status !== "issued") continue;
    out.bills += 1;
    const names = new Map(inv.lines.map((l) => [l.lineId, l]));
    for (const l of inv.bill.lines) {
      if (l.qty <= 0) continue;
      const snap = names.get(l.lineId);
      const name = snap?.name ?? "Item";
      const variantName = snap?.variantName || undefined;
      const key = `${name}\u0000${variantName ?? ""}`;
      const row = byKey.get(key) ?? { name, ...(variantName ? { variantName } : {}), qty: 0, grossPaise: 0, discPaise: 0, taxablePaise: 0 };
      const disc = l.itemDiscPaise + l.billDiscPaise;
      row.qty += l.qty;
      row.grossPaise += l.grossPaise;
      row.discPaise += disc;
      row.taxablePaise += l.taxablePaise;
      byKey.set(key, row);
      out.qty += l.qty;
      out.grossPaise += l.grossPaise;
      out.discPaise += disc;
      out.taxablePaise += l.taxablePaise;
    }
  }
  out.rows = [...byKey.values()].sort((a, b) => b.grossPaise - a.grossPaise || b.qty - a.qty || itemLabel(a).localeCompare(itemLabel(b)));
  return out;
}

/** "Masala Chai (Large)". */
export const itemLabel = (r: Pick<ItemSalesRow, "name" | "variantName">) => (r.variantName ? `${r.name} (${r.variantName})` : r.name);

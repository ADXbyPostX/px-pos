import { describe, expect, it } from "vitest";
import { computeBill, type BillLineInput } from "../src/bill";
import { itemSales } from "../src/item-sales";
import { receiptText, renderItemSales } from "../src/receipt";
import type { Charges, Invoice, InvoiceLine } from "../src/types";

const noCharges: Charges = { packagingPaise: 0, packagingOn: [], deliveryPaise: 0, serviceChargeBps: 0 };
const client = { taxMode: "regular" as const, rounding: "rupee" as const, defaultTaxBps: 500 };

type L = { id: string; name: string; variant?: string; unit: number; qty: number; voided?: number };
function inv(lines: L[], status: Invoice["status"] = "issued", billDiscount?: BillLineInput["discount"]): Pick<Invoice, "status" | "lines" | "bill"> {
  const bill = computeBill({
    lines: lines.map((l) => ({ lineId: l.id, unitPricePaise: l.unit, qty: l.qty, voidedQty: l.voided ?? 0, taxBps: 500 })),
    ...(billDiscount ? { billDiscount } : {}),
    serviceChargeOptIn: false,
    charges: noCharges,
    mode: "quick",
    client,
  });
  const snap: InvoiceLine[] = lines.map((l) => ({ lineId: l.id, name: l.name, ...(l.variant ? { variantName: l.variant } : {}), qty: l.qty, unitPricePaise: l.unit, amountPaise: l.unit * l.qty, taxBps: 500 }));
  return { status, lines: snap, bill };
}

describe("itemSales", () => {
  it("adds each dish up across bills; the total equals the bills' gross", () => {
    const day = [
      inv([{ id: "a", name: "Tea", unit: 2500, qty: 2 }, { id: "b", name: "Bun Butter", unit: 4000, qty: 1 }]),
      inv([{ id: "a", name: "Tea", unit: 2500, qty: 3 }]),
      inv([{ id: "a", name: "Coffee", variant: "Large", unit: 6000, qty: 1 }, { id: "b", name: "Coffee", unit: 4500, qty: 2 }]),
    ];
    const s = itemSales(day);
    expect(s.rows.map((r) => [r.name, r.variantName ?? "", r.qty, r.grossPaise])).toEqual([
      ["Tea", "", 5, 12500],
      ["Coffee", "", 2, 9000],
      ["Coffee", "Large", 1, 6000],
      ["Bun Butter", "", 1, 4000],
    ]);
    expect(s.bills).toBe(3);
    expect(s.qty).toBe(9);
    expect(s.grossPaise).toBe(day.reduce((n, i) => n + i.bill.grossPaise, 0));
    expect(s.taxablePaise).toBe(day.reduce((n, i) => n + i.bill.taxablePaise, 0));
  });

  it("leaves out cancelled bills and burned numbers, and lines voided to zero", () => {
    const s = itemSales([
      inv([{ id: "a", name: "Tea", unit: 2500, qty: 1 }]),
      inv([{ id: "a", name: "Tea", unit: 2500, qty: 4 }], "cancelled"),
      inv([{ id: "a", name: "Tea", unit: 2500, qty: 1 }], "void_unused"),
      inv([{ id: "a", name: "Samosa", unit: 2000, qty: 2, voided: 2 }, { id: "b", name: "Tea", unit: 2500, qty: 1 }]),
    ]);
    expect(s.rows.map((r) => [r.name, r.qty])).toEqual([["Tea", 2]]);
    expect(s.bills).toBe(2);
  });

  it("keeps discounts apart from gross", () => {
    const s = itemSales([inv([{ id: "a", name: "Tea", unit: 2500, qty: 4 }], "issued", { kind: "pct", value: 1000, reason: "Staff", by: "s1" })]);
    expect(s.rows[0]).toMatchObject({ qty: 4, grossPaise: 10000, discPaise: 1000 });
  });
});

describe("renderItemSales", () => {
  const s = itemSales([
    inv([{ id: "a", name: "Tea", unit: 2500, qty: 120 }, { id: "b", name: "Special Ginger Lemon Honey Tea With Mint", variant: "Large", unit: 6000, qty: 3 }]),
  ]);
  it("prints each dish with qty and gross, and the total", () => {
    const text = receiptText(renderItemSales(s, { cols: 48, outletName: "Tea Room", businessDate: "2026-11-23", printedAtMs: Date.parse("2026-11-24T00:22:00+05:30") }), 48);
    const lines = text.split("\n");
    expect(text).toContain("ITEM SALES");
    expect(lines.find((l) => l.startsWith("Tea "))).toMatch(/^Tea\s+120\s+3,000\.00$/);
    expect(lines.find((l) => l.startsWith("Total"))).toMatch(/^Total \(2 items\)\s+123\s+3,180\.00$/);
    expect(lines.every((l) => l.length <= 48)).toBe(true);
    expect(text).not.toContain("Discounts");
  });
  it("wraps long names on 58 mm paper", () => {
    const lines = receiptText(renderItemSales(s, { cols: 32, outletName: "Tea Room", businessDate: "2026-11-23", printedAtMs: 0, live: true }), 32).split("\n");
    expect(lines.every((l) => l.length <= 32)).toBe(true);
    expect(lines.some((l) => l.includes("(day not closed)"))).toBe(true);
    expect(lines.find((l) => l.startsWith("Special"))).toMatch(/\s3\s+180\.00$/);
  });
});

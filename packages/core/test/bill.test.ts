import { describe, expect, it } from "vitest";
import { computeBill, rateLabel, halfRateLabel } from "../src/bill";
import type { BillInput, BillLineInput } from "../src/bill";
import type { Charges } from "../src/types";

const noCharges: Charges = { packagingPaise: 0, packagingOn: [], deliveryPaise: 0, serviceChargeBps: 0 };
const regular = { taxMode: "regular" as const, priceMode: "exclusive" as const, rounding: "rupee" as const, defaultTaxBps: 500 };

const line = (id: string, unit: number, qty: number, extra: Partial<BillLineInput> = {}): BillLineInput => ({
  lineId: id,
  unitPricePaise: unit,
  qty,
  voidedQty: 0,
  taxBps: null,
  ...extra,
});

function bill(lines: BillLineInput[], over: Partial<BillInput> = {}) {
  return computeBill({ lines, serviceChargeOptIn: false, charges: noCharges, mode: "dineIn", client: regular, ...over });
}

describe("computeBill — exclusive pricing", () => {
  it("₹100 × 3 at 5% → CGST 7.50 + SGST 7.50 = ₹315", () => {
    const b = bill([line("a", 10000, 3)]);
    expect(b.grossPaise).toBe(30000);
    expect(b.taxablePaise).toBe(30000);
    expect(b.cgstPaise).toBe(750);
    expect(b.sgstPaise).toBe(750);
    expect(b.roundOffPaise).toBe(0);
    expect(b.grandTotalPaise).toBe(31500);
    expect(b.docType).toBe("tax_invoice");
    expect(b.itemQty).toBe(3);
  });

  it("₹200 at 5% → ₹210 (the M4 verification bill)", () => {
    expect(bill([line("a", 20000, 1)]).grandTotalPaise).toBe(21000);
  });

  it("mixes 5% and 18% buckets", () => {
    const b = bill([line("a", 10000, 1), line("b", 20000, 1, { taxBps: 1800 })]);
    expect(b.taxes).toEqual([
      { bps: 500, taxablePaise: 10000, cgstPaise: 250, sgstPaise: 250 },
      { bps: 1800, taxablePaise: 20000, cgstPaise: 1800, sgstPaise: 1800 },
    ]);
    expect(b.grandTotalPaise).toBe(34100);
  });

  it("applies item % then allocates a flat bill discount; rounds to the rupee", () => {
    const b = bill([line("a", 10000, 2, { discount: { kind: "pct", value: 1000, reason: "promo", by: "s1" } }), line("b", 5000, 1)], {
      billDiscount: { kind: "flat", value: 2300, reason: "regular", by: "s1" },
    });
    expect(b.itemDiscPaise).toBe(2000);
    expect(b.billDiscPaise).toBe(2300);
    expect(b.lines.map((l) => l.billDiscPaise)).toEqual([1800, 500]);
    expect(b.taxablePaise).toBe(20700);
    expect(b.cgstPaise).toBe(518);
    expect(b.sgstPaise).toBe(518);
    expect(b.grandTotalPaise).toBe(21700);
    expect(b.roundOffPaise).toBe(-36);
  });

  it("a 100% comp has zero tax and records comp value", () => {
    const b = bill([line("a", 10000, 1, { discount: { kind: "pct", value: 10000, reason: "owner", by: "m1", comp: true } })]);
    expect(b.taxablePaise).toBe(0);
    expect(b.cgstPaise + b.sgstPaise).toBe(0);
    expect(b.grandTotalPaise).toBe(0);
    expect(b.compPaise).toBe(10000);
    expect(b.lines[0]?.comp).toBe(true);
  });

  it("excludes voided units", () => {
    const b = bill([line("a", 10000, 3, { voidedQty: 1 })]);
    expect(b.grossPaise).toBe(20000);
    expect(b.itemQty).toBe(2);
  });

  it("taxes packaging on configured modes only", () => {
    const charges: Charges = { ...noCharges, packagingPaise: 2000, packagingOn: ["quick"] };
    const q = bill([line("a", 10000, 1)], { mode: "quick", charges });
    expect(q.charges).toEqual([{ kind: "packaging", amountPaise: 2000, taxablePaise: 2000, taxBps: 500 }]);
    expect(q.taxablePaise).toBe(12000);
    expect(q.cgstPaise).toBe(300);
    expect(q.grandTotalPaise).toBe(12600);
    expect(q.chargesPaise).toBe(2000);
    const d = bill([line("a", 10000, 1)], { mode: "dineIn", charges });
    expect(d.charges).toEqual([]);
  });

  it("adds no flat charges to an empty or fully voided ticket", () => {
    const charges: Charges = { ...noCharges, packagingPaise: 2000, packagingOn: ["quick", "delivery"], deliveryPaise: 4000 };
    const empty = bill([], { mode: "delivery", charges });
    expect(empty.charges).toEqual([]);
    expect(empty.grandTotalPaise).toBe(0);
    const voided = bill([line("a", 10000, 2, { voidedQty: 2 })], { mode: "quick", charges });
    expect(voided.charges).toEqual([]);
    expect(voided.grandTotalPaise).toBe(0);
  });

  it("adds a delivery charge on delivery orders only", () => {
    const charges: Charges = { ...noCharges, deliveryPaise: 4000 };
    expect(bill([line("a", 10000, 1)], { mode: "delivery", charges }).chargesPaise).toBe(4000);
    expect(bill([line("a", 10000, 1)], { mode: "quick", charges }).chargesPaise).toBe(0);
  });

  it("never adds service charge unless opted in on the bill", () => {
    const charges: Charges = { ...noCharges, serviceChargeBps: 1000 };
    const off = bill([line("a", 10000, 1)], { charges });
    expect(off.charges).toEqual([]);
    const on = bill([line("a", 10000, 1)], { charges, serviceChargeOptIn: true });
    expect(on.charges).toEqual([{ kind: "service", amountPaise: 1000, taxablePaise: 1000, taxBps: 500 }]);
    expect(on.taxablePaise).toBe(11000);
    expect(on.grandTotalPaise).toBe(11600); // 115.50 → 116
    expect(on.roundOffPaise).toBe(50);
  });
});

describe("computeBill — inclusive pricing", () => {
  const inclusive = { ...regular, priceMode: "inclusive" as const };
  it("₹105 inclusive at 5% → taxable 100, tax 5", () => {
    const b = bill([line("a", 10500, 1)], { client: inclusive });
    expect(b.taxablePaise).toBe(10000);
    expect(b.cgstPaise).toBe(250);
    expect(b.sgstPaise).toBe(250);
    expect(b.grandTotalPaise).toBe(10500);
  });
  it("₹100 inclusive at 5% keeps the menu total", () => {
    const b = bill([line("a", 10000, 1)], { client: inclusive });
    expect(b.taxablePaise).toBe(9524);
    expect(b.cgstPaise).toBe(238);
    expect(b.grandTotalPaise).toBe(10000);
  });
  it("puts the paise residual into round-off", () => {
    const b = bill([line("a", 100, 1)], { client: { ...inclusive, rounding: "none" } });
    expect(b.taxablePaise).toBe(95);
    expect(b.cgstPaise).toBe(2);
    expect(b.grandTotalPaise).toBe(100);
    expect(b.roundOffPaise).toBe(1);
  });
  it("splits a bucket's taxable value exactly across lines", () => {
    const b = bill([line("a", 10000, 1), line("b", 10000, 2)], { client: inclusive });
    expect(b.lines.reduce((s, l) => s + l.taxablePaise, 0)).toBe(b.taxablePaise);
  });
});

describe("computeBill — composition, unregistered, rounding", () => {
  it("composition issues a Bill of Supply with no tax", () => {
    const b = bill([line("a", 10000, 1)], { client: { ...regular, taxMode: "composition" } });
    expect(b.docType).toBe("bill_of_supply");
    expect(b.cgstPaise + b.sgstPaise).toBe(0);
    expect(b.grandTotalPaise).toBe(10000);
    expect(b.taxes).toEqual([{ bps: 0, taxablePaise: 10000, cgstPaise: 0, sgstPaise: 0 }]);
  });
  it("unregistered also has no tax", () => {
    expect(bill([line("a", 10000, 1)], { client: { ...regular, taxMode: "unregistered" } }).docType).toBe("bill_of_supply");
  });
  it("round-off is −49 at .49 and +50 at .50; none keeps paise", () => {
    const comp = { ...regular, taxMode: "composition" as const };
    expect(bill([line("a", 10049, 1)], { client: comp }).roundOffPaise).toBe(-49);
    expect(bill([line("a", 10049, 1)], { client: comp }).grandTotalPaise).toBe(10000);
    expect(bill([line("a", 10050, 1)], { client: comp }).roundOffPaise).toBe(50);
    expect(bill([line("a", 10050, 1)], { client: comp }).grandTotalPaise).toBe(10100);
    const none = bill([line("a", 10049, 1)], { client: { ...comp, rounding: "none" } });
    expect(none.grandTotalPaise).toBe(10049);
    expect(none.roundOffPaise).toBe(0);
  });
});

describe("computeBill — invariants", () => {
  it("grand = taxable + cgst + sgst + roundOff for random bills", () => {
    let seed = 7;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31), seed / 2 ** 31);
    const rates = [null, 0, 500, 1800, 4000];
    for (let n = 0; n < 400; n++) {
      const lines = Array.from({ length: 1 + Math.floor(rand() * 6) }, (_, i) =>
        line(`l${i}`, 100 + Math.floor(rand() * 200000), 1 + Math.floor(rand() * 5), {
          taxBps: rates[Math.floor(rand() * rates.length)] ?? null,
          ...(rand() < 0.3 ? { discount: { kind: rand() < 0.5 ? ("pct" as const) : ("flat" as const), value: Math.floor(rand() * 5000), reason: "x", by: "s" } } : {}),
        }),
      );
      const b = computeBill({
        lines,
        serviceChargeOptIn: rand() < 0.3,
        charges: { packagingPaise: rand() < 0.5 ? 1500 : 0, packagingOn: ["dineIn"], deliveryPaise: 0, serviceChargeBps: 500 },
        mode: "dineIn",
        client: { ...regular, priceMode: rand() < 0.5 ? "exclusive" : "inclusive" },
        ...(rand() < 0.3 ? { billDiscount: { kind: "pct" as const, value: 500, reason: "x", by: "s" } } : {}),
      });
      expect(b.grandTotalPaise).toBe(b.taxablePaise + b.cgstPaise + b.sgstPaise + b.roundOffPaise);
      expect(b.cgstPaise).toBe(b.sgstPaise);
      expect(b.grandTotalPaise).toBeGreaterThanOrEqual(0);
      expect(b.grandTotalPaise % 100).toBe(0);
      expect(b.lines.reduce((s, l) => s + l.taxablePaise, 0) + b.chargesPaise).toBe(b.taxablePaise);
    }
  });
});

describe("labels", () => {
  it("formats rates", () => {
    expect(rateLabel(500)).toBe("5%");
    expect(rateLabel(250)).toBe("2.5%");
    expect(halfRateLabel(500)).toBe("2.5%");
    expect(halfRateLabel(1800)).toBe("9%");
  });
});

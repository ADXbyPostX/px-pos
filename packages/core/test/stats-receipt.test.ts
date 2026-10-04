import { describe, expect, it } from "vitest";
import { computeBill } from "../src/bill";
import { countDenoms, expectedCash } from "../src/cash";
import { presence } from "../src/presence";
import { renderInvoice, renderKot, renderZ, receiptText } from "../src/receipt";
import type { InvoicePrint } from "../src/receipt";
import { can, needsApproval } from "../src/roles";
import {
  cancelBillDelta,
  collected,
  diffStats,
  expenseDelta,
  expenseVoidDelta,
  kotDelta,
  netSales,
  quickDelta,
  settleDelta,
  statsTree,
  sumDeltas,
  voidDelta,
  zReport,
} from "../src/stats";
import type { SettleDeltaInput } from "../src/stats";
import { eodRow, snapshotFromLedger, stockEod, stockLevel } from "../src/stock";
import type { Client, DailyStats } from "../src/types";

const bill = computeBill({
  lines: [
    { lineId: "a", unitPricePaise: 20000, qty: 1, voidedQty: 0, taxBps: null },
    { lineId: "b", unitPricePaise: 5000, qty: 2, voidedQty: 0, taxBps: 1800 },
  ],
  serviceChargeOptIn: false,
  charges: { packagingPaise: 1000, packagingOn: ["dineIn"], deliveryPaise: 0, serviceChargeBps: 0 },
  mode: "dineIn",
  client: { taxMode: "regular", priceMode: "exclusive", rounding: "rupee", defaultTaxBps: 500 },
});

const settle: SettleDeltaInput = {
  mode: "dineIn",
  covers: 3,
  lines: { a: { itemId: "paneer", categoryId: "starters" }, b: { itemId: "lime", categoryId: "drinks" } },
  bill,
  applied: [
    { mode: "upi", amountPaise: 10000 },
    { mode: "cash", amountPaise: bill.grandTotalPaise - 10000 },
  ],
  tipPaise: 0,
  series: "DC1",
  settledAtMs: Date.parse("2026-09-29T08:35:00Z"),
  staffId: "s1",
  terminalId: "t1",
};

describe("settle delta", () => {
  it("matches the bill", () => {
    const d = settleDelta(settle);
    expect(d.totalPaise).toBe(bill.grandTotalPaise);
    expect(d.orders).toBe(1);
    expect(d.covers).toBe(3);
    const byPay = d.byPay as Record<string, number>;
    expect(byPay.upi! + byPay.cash!).toBe(bill.grandTotalPaise);
    expect((d.cash as Record<string, { sales: number }>).t1?.sales).toBe(bill.grandTotalPaise - 10000);
    expect((d.byHour as Record<string, { n: number }>)["14"]?.n).toBe(1);
    const byItem = d.byItem as Record<string, { qty: number; net: number }>;
    expect(byItem.paneer).toEqual({ qty: 1, net: 20000 });
    expect(byItem.lime).toEqual({ qty: 2, net: 10000 });
    expect(netSales(d as Partial<DailyStats>)).toBe(30000);
    expect(d.chargesPaise).toBe(1000);
  });

  it("settle + cancel nets sales to zero but keeps collected money and records the refund", () => {
    const s = settleDelta(settle);
    const c = cancelBillDelta({
      settled: true,
      settle,
      bill,
      series: "DC1",
      refunds: settle.applied,
      cancellingTerminalId: "t2",
      items: [{ itemId: "paneer", qty: 1 }],
      tracked: new Set(["paneer"]),
      prepared: false,
    });
    const sum = sumDeltas([s, c.stats]) as Partial<DailyStats>;
    expect(sum.orders).toBe(0);
    expect(sum.totalPaise).toBe(0);
    expect(sum.taxablePaise).toBe(0);
    expect((sum.byMode as Record<string, { n: number }>).dineIn?.n).toBe(0);
    expect(collected(sum)).toBe(0);
    expect(sum.cancelledBills).toEqual({ n: 1, paise: bill.grandTotalPaise });
    expect((sum.cash as Record<string, { refunds?: number; sales?: number }>).t2?.refunds).toBe(bill.grandTotalPaise - 10000);
    expect((sum.invoices as Record<string, { count: number; cancelled: number }>).DC1).toEqual({ count: 1, cancelled: 1 });
    expect(c.stock).toEqual({ paneer: 1 });
  });

  it("quick = kot + settle", () => {
    const q = quickDelta(settle, [{ itemId: "paneer", qty: 1 }, { itemId: "lime", qty: 2 }], new Set(["paneer"]));
    expect(q.stock).toEqual({ paneer: -1 });
    expect(diffStats(q.stats, sumDeltas([settleDelta(settle), kotDelta([{ itemId: "paneer", qty: 1 }], new Set(["paneer"])).stats]))).toEqual([]);
  });
});

describe("stock deltas", () => {
  it("kot deducts tracked items only", () => {
    const k = kotDelta([{ itemId: "a", qty: 2 }, { itemId: "b", qty: 1 }], new Set(["a"]));
    expect(k.stock).toEqual({ a: -2 });
    expect(k.stats).toEqual({ stock: { a: { sold: 2 } } });
  });
  it("voids return (not prepared) or waste (prepared)", () => {
    const back = voidDelta({ itemId: "a", qty: 1, amountPaise: 20000, reason: "wrong_item", prepared: false, staffId: "s1", tracked: true });
    expect(back.stock).toEqual({ a: 1 });
    expect((back.stats.stock as Record<string, { rev: number }>).a?.rev).toBe(1);
    const waste = voidDelta({ itemId: "a", qty: 1, amountPaise: 20000, reason: "quality", prepared: true, staffId: "s1", tracked: true });
    expect(waste.stock).toEqual({});
    expect((waste.stats.stock as Record<string, { waste: number }>).a?.waste).toBe(1);
    expect((waste.stats.voidByReason as Record<string, { n: number }>).quality?.n).toBe(1);
  });
  it("EOD formula and ledger snapshots", () => {
    expect(stockEod(10, { in: 5, sold: 3, rev: 1, waste: 2, adj: -1 })).toBe(10);
    expect(snapshotFromLedger({ a: 10 }, { a: { sold: 4 }, b: { in: 6 } })).toEqual({ a: 6, b: 6 });
    expect(eodRow("a", 10, { sold: 4 }, 5)).toMatchObject({ closing: 6, variance: -1 });
    expect(stockLevel(0, 5)).toBe("out");
    expect(stockLevel(3, 5)).toBe("low");
    expect(stockLevel(30, 5)).toBe("ok");
  });
});

describe("cash drawer", () => {
  it("expected cash accounts for drawer expenses, refunds and drops", () => {
    const e = expenseDelta({ amountPaise: 50000, category: "vegetables", paidVia: "drawer", drawerTerminalId: "t1" });
    const s = sumDeltas([{ cash: { t1: { sales: 300000 } } }, e, { cash: { t1: { refunds: 10000, drops: 100000 } } }]);
    const c = (s.cash as Record<string, { sales: number; refunds: number; paidOut: number; drops: number }>).t1!;
    expect(expectedCash(200000, { paidIn: 0, ...c })).toBe(200000 + 300000 - 10000 - 50000 - 100000);
    expect(sumDeltas([e, expenseVoidDelta({ amountPaise: 50000, category: "vegetables", paidVia: "drawer", drawerTerminalId: "t1" })]).expensesPaise).toBe(0);
  });
  it("counts denominations", () => {
    expect(countDenoms({ "50000": 2, "100": 5, junk: 3 })).toBe(100500);
  });
});

describe("Z report", () => {
  it("summarises stats and drawers", () => {
    const stats = statsTree(sumDeltas([settleDelta(settle), expenseDelta({ amountPaise: 30000, category: "gas_fuel", paidVia: "drawer", drawerTerminalId: "t1" })]) as Record<string, unknown>) as Partial<DailyStats>;
    const z = zReport({ zNo: 1, businessDate: "2026-09-29", closedAtMs: 0, stats, drawers: [{ terminalId: "t1", openingFloatPaise: 200000, countedPaise: 200000 + (bill.grandTotalPaise - 10000) - 30000 - 100 }], invoiceRanges: [] });
    expect(z.totalPaise).toBe(bill.grandTotalPaise);
    expect(z.netPaise).toBe(30000);
    expect(z.drawers[0]?.expectedPaise).toBe(200000 + bill.grandTotalPaise - 10000 - 30000);
    expect(z.drawers[0]?.variancePaise).toBe(-100);
    const text = receiptText(renderZ(z, { cols: 48, outletName: "Demo Cafe" }), 48);
    expect(text).toContain("Z REPORT #1");
    expect(text).toContain("Variance");
  });
});

const client = { approvals: { voidAfterKot: true, discountOverCap: true, comp: true, cancelBill: true, editBill: true, reprint: false, paidOut: false, stockAdjust: true, dayClose: true }, discountCapBps: { owner: 10000, manager: 10000, cashier: 1000, captain: 0, kitchen: 0 } } as Pick<Client, "approvals" | "discountCapBps">;

describe("roles", () => {
  it("permission matrix", () => {
    expect(can("captain", "kot")).toBe(true);
    expect(can("captain", "settle")).toBe(false);
    expect(can("kitchen", "kds")).toBe(true);
    expect(can("kitchen", "order")).toBe(false);
    expect(can("cashier", "cancelBill")).toBe(false);
    expect(can("manager", "dayClose")).toBe(true);
  });
  it("approval prompts", () => {
    expect(needsApproval("discount", "cashier", client, 1500)).toBe(true);
    expect(needsApproval("discount", "cashier", client, 500)).toBe(false);
    expect(needsApproval("discount", "manager", client, 5000)).toBe(false);
    expect(needsApproval("comp", "cashier", client)).toBe(true);
    expect(needsApproval("voidAfterKot", "cashier", client)).toBe(true);
    expect(needsApproval("reprint", "cashier", client)).toBe(false);
    expect(needsApproval("voidAfterKot", "owner", client)).toBe(false);
  });
  it("presence thresholds", () => {
    const now = 10_000_000;
    expect(presence(now - 60_000, now)).toBe("online");
    expect(presence(now - 3 * 60_000, now)).toBe("online");
    expect(presence(now - 3 * 60_000 - 1, now)).toBe("stale");
    expect(presence(now - 30 * 60_000 - 1, now)).toBe("offline");
    expect(presence(undefined, now)).toBe("never");
  });
});

const print: InvoicePrint = {
  invoiceNo: "DC1/26-27/000001",
  issuedAtMs: Date.parse("2026-09-29T08:35:00Z"),
  orderNo: "1-001",
  mode: "dineIn",
  where: "T4",
  covers: 3,
  docType: "tax_invoice",
  supplier: { legalName: "Demo Cafe Private Limited", gstin: "27AAPFU0939F1ZV", fssai: "12345678901234", address: "12 Linking Road, Bandra West, Mumbai 400050", stateName: "Maharashtra", stateCode: "27", phone: "9876543210" },
  lines: [
    { lineId: "a", name: "Paneer Tikka Masala With Extra Butter And Cheese", variantName: "Full", qty: 1, unitPricePaise: 20000, amountPaise: 20000, taxBps: 500 },
    { lineId: "b", name: "Fresh Lime Soda", qty: 2, unitPricePaise: 5000, amountPaise: 10000, taxBps: 1800 },
  ],
  bill,
  payments: [
    { mode: "upi", amountPaise: 10000, ref: "UPI123456789" },
    { mode: "cash", amountPaise: bill.grandTotalPaise - 10000, tenderedPaise: 50000, changePaise: 50000 - (bill.grandTotalPaise - 10000) },
  ],
  staffName: "Ravi",
};
const settings = { header: [], footer: ["Thank you! Visit again."], showSac: true };

describe("receipts", () => {
  for (const cols of [32, 48] as const) {
    it(`tax invoice fits ${cols} columns and carries the legal fields`, () => {
      const lines = renderInvoice(print, settings, { copy: "ORIGINAL", cols });
      for (const l of lines) if (l.kind === "text") expect(l.text.length).toBeLessThanOrEqual(l.size === 2 ? cols / 2 : cols);
      const raw = receiptText(lines, cols);
      for (const line of raw.split("\n")) expect(line.length).toBeLessThanOrEqual(cols);
      const text = raw.replace(/\s+/g, " ");
      expect(text).toContain("TAX INVOICE");
      expect(text).toContain("ORIGINAL FOR RECIPIENT");
      expect(text).toContain("GSTIN: 27AAPFU0939F1ZV");
      expect(text).toContain("FSSAI Lic. No: 12345678901234");
      expect(text).toContain("Place of supply: Maharashtra (27)");
      expect(text).toContain("SAC 996331");
      expect(text).toContain("Reverse charge: No");
      expect(text).toContain("CGST @ 2.5%");
      expect(text).toContain("SGST @ 9%");
      expect(text).toMatch(/TOTAL\s+Rs\.\d/);
      expect(raw).not.toMatch(/[^\x20-\x7E\n]/);
      expect(text).toContain("Order: 1-001");
    });
  }
  it("duplicate copies and bills of supply", () => {
    const dup = receiptText(renderInvoice(print, settings, { copy: "DUPLICATE", cols: 48 }), 48);
    expect(dup).toContain("DUPLICATE");
    expect(dup).not.toContain("ORIGINAL FOR RECIPIENT");
    const bos = receiptText(renderInvoice({ ...print, docType: "bill_of_supply" }, settings, { copy: "ORIGINAL", cols: 48 }), 48);
    expect(bos).toContain("BILL OF SUPPLY");
    expect(bos).toContain("Composition taxable person");
    expect(bos).not.toContain("CGST");
  });
  it("leaves the FSSAI line out until the outlet adds its number", () => {
    const text = receiptText(renderInvoice({ ...print, supplier: { ...print.supplier, fssai: "" } }, settings, { copy: "ORIGINAL", cols: 48 }), 48);
    expect(text).not.toContain("FSSAI");
  });
  it("KOT shows add-on and cancelled banners without prices", () => {
    const base = { kotNo: "1-17", kind: "addon" as const, mode: "dineIn" as const, where: "T4", station: "kitchen" as const, items: [{ lineId: "a", itemId: "p", name: "Paneer Tikka", qty: 2, note: "less spicy" }], orderNo: "1-001", createdAtMs: 0 };
    const addon = receiptText(renderKot(base, { cols: 32 }), 32);
    expect(addon).toContain("KOT 1-17");
    expect(addon).toContain("ADD-ON");
    expect(addon).toContain("2 x Paneer Tikka");
    expect(addon).toContain("> less spicy");
    expect(addon).not.toMatch(/Rs\./);
    expect(receiptText(renderKot({ ...base, kind: "cancel", reason: "Wrong item" }, { cols: 48 }), 48)).toContain("CANCELLED");
  });
});

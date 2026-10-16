import { describe, expect, it } from "vitest";
import { can } from "../src/roles";
import { receiptText, renderVoucher, renderZ } from "../src/receipt";
import { cashStats, expectedCashFor, profitPaise, purchaseDelta, purchaseVoidDelta, sumDeltas, vendorDay, vendorPayDelta, vendorPayVoidDelta, zReport } from "../src/stats";
import { openingBalancePlan, purchaseEditPlan, purchasePlan, purchaseVoidPlan, upsertMaterialPlan, upsertVendorPlan, vendorPaymentPlan, vendorPaymentVoidPlan } from "../src/plans/vendors";
import type { VendorProfile } from "../src/plans/vendors";
import type { PlanCtx, WritePlan } from "../src/plans/types";
import { validateMaterial, validatePurchase, validateVendor, validateVendorPayment } from "../src/validate";
import {
  amountForRate,
  clearedBy,
  fifoCompare,
  formatQty,
  gstInclusiveSplit,
  guessUnit,
  lastRates,
  parseQty,
  payChips,
  paymentPreview,
  priceHistory,
  purchaseSummary,
  purchaseTotals,
  unitRatePaise,
  vendorBalance,
  vendorDrift,
  vendorLedger,
  vendorOverview,
  vendorPosition,
  withGst,
} from "../src/vendors";
import type { FifoBill } from "../src/vendors";
import type { Material, Purchase, StatsDelta, Vendor, VendorPayment } from "../src/types";

let n = 0;
const till: PlanCtx = { cid: "c1", nowMs: Date.parse("2026-10-16T04:30:00Z"), actorId: "s1", actorName: "Ravi", actorKind: "staff", terminalId: "t1", source: "app", newId: () => `a${++n}` };
const admin: PlanCtx = { cid: "c1", nowMs: Date.parse("2026-10-16T04:30:00Z"), actorId: "u1", actorKind: "platform", source: "admin", newId: () => `b${++n}` };
const BD = "2026-10-16";

const postingOpsOf = (p: WritePlan) => p.ops.filter((o) => o.path.includes("/postings/"));
const countedOpsOf = (p: WritePlan) => p.ops.filter((o) => o.path.includes("/dailyStats/") || o.path.includes("/stock/") || (o.path.includes("/vendors/") && o.op === "merge"));

/** One posting, created with set; every counted doc carries its key; no path twice. */
function expectExactlyOnce(p: WritePlan) {
  expect(p.postingKey).toBeTruthy();
  const postings = postingOpsOf(p);
  expect(postings).toHaveLength(1);
  expect(postings[0]?.op).toBe("set");
  expect(postings[0]?.path).toBe(`clients/c1/postings/${p.postingKey}`);
  expect(p.primaryPath).toBe(postings[0]?.path);
  for (const op of countedOpsOf(p)) expect(op.data.lastPostingKey).toBe(p.postingKey);
  expect(new Set(p.ops.map((o) => o.path)).size).toBe(p.ops.length);
}

const bill = (id: string, billDate: string, rupees: number, extra: Partial<FifoBill> = {}): FifoBill => ({ id, kind: "bill", billDate, createdAtMs: Date.parse(`${billDate}T05:00:00Z`), totalPaise: rupees * 100, ...extra });

/** Straight oldest-first allocation of a total paid (the reference the derived walk must match). */
function oldestFirst(bills: FifoBill[], paidPaise: number): Map<string, number> {
  let left = paidPaise;
  const due = new Map<string, number>();
  for (const b of bills.filter((x) => x.status !== "void").sort(fifoCompare)) {
    const pay = Math.min(Math.max(left, 0), b.totalPaise);
    left -= pay;
    due.set(b.id, b.totalPaise - pay);
  }
  return due;
}

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("quantities and GST", () => {
  it("parses and prints quantities in thousandths", () => {
    expect(parseQty("1.5")).toBe(1500);
    expect(parseQty(".5")).toBe(500);
    expect(parseQty("2")).toBe(2000);
    expect(parseQty("0.001")).toBe(1);
    for (const bad of ["", "0", "-1", "1.2345", "1e3", "1,5", "abc", "."]) expect(parseQty(bad)).toBeNull();
    expect(formatQty(1500)).toBe("1.5");
    expect(formatQty(2000)).toBe("2");
    expect(formatQty(1)).toBe("0.001");
    expect(formatQty(1250)).toBe("1.25");
  });
  it("backs GST out of an amount the way bills do", () => {
    expect(gstInclusiveSplit(2500, 500)).toEqual({ taxablePaise: 2380, gstPaise: 120 });
    expect(gstInclusiveSplit(10500, 500)).toEqual({ taxablePaise: 10000, gstPaise: 500 });
    expect(gstInclusiveSplit(5000, 0)).toEqual({ taxablePaise: 5000, gstPaise: 0 });
    expect(withGst(10000, 1800)).toBe(11800);
  });
  it("works out rates and totals", () => {
    expect(unitRatePaise(108000, 20000)).toBe(5400); // ₹1,080 for 20 L = ₹54/L
    expect(amountForRate(5400, 20000)).toBe(108000);
    const t = purchaseTotals(
      [
        { lineId: "a", materialId: "milk", name: "Milk", qtyMilli: 20000, unit: "L", amountPaise: 112000, taxBps: 0 },
        { lineId: "b", materialId: "sugar", name: "Sugar", qtyMilli: 5000, unit: "kg", amountPaise: 21000, taxBps: 500 },
      ],
      -50,
    );
    expect(t.subtotalPaise).toBe(133000);
    expect(t.totalPaise).toBe(132950);
    expect(t.gstPaise).toBe(1000);
    expect(purchaseSummary({ kind: "bill", lines: t.lines })).toBe("Milk 20 L, Sugar 5 kg");
  });
});

describe("oldest-first settlement", () => {
  const mon = bill("mon", "2026-10-12", 1000);
  const wed = bill("wed", "2026-10-14", 600);
  const fri = bill("fri", "2026-10-16", 400);

  it("Mandy's example: half pays the oldest bill first", () => {
    const pos = vendorPosition([fri, mon, wed], 2000_00 - 1300_00);
    const by = Object.fromEntries(pos.bills.map((s) => [s.bill.id, s]));
    expect(by.mon).toMatchObject({ state: "paid", duePaise: 0 });
    expect(by.wed).toMatchObject({ state: "part", duePaise: 300_00, paidPaise: 300_00 });
    expect(by.fri).toMatchObject({ state: "due", duePaise: 400_00 });
    expect(pos.oldestDue?.bill.id).toBe("wed");
    expect(pos.uncoveredPaise).toBe(0);
  });
  it("paying everything settles; paying more leaves an advance", () => {
    expect(vendorPosition([mon, wed, fri], 0).bills.every((s) => s.state === "paid")).toBe(true);
    const over = vendorPosition([mon, wed, fri], -100_00);
    expect(over.advancePaise).toBe(100_00);
    expect(over.duePaise).toBe(0);
    expect(over.oldestDue).toBeNull();
  });
  it("matches a straight oldest-first allocation for any history", () => {
    const rnd = mulberry32(42);
    for (let run = 0; run < 500; run++) {
      const bills: FifoBill[] = [];
      const count = 1 + Math.floor(rnd() * 8);
      for (let i = 0; i < count; i++) {
        const day = `2026-10-${String(1 + Math.floor(rnd() * 5)).padStart(2, "0")}`;
        bills.push(bill(`b${i}`, day, 1 + Math.floor(rnd() * 900), { createdAtMs: Math.floor(rnd() * 3) * 1000, ...(i === 0 && rnd() < 0.3 ? { kind: "opening" as const } : {}), ...(rnd() < 0.15 ? { status: "void" as const } : {}) }));
      }
      const active = bills.filter((b) => b.status !== "void").reduce((s, b) => s + b.totalPaise, 0);
      const paid = Math.floor(rnd() * (active + 50000));
      const ref = oldestFirst(bills, paid);
      const shuffled = [...bills].sort(() => rnd() - 0.5);
      const pos = vendorPosition(shuffled, active - paid);
      for (const s of pos.bills) expect(s.duePaise).toBe(ref.get(s.bill.id));
      expect(pos.uncoveredPaise).toBe(0);
    }
  });
  it("voids, a late bill dated earlier and an opening balance", () => {
    // Voiding the oldest bill moves the line: what's owed is still the newest bills.
    const voided = vendorPosition([{ ...mon, status: "void" }, wed, fri], 700_00);
    expect(voided.bills.map((s) => s.bill.id)).toEqual(["fri", "wed"]);
    expect(Object.fromEntries(voided.bills.map((s) => [s.bill.id, s.state]))).toEqual({ fri: "due", wed: "part" });
    // A bill entered today but dated before everything is the first one paid.
    const late = bill("late", "2026-10-10", 500, { createdAtMs: Date.parse("2026-10-16T09:00:00Z") });
    const ref = oldestFirst([mon, wed, fri, late], 500_00);
    expect(ref.get("late")).toBe(0);
    expect(vendorPosition([mon, wed, fri, late], 2500_00 - 500_00).bills.find((s) => s.bill.id === "late")?.state).toBe("paid");
    // An opening balance is cleared before that day's bills.
    const open = bill("open", "2026-10-12", 800, { kind: "opening", createdAtMs: Date.parse("2026-10-12T23:00:00Z") });
    expect(fifoCompare(open, mon)).toBeLessThan(0);
  });
  it("says when older dues aren't loaded", () => {
    const pos = vendorPosition([wed, fri], 1500_00);
    expect(pos.uncoveredPaise).toBe(500_00);
    expect(pos.oldestDue).toBeNull();
    expect(pos.bills.every((s) => s.state === "due")).toBe(true);
  });
  it("previews what a payment clears and keeps the books balanced", () => {
    const p = paymentPreview([mon, wed, fri], 2000_00, 1300_00);
    expect(p.clears.map((c) => [c.id, c.dueBeforePaise, c.dueAfterPaise, c.cleared])).toEqual([
      ["mon", 1000_00, 0, true],
      ["wed", 600_00, 300_00, false],
    ]);
    expect(p.advancePaise).toBe(0);
    expect(p.balanceAfterPaise).toBe(700_00);
    const rnd = mulberry32(7);
    for (let run = 0; run < 300; run++) {
      const bills = [mon, wed, fri].filter(() => rnd() < 0.8);
      const total = bills.reduce((s, b) => s + b.totalPaise, 0);
      const balance = Math.floor(rnd() * (total + 30000)) - 10000;
      const amount = 1 + Math.floor(rnd() * 250000);
      const pr = paymentPreview(bills, balance, amount);
      const applied = pr.clears.reduce((s, c) => s + c.dueBeforePaise - c.dueAfterPaise, 0);
      expect(applied + pr.olderPaise + pr.advancePaise).toBe(amount);
    }
    const older = paymentPreview([wed, fri], 1500_00, 700_00);
    expect(older.olderPaise).toBe(500_00);
    expect(older.clears.map((c) => c.id)).toEqual(["wed"]);
  });
  it("offers quick amounts: everything, the oldest bill, up to a date", () => {
    const chips = payChips(vendorPosition([mon, wed, fri], 2000_00));
    expect(chips).toEqual([
      { label: "all", amountPaise: 2000_00 },
      { label: "oldest", billDate: "2026-10-12", amountPaise: 1000_00 },
      { label: "upTo", billDate: "2026-10-14", amountPaise: 1600_00 },
    ]);
    expect(payChips(vendorPosition([mon], 1000_00))).toEqual([{ label: "all", amountPaise: 1000_00 }]);
    expect(payChips(vendorPosition([mon], 0))).toEqual([]);
  });
  it("replays which bills a past payment cleared", () => {
    const pays = [
      { id: "p1", kind: "payment" as const, businessDate: "2026-10-13", createdAtMs: 1, amountPaise: 700_00, status: "active" as const },
      { id: "p2", kind: "payment" as const, businessDate: "2026-10-16", createdAtMs: 2, amountPaise: 600_00, status: "active" as const },
    ];
    const second = clearedBy([mon, wed, fri], pays, "p2");
    expect(second.clears.map((c) => [c.id, c.appliedPaise, c.cleared])).toEqual([
      ["mon", 300_00, true],
      ["wed", 300_00, false],
    ]);
    expect(clearedBy([mon], [{ ...pays[0]!, amountPaise: 1200_00 }], "p1").advancePaise).toBe(200_00);
  });
});

describe("statement, overview and prices", () => {
  const purchases = [
    { id: "o", kind: "opening" as const, billDate: "2026-10-01", createdAtMs: 5, totalPaise: 500_00, status: "active" as const },
    { id: "b1", kind: "bill" as const, billDate: "2026-10-02", createdAtMs: 10, totalPaise: 1000_00, status: "active" as const, billNo: "11" },
    { id: "b2", kind: "bill" as const, billDate: "2026-10-03", createdAtMs: 20, totalPaise: 300_00, status: "void" as const },
  ];
  const payments = [{ id: "p1", kind: "payment" as const, businessDate: "2026-10-02", createdAtMs: 15, amountPaise: 600_00, status: "active" as const, mode: "upi" as const }];

  it("runs a balance, skipping void rows", () => {
    const l = vendorLedger(purchases, payments);
    expect(l.rows.map((r) => [r.id, r.balancePaise])).toEqual([
      ["o", 500_00],
      ["b1", 1500_00],
      ["p1", 900_00],
      ["b2", 900_00],
    ]);
    expect(l.closingPaise).toBe(900_00);
    expect(l.purchasedPaise).toBe(1500_00);
    expect(l.paidPaise).toBe(600_00);
    // Only recent history loaded: the brought-forward line makes the end match the live balance.
    expect(vendorLedger(purchases.slice(1), payments, { closingPaise: 900_00 }).broughtForwardPaise).toBe(500_00);
  });
  it("spots totals that drifted from the documents", () => {
    expect(vendorDrift({ purchasedPaise: 1500_00, paidPaise: 600_00 }, purchases, payments)).toEqual([]);
    expect(vendorDrift({ purchasedPaise: 1800_00, paidPaise: 600_00 }, purchases, payments)).toEqual([{ field: "purchasedPaise", stored: 1800_00, actual: 1500_00 }]);
  });
  it("lists who is owed, oldest due first, and who is overdue", () => {
    const vendors = [
      { id: "v1", name: "Dairy", active: true, creditDays: 0, purchasedPaise: 1000_00, paidPaise: 400_00 },
      { id: "v2", name: "Grocer", active: true, creditDays: 30, purchasedPaise: 500_00, paidPaise: 0 },
      { id: "v3", name: "Gas", active: true, creditDays: 7, purchasedPaise: 100_00, paidPaise: 300_00 },
      { id: "v4", name: "Old", active: false, creditDays: 0, purchasedPaise: 0, paidPaise: 0 },
    ];
    const recent = [
      { ...bill("d1", "2026-10-15", 600), vendorId: "v1" },
      { ...bill("d2", "2026-10-16", 400), vendorId: "v1" },
      { ...bill("g1", "2026-10-01", 500), vendorId: "v2" },
    ];
    const o = vendorOverview(vendors, recent, BD);
    expect(o.vendors).toBe(4);
    expect(o.active).toBe(3);
    expect(o.pending).toBe(2);
    expect(o.duePaise).toBe(1100_00);
    expect(o.advancePaise).toBe(200_00);
    expect(o.rows.map((r) => r.id)).toEqual(["v1", "v2", "v3"]);
    const dairy = o.rows[0]!;
    expect(dairy).toMatchObject({ dueBills: 2, oldestDueDate: "2026-10-15", dueDays: 1, overdue: true });
    expect(o.rows[1]).toMatchObject({ dueDays: 15, overdue: false });
    expect(o.overdue).toBe(1);
    // Owed more than the loaded bills explain: older than the window, so overdue.
    expect(vendorOverview([{ ...vendors[1]!, purchasedPaise: 900_00 }], recent, BD).rows[0]).toMatchObject({ uncoveredPaise: 400_00, overdue: true });
  });
  it("keeps price history per material, newest first", () => {
    const line = (amount: number, qty: number) => ({ lineId: "l", materialId: "milk", name: "Milk", qtyMilli: qty, unit: "L" as const, amountPaise: amount, taxBps: 0, gstPaise: 0 });
    const ps = [
      { id: "x1", billDate: "2026-10-10", createdAtMs: 1, vendorId: "v1", vendorName: "Dairy", status: "active" as const, lines: [line(110000, 20000)] },
      { id: "x2", billDate: "2026-10-12", createdAtMs: 2, vendorId: "v1", vendorName: "Dairy", status: "active" as const, lines: [line(116000, 20000)] },
      { id: "x3", billDate: "2026-10-13", createdAtMs: 3, vendorId: "v1", vendorName: "Dairy", status: "void" as const, lines: [line(999900, 20000)] },
    ];
    expect(priceHistory(ps, "milk").map((p) => [p.purchaseId, p.ratePaise])).toEqual([
      ["x2", 5800],
      ["x1", 5500],
    ]);
  });
  it("remembers the last rate per material and guesses units", () => {
    const line = (materialId: string, amount: number, qty: number) => ({ lineId: materialId, materialId, name: materialId, qtyMilli: qty, unit: "kg" as const, amountPaise: amount, taxBps: 0, gstPaise: 0 });
    const rates = lastRates([
      { id: "a", billDate: "2026-10-10", createdAtMs: 1, vendorId: "v1", vendorName: "G", status: "active", lines: [line("sugar", 4400, 1000)] },
      { id: "b", billDate: "2026-10-12", createdAtMs: 2, vendorId: "v2", vendorName: "H", status: "active", lines: [line("sugar", 4600, 1000), line("rice", 6000, 1000)] },
      { id: "c", billDate: "2026-10-13", createdAtMs: 3, vendorId: "v2", vendorName: "H", status: "void", lines: [line("sugar", 9900, 1000)] },
    ]);
    expect(rates.get("sugar")).toMatchObject({ ratePaise: 4600, vendorName: "H" });
    expect(rates.get("rice")?.ratePaise).toBe(6000);
    expect([guessUnit("Milk"), guessUnit("Sugar"), guessUnit("Gas cylinder"), guessUnit("Eggs"), guessUnit("Bread"), guessUnit("Paper cups")]).toEqual(["L", "kg", "cylinder", "tray", "pkt", "pcs"]);
  });
  it("vendor balance treats missing totals as zero", () => {
    expect(vendorBalance(undefined)).toBe(0);
    expect(vendorBalance({ purchasedPaise: 500, paidPaise: 700 })).toBe(-200);
  });
});

describe("vendor stats", () => {
  const lines = [
    { lineId: "a", materialId: "milk", name: "Milk", qtyMilli: 20000, unit: "L" as const, amountPaise: 112000, taxBps: 0, gstPaise: 0 },
    { lineId: "b", name: "Ice", qtyMilli: 2000, unit: "kg" as const, amountPaise: 8000, taxBps: 500, gstPaise: 380 },
  ];
  it("counts bills as bought and never an opening balance", () => {
    expect(purchaseDelta({ kind: "bill", vendorId: "v1", totalPaise: 120000, gstPaise: 380, lines })).toEqual({
      purchasesPaise: 120000,
      purchaseBills: 1,
      purchaseGstPaise: 380,
      purchByVendor: { v1: 120000 },
      purchByMaterial: { milk: { qty: 20000, paise: 112000 } },
    });
    expect(purchaseDelta({ kind: "opening", vendorId: "v1", totalPaise: 5000, gstPaise: 0, lines: [] })).toEqual({});
    const p = { kind: "bill" as const, vendorId: "v1", totalPaise: 120000, gstPaise: 380, lines };
    expect(sumDeltas([purchaseDelta(p), purchaseVoidDelta(p)])).toEqual(zeros(purchaseDelta(p)));
  });
  it("drawer cash is paid out of the drawer once, with a vendor breakdown", () => {
    const d = vendorPayDelta({ kind: "payment", amountPaise: 3000_00, mode: "drawer", drawerTerminalId: "t1" });
    expect(d).toEqual({ vendorPaidPaise: 3000_00, vendorPaidByMode: { drawer: 3000_00 }, cash: { t1: { paidOut: 3000_00, paidOutVendors: 3000_00 } } });
    expect(vendorPayDelta({ kind: "payment", amountPaise: 500, mode: "upi" })).toEqual({ vendorPaidPaise: 500, vendorPaidByMode: { upi: 500 } });
    expect(vendorPayDelta({ kind: "opening", amountPaise: 500, mode: "other" })).toEqual({});
    expect(vendorPayVoidDelta({ kind: "payment", amountPaise: 500, mode: "upi" })).toEqual({ vendorPaidPaise: -500, vendorPaidByMode: { upi: -500 } });
    // Expected cash subtracts the vendor cash exactly once (it is inside paidOut).
    const c = cashStats({ sales: 10000_00, paidOut: 8000_00, paidOutVendors: 3000_00 });
    expect(c.paidOutVendors).toBe(3000_00);
    expect(expectedCashFor(2000_00, c)).toBe(2000_00 + 10000_00 - 8000_00);
    expect(cashStats({ sales: 1 })).toEqual({ sales: 1, refunds: 0, paidIn: 0, paidOut: 0, drops: 0 });
  });
  it("reads the day's vendor figures and profit", () => {
    const s = { taxablePaise: 10000_00, chargesPaise: 0, purchasesPaise: 3000_00, purchaseBills: 2, vendorPaidPaise: 1000_00, vendorPaidByMode: { upi: 1000_00, cash: 0 }, expensesPaise: 500_00 };
    expect(vendorDay(s)).toEqual({ boughtPaise: 3000_00, bills: 2, gstPaise: 0, paidPaise: 1000_00, paidByMode: { upi: 1000_00 } });
    expect(profitPaise(s)).toBe(10000_00 - 3000_00 - 500_00);
  });
  it("Z report carries and prints the vendor lines; old ones print as before", () => {
    const stats = { purchasesPaise: 3000_00, purchaseBills: 2, vendorPaidPaise: 1500_00, vendorPaidByMode: { drawer: 1000_00, upi: 500_00 }, cash: { t1: { sales: 5000_00, refunds: 0, paidIn: 0, paidOut: 1200_00, drops: 0, paidOutVendors: 1000_00 } } };
    const z = zReport({ zNo: 3, businessDate: BD, closedAtMs: 0, stats, drawers: [{ terminalId: "t1", openingFloatPaise: 0 }], invoiceRanges: [] });
    expect(z).toMatchObject({ purchasesPaise: 3000_00, purchaseBills: 2, vendorPaidPaise: 1500_00 });
    expect(z.drawers[0]?.expectedPaise).toBe(5000_00 - 1200_00);
    const text = receiptText(renderZ(z, { cols: 32, outletName: "Demo", terminalNames: { t1: "Counter" } }), 32);
    expect(text).toMatch(/Bought \(2 bills\)\s+3,000\.00/);
    expect(text).toMatch(/Paid to vendors\s+1,500\.00/);
    expect(text).toMatch(/Till cash\s+1,000\.00/);
    expect(text).toMatch(/Paid out \(expenses\)\s+-200\.00/);
    expect(text).toMatch(/Paid to vendors\s+-1,000\.00/);
    for (const l of text.split("\n")) expect(l.length).toBeLessThanOrEqual(32);
    const plain = zReport({ zNo: 1, businessDate: BD, closedAtMs: 0, stats: { cash: { t1: { sales: 0, refunds: 0, paidIn: 0, paidOut: 300, drops: 0 } } }, drawers: [{ terminalId: "t1", openingFloatPaise: 0 }], invoiceRanges: [] });
    expect(plain.purchasesPaise).toBeUndefined();
    const old = receiptText(renderZ(plain, { cols: 32, outletName: "Demo" }), 32);
    expect(old).not.toMatch(/Bought|vendors/);
    expect(old).toMatch(/Paid out \(expenses\)\s+-3\.00/);
  });
});

/** The zero tree of a delta (what an entry plus its void add up to). */
function zeros(d: StatsDelta): StatsDelta {
  return Object.fromEntries(Object.entries(d).map(([k, v]) => [k, typeof v === "number" ? 0 : zeros(v as StatsDelta)]));
}

describe("vendor plans", () => {
  const profile: VendorProfile = { name: " Lakshmi Dairy ", phone: "98765 43210", gstin: undefined, materialIds: ["milk"], creditDays: 7, note: undefined, active: true };
  const lines = [{ lineId: "l1", materialId: "milk", name: "Milk", qtyMilli: 20000, unit: "L" as const, amountPaise: 112000, taxBps: 0 }];

  it("adds a vendor with zero totals and updates only what changed", () => {
    const c = upsertVendorPlan(till, { id: "v1", vendor: profile });
    const doc = c.ops[0]!.data;
    expect(doc).toMatchObject({ name: "Lakshmi Dairy", phone: "98765 43210", purchasedPaise: 0, paidPaise: 0, active: true, creditDays: 7 });
    expect(doc).not.toHaveProperty("lastPostingKey");
    expect(c.postingKey).toBeUndefined();
    const before = { ...(doc as unknown as Vendor), id: "v1", purchasedPaise: 5000, paidPaise: 0 };
    expect(upsertVendorPlan(till, { id: "v1", vendor: { ...profile }, before }).ops).toEqual([]);
    const u = upsertVendorPlan(till, { id: "v1", vendor: { ...profile, phone: undefined, creditDays: 30 }, before });
    expect(u.ops[0]?.op).toBe("update");
    expect(u.ops[0]?.data).toMatchObject({ phone: { $delete: true }, creditDays: 30 });
    expect(Object.keys(u.ops[0]!.data)).not.toContain("purchasedPaise");
    expect(() => upsertVendorPlan(till, { id: "v1", vendor: { ...profile, name: " " } })).toThrow(/name/);
  });
  it("materials keep their unit", () => {
    const m = upsertMaterialPlan(till, { id: "milk", material: { name: "Milk", unit: "L", taxBps: 0, active: true } });
    expect(m.ops[0]?.data).toMatchObject({ name: "Milk", unit: "L", taxBps: 0 });
    const before = { ...(m.ops[0]!.data as unknown as Material), id: "milk" };
    expect(() => upsertMaterialPlan(till, { id: "milk", material: { name: "Milk", unit: "kg", taxBps: 0, active: true }, before })).toThrow(/unit/);
    expect(upsertMaterialPlan(till, { id: "milk", material: { name: "Cow milk", unit: "L", taxBps: 0, active: true }, before }).ops[0]?.data).toMatchObject({ name: "Cow milk" });
  });
  it("a purchase moves bought and the vendor's total once", () => {
    const p = purchasePlan(till, { id: "p1", vendor: { id: "v1", name: "Lakshmi Dairy" }, billDate: BD, businessDate: BD, billNo: " 1201 ", lines, today: BD });
    expectExactlyOnce(p);
    expect(p.postingKey).toBe("vbill:p1");
    const doc = p.ops.find((o) => o.path.endsWith("/purchases/p1"))!.data;
    expect(doc).toMatchObject({ kind: "bill", billNo: "1201", totalPaise: 112000, materialIds: ["milk"], status: "active", terminalId: "t1", enteredBy: "s1" });
    const vendor = p.ops.find((o) => o.path === "clients/c1/vendors/v1")!;
    expect(vendor.op).toBe("merge");
    expect(vendor.data).toMatchObject({ purchasedPaise: { $inc: 112000 }, lastPostingKey: "vbill:p1", materialIds: { $arrayUnion: ["milk"] } });
    expect(vendor.data).not.toHaveProperty("paidPaise");
    const stats = p.ops.find((o) => o.path.endsWith(`/dailyStats/${BD}`))!.data;
    expect(stats).toMatchObject({ purchasesPaise: { $inc: 112000 }, purchaseBills: { $inc: 1 } });
  });
  it("paid on delivery from the drawer: one batch, one posting", () => {
    const p = purchasePlan(till, { id: "p2", vendor: { id: "v1", name: "Dairy" }, billDate: BD, businessDate: BD, lines, paidNow: { id: "pay2", amountPaise: 112000, mode: "drawer" }, newMaterials: [{ id: "milk", material: { name: "Milk", unit: "L", taxBps: 0, active: true } }] });
    expectExactlyOnce(p);
    const pay = p.ops.find((o) => o.path.endsWith("/vendorPayments/pay2"))!.data;
    expect(pay).toMatchObject({ kind: "payment", mode: "drawer", drawerTerminalId: "t1", purchaseId: "p2", amountPaise: 112000 });
    expect(p.ops.some((o) => o.path === "clients/c1/materials/milk" && o.op === "set")).toBe(true);
    const stats = p.ops.find((o) => o.path.endsWith(`/dailyStats/${BD}`))!.data;
    expect(stats).toMatchObject({ vendorPaidPaise: { $inc: 112000 }, cash: { t1: { paidOut: { $inc: 112000 }, paidOutVendors: { $inc: 112000 } } } });
    expect(p.ops.find((o) => o.path === "clients/c1/vendors/v1")!.data).toMatchObject({ purchasedPaise: { $inc: 112000 }, paidPaise: { $inc: 112000 } });
    expect(() => purchasePlan(admin, { id: "p3", vendor: { id: "v1", name: "Dairy" }, billDate: BD, businessDate: BD, lines, paidNow: { id: "x", amountPaise: 100, mode: "drawer" } })).toThrow(/till/);
    expect(() => purchasePlan(till, { id: "p4", vendor: { id: "v1", name: "Dairy" }, billDate: BD, businessDate: BD, lines, paidNow: { id: "x", amountPaise: 200000, mode: "upi" } })).toThrow(/more than the bill/);
    expect(() => purchasePlan(till, { id: "p5", vendor: { id: "v1", name: "Dairy" }, billDate: "2026-10-17", businessDate: BD, lines, today: BD })).toThrow(/future/);
  });
  it("voids reverse on the original day, once", () => {
    const pv = purchaseVoidPlan(till, { id: "p1", kind: "bill", vendorId: "v1", vendorName: "Dairy", businessDate: "2026-10-14", totalPaise: 112000, gstPaise: 0, lines: lines.map((l) => ({ ...l, gstPaise: 0 })), status: "active" }, "Entered twice");
    expectExactlyOnce(pv);
    expect(pv.postingKey).toBe("vbillx:p1");
    expect(pv.ops.find((o) => o.path.endsWith("/dailyStats/2026-10-14"))?.data).toMatchObject({ purchasesPaise: { $inc: -112000 } });
    expect(pv.ops.find((o) => o.path === "clients/c1/vendors/v1")?.data).toMatchObject({ purchasedPaise: { $inc: -112000 } });
    expect(() => purchaseVoidPlan(till, { id: "p1", kind: "bill", vendorId: "v1", vendorName: "Dairy", businessDate: BD, totalPaise: 1, gstPaise: 0, lines: [], status: "void" }, "x")).toThrow(/already/);
    const pay = vendorPaymentPlan(till, { id: "q1", vendor: { id: "v1", name: "Dairy" }, businessDate: BD, amountPaise: 5000_00, mode: "drawer" });
    expectExactlyOnce(pay);
    expect(pay.postingKey).toBe("vpay:q1");
    const qv = vendorPaymentVoidPlan(till, { id: "q1", kind: "payment", vendorId: "v1", vendorName: "Dairy", businessDate: BD, amountPaise: 5000_00, mode: "drawer", drawerTerminalId: "t1", status: "active" }, "Wrong amount");
    expectExactlyOnce(qv);
    expect(qv.ops.find((o) => o.path.endsWith(`/dailyStats/${BD}`))?.data).toMatchObject({ cash: { t1: { paidOut: { $inc: -5000_00 }, paidOutVendors: { $inc: -5000_00 } } } });
    expect(() => vendorPaymentPlan(admin, { id: "q2", vendor: { id: "v1", name: "Dairy" }, businessDate: BD, amountPaise: 100, mode: "drawer" })).toThrow(/till/);
    expect(vendorPaymentPlan(admin, { id: "q3", vendor: { id: "v1", name: "Dairy" }, businessDate: BD, amountPaise: 100, mode: "bank", ref: "NEFT 77" }).ops[0]?.data).toMatchObject({ mode: "bank", ref: "NEFT 77", paidBy: "u1" });
  });
  it("an opening balance touches only the vendor", () => {
    const owed = openingBalancePlan(admin, { id: "o1", vendor: { id: "v1", name: "Dairy" }, asOf: "2026-10-01", amountPaise: 8400_00 });
    expectExactlyOnce(owed);
    expect(owed.ops.some((o) => o.path.includes("/dailyStats/"))).toBe(false);
    expect(owed.ops.find((o) => o.path.endsWith("/purchases/o1"))?.data).toMatchObject({ kind: "opening", totalPaise: 8400_00, lines: [] });
    const advance = openingBalancePlan(admin, { id: "o2", vendor: { id: "v1", name: "Dairy" }, asOf: "2026-10-01", amountPaise: -500_00 });
    expectExactlyOnce(advance);
    expect(advance.postingKey).toBe("vpay:o2");
    expect(advance.ops.find((o) => o.path === "clients/c1/vendors/v1")?.data).toMatchObject({ paidPaise: { $inc: 500_00 } });
    expect(() => openingBalancePlan(admin, { id: "o3", vendor: { id: "v1", name: "Dairy" }, asOf: BD, amountPaise: 0 })).toThrow();
  });
  it("edits only a bill's number or note", () => {
    const e = purchaseEditPlan(till, { id: "p1", vendorName: "Dairy", billNo: "12", note: undefined }, { billNo: "120", note: "" });
    expect(e.ops[0]?.data).toEqual({ billNo: "120", updatedAtMs: till.nowMs });
    expect(purchaseEditPlan(till, { id: "p1", vendorName: "Dairy", billNo: "12" }, { billNo: "12" }).ops).toEqual([]);
  });
});

describe("vendor validation and roles", () => {
  it("vendors and materials", () => {
    expect(validateVendor({ name: "Dairy", creditDays: 7 })).toBeNull();
    expect(validateVendor({ name: "Dairy", creditDays: 91 })).toMatch(/Credit days/);
    expect(validateVendor({ name: "Dairy", creditDays: 0, phone: "12345" })).toMatch(/mobile/);
    expect(validateVendor({ name: "Dairy", creditDays: 0, gstin: "27AAPFU0939F1ZX" })).toMatch(/Vendor's GSTIN/);
    expect(validateMaterial({ name: "Milk", unit: "L", taxBps: 0 })).toBeNull();
    expect(validateMaterial({ name: "Milk", unit: "L", taxBps: 1200 })).toMatch(/GST/);
  });
  it("purchases and payments", () => {
    const base = { kind: "bill" as const, billDate: BD, businessDate: BD, lines: [{ lineId: "a", name: "Milk", qtyMilli: 1000, unit: "L" as const, amountPaise: 5600, taxBps: 0 }] };
    expect(validatePurchase(base, BD)).toBeNull();
    expect(validatePurchase({ ...base, lines: [] })).toMatch(/at least one/);
    expect(validatePurchase({ ...base, lines: [{ ...base.lines[0]!, qtyMilli: 0 }] })).toMatch(/quantity/);
    expect(validatePurchase({ ...base, adjustPaise: 10001 })).toMatch(/Round off/);
    expect(validatePurchase({ ...base, adjustPaise: -5600 })).toMatch(/more than/);
    expect(validatePurchase({ ...base, lines: Array.from({ length: 51 }, (_, i) => ({ ...base.lines[0]!, lineId: String(i) })) })).toMatch(/50/);
    expect(validateVendorPayment({ amountPaise: 100, mode: "upi", businessDate: BD }, BD)).toBeNull();
    expect(validateVendorPayment({ amountPaise: 0, mode: "upi", businessDate: BD })).toMatch(/amount/);
    expect(validateVendorPayment({ amountPaise: 100, mode: "upi", businessDate: "2026-10-17" }, BD)).toMatch(/future/);
  });
  it("cashiers log deliveries; owners and managers run vendors and pay", () => {
    expect(can("cashier", "purchase")).toBe(true);
    expect(can("cashier", "vendors")).toBe(false);
    expect(can("cashier", "vendorPay")).toBe(false);
    for (const r of ["owner", "manager"] as const) {
      expect(can(r, "vendors")).toBe(true);
      expect(can(r, "vendorPay")).toBe(true);
    }
    expect(can("captain", "purchase")).toBe(false);
  });
});

describe("payment voucher", () => {
  it("fits both papers in plain ASCII", () => {
    for (const cols of [32, 48] as const) {
      const text = receiptText(
        renderVoucher(
          {
            outletName: "Demo Tea Shop",
            vendorName: "Lakshmi Dairy",
            amountPaise: 5000_00,
            mode: "drawer",
            terminalName: "Counter",
            paidAtMs: Date.parse("2026-10-16T05:12:00Z"),
            businessDate: BD,
            paidBy: "Ravi (Manager)",
            voucherNo: "PV-7KQ2XD",
            clears: [
              { billDate: "2026-09-18", billNo: "1201", appliedPaise: 3200_00, cleared: true },
              { billDate: "2026-09-25", billNo: "1210", appliedPaise: 1800_00, cleared: false },
            ],
            balanceAfterPaise: 7400_00,
          },
          { cols },
        ),
        cols,
      );
      for (const l of text.split("\n")) expect(l.length).toBeLessThanOrEqual(cols);
      expect(text).not.toMatch(/[^\x20-\x7E\n]/);
      expect(text).toContain("PAYMENT VOUCHER");
      expect(text).toMatch(/Rs\.5,000\.00/);
      expect(text).toMatch(/18 Sep bill 1201\s+3,200\.00/);
      expect(text).toMatch(/1,800\.00 part/);
      expect(text).toMatch(/Still owed\s+7,400\.00/);
      expect(text).toContain("Received by ___");
    }
  });
});

// Satisfy the type-only imports above in strict builds.
export type _Unused = Purchase | VendorPayment;

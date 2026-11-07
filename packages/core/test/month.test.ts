import { describe, expect, it } from "vitest";
import { addMonths, mergeInvoiceRanges, monthCloseCheck, monthLabel, monthOf, monthProfit, monthRange, monthReport, monthsBetween } from "../src/month";
import { closeMonthPlan, reopenMonthPlan } from "../src/plans/month";
import { receiptText, renderMonth } from "../src/receipt";
import type { PlanCtx } from "../src/plans/types";
import type { DailyStats, Day } from "../src/types";

const ctx: PlanCtx = { cid: "tr", nowMs: Date.parse("2026-11-07T10:00:00+05:30"), actorId: "boss", actorName: "Mandy", actorKind: "platform", source: "admin", newId: () => "a1" };

describe("month keys", () => {
  it("ranges, labels and steps", () => {
    expect(monthOf("2026-10-31")).toBe("2026-10");
    expect(monthRange("2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(monthRange("2028-02").to).toBe("2028-02-29");
    expect(monthRange("2026-12")).toEqual({ from: "2026-12-01", to: "2026-12-31" });
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(monthsBetween("2026-10", "2027-01")).toEqual(["2026-10", "2026-11", "2026-12", "2027-01"]);
    expect(monthLabel("2026-10")).toBe("October 2026");
    expect(monthLabel("2026-10", true)).toBe("Oct 2026");
  });
});

const day = (id: string, zNo: number | null, ranges: Array<{ series: string; first: string; last: string; count: number; cancelled: number }> = []): Pick<Day, "status" | "zNo" | "z"> & { id: string } =>
  ({ id, status: zNo ? "closed" : "open", ...(zNo ? { zNo, z: { invoiceRanges: ranges } } : {}) }) as unknown as Pick<Day, "status" | "zNo" | "z"> & { id: string };

const stats = (id: string, o: Partial<DailyStats>): Partial<DailyStats> & { id: string } => ({ id, businessDate: id, lastPostingKey: "k", updatedAtMs: 1, ...o });

describe("month report", () => {
  const days = [
    day("2026-10-01", 1, [{ series: "TR1", first: "TR1/26-27/000001", last: "TR1/26-27/000040", count: 40, cancelled: 1 }]),
    day("2026-10-02", 2, [{ series: "TR1", first: "TR1/26-27/000041", last: "TR1/26-27/000090", count: 50, cancelled: 0 }]),
    day("2026-11-01", 3),
  ];
  const s = [
    stats("2026-10-01", { orders: 40, totalPaise: 100_000, grossPaise: 100_000, cgstPaise: 2_381, sgstPaise: 2_381, byPay: { cash: 60_000, upi: 40_000 }, byTaxBps: { "500": { taxable: 95_238, cgst: 2_381, sgst: 2_381 } }, expensesPaise: 5_000, expByCat: { dairy: 5_000 } }),
    stats("2026-10-02", { orders: 50, totalPaise: 150_000, grossPaise: 150_000, byPay: { upi: 150_000 }, purchasesPaise: 20_000, purchaseBills: 2, purchaseGstPaise: 500 }),
    stats("2026-11-01", { orders: 99, totalPaise: 999_999 }),
  ];

  it("adds up the month's days only", () => {
    const r = monthReport({ month: "2026-10", days, stats: s, builtAtMs: ctx.nowMs });
    expect(r).toMatchObject({ month: "2026-10", from: "2026-10-01", to: "2026-10-31", orders: 90, totalPaise: 250_000, grossPaise: 250_000, tradingDays: 2, zFrom: 1, zTo: 2, expensesPaise: 5_000, purchasesPaise: 20_000, purchaseBills: 2, purchaseGstPaise: 500 });
    expect(r.byPay).toEqual({ cash: 60_000, upi: 190_000 });
    expect(r.bestDay).toEqual({ date: "2026-10-02", totalPaise: 150_000 });
    expect(r.expByCat).toEqual({ dairy: 5_000 });
    expect(r.invoiceRanges).toEqual([{ series: "TR1", first: "TR1/26-27/000001", last: "TR1/26-27/000090", count: 90, cancelled: 1 }]);
    expect(monthProfit(r)).toBe(r.netPaise - 20_000 - 5_000);
  });

  it("merges invoice ranges per series", () => {
    expect(mergeInvoiceRanges([[{ series: "B", first: "B/2", last: "B/3", count: 2, cancelled: 0 }], [{ series: "A", first: "A/1", last: "A/1", count: 1, cancelled: 0 }, { series: "B", first: "B/1", last: "B/1", count: 1, cancelled: 1 }]])).toEqual([
      { series: "A", first: "A/1", last: "A/1", count: 1, cancelled: 0 },
      { series: "B", first: "B/1", last: "B/3", count: 3, cancelled: 1 },
    ]);
  });

  it("prints", () => {
    const r = monthReport({ month: "2026-10", days, stats: s, builtAtMs: ctx.nowMs });
    const live = receiptText(renderMonth(r, { cols: 32, outletName: "Tea Room", live: true }), 32);
    expect(live).toContain("MONTH REPORT");
    expect(live).toContain("October 2026");
    expect(live).toContain("Not closed: figures so far");
    expect(live).toContain("Z reports");
    for (const line of live.split("\n")) expect(line.length).toBeLessThanOrEqual(32);
    const closed = receiptText(renderMonth({ ...r, stockWorthPaise: 12_345_00 }, { cols: 48, outletName: "Tea Room", closedAtMs: ctx.nowMs }), 48);
    expect(closed).toContain("Closed ");
    expect(closed).toContain("Stock worth at close");
    expect(closed).toContain("TR1/26-27/000001 .. TR1/26-27/000090");
  });
});

describe("closing a month", () => {
  it("needs the month over and every day closed", () => {
    const base = { month: "2026-10", days: [day("2026-10-01", 1), day("2026-10-02", 2)], statsDates: ["2026-10-01", "2026-10-02"] };
    expect(monthCloseCheck({ ...base, today: "2026-10-31" })).toMatchObject({ ok: false, notOver: true });
    expect(monthCloseCheck({ ...base, today: "2026-11-07" })).toEqual({ ok: true, notOver: false, openDays: [] });
    expect(monthCloseCheck({ ...base, today: "2026-11-07", days: [day("2026-10-01", 1), day("2026-10-02", null)] }).openDays).toEqual(["2026-10-02"]);
    // Sales on a date whose day record is missing still need a close.
    expect(monthCloseCheck({ ...base, today: "2026-11-07", statsDates: ["2026-10-01", "2026-10-02", "2026-10-09"] }).openDays).toEqual(["2026-10-09"]);
  });

  it("writes the frozen report with an audit entry; reopening needs a reason", () => {
    const report = monthReport({ month: "2026-10", days: [], stats: [], builtAtMs: ctx.nowMs });
    const p = closeMonthPlan(ctx, { month: "2026-10", report });
    expect(p.ops[0]).toMatchObject({ path: "clients/tr/months/2026-10", op: "set", data: { month: "2026-10", status: "closed", closedBy: "boss", closedByName: "Mandy" } });
    expect(p.ops[1]?.data).toMatchObject({ action: "month.close" });
    expect(() => closeMonthPlan(ctx, { month: "2026-11", report })).toThrow();
    expect(() => reopenMonthPlan(ctx, "2026-10", " ")).toThrow("Say why");
    expect(reopenMonthPlan(ctx, "2026-10", "Late bill").ops[0]).toMatchObject({ op: "update", data: { status: "open", reopenReason: "Late bill" } });
  });
});

import { describe, expect, it } from "vitest";
import { closeDayPlan, type CloseDayInput } from "../src/plans/ops";
import { dayMovePlan, isEarlyClose, misplacedPostings, moveIdFor, recountPlan, reopenDayPlan, retagPlans, withoutCash } from "../src/plans/day-fix";
import type { PlanCtx } from "../src/plans/types";
import { receiptText, renderZ } from "../src/receipt";
import { prune, statsTree, sumDeltas, zReport } from "../src/stats";
import type { DailyStats, Day, Drawer, Posting, StatsDelta } from "../src/types";

const admin: PlanCtx = { cid: "tr", nowMs: Date.parse("2026-11-25T10:00:00+05:30"), actorId: "adm1", actorName: "Ravi", actorKind: "platform", source: "admin", newId: () => `a${Math.random()}` };
const at = (iso: string) => Date.parse(`${iso}+05:30`);

/** A quick sale posting: total, paid by cash or UPI, on till t1. */
function sale(id: string, businessDate: string, timeIso: string, totalPaise: number, pay: "cash" | "upi" = "upi"): Posting & { id: string } {
  const stats: StatsDelta = {
    orders: 1,
    grossPaise: totalPaise,
    totalPaise,
    taxablePaise: Math.round(totalPaise / 1.05),
    byPay: { [pay]: totalPaise },
    byItem: { tea: { qty: 1, net: Math.round(totalPaise / 1.05) } },
    invoices: { TR1: { count: 1 } },
    ...(pay === "cash" ? { cash: { t1: { sales: totalPaise } } } : {}),
  };
  return { id: `quick:${id}`, kind: "quick", businessDate, refId: id, stats, staffId: "s1", terminalId: "t1", createdAtMs: at(timeIso), source: "app" };
}

// 22 Nov closed at 3 pm; the till moved on to 23 Nov, so the evening's bills carry the 23rd.
const postings23 = [
  sale("o1", "2026-11-23", "2026-11-22T16:10:00", 2500, "cash"),
  sale("o2", "2026-11-23", "2026-11-22T21:45:00", 5000),
  sale("o3", "2026-11-23", "2026-11-23T09:00:00", 7500),
  sale("o4", "2026-11-23", "2026-11-23T23:50:00", 2500, "cash"),
  // Made in admin (no terminal): never moved.
  { ...sale("v1", "2026-11-23", "2026-11-22T18:00:00", 1000), id: "vbill:v1", kind: "purchase" as const, terminalId: undefined },
];

describe("misplacedPostings", () => {
  it("finds till sales sold on another business day, grouped by that day", () => {
    const groups = misplacedPostings(postings23, "2026-11-23", 0);
    expect(groups).toHaveLength(1);
    const g = groups[0]!;
    expect(g).toMatchObject({ to: "2026-11-22", bills: 2, orderIds: ["o1", "o2"], totalPaise: 7500, byPay: { cash: 2500, upi: 5000 } });
    expect(g.firstMs).toBe(at("2026-11-22T16:10:00"));
    expect(g.lastMs).toBe(at("2026-11-22T21:45:00"));
    // Drawer cash stays where it was counted.
    expect(g.delta).not.toHaveProperty("cash");
  });

  it("uses the outlet's day cutoff: a bill at 00:30 belongs to the day before when the day ends at 4 am", () => {
    const p = [sale("late", "2026-11-23", "2026-11-24T00:30:00", 2500)];
    expect(misplacedPostings(p, "2026-11-23", 0)[0]?.to).toBe("2026-11-24");
    expect(misplacedPostings(p, "2026-11-23", 240)).toEqual([]);
  });

  it("leaves out postings already moved", () => {
    expect(misplacedPostings(postings23, "2026-11-23", 0, new Set(["quick:o1", "quick:o2"]))).toEqual([]);
  });
});

describe("dayMovePlan", () => {
  const z22 = zReport({ zNo: 48, businessDate: "2026-11-22", closedAtMs: at("2026-11-22T15:00:00"), stats: { orders: 10, totalPaise: 20000, grossPaise: 20000, byPay: { cash: 20000 }, cash: { t1: { sales: 20000, refunds: 0, paidIn: 0, paidOut: 0, drops: 0 } } }, drawers: [{ terminalId: "t1", openingFloatPaise: 200000, countedPaise: 220000 }], invoiceRanges: [] });
  const stats23: Partial<DailyStats> = statsTree(sumDeltas(postings23.filter((p) => p.terminalId).map((p) => p.stats))) as Partial<DailyStats>;
  const z23 = zReport({ zNo: 49, businessDate: "2026-11-23", closedAtMs: at("2026-11-24T00:22:00"), stats: stats23, drawers: [{ terminalId: "t1", openingFloatPaise: 200000, countedPaise: 205000 }], invoiceRanges: [] });
  const day = (z: typeof z22): Day => ({ status: "closed", openedAtMs: 1, openedBy: "s1", zNo: z.zNo, z, updatedAtMs: 1 });
  const inv = (orderId: string, seq: number) => ({ orderId, series: "TR1", seq, invoiceNo: `TR1/26-27/${String(seq).padStart(6, "0")}`, status: "issued" as const });
  const group = misplacedPostings(postings23, "2026-11-23", 0)[0]!;
  const run = () =>
    dayMovePlan(admin, {
      from: "2026-11-23",
      group,
      reason: "Day closed in the afternoon by mistake",
      fromDay: day(z23),
      toDay: day(z22),
      fromStats: stats23,
      toStats: { orders: 10, totalPaise: 20000, grossPaise: 20000, byPay: { cash: 20000 }, cash: { t1: { sales: 20000, refunds: 0, paidIn: 0, paidOut: 0, drops: 0 } } },
      fromInvoices: [inv("o1", 11), inv("o2", 12), inv("o3", 13), inv("o4", 14)],
      toInvoices: [inv("x", 10)],
    });

  it("moves the exact deltas out of one day and into the other, without drawer cash", () => {
    const { plan, moveId } = run();
    expect(moveId).toBe(moveIdFor("2026-11-23", "2026-11-22", ["quick:o2", "quick:o1"]));
    const out = plan.ops.find((o) => o.path === `clients/tr/postings/dmove:${moveId}:out`)!;
    const inn = plan.ops.find((o) => o.path === `clients/tr/postings/dmove:${moveId}:in`)!;
    expect(out.data).toMatchObject({ kind: "day_move", businessDate: "2026-11-23", stats: { totalPaise: -7500, orders: -2, byPay: { cash: -2500, upi: -5000 } } });
    expect(inn.data).toMatchObject({ kind: "day_move", businessDate: "2026-11-22", stats: { totalPaise: 7500, orders: 2 } });
    // The two halves cancel out exactly.
    expect(prune(sumDeltas([out.data.stats as StatsDelta, inn.data.stats as StatsDelta]))).toEqual({});
    expect(out.data.stats).not.toHaveProperty("cash");
    // Each dailyStats doc points at its own posting (rules: posted() per doc).
    expect(plan.ops.find((o) => o.path === "clients/tr/dailyStats/2026-11-23")?.data).toMatchObject({ lastPostingKey: `dmove:${moveId}:out` });
    expect(plan.ops.find((o) => o.path === "clients/tr/dailyStats/2026-11-22")?.data).toMatchObject({ lastPostingKey: `dmove:${moveId}:in` });
    expect(plan.ops.find((o) => o.path === `clients/tr/dayMoves/${moveId}`)?.data).toMatchObject({ from: "2026-11-23", to: "2026-11-22", bills: 2, totalPaise: 7500, retag: "pending", orderIds: ["o1", "o2"] });
  });

  it("rebuilds both closed Z reports under the same numbers and keeps the Z as printed", () => {
    const { plan } = run();
    const d23 = plan.ops.find((o) => o.path === "clients/tr/days/2026-11-23")!.data as { z: typeof z23; zFirst: typeof z23; corrections: { $arrayUnion: unknown[] } };
    const d22 = plan.ops.find((o) => o.path === "clients/tr/days/2026-11-22")!.data as typeof d23;
    expect(d23.z).toMatchObject({ zNo: 49, totalPaise: z23.totalPaise - 7500, orders: z23.orders - 2 });
    expect(d23.zFirst).toEqual(z23);
    expect(d22.z).toMatchObject({ zNo: 48, totalPaise: 27500, byPay: { cash: 22500, upi: 5000 } });
    // Drawer cash isn't moved: expected cash and the count's variance stay as they were.
    expect(d22.z.drawers).toEqual(z22.drawers);
    expect(d23.z.drawers).toEqual(z23.drawers);
    // Invoice ranges follow the bills.
    expect(d22.z.invoiceRanges[0]).toMatchObject({ first: "TR1/26-27/000010", last: "TR1/26-27/000012", count: 3 });
    expect(d23.z.invoiceRanges[0]).toMatchObject({ first: "TR1/26-27/000013", last: "TR1/26-27/000014", count: 2 });
    expect(d23.corrections.$arrayUnion[0]).toMatchObject({ kind: "move_out", otherDate: "2026-11-22", bills: 2, totalPaise: 7500, byName: "Ravi" });
    expect(d22.corrections.$arrayUnion[0]).toMatchObject({ kind: "move_in", otherDate: "2026-11-23" });
    const text = receiptText(renderZ(d22.z, { cols: 48, outletName: "Tea Room", corrections: d22.corrections.$arrayUnion as never }), 48);
    expect(text).toContain("CORRECTED");
    expect(text).toContain("2 bills (75.00) moved in from Mon 23 Nov.");
  });

  it("needs a reason", () => {
    expect(() => dayMovePlan(admin, { from: "2026-11-23", group, reason: " ", fromDay: null, toDay: null, fromStats: null, toStats: null, fromInvoices: [], toInvoices: [] })).toThrow(/why/);
  });

  it("re-dates orders and invoices in batches of 400, the last marking the move done", () => {
    const ids = Array.from({ length: 450 }, (_, k) => `o${k}`);
    const plans = retagPlans(admin, { moveId: "m1", from: "2026-11-23", to: "2026-11-22", orderIds: ids, invoiceIds: ids.slice(0, 50) });
    expect(plans.map((p) => p.ops.length)).toEqual([400, 101]);
    expect(plans[0]!.ops[0]).toMatchObject({ op: "update", path: "clients/tr/orders/o0", data: { businessDate: "2026-11-22", movedFrom: "2026-11-23" } });
    expect(plans[1]!.ops.at(-1)).toMatchObject({ path: "clients/tr/dayMoves/m1", data: { retag: "done" } });
  });

  it("strips only drawer cash", () => {
    expect(withoutCash({ totalPaise: 5, cash: { t1: { sales: 5 } }, byPay: { cash: 5 } })).toEqual({ totalPaise: 5, byPay: { cash: 5 } });
  });
});

describe("recount and reopen", () => {
  const z = zReport({ zNo: 49, businessDate: "2026-11-23", closedAtMs: 1, stats: { totalPaise: 10000, cash: { t1: { sales: 8295, refunds: 0, paidIn: 0, paidOut: 0, drops: 0 } } }, drawers: [{ terminalId: "t1", openingFloatPaise: 2000, countedPaise: 15231 }], invoiceRanges: [] });
  const day: Day = { status: "closed", openedAtMs: 1, openedBy: "s1", zNo: 49, z, updatedAtMs: 1 };
  const drawer: Drawer & { id: string } = { id: "2026-11-23_t1", terminalId: "t1", businessDate: "2026-11-23", openingFloatPaise: 2000, openedBy: "s1", openedAtMs: 1, status: "closed", countedPaise: 15231, expectedPaise: 10295, variancePaise: 4936, updatedAtMs: 1 };

  it("corrects a count on a closed day: drawer, Z line and history", () => {
    const plan = recountPlan(admin, { businessDate: "2026-11-23", day, drawer, countedPaise: 10300, reason: "Counted UPI slips as cash" });
    expect(plan.ops[0]).toMatchObject({ op: "update", path: "clients/tr/drawers/2026-11-23_t1", data: { countedPaise: 10300, variancePaise: 5, countHistory: { $arrayUnion: [{ fromPaise: 15231, toPaise: 10300, reason: "Counted UPI slips as cash" }] } } });
    const d = plan.ops[1]!.data as { z: typeof z; zFirst: typeof z };
    expect(d.z.drawers[0]).toMatchObject({ countedPaise: 10300, variancePaise: 5, expectedPaise: 10295 });
    expect(d.zFirst).toEqual(z);
    expect(() => recountPlan(admin, { businessDate: "2026-11-23", day: { ...day, status: "open" }, drawer, countedPaise: 1, reason: "x" })).toThrow(/closed day/);
  });

  it("reopens a closed day and its drawers; closing again keeps the Z number", () => {
    const plan = reopenDayPlan(admin, { businessDate: "2026-11-23", day, drawers: [drawer], reason: "Closed by mistake" });
    expect(plan.ops[0]!.data).toMatchObject({ status: "open", reopenedBy: "adm1", reopenReason: "Closed by mistake", zFirst: z });
    expect(plan.ops[1]!.data).toMatchObject({ status: "open", countedPaise: { $delete: true }, countHistory: { $arrayUnion: [{ fromPaise: 15231, toPaise: null }] } });
    const input: CloseDayInput = {
      businessDate: "2026-11-23",
      lastZNo: 60,
      day: { status: "open", zNo: 49 },
      stats: { totalPaise: 10000 },
      drawers: [{ ...drawer, status: "open" }],
      invoices: [],
      prevSnapshot: null,
      counts: { t1: { countedPaise: 10295 } },
    };
    const { zNo, plan: close } = closeDayPlan({ ...admin, terminalId: "t1" }, input);
    expect(zNo).toBe(49);
    expect(close.ops.some((o) => o.path === "clients/tr")).toBe(false);
  });
});

describe("early close", () => {
  it("warns when today's day closes before 9 pm, not later or for an earlier day", () => {
    expect(isEarlyClose("2026-11-22", at("2026-11-22T15:10:00"), 0)).toBe(true);
    expect(isEarlyClose("2026-11-22", at("2026-11-22T21:30:00"), 0)).toBe(false);
    expect(isEarlyClose("2026-11-21", at("2026-11-22T15:10:00"), 0)).toBe(false);
    // After midnight with a 4 am cutoff it's still the 22nd's business day, but past 9 pm: no warning.
    expect(isEarlyClose("2026-11-22", at("2026-11-23T00:30:00"), 240)).toBe(false);
  });
});

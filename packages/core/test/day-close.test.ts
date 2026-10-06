import { describe, expect, it } from "vitest";
import { closeDayPlan, invoiceRangesFrom, type CloseDayInput } from "../src/plans/ops";
import type { PlanCtx } from "../src/plans/types";
import { renderZ, receiptText } from "../src/receipt";
import type { Drawer } from "../src/types";

const till: PlanCtx = { cid: "tr", nowMs: 5_000, actorId: "s1", actorKind: "staff", source: "app", terminalId: "t1", newId: () => `a${Math.random()}` };
const drawer = (terminalId: string, extra: Partial<Drawer> = {}): Drawer & { id: string } => ({ id: `2026-10-05_${terminalId}`, terminalId, businessDate: "2026-10-05", openingFloatPaise: 200000, openedBy: "s1", openedAtMs: 1, status: "open", updatedAtMs: 1, ...extra });
const base: CloseDayInput = {
  businessDate: "2026-10-05",
  lastZNo: 3,
  day: { status: "open" },
  stats: { orders: 12, totalPaise: 50000, grossPaise: 50000, byPay: { cash: 30000, upi: 20000 }, cash: { t1: { sales: 30000, refunds: 0, paidIn: 0, paidOut: 5000, drops: 0 } }, stock: { tea: { in: 0, sold: 4, rev: 0, waste: 0, adj: 0 } } },
  drawers: [drawer("t1")],
  invoices: [
    { series: "1", seq: 2, invoiceNo: "1/26-27/000002", status: "issued" },
    { series: "1", seq: 1, invoiceNo: "1/26-27/000001", status: "cancelled" },
    { series: "1", seq: 3, invoiceNo: "1/26-27/000003", status: "void_unused" },
  ],
  prevSnapshot: { tea: 10 },
  counts: { t1: { countedPaise: 224000 } },
};

describe("close day", () => {
  it("closes the drawer with its count, then the day with the next Z", () => {
    const { plan, z, zNo } = closeDayPlan(till, base);
    expect(zNo).toBe(4);
    const drawerOp = plan.ops.find((o) => o.path === "clients/tr/drawers/2026-10-05_t1");
    // expected = 2000 float + 300 cash − 50 paid out = 2250; counted 2240 → 10 short
    expect(drawerOp?.data).toMatchObject({ status: "closed", expectedPaise: 225000, countedPaise: 224000, variancePaise: -1000, closedBy: "s1" });
    expect(plan.ops.find((o) => o.path === "clients/tr/days/2026-10-05")?.data).toMatchObject({ status: "closed", zNo: 4 });
    expect(plan.ops.find((o) => o.path === "clients/tr")?.data).toEqual({ lastZNo: 4, updatedAtMs: 5_000 });
    expect(plan.ops.find((o) => o.path === "clients/tr/stockSnapshots/2026-10-05")?.data).toMatchObject({ items: { tea: 6 } });
    expect(z).toMatchObject({ zNo: 4, orders: 12, totalPaise: 50000, drawers: [{ terminalId: "t1", expectedPaise: 225000, countedPaise: 224000, variancePaise: -1000 }] });
    expect(z.invoiceRanges).toEqual([{ series: "1", first: "1/26-27/000001", last: "1/26-27/000002", count: 2, cancelled: 1 }]);
    expect(receiptText(renderZ(z, { cols: 32, outletName: "Tea Room" }), 32)).toContain("Z REPORT #4");
  });

  it("from admin, an uncounted drawer closes as not counted; one already closed keeps its count", () => {
    const admin: PlanCtx = { ...till, actorId: "boss", actorKind: "platform", source: "admin", terminalId: undefined };
    const { plan, z } = closeDayPlan(admin, { ...base, drawers: [drawer("t1"), drawer("t2", { status: "closed", countedPaise: 100000 })], counts: {} });
    const t1 = plan.ops.find((o) => o.path.endsWith("drawers/2026-10-05_t1"))?.data;
    expect(t1).toMatchObject({ status: "closed", note: "Closed without a cash count", closedBy: "boss" });
    expect(t1).not.toHaveProperty("countedPaise");
    expect(plan.ops.some((o) => o.path.endsWith("drawers/2026-10-05_t2"))).toBe(false);
    expect(z.drawers.find((d) => d.terminalId === "t1")).not.toHaveProperty("countedPaise");
    expect(z.drawers.find((d) => d.terminalId === "t2")).toMatchObject({ countedPaise: 100000 });
  });

  it("refuses a day that is closed or was never opened", () => {
    expect(() => closeDayPlan(till, { ...base, day: { status: "closed", zNo: 3 } })).toThrow(/already closed \(Z 3\)/);
    expect(() => closeDayPlan(till, { ...base, day: null })).toThrow(/never opened/);
  });

  it("invoice ranges per series", () => {
    expect(invoiceRangesFrom([])).toEqual([]);
    expect(invoiceRangesFrom([{ series: "2", seq: 5, invoiceNo: "2/26-27/000005", status: "issued" }, { series: "1", seq: 9, invoiceNo: "1/26-27/000009", status: "issued" }]).map((r) => r.series)).toEqual(["1", "2"]);
  });
});

import { describe, expect, it } from "vitest";
import { computeBill } from "../src/bill";
import { mapSentinels } from "../src/plans/types";
import type { PlanCtx, WritePlan } from "../src/plans/types";
import {
  billPlan,
  cancelOrderPlan,
  invoiceLinesFor,
  kotPlan,
  mergePlan,
  quickPlan,
  settlePlan,
  voidLinePlan,
  voidTicketPlan,
} from "../src/plans/order";
import type { OrderRef } from "../src/plans/order";
import { cashMovePlan, dayOpenPlan, expensePlan, expenseVoidPlan, stockMovePlan, zClosePlan } from "../src/plans/ops";
import { bootstrapPlan, heartbeatPlan, pairPlan, revokeTerminalPlan } from "../src/plans/platform";
import { createClientPlan, updateClientPlan, upsertItemPlan } from "../src/plans/admin";
import { settleTenders } from "../src/tenders";
import type { Client, OrderLine } from "../src/types";

let n = 0;
const ctx: PlanCtx = { cid: "demo", nowMs: Date.parse("2026-09-29T08:35:00Z"), actorId: "s1", actorKind: "staff", terminalId: "t1", source: "app", newId: () => `id${++n}` };
const tracked = new Set(["paneer"]);
const supplier = { legalName: "Demo", fssai: "12345678901234", address: "x", stateName: "Maharashtra", stateCode: "27", gstin: "27AAPFU0939F1ZV" };
const client = { taxMode: "regular" as const, rounding: "rupee" as const, defaultTaxBps: 500 };

const line = (id: string, itemId: string, qty: number, extra: Partial<OrderLine> = {}): OrderLine => ({
  lineId: id,
  seq: 1,
  itemId,
  name: itemId,
  categoryId: "c",
  station: "kitchen",
  unitPricePaise: 20000,
  qty,
  taxBps: null,
  sentQty: 0,
  voidedQty: 0,
  addedBy: "s1",
  addedAtMs: 0,
  ...extra,
});

function order(status: OrderRef["status"], lines: OrderLine[], extra: Partial<OrderRef> = {}): OrderRef {
  return {
    id: "o1",
    orderNo: "1-001",
    mode: "dineIn",
    businessDate: "2026-09-29",
    terminalId: "t1",
    kotCount: 1,
    status,
    lines: Object.fromEntries(lines.map((l) => [l.lineId, l])),
    tableId: "tab4",
    tableLabel: "T4",
    ...extra,
  };
}

const postingOpsOf = (p: WritePlan) => p.ops.filter((o) => o.path.includes("/postings/"));
const statsOpsOf = (p: WritePlan) => p.ops.filter((o) => o.path.includes("/dailyStats/") || o.path.includes("/stock/"));

/** The exactly-once contract every stats-moving plan must honour. */
function expectExactlyOnce(p: WritePlan) {
  expect(p.postingKey).toBeTruthy();
  const postings = postingOpsOf(p);
  expect(postings).toHaveLength(1);
  expect(postings[0]?.path.endsWith(`/postings/${p.postingKey}`)).toBe(true);
  expect(postings[0]?.op).toBe("set");
  for (const op of statsOpsOf(p)) expect(op.data.lastPostingKey).toBe(p.postingKey);
  expect(new Set(p.ops.map((o) => o.path)).size).toBe(p.ops.length);
}

const bill = computeBill({ lines: [{ lineId: "a", unitPricePaise: 20000, qty: 1, voidedQty: 0, taxBps: null }], serviceChargeOptIn: false, charges: { packagingPaise: 0, packagingOn: [], deliveryPaise: 0, serviceChargeBps: 0 }, mode: "dineIn", client });
const invoice = { series: "DC1", fy: "26-27", seq: 1, invoiceNo: "DC1/26-27/000001", invoiceId: "DC1-2627-000001", dateIST: "2026-09-29" };
const tender = settleTenders(bill.grandTotalPaise, 0, [{ mode: "upi", amountPaise: 10000 }, { mode: "cash", amountPaise: 20000 }]);
const applied = tender.ok ? tender.applied : [];

describe("order plans honour exactly-once", () => {
  it("kot (first round creates the order)", () => {
    const p = kotPlan(ctx, {
      order: { create: { id: "o1", orderNo: "1-001", mode: "dineIn", businessDate: "2026-09-29", tableId: "tab4", tableLabel: "T4", covers: 3 } },
      lines: [line("a", "paneer", 2), line("b", "lime", 1, { station: "bar" })],
      alloc: { numbers: [17, 18], terminalCode: "1" },
      tracked,
    });
    expectExactlyOnce(p);
    expect(p.kots.map((k) => k.kotNo)).toEqual(["1-17", "1-18"]);
    const orderOp = p.ops.find((o) => o.path === "clients/demo/orders/o1");
    expect(orderOp?.op).toBe("set");
    expect((orderOp?.data.lines as Record<string, OrderLine>).a?.sentQty).toBe(2);
    expect(p.ops.find((o) => o.path === "clients/demo/stock/paneer")?.data.onHand).toEqual({ $inc: -2 });
    expect(p.ops.some((o) => o.path === "clients/demo/stock/lime")).toBe(false);
    expect(p.postingKey).toBe("kot:o1-1-17");
  });

  it("void ticket: kept as a cancelled order, counted in the day's voids, no sales or stock", () => {
    const p = voidTicketPlan(ctx, {
      create: { id: "t9", orderNo: "1-009", mode: "quick", businessDate: "2026-09-29" },
      lines: [line("a", "paneer", 2), line("b", "lime", 1, { unitPricePaise: 5000 })],
      reason: "customer_changed",
    });
    expectExactlyOnce(p);
    expect(p.postingKey).toBe("tvoid:t9");
    const order = p.ops.find((o) => o.path === "clients/demo/orders/t9")?.data;
    expect(order).toMatchObject({ status: "cancelled", orderNo: "1-009", terminalId: "t1", cancel: { reason: "customer_changed", by: "s1", prepared: false } });
    expect((order?.lines as Record<string, OrderLine>).a).toMatchObject({ qty: 2, voidedQty: 2, sentQty: 0 });
    const stats = p.ops.find((o) => o.path.includes("/dailyStats/"))?.data as Record<string, unknown>;
    expect(stats.voidItems).toEqual({ n: { $inc: 3 }, paise: { $inc: 45000 } });
    expect(stats.voidByReason).toEqual({ customer_changed: { n: { $inc: 3 }, paise: { $inc: 45000 } } });
    expect(stats.byStaff).toEqual({ s1: { voids: { $inc: 3 } } });
    expect(stats.totalPaise).toBeUndefined();
    expect(stats.orders).toBeUndefined();
    expect(p.ops.some((o) => o.path.includes("/stock/") || o.path.includes("/kots/") || o.path.includes("/invoices/"))).toBe(false);
    expect(() => voidTicketPlan(ctx, { create: { id: "t0", orderNo: "1-010", mode: "quick", businessDate: "2026-09-29" }, lines: [], reason: "other" })).toThrow();
  });

  it("kot add-on updates lines with dotted paths", () => {
    const p = kotPlan(ctx, { order: order("open", [line("a", "paneer", 2, { sentQty: 2 })]), lines: [line("c", "paneer", 1, { seq: 2 })], alloc: { numbers: [19], terminalCode: "1" }, tracked });
    const upd = p.ops.find((o) => o.path === "clients/demo/orders/o1");
    expect(upd?.op).toBe("update");
    expect(upd?.data["lines.c"]).toMatchObject({ sentQty: 1, kotId: "o1-1-19" });
    expect(p.ops.find((o) => o.path.includes("/kots/"))?.data.kind).toBe("addon");
  });

  it("bill issues the invoice and advances the terminal sequence; no posting", () => {
    const o = order("open", [line("a", "paneer", 1, { sentQty: 1 })]);
    const p = billPlan(ctx, { order: o, bill, lines: invoiceLinesFor(Object.values(o.lines), bill), invoice, supplier, docType: "tax_invoice" });
    expect(p.postingKey).toBeUndefined();
    expect(p.ops.find((x) => x.path === "clients/demo/orders/o1")?.data).toMatchObject({ status: "billed", invoiceId: invoice.invoiceId });
    expect(p.ops.find((x) => x.path === "clients/demo/invoices/DC1-2627-000001")?.data).toMatchObject({ seq: 1, status: "issued", series: "DC1" });
    expect(p.ops.find((x) => x.path === "clients/demo/terminals/t1")?.data).toMatchObject({ lastInvoiceSeq: 1, lastInvoiceFy: "26-27" });
  });

  it("settle", () => {
    const p = settlePlan(ctx, { order: order("billed", [line("a", "paneer", 1, { sentQty: 1 })], { invoiceId: invoice.invoiceId, invoiceNo: invoice.invoiceNo }), bill, series: "DC1", applied, tipPaise: 0 });
    expectExactlyOnce(p);
    expect(p.postingKey).toBe("settle:o1");
    expect(p.ops.filter((o) => o.path.includes("/payments/"))).toHaveLength(2);
    const stats = p.ops.find((o) => o.path.includes("/dailyStats/"))?.data;
    expect(stats?.totalPaise).toEqual({ $inc: 20000 }); // ₹200 menu price, GST inside it
  });

  it("quick order is one batch with one posting", () => {
    const p = quickPlan(ctx, {
      create: { id: "q1", orderNo: "1-002", mode: "quick", businessDate: "2026-09-29", token: 7 },
      lines: [line("a", "paneer", 1)],
      alloc: { numbers: [20], terminalCode: "1" },
      bill,
      invoiceLines: invoiceLinesFor([line("a", "paneer", 1)], bill),
      invoice: { ...invoice, seq: 2, invoiceNo: "DC1/26-27/000002", invoiceId: "DC1-2627-000002" },
      supplier,
      docType: "tax_invoice",
      applied,
      tipPaise: 0,
      tracked,
    });
    expectExactlyOnce(p);
    expect(p.postingKey).toBe("quick:q1");
    expect(p.ops.find((o) => o.path === "clients/demo/orders/q1")?.data).toMatchObject({ status: "settled", token: 7 });
    expect(p.ops.find((o) => o.path.includes("/kots/"))?.data).toMatchObject({ where: "Token 7", kind: "new" });
    expect(p.ops.find((o) => o.path === "clients/demo/stock/paneer")?.data.onHand).toEqual({ $inc: -1 });
  });

  it("void", () => {
    const l = line("a", "paneer", 2, { sentQty: 2 });
    const p = voidLinePlan(ctx, { order: order("open", [l]), line: l, qty: 1, reason: "wrong_item", prepared: false, alloc: { numbers: [21], terminalCode: "1" }, tracked, approver: { id: "m1", name: "Manager" } });
    expectExactlyOnce(p);
    expect(p.postingKey).toBe("void:o1:a:1");
    expect(p.ops.find((o) => o.path === "clients/demo/orders/o1")?.data["lines.a.voidedQty"]).toBe(1);
    expect(p.kot.items[0]?.qty).toBe(1);
    expect(() => voidLinePlan(ctx, { order: order("open", [l]), line: l, qty: 3, reason: "x", prepared: false, alloc: { numbers: [22], terminalCode: "1" }, tracked })).toThrow();
  });

  it("cancel a settled bill", () => {
    const l = line("a", "paneer", 1, { sentQty: 1 });
    const p = cancelOrderPlan(ctx, {
      order: order("settled", [l], { invoiceId: invoice.invoiceId, invoiceNo: invoice.invoiceNo, bill, settledAtMs: ctx.nowMs, settledBy: "s1" }),
      reason: "wrong_bill",
      prepared: false,
      tracked,
      refunds: applied,
      series: "DC1",
    });
    expectExactlyOnce(p);
    expect(p.ops.filter((o) => o.path.includes("/payments/o1_r"))).toHaveLength(2);
    expect(p.ops.find((o) => o.path.includes("/invoices/"))?.data.status).toBe("cancelled");
    const stats = p.ops.find((o) => o.path.includes("/dailyStats/"))?.data as Record<string, unknown>;
    expect(stats.totalPaise).toEqual({ $inc: -20000 });
    expect(stats.byPay).toBeUndefined();
  });

  it("cancel an unbilled order returns stock without touching sales", () => {
    const l = line("a", "paneer", 2, { sentQty: 2 });
    const p = cancelOrderPlan(ctx, { order: order("open", [l]), reason: "customer_left", prepared: false, tracked });
    expectExactlyOnce(p);
    const stats = p.ops.find((o) => o.path.includes("/dailyStats/"))?.data as Record<string, unknown>;
    expect(stats.cancelledBills).toBeUndefined();
    expect(stats.totalPaise).toBeUndefined();
    expect(p.ops.find((o) => o.path === "clients/demo/stock/paneer")?.data.onHand).toEqual({ $inc: 2 });
  });

  it("merge moves lines and cancels the source", () => {
    const target = order("open", [line("a", "paneer", 1, { sentQty: 1 })]);
    const source = { ...order("open", [line("x", "lime", 2, { sentQty: 2 })]), id: "o2", orderNo: "1-003", tableLabel: "T2", covers: 2 };
    const p = mergePlan(ctx, source, target);
    const t = p.ops.find((o) => o.path === "clients/demo/orders/o1")?.data;
    expect(t?.["lines.x"]).toMatchObject({ seq: 2 });
    expect(p.ops.find((o) => o.path === "clients/demo/orders/o2")?.data).toMatchObject({ status: "cancelled" });
    expect(() => mergePlan(ctx, { ...source, status: "billed" }, target)).toThrow();
  });
});

describe("money, stock and admin plans honour exactly-once", () => {
  it("expense + void", () => {
    const e = { id: "e1", businessDate: "2026-09-29", category: "vegetables" as const, amountPaise: 50000, paidVia: "drawer" as const, drawerTerminalId: "t1" };
    expectExactlyOnce(expensePlan(ctx, e));
    expectExactlyOnce(expenseVoidPlan(ctx, e, "duplicate"));
  });
  it("cash moves (no_sale has no posting)", () => {
    expectExactlyOnce(cashMovePlan(ctx, { id: "c1", businessDate: "2026-09-29", kind: "paid_in", amountPaise: 10000, reason: "change" }));
    const ns = cashMovePlan(ctx, { id: "c2", businessDate: "2026-09-29", kind: "no_sale", amountPaise: 0, reason: "open drawer" });
    expect(ns.postingKey).toBeUndefined();
    expect(postingOpsOf(ns)).toHaveLength(0);
  });
  it("stock moves including a physical count", () => {
    for (const kind of ["in", "waste", "adjust"] as const) expectExactlyOnce(stockMovePlan(ctx, { id: `m-${kind}`, businessDate: "2026-09-29", kind, itemId: "paneer", qty: 3 }));
    const c = stockMovePlan(ctx, { id: "m-count", businessDate: "2026-09-29", kind: "count", itemId: "paneer", qty: 7, onHand: 9 });
    expectExactlyOnce(c);
    expect(c.ops.find((o) => o.path === "clients/demo/stock/paneer")?.data.onHand).toEqual({ $inc: -2 });
    expect(postingOpsOf(c)[0]?.data).toMatchObject({ kind: "count", counted: 7, onHandBefore: 9 });
  });
  it("new item with opening stock posts it as stock-in", () => {
    const p = upsertItemPlan(ctx, {
      id: "paneer",
      item: { name: "Paneer", categoryId: "c", sort: 1, foodType: "veg", pricePaise: 20000, variants: [], taxBps: null, modes: ["dineIn"], trackStock: true, unit: "plate", lowAt: 5, available: true, active: true },
      openingQty: 20,
      businessDate: "2026-09-29",
    });
    expectExactlyOnce(p);
    expect(p.ops.find((o) => o.path === "clients/demo/stock/paneer")?.data.onHand).toEqual({ $inc: 20 });
  });
});

describe("day, platform and client plans", () => {
  it("day open creates the drawer; Z close writes snapshot and advances lastZNo", () => {
    const open = dayOpenPlan(ctx, { businessDate: "2026-09-29", floatPaise: 200000, createDay: true });
    expect(open.ops.map((o) => o.path)).toEqual(expect.arrayContaining(["clients/demo/days/2026-09-29", "clients/demo/drawers/2026-09-29_t1"]));
    const z = zClosePlan(ctx, { businessDate: "2026-09-29", zNo: 1, z: { totalPaise: 0 } as never, snapshot: { paneer: 10 } });
    expect(z.ops.find((o) => o.path === "clients/demo")?.data.lastZNo).toBe(1);
    expect(z.ops.find((o) => o.path.includes("stockSnapshots"))?.data.items).toEqual({ paneer: 10 });
  });
  it("bootstrap, pairing, revoke, heartbeat", () => {
    expect(bootstrapPlan({ uid: "u1", name: "Mandy", nowMs: 1 }).ops.map((o) => o.path)).toEqual(["meta/bootstrap", "platformUsers/u1"]);
    const admin: PlanCtx = { ...ctx, actorKind: "platform", actorId: "u1", source: "admin", terminalId: undefined };
    const pair = pairPlan(admin, { requestUid: "dev1", terminalId: "t9", code: "2", name: "Counter", mode: "pos", series: "DC2", fy: "26-27" });
    expect(pair.ops.map((o) => o.path)).toEqual(expect.arrayContaining(["clients/demo/terminals/t9", "clients/demo/members/dev1", "pairingRequests/dev1"]));
    const rev = revokeTerminalPlan(admin, { id: "t9", authUid: "dev1", name: "Counter" }, "lost");
    expect(rev.ops.find((o) => o.path === "clients/demo/members/dev1")?.data.active).toBe(false);
    expect(heartbeatPlan(ctx, { appVersion: "0.1.0", pendingWrites: 0, journalRejected: 0 }).ops[0]?.op).toBe("merge");
  });
  it("client create and audited update", () => {
    const admin: PlanCtx = { ...ctx, actorKind: "platform", actorId: "u1", source: "admin", terminalId: undefined };
    const c = createClientPlan(admin, { name: "Demo", legalName: "Demo Pvt Ltd", address: "x", city: "Mumbai", stateName: "Maharashtra", stateCode: "27", fssai: "12345678901234" });
    const doc = c.ops[0]?.data as unknown as Client;
    expect(doc.orderModes).toEqual({ dineIn: true, quick: true, delivery: false });
    expect(doc.charges.serviceChargeBps).toBe(0);
    const u = updateClientPlan(admin, doc, { orderModes: { dineIn: true, quick: true, delivery: true } });
    expect(u.ops[0]?.data.orderModes).toEqual({ dineIn: true, quick: true, delivery: true });
    expect(u.ops[1]?.data).toMatchObject({ action: "client.update", before: { orderModes: { delivery: false } } });
    expect(updateClientPlan(admin, doc, { orderModes: doc.orderModes }).ops).toHaveLength(0);
  });
});

describe("sentinel mapping", () => {
  it("converts sentinels and drops undefined", () => {
    const out = mapSentinels({ a: { $inc: 2 }, b: undefined, c: { d: { $serverTs: true } }, e: [1, undefined, 2] }, (s) => `S:${Object.keys(s)[0]}`);
    expect(out).toEqual({ a: "S:$inc", c: { d: "S:$serverTs" }, e: [1, 2] });
  });
});

describe("audit snapshots never carry write markers", () => {
  it("replaces sentinels in before/after with null", async () => {
    const { auditOp } = await import("../src/plans/common");
    const { del } = await import("../src/plans/types");
    const op = auditOp(ctx, { action: "client.update", target: { type: "client", id: "c" }, after: { gstin: del(), name: "x" } });
    expect(op.data.after).toEqual({ gstin: null, name: "x" });
  });
});

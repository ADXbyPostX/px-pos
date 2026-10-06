import { paths, postingKey } from "../paths";
import { cashMoveDelta, cashStats, expectedCashFor, expenseDelta, expenseVoidDelta, stockMoveDelta, zReport } from "../stats";
import { snapshotFromLedger } from "../stock";
import type { BizDate, CashMoveKind, DailyStats, Day, Drawer, Expense, ExpenseCategory, Invoice, Paise, PaidVia, PostingKind, ZReport } from "../types";
import { auditOp, meta, postingOps } from "./common";
import type { PlanCtx, PlanOp, WritePlan } from "./types";

// ─── expenses ───────────────────────────────────────────────────────────────

export interface ExpenseInput {
  id: string;
  businessDate: BizDate;
  category: ExpenseCategory;
  amountPaise: Paise;
  paidVia: PaidVia;
  drawerTerminalId?: string;
  payee?: string;
  note?: string;
  approver?: { id: string; name?: string };
}

export function expensePlan(ctx: PlanCtx, e: ExpenseInput): WritePlan {
  const key = postingKey.expense(e.id);
  const doc = {
    ...meta(ctx),
    outletId: "main",
    businessDate: e.businessDate,
    dateMs: ctx.nowMs,
    category: e.category,
    amountPaise: e.amountPaise,
    paidVia: e.paidVia,
    ...(e.paidVia === "drawer" && e.drawerTerminalId ? { drawerTerminalId: e.drawerTerminalId } : {}),
    ...(e.payee ? { payee: e.payee } : {}),
    ...(e.note ? { note: e.note } : {}),
    enteredBy: ctx.actorId,
    ...(e.approver ? { approvedBy: e.approver.id } : {}),
    status: "active",
    ...(ctx.terminalId ? { terminalId: ctx.terminalId } : {}),
  };
  return {
    label: `Expense ${e.category}`,
    ops: [
      { path: paths.doc(ctx.cid, "expenses", e.id), op: "set", data: doc },
      ...postingOps(ctx, { key, kind: "expense", businessDate: e.businessDate, refId: e.id, stats: expenseDelta(e), ...(e.approver ? { approverId: e.approver.id } : {}) }),
    ],
    postingKey: key,
    primaryPath: paths.posting(ctx.cid, key),
  };
}

export function expenseVoidPlan(ctx: PlanCtx, e: Pick<Expense, "businessDate" | "category" | "amountPaise" | "paidVia" | "drawerTerminalId"> & { id: string }, reason: string): WritePlan {
  const key = postingKey.expenseVoid(e.id);
  return {
    label: `Void expense`,
    ops: [
      { path: paths.doc(ctx.cid, "expenses", e.id), op: "update", data: { status: "void", void: { reason, by: ctx.actorId, atMs: ctx.nowMs }, updatedAtMs: ctx.nowMs } },
      // Reversal is booked on the expense's own business day so both days reconcile.
      ...postingOps(ctx, { key, kind: "expense_void", businessDate: e.businessDate, refId: e.id, stats: expenseVoidDelta(e) }),
      auditOp(ctx, { action: "expense.void", target: { type: "expense", id: e.id }, before: { amountPaise: e.amountPaise, category: e.category }, reason }),
    ],
    postingKey: key,
    primaryPath: paths.posting(ctx.cid, key),
  };
}

// ─── cash drawer movements ──────────────────────────────────────────────────

export interface CashMoveInput {
  id: string;
  businessDate: BizDate;
  kind: CashMoveKind;
  amountPaise: Paise;
  reason: string;
  approver?: { id: string; name?: string };
}

export function cashMovePlan(ctx: PlanCtx, m: CashMoveInput): WritePlan {
  if (!ctx.terminalId) throw new Error("cashMovePlan: terminalId required");
  const doc = {
    ...meta(ctx),
    outletId: "main",
    businessDate: m.businessDate,
    terminalId: ctx.terminalId,
    kind: m.kind,
    amountPaise: m.kind === "no_sale" ? 0 : m.amountPaise,
    reason: m.reason,
    staffId: ctx.actorId,
    ...(m.approver ? { approvedBy: m.approver.id } : {}),
  };
  const ops: PlanOp[] = [{ path: paths.doc(ctx.cid, "cashMovements", m.id), op: "set", data: doc }];
  let key: string | undefined;
  if (m.kind !== "no_sale") {
    key = postingKey.cashMove(m.id);
    ops.push(...postingOps(ctx, { key, kind: "cash_move", businessDate: m.businessDate, refId: m.id, stats: cashMoveDelta(m.kind, m.amountPaise, ctx.terminalId), ...(m.approver ? { approverId: m.approver.id } : {}) }));
  }
  ops.push(auditOp(ctx, { action: `cash.${m.kind}`, target: { type: "drawer", id: `${m.businessDate}_${ctx.terminalId}` }, after: { amountPaise: m.amountPaise }, reason: m.reason, ...(m.approver ? { approver: m.approver } : {}) }));
  return { label: `Cash ${m.kind.replace("_", " ")}`, ops, ...(key ? { postingKey: key } : {}), primaryPath: key ? paths.posting(ctx.cid, key) : paths.doc(ctx.cid, "cashMovements", m.id) };
}

// ─── stock movements ────────────────────────────────────────────────────────

export type StockMoveKindInput = "in" | "waste" | "adjust" | "count";

export interface StockMoveInput {
  id: string;
  businessDate: BizDate;
  kind: StockMoveKindInput;
  itemId: string;
  itemName?: string;
  /** in/waste: positive units; adjust: signed units; count: the physically counted quantity. */
  qty: number;
  /** For count: the current onHand, so the adjustment = counted − onHand. */
  onHand?: number;
  reason?: string;
  approver?: { id: string; name?: string };
}

const KIND_FOR: Record<StockMoveKindInput, PostingKind> = { in: "stock_in", waste: "wastage", adjust: "adjust", count: "count" };

export function stockMovePlan(ctx: PlanCtx, m: StockMoveInput): WritePlan {
  if (!Number.isInteger(m.qty)) throw new Error("Stock quantities are whole units");
  const deltaQty = m.kind === "count" ? m.qty - (m.onHand ?? 0) : m.qty;
  const delta = m.kind === "in" ? stockMoveDelta("in", m.itemId, m.qty) : m.kind === "waste" ? stockMoveDelta("waste", m.itemId, m.qty) : stockMoveDelta("adjust", m.itemId, deltaQty);
  const key = postingKey.stockMove(m.id);
  return {
    label: `Stock ${m.kind} ${m.itemName ?? m.itemId}`,
    ops: [
      ...postingOps(ctx, {
        key,
        kind: KIND_FOR[m.kind],
        businessDate: m.businessDate,
        refId: m.itemId,
        stats: delta.stats,
        stock: delta.stock,
        ...(m.approver ? { approverId: m.approver.id } : {}),
        extra: { itemId: m.itemId, ...(m.kind === "count" ? { counted: m.qty, onHandBefore: m.onHand ?? 0 } : {}), ...(m.reason ? { reason: m.reason } : {}) },
      }),
      auditOp(ctx, {
        action: `stock.${m.kind}`,
        target: { type: "item", id: m.itemId, ...(m.itemName ? { label: m.itemName } : {}) },
        after: m.kind === "count" ? { counted: m.qty, adjustment: deltaQty } : { qty: m.qty },
        ...(m.reason ? { reason: m.reason } : {}),
        ...(m.approver ? { approver: m.approver } : {}),
      }),
    ],
    postingKey: key,
    primaryPath: paths.posting(ctx.cid, key),
  };
}

// ─── day and drawers ────────────────────────────────────────────────────────

export function dayOpenPlan(ctx: PlanCtx, i: { businessDate: BizDate; floatPaise: Paise; createDay: boolean }): WritePlan {
  if (!ctx.terminalId) throw new Error("dayOpenPlan: terminalId required");
  const ops: PlanOp[] = [];
  if (i.createDay) {
    ops.push({ path: paths.day(ctx.cid, i.businessDate), op: "merge", data: { status: "open", openedAtMs: ctx.nowMs, openedBy: ctx.actorId, updatedAtMs: ctx.nowMs } });
  }
  ops.push({
    path: paths.drawer(ctx.cid, i.businessDate, ctx.terminalId),
    op: "set",
    data: {
      terminalId: ctx.terminalId,
      businessDate: i.businessDate,
      openingFloatPaise: i.floatPaise,
      openedBy: ctx.actorId,
      openedAtMs: ctx.nowMs,
      status: "open",
      updatedAtMs: ctx.nowMs,
    },
  });
  ops.push(auditOp(ctx, { action: "drawer.open", target: { type: "drawer", id: `${i.businessDate}_${ctx.terminalId}` }, after: { floatPaise: i.floatPaise } }));
  return { label: `Open day ${i.businessDate}`, ops, primaryPath: paths.drawer(ctx.cid, i.businessDate, ctx.terminalId) };
}

export function drawerClosePlan(
  ctx: PlanCtx,
  i: { businessDate: BizDate; countedPaise: Paise; denoms: Record<string, number>; expectedPaise: Paise; note?: string },
): WritePlan {
  if (!ctx.terminalId) throw new Error("drawerClosePlan: terminalId required");
  const path = paths.drawer(ctx.cid, i.businessDate, ctx.terminalId);
  return {
    label: `Close drawer ${i.businessDate}`,
    ops: [
      {
        path,
        op: "update",
        data: {
          status: "closed",
          countedPaise: i.countedPaise,
          denoms: i.denoms,
          expectedPaise: i.expectedPaise,
          variancePaise: i.countedPaise - i.expectedPaise,
          ...(i.note ? { note: i.note } : {}),
          closedBy: ctx.actorId,
          closedAtMs: ctx.nowMs,
          updatedAtMs: ctx.nowMs,
        },
      },
      auditOp(ctx, { action: "drawer.close", target: { type: "drawer", id: `${i.businessDate}_${ctx.terminalId}` }, after: { counted: i.countedPaise, expected: i.expectedPaise, variance: i.countedPaise - i.expectedPaise }, ...(i.note ? { reason: i.note } : {}) }),
    ],
    primaryPath: path,
  };
}

/**
 * Z close. Returns the ops; the caller runs them inside runTransaction after re-reading
 * clients.lastZNo and dailyStats from the server (online only).
 */
export function zClosePlan(
  ctx: PlanCtx,
  i: { businessDate: BizDate; zNo: number; z: ZReport; snapshot: Record<string, number>; counted?: Record<string, number>; approver?: { id: string; name?: string } },
): WritePlan {
  const path = paths.day(ctx.cid, i.businessDate);
  return {
    label: `Z close ${i.businessDate}`,
    ops: [
      {
        path,
        op: "merge",
        data: {
          status: "closed",
          closedAtMs: ctx.nowMs,
          closedBy: ctx.actorId,
          ...(i.approver ? { approvedBy: i.approver.id } : {}),
          zNo: i.zNo,
          z: i.z,
          updatedAtMs: ctx.nowMs,
        },
      },
      { path: paths.client(ctx.cid), op: "update", data: { lastZNo: i.zNo, updatedAtMs: ctx.nowMs } },
      { path: paths.stockSnapshot(ctx.cid, i.businessDate), op: "set", data: { businessDate: i.businessDate, items: i.snapshot, ...(i.counted ? { counted: i.counted } : {}), createdAtMs: ctx.nowMs } },
      auditOp(ctx, { action: "day.close", target: { type: "day", id: i.businessDate }, after: { zNo: i.zNo, totalPaise: i.z.totalPaise }, ...(i.approver ? { approver: i.approver } : {}) }),
    ],
    primaryPath: path,
  };
}

/** Bills issued on a business day, per series: first and last number, issued and cancelled. */
export function invoiceRangesFrom(invoices: Array<Pick<Invoice, "series" | "seq" | "invoiceNo" | "status">>): ZReport["invoiceRanges"] {
  const by = new Map<string, Array<Pick<Invoice, "seq" | "invoiceNo" | "status">>>();
  for (const i of invoices) if (i.status !== "void_unused") by.set(i.series, [...(by.get(i.series) ?? []), i]);
  return [...by.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([series, list]) => {
      const sorted = [...list].sort((a, b) => a.seq - b.seq);
      return { series, first: sorted[0]!.invoiceNo, last: sorted[sorted.length - 1]!.invoiceNo, count: sorted.length, cancelled: sorted.filter((i) => i.status === "cancelled").length };
    });
}

/** What a day close reads first (inside the transaction, from the server). */
export interface CloseDayInput {
  businessDate: BizDate;
  /** clients/{cid}.lastZNo — the new Z is the next number. */
  lastZNo: number;
  day: Pick<Day, "status" | "zNo"> | null;
  stats: Partial<DailyStats> | null;
  /** Every drawer opened for the day (one per terminal). */
  drawers: Array<Drawer & { id: string }>;
  /** That day's bills, for the invoice ranges on the Z. */
  invoices: Array<Pick<Invoice, "series" | "seq" | "invoiceNo" | "status">>;
  /** The previous business day's stock snapshot, if it was closed. */
  prevSnapshot: Record<string, number> | null;
  /** Cash counted per terminal for drawers still open. A drawer without a count closes as "not counted" (admin). */
  counts: Record<string, { countedPaise?: Paise; note?: string }>;
  approver?: { id: string; name?: string };
}

/**
 * End of day, from the till or from admin: closes every drawer still open (counted, or marked not
 * counted), then the day itself with the next Z number, the Z report and the stock snapshot.
 * Run it inside a transaction with fresh reads (online only); a day already closed throws.
 */
export function closeDayPlan(ctx: PlanCtx, i: CloseDayInput): { plan: WritePlan; z: ZReport; zNo: number } {
  if (!i.day) throw new Error(`Business day ${i.businessDate} was never opened.`);
  if (i.day.status === "closed") throw new Error(`Business day ${i.businessDate} is already closed (Z ${i.day.zNo ?? ""}).`);
  const zNo = (i.lastZNo || 0) + 1;
  const stats = i.stats ?? {};
  const ops: PlanOp[] = [];
  const counted: Record<string, Paise | undefined> = {};
  for (const d of i.drawers) {
    if (d.status === "closed") {
      counted[d.terminalId] = d.countedPaise;
      continue;
    }
    const expected = expectedCashFor(d.openingFloatPaise, cashStats(stats.cash?.[d.terminalId]));
    const c = i.counts[d.terminalId];
    const has = c?.countedPaise != null;
    counted[d.terminalId] = has ? c.countedPaise : undefined;
    const note = c?.note?.trim() || (has ? undefined : "Closed without a cash count");
    const path = paths.drawer(ctx.cid, i.businessDate, d.terminalId);
    ops.push({
      path,
      op: "update",
      data: {
        status: "closed",
        expectedPaise: expected,
        ...(has ? { countedPaise: c.countedPaise, variancePaise: c.countedPaise! - expected, denoms: {} } : {}),
        ...(note ? { note } : {}),
        closedBy: ctx.actorId,
        closedAtMs: ctx.nowMs,
        updatedAtMs: ctx.nowMs,
      },
    });
    ops.push(auditOp(ctx, { action: "drawer.close", target: { type: "drawer", id: `${i.businessDate}_${d.terminalId}` }, after: { expected, ...(has ? { counted: c.countedPaise, variance: c.countedPaise! - expected } : { counted: null }) }, ...(note ? { reason: note } : {}) }));
  }
  const z = zReport({
    zNo,
    businessDate: i.businessDate,
    closedAtMs: ctx.nowMs,
    stats,
    drawers: i.drawers.map((d) => ({ terminalId: d.terminalId, openingFloatPaise: d.openingFloatPaise, ...(counted[d.terminalId] != null ? { countedPaise: counted[d.terminalId] } : {}) })),
    invoiceRanges: invoiceRangesFrom(i.invoices),
  });
  const zPlan = zClosePlan(ctx, { businessDate: i.businessDate, zNo, z, snapshot: snapshotFromLedger(i.prevSnapshot ?? {}, stats.stock), ...(i.approver ? { approver: i.approver } : {}) });
  return { plan: { label: `Close day ${i.businessDate}`, ops: [...ops, ...zPlan.ops], primaryPath: zPlan.primaryPath }, z, zNo };
}

export function dayCarryForwardPlan(ctx: PlanCtx, businessDate: BizDate, approver?: { id: string; name?: string }): WritePlan {
  return {
    label: `Carry forward ${businessDate}`,
    ops: [
      { path: paths.day(ctx.cid, businessDate), op: "merge", data: { carriedForward: true, updatedAtMs: ctx.nowMs } },
      auditOp(ctx, { action: "day.carry_forward", target: { type: "day", id: businessDate }, ...(approver ? { approver } : {}) }),
    ],
    primaryPath: paths.day(ctx.cid, businessDate),
  };
}

export function dayReopenPlan(ctx: PlanCtx, businessDate: BizDate, reason: string): WritePlan {
  return {
    label: `Reopen ${businessDate}`,
    ops: [
      { path: paths.day(ctx.cid, businessDate), op: "merge", data: { status: "open", reopenedAtMs: ctx.nowMs, reopenedBy: ctx.actorId, updatedAtMs: ctx.nowMs } },
      auditOp(ctx, { action: "day.reopen", target: { type: "day", id: businessDate }, reason }),
    ],
    primaryPath: paths.day(ctx.cid, businessDate),
  };
}

/** Admin: mark a gap in an invoice series as void_unused (audited). */
export function voidUnusedInvoicePlan(ctx: PlanCtx, i: { invoiceId: string; invoiceNo: string; series: string; fy: string; seq: number; businessDate: BizDate; reason: string }): WritePlan {
  const path = paths.invoice(ctx.cid, i.invoiceId);
  return {
    label: `Void unused ${i.invoiceNo}`,
    ops: [
      {
        path,
        op: "set",
        data: {
          ...meta(ctx),
          outletId: "main",
          invoiceNo: i.invoiceNo,
          series: i.series,
          fy: i.fy,
          seq: i.seq,
          businessDate: i.businessDate,
          dateIST: i.businessDate,
          status: "void_unused",
          cancel: { reason: i.reason, by: ctx.actorId, atMs: ctx.nowMs },
          modifiedCount: 0,
          printedCount: 0,
          staffId: ctx.actorId,
        },
      },
      auditOp(ctx, { action: "invoice.void_unused", target: { type: "invoice", id: i.invoiceId, label: i.invoiceNo }, reason: i.reason }),
    ],
    primaryPath: path,
  };
}

/** Cash counters touched by a drawer on a day (convenience for the Day screen). */
export const DRAWER_FIELDS = ["sales", "refunds", "paidIn", "paidOut", "drops"] as const;

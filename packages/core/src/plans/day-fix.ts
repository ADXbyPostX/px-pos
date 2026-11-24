import { paths, postingKey } from "../paths";
import { addInto, negate, prune, statsTree, sumDeltas, zReport } from "../stats";
import { businessDateFor, istDate, istParts } from "../time";
import type { BizDate, DailyStats, Day, DayCorrection, Drawer, Invoice, Paise, Posting, StatsDelta, ZReport } from "../types";
import { auditOp, meta, postingOps } from "./common";
import { invoiceRangesFrom } from "./ops";
import { arrayUnion, del } from "./types";
import type { PlanCtx, PlanOp, WritePlan } from "./types";

/*
 * Fixing a business day after the fact (admin › End of day): move bills to the day they were
 * sold, correct a cash count, reopen a closed day. A closed day keeps its Z number; the Z as first
 * printed stays in `zFirst` and every fix is listed in `corrections`.
 */

/** Before this hour (IST) a close of today's business day counts as early: the till warns. */
export const EARLY_CLOSE_HOUR = 21;

/**
 * Closing `businessDate` at `atMs` is early when it's still that business day, on its own date, before 9 pm:
 * the rest of the day's bills would then count for the next day (the till's Open day moves on).
 */
export function isEarlyClose(businessDate: BizDate, atMs: number, cutoffMin: number): boolean {
  // Past midnight (a day that runs to a late cutoff) is never early.
  return businessDateFor(atMs, cutoffMin) === businessDate && istDate(atMs) === businessDate && istParts(atMs).hour < EARLY_CLOSE_HOUR;
}

/** Bills on one business day that were sold on another, grouped by the day they belong to. */
export interface MisplacedGroup {
  to: BizDate;
  keys: string[];
  /** Orders whose bill moves (quick and settle postings). */
  orderIds: string[];
  bills: number;
  firstMs: number;
  lastMs: number;
  totalPaise: Paise;
  byPay: Record<string, Paise>;
  /** What moves: the postings' summed stats, without drawer cash (it stays with the count it was counted in). */
  delta: StatsDelta;
}

/** Drawer cash stays where it was physically counted: everything else in a delta moves. */
export function withoutCash(d: StatsDelta): StatsDelta {
  const { cash: _cash, ...rest } = d;
  return prune(rest);
}

/**
 * Till postings stamped with `from` whose time (with the outlet's day cutoff) falls on another
 * business day: a day closed early (the rest of its sales landed on the next date) or left open
 * overnight (the next day's sales landed on it). Keys already moved are left out.
 */
export function misplacedPostings(postings: ReadonlyArray<Posting & { id: string }>, from: BizDate, cutoffMin: number, moved: ReadonlySet<string> = new Set()): MisplacedGroup[] {
  const groups = new Map<BizDate, Array<Posting & { id: string }>>();
  for (const p of postings) {
    if (p.businessDate !== from || !p.terminalId || p.kind === "day_move" || moved.has(p.id)) continue;
    const to = businessDateFor(p.createdAtMs, cutoffMin);
    if (to === from) continue;
    groups.set(to, [...(groups.get(to) ?? []), p]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([to, list]) => {
      const delta = withoutCash(sumDeltas(list.map((p) => p.stats ?? {})));
      const orderIds = [...new Set(list.filter((p) => p.kind === "quick" || p.kind === "settle").map((p) => p.refId))];
      const times = list.map((p) => p.createdAtMs);
      const byPay: Record<string, Paise> = {};
      for (const [k, v] of Object.entries((delta.byPay as StatsDelta | undefined) ?? {})) if (typeof v === "number") byPay[k] = v;
      return {
        to,
        keys: list.map((p) => p.id).sort(),
        orderIds,
        bills: orderIds.length,
        firstMs: Math.min(...times),
        lastMs: Math.max(...times),
        totalPaise: typeof delta.totalPaise === "number" ? delta.totalPaise : 0,
        byPay,
        delta,
      };
    });
}

/** Short, stable id for a set of posting keys (FNV-1a), so the same move can't be applied twice. */
export function moveIdFor(from: BizDate, to: BizDate, keys: readonly string[]): string {
  let h = 0x811c9dc5;
  for (const ch of [...keys].sort().join("|")) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${from}_${to}_${h.toString(36)}`;
}

type InvoiceForRange = Pick<Invoice, "orderId" | "series" | "seq" | "invoiceNo" | "status">;

export interface DayMoveInput {
  from: BizDate;
  group: MisplacedGroup;
  reason: string;
  /** Fresh reads inside the transaction (null = no record). */
  fromDay: Day | null;
  toDay: Day | null;
  fromStats: Partial<DailyStats> | null;
  toStats: Partial<DailyStats> | null;
  /** Both days' bills before the move, for the invoice ranges on a re-frozen Z. */
  fromInvoices: InvoiceForRange[];
  toInvoices: InvoiceForRange[];
}

/** A closed day's Z rebuilt from its corrected stats: same number, drawers and close time. */
export function correctedZ(day: Day & { z: ZReport }, stats: StatsDelta, invoices: InvoiceForRange[]): ZReport {
  return zReport({
    zNo: day.z.zNo,
    businessDate: day.z.businessDate,
    closedAtMs: day.z.closedAtMs,
    stats: stats as Partial<DailyStats>,
    drawers: day.z.drawers.map((d) => ({ terminalId: d.terminalId, openingFloatPaise: d.floatPaise, ...(d.countedPaise != null ? { countedPaise: d.countedPaise } : {}) })),
    invoiceRanges: invoiceRangesFrom(invoices),
  });
}

function correctionOps(ctx: PlanCtx, date: BizDate, day: Day | null, c: Omit<DayCorrection, "atMs" | "by" | "byName">, z?: ZReport): PlanOp[] {
  if (!day) return [];
  const entry: DayCorrection = { ...c, atMs: ctx.nowMs, by: ctx.actorId, ...(ctx.actorName ? { byName: ctx.actorName } : {}) };
  return [
    {
      path: paths.day(ctx.cid, date),
      op: "merge",
      data: {
        ...(z ? { z } : {}),
        ...(z && day.z && !day.zFirst ? { zFirst: day.z } : {}),
        corrections: arrayUnion(entry),
        updatedAtMs: ctx.nowMs,
      },
    },
  ];
}

/**
 * Move one group of misplaced bills to the day they were sold, in one batch (run it in a
 * transaction over fresh reads): an "out" posting on the old day and an "in" posting on the right
 * one carry the exact deltas, a DayMove record lists the postings, and each closed side gets its Z
 * rebuilt (same number) with the fix listed. Orders and invoices are re-stamped afterwards
 * (`retagPlans`). Applying the same move twice is refused (the postings already exist).
 */
export function dayMovePlan(ctx: PlanCtx, i: DayMoveInput): { plan: WritePlan; moveId: string } {
  const { from, group } = i;
  const to = group.to;
  if (to === from) throw new Error("Nothing to move: the bills already belong to this day.");
  if (!group.keys.length) throw new Error("Nothing to move.");
  const reason = i.reason.trim();
  if (!reason) throw new Error("Say why the bills are moved.");
  const moveId = moveIdFor(from, to, group.keys);
  const out = negate(group.delta);
  const moving = new Set(group.orderIds);
  const fromInvoicesAfter = i.fromInvoices.filter((v) => !moving.has(v.orderId));
  const toInvoicesAfter = [...i.toInvoices, ...i.fromInvoices.filter((v) => moving.has(v.orderId))];
  const fromZ = i.fromDay?.status === "closed" && i.fromDay.z ? correctedZ(i.fromDay as Day & { z: ZReport }, addInto(statsTree(i.fromStats), out), fromInvoicesAfter) : undefined;
  const toZ = i.toDay?.status === "closed" && i.toDay.z ? correctedZ(i.toDay as Day & { z: ZReport }, addInto(statsTree(i.toStats), group.delta), toInvoicesAfter) : undefined;
  const summary = { moveId, bills: group.bills, totalPaise: group.totalPaise, note: reason };
  const ops: PlanOp[] = [
    ...postingOps(ctx, { key: postingKey.dayMove(moveId, "out"), kind: "day_move", businessDate: from, refId: moveId, stats: out, extra: { to } }),
    ...postingOps(ctx, { key: postingKey.dayMove(moveId, "in"), kind: "day_move", businessDate: to, refId: moveId, stats: group.delta, extra: { from } }),
    {
      path: paths.dayMove(ctx.cid, moveId),
      op: "set",
      data: {
        ...meta(ctx),
        from,
        to,
        keys: group.keys,
        orderIds: group.orderIds,
        bills: group.bills,
        totalPaise: group.totalPaise,
        byPay: group.byPay,
        reason,
        by: ctx.actorId,
        ...(ctx.actorName ? { byName: ctx.actorName } : {}),
        atMs: ctx.nowMs,
        retag: "pending",
      },
    },
    ...correctionOps(ctx, from, i.fromDay, { kind: "move_out", otherDate: to, ...summary }, fromZ),
    ...correctionOps(ctx, to, i.toDay, { kind: "move_in", otherDate: from, ...summary }, toZ),
    auditOp(ctx, { action: "day.move", target: { type: "day", id: from }, after: { to, bills: group.bills, totalPaise: group.totalPaise, moveId }, reason }),
  ];
  return { plan: { label: `Move ${group.bills} bills ${from} → ${to}`, ops, postingKey: postingKey.dayMove(moveId, "out"), primaryPath: paths.dayMove(ctx.cid, moveId) }, moveId };
}

/**
 * After a move: stamp the moved orders and their invoices with the day they were sold, so lists,
 * item sales and invoice ranges follow. Batches of at most 400 writes; the last one marks the move
 * done. Safe to run again (it only sets the same values).
 */
export function retagPlans(ctx: PlanCtx, i: { moveId: string; from: BizDate; to: BizDate; orderIds: readonly string[]; invoiceIds: readonly string[] }): WritePlan[] {
  const data = { businessDate: i.to, movedFrom: i.from, updatedAtMs: ctx.nowMs };
  const ops: PlanOp[] = [...i.orderIds.map((id) => ({ path: paths.order(ctx.cid, id), op: "update" as const, data })), ...i.invoiceIds.map((id) => ({ path: paths.invoice(ctx.cid, id), op: "update" as const, data }))];
  const plans: WritePlan[] = [];
  for (let k = 0; k < ops.length; k += 400) plans.push({ label: `Re-date bills ${i.from} → ${i.to}`, ops: ops.slice(k, k + 400), primaryPath: paths.dayMove(ctx.cid, i.moveId) });
  const done: PlanOp = { path: paths.dayMove(ctx.cid, i.moveId), op: "update", data: { retag: "done", retaggedAtMs: ctx.nowMs, updatedAtMs: ctx.nowMs } };
  if (plans.length) plans[plans.length - 1]!.ops.push(done);
  else plans.push({ label: "Re-date bills", ops: [done], primaryPath: paths.dayMove(ctx.cid, i.moveId) });
  return plans;
}

/**
 * Correct a drawer's cash count on a closed day (or count one closed without a count): the drawer,
 * that drawer's line on the Z, and the day's corrections; the Z as first printed is kept.
 */
export function recountPlan(ctx: PlanCtx, i: { businessDate: BizDate; day: Day; drawer: Drawer & { id: string }; countedPaise: Paise; reason: string }): WritePlan {
  const reason = i.reason.trim();
  if (!reason) throw new Error("Say why the count changes.");
  if (!Number.isInteger(i.countedPaise) || i.countedPaise < 0) throw new Error("Enter the cash counted.");
  if (i.day.status !== "closed" || !i.day.z) throw new Error("Only a closed day's count can be corrected. An open day is counted when it closes.");
  const line = i.day.z.drawers.find((d) => d.terminalId === i.drawer.terminalId);
  const expected = line?.expectedPaise ?? i.drawer.expectedPaise ?? 0;
  const fromPaise = i.drawer.countedPaise ?? null;
  const z: ZReport = { ...i.day.z, drawers: i.day.z.drawers.map((d) => (d.terminalId === i.drawer.terminalId ? { ...d, countedPaise: i.countedPaise, variancePaise: i.countedPaise - d.expectedPaise } : d)) };
  const path = paths.drawer(ctx.cid, i.businessDate, i.drawer.terminalId);
  return {
    label: `Recount ${i.businessDate}`,
    ops: [
      {
        path,
        op: "update",
        data: {
          countedPaise: i.countedPaise,
          variancePaise: i.countedPaise - expected,
          expectedPaise: expected,
          ...(i.drawer.note === "Closed without a cash count" ? { note: del() } : {}),
          countHistory: arrayUnion({ fromPaise, toPaise: i.countedPaise, by: ctx.actorId, atMs: ctx.nowMs, reason }),
          updatedAtMs: ctx.nowMs,
        },
      },
      ...correctionOps(ctx, i.businessDate, i.day, { kind: "recount", terminalId: i.drawer.terminalId, fromPaise, toPaise: i.countedPaise, note: reason }, line ? z : undefined),
      auditOp(ctx, { action: "drawer.recount", target: { type: "drawer", id: i.drawer.id }, before: { counted: fromPaise }, after: { counted: i.countedPaise, expected, variance: i.countedPaise - expected }, reason }),
    ],
    primaryPath: path,
  };
}

/**
 * Reopen a closed day: it takes sales again on a till still on that date, and closes again later
 * with the same Z number. Its drawers reopen (their counts go into countHistory) so the next close
 * counts again. The Z as first printed is kept.
 */
export function reopenDayPlan(ctx: PlanCtx, i: { businessDate: BizDate; day: Day; drawers: Array<Drawer & { id: string }>; reason: string }): WritePlan {
  const reason = i.reason.trim();
  if (!reason) throw new Error("Say why the day is reopened.");
  if (i.day.status !== "closed") throw new Error("This day is already open.");
  const path = paths.day(ctx.cid, i.businessDate);
  const entry: DayCorrection = { kind: "reopen", atMs: ctx.nowMs, by: ctx.actorId, ...(ctx.actorName ? { byName: ctx.actorName } : {}), note: reason };
  const ops: PlanOp[] = [
    {
      path,
      op: "merge",
      data: {
        status: "open",
        reopenedAtMs: ctx.nowMs,
        reopenedBy: ctx.actorId,
        reopenReason: reason,
        ...(i.day.z && !i.day.zFirst ? { zFirst: i.day.z } : {}),
        corrections: arrayUnion(entry),
        updatedAtMs: ctx.nowMs,
      },
    },
  ];
  for (const d of i.drawers) {
    if (d.status !== "closed") continue;
    ops.push({
      path: paths.drawer(ctx.cid, i.businessDate, d.terminalId),
      op: "update",
      data: {
        status: "open",
        countedPaise: del(),
        variancePaise: del(),
        expectedPaise: del(),
        denoms: del(),
        note: del(),
        closedAtMs: del(),
        closedBy: del(),
        countHistory: arrayUnion({ fromPaise: d.countedPaise ?? null, toPaise: null, by: ctx.actorId, atMs: ctx.nowMs, reason: `Day reopened: ${reason}` }),
        updatedAtMs: ctx.nowMs,
      },
    });
  }
  ops.push(auditOp(ctx, { action: "day.reopen", target: { type: "day", id: i.businessDate }, before: { zNo: i.day.zNo, totalPaise: i.day.z?.totalPaise }, reason }));
  return { label: `Reopen ${i.businessDate}`, ops, primaryPath: path };
}

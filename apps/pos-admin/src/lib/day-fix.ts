"use client";

import { collection, doc, getDocFromServer, getDocsFromServer, query, where } from "firebase/firestore";
import {
  dayMovePlan,
  misplacedPostings,
  paths,
  recountPlan,
  reopenDayPlan,
  retagPlans,
  type BizDate,
  type DailyStats,
  type Day,
  type DayMove,
  type Drawer,
  type Invoice,
  type MisplacedGroup,
  type Paise,
  type PlanCtx,
  type Posting,
} from "@px-pos/core";
import { getDb } from "@/lib/firebase/client";
import { applyPlan, applyPlanInTx, runTransaction } from "@/lib/firebase/apply-plan";

/*
 * Fixing a business day from admin (End of day › a day › Fix): every change runs over fresh
 * server reads, like closing a day from here (lib/day-close.ts). Core builds the batches.
 */

const invoicesOn = (cid: string, d: BizDate) => getDocsFromServer(query(collection(getDb(), paths.col(cid, "invoices")), where("businessDate", "==", d)));

/** Bills on this business day that were sold on another one (by bill time), not moved yet. */
export async function findMisplaced(cid: string, from: BizDate, cutoffMin: number): Promise<MisplacedGroup[]> {
  const db = getDb();
  const [postings, moves] = await Promise.all([
    getDocsFromServer(query(collection(db, paths.col(cid, "postings")), where("businessDate", "==", from))),
    getDocsFromServer(query(collection(db, paths.col(cid, "dayMoves")), where("from", "==", from))),
  ]);
  const moved = new Set(moves.docs.flatMap((d) => (d.data() as DayMove).keys ?? []));
  return misplacedPostings(
    postings.docs.map((d) => ({ ...(d.data() as Posting), id: d.id })),
    from,
    cutoffMin,
    moved,
  );
}

/** Move one group of bills to the day they were sold (totals, both Z reports), then re-date the bills. */
export async function moveBills(ctx: PlanCtx, from: BizDate, group: MisplacedGroup, reason: string): Promise<{ moveId: string }> {
  const db = getDb();
  const cid = ctx.cid;
  const [fromInvoices, toInvoices] = await Promise.all([invoicesOn(cid, from), invoicesOn(cid, group.to)]);
  const { moveId } = await runTransaction(db, async (tx) => {
    const [fd, td, fs, ts] = await Promise.all([
      tx.get(doc(db, paths.day(cid, from))),
      tx.get(doc(db, paths.day(cid, group.to))),
      tx.get(doc(db, paths.dailyStats(cid, from))),
      tx.get(doc(db, paths.dailyStats(cid, group.to))),
    ]);
    const r = dayMovePlan(
      { ...ctx, nowMs: Date.now() },
      {
        from,
        group,
        reason,
        fromDay: fd.exists() ? (fd.data() as Day) : null,
        toDay: td.exists() ? (td.data() as Day) : null,
        fromStats: fs.exists() ? (fs.data() as DailyStats) : null,
        toStats: ts.exists() ? (ts.data() as DailyStats) : null,
        fromInvoices: fromInvoices.docs.map((d) => d.data() as Invoice),
        toInvoices: toInvoices.docs.map((d) => d.data() as Invoice),
      },
    );
    applyPlanInTx(tx, r.plan);
    return { moveId: r.moveId };
  });
  await finishMove(ctx, moveId);
  return { moveId };
}

/** Re-date a move's orders and invoices (safe to run again if it stopped half way). */
export async function finishMove(ctx: PlanCtx, moveId: string): Promise<void> {
  const db = getDb();
  const cid = ctx.cid;
  const snap = await getDocFromServer(doc(db, paths.dayMove(cid, moveId)));
  if (!snap.exists()) throw new Error("That move wasn't found.");
  const m = snap.data() as DayMove;
  if (m.retag === "done") return;
  const ids = new Set(m.orderIds);
  const [orders, invoices] = await Promise.all([getDocsFromServer(query(collection(db, paths.col(cid, "orders")), where("businessDate", "==", m.from))), invoicesOn(cid, m.from)]);
  const orderIds = orders.docs.filter((d) => ids.has(d.id)).map((d) => d.id);
  const invoiceIds = invoices.docs.filter((d) => ids.has((d.data() as Invoice).orderId)).map((d) => d.id);
  for (const plan of retagPlans({ ...ctx, nowMs: Date.now() }, { moveId, from: m.from, to: m.to, orderIds, invoiceIds })) await applyPlan(plan);
}

/** Correct one drawer's cash count on a closed day. */
export async function recountDrawer(ctx: PlanCtx, businessDate: BizDate, terminalId: string, countedPaise: Paise, reason: string): Promise<void> {
  const db = getDb();
  const cid = ctx.cid;
  await runTransaction(db, async (tx) => {
    const [day, drawer] = await Promise.all([tx.get(doc(db, paths.day(cid, businessDate))), tx.get(doc(db, paths.drawer(cid, businessDate, terminalId)))]);
    if (!day.exists()) throw new Error("This day has no record.");
    if (!drawer.exists()) throw new Error("This drawer has no record.");
    applyPlanInTx(tx, recountPlan({ ...ctx, nowMs: Date.now() }, { businessDate, day: day.data() as Day, drawer: { ...(drawer.data() as Drawer), id: drawer.id }, countedPaise, reason }));
  });
}

/** Reopen a closed day (it closes again later under the same Z number). */
export async function reopenDay(ctx: PlanCtx, businessDate: BizDate, reason: string): Promise<void> {
  const db = getDb();
  const cid = ctx.cid;
  const listed = await getDocsFromServer(query(collection(db, paths.col(cid, "drawers")), where("businessDate", "==", businessDate)));
  await runTransaction(db, async (tx) => {
    const day = await tx.get(doc(db, paths.day(cid, businessDate)));
    if (!day.exists()) throw new Error("This day has no record.");
    const fresh = await Promise.all(listed.docs.map((d) => tx.get(d.ref)));
    applyPlanInTx(tx, reopenDayPlan({ ...ctx, nowMs: Date.now() }, { businessDate, day: day.data() as Day, drawers: fresh.filter((d) => d.exists()).map((d) => ({ ...(d.data() as Drawer), id: d.id })), reason }));
  });
}

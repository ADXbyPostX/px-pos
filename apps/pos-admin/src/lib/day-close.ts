"use client";

import { collection, doc, getDocsFromServer, query, where } from "firebase/firestore";
import { addDays, closeDayPlan, paths, type BizDate, type Client, type DailyStats, type Day, type Drawer, type Invoice, type Paise, type PlanCtx, type StockSnapshot } from "@px-pos/core";
import { getDb } from "@/lib/firebase/client";
import { applyPlanInTx, runTransaction } from "@/lib/firebase/apply-plan";

/**
 * Close a business day from admin (super admin or the outlet's admins), when the till couldn't:
 * every drawer still open closes with the cash typed here, or as "not counted", and the day gets
 * the next Z number. Same core plan as the till's End of day, in one transaction over fresh reads.
 */
export async function closeDayFromAdmin(ctx: PlanCtx, businessDate: BizDate, counts: Record<string, { countedPaise?: Paise; note?: string }>): Promise<{ zNo: number }> {
  const db = getDb();
  const cid = ctx.cid;
  const [drawers, invoices] = await Promise.all([
    getDocsFromServer(query(collection(db, paths.col(cid, "drawers")), where("businessDate", "==", businessDate))),
    getDocsFromServer(query(collection(db, paths.col(cid, "invoices")), where("businessDate", "==", businessDate))),
  ]);
  return runTransaction(db, async (tx) => {
    const [client, day, stats, prev] = await Promise.all([
      tx.get(doc(db, paths.client(cid))),
      tx.get(doc(db, paths.day(cid, businessDate))),
      tx.get(doc(db, paths.dailyStats(cid, businessDate))),
      tx.get(doc(db, paths.stockSnapshot(cid, addDays(businessDate, -1)))),
    ]);
    const fresh = await Promise.all(drawers.docs.map((d) => tx.get(d.ref)));
    const { plan, zNo } = closeDayPlan(
      { ...ctx, nowMs: Date.now() },
      {
        businessDate,
        lastZNo: (client.data() as Client | undefined)?.lastZNo ?? 0,
        day: day.exists() ? (day.data() as Day) : null,
        stats: stats.exists() ? (stats.data() as DailyStats) : null,
        drawers: fresh.filter((d) => d.exists()).map((d) => ({ ...(d.data() as Drawer), id: d.id })),
        invoices: invoices.docs.map((d) => d.data() as Invoice),
        prevSnapshot: prev.exists() ? (prev.data() as StockSnapshot).items : null,
        counts,
      },
    );
    applyPlanInTx(tx, plan);
    return { zNo };
  });
}

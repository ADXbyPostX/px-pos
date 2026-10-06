import { collection, doc, getDocsFromServer, query, runTransaction, where } from "@react-native-firebase/firestore";
import { addDays, closeDayPlan, paths, type BizDate, type Client, type DailyStats, type Day, type Drawer, type Invoice, type Paise, type Staff, type StockSnapshot, type ZReport } from "@px-pos/core";
import { getDb } from "@/firebase";
import { applyPlanInTx } from "@/firebase/apply-plan";
import { planCtx } from "./context";

type Session = { cid: string; tid: string };

/**
 * End of day on the till (online only): closes this terminal's drawer with the counted cash and
 * the business day with the next Z number, in one transaction over fresh server reads. Other
 * terminals' drawers must already be closed (the screen checks); admin can force-close instead.
 */
export async function closeDayOnTill(session: Session, operator: Pick<Staff, "name"> & { id: string }, businessDate: BizDate, countedPaise: Paise): Promise<{ z: ZReport; zNo: number }> {
  const db = getDb();
  const [drawers, invoices] = await Promise.all([
    getDocsFromServer(query(collection(db, paths.col(session.cid, "drawers")), where("businessDate", "==", businessDate))),
    getDocsFromServer(query(collection(db, paths.col(session.cid, "invoices")), where("businessDate", "==", businessDate))),
  ]);
  return runTransaction(db, async (tx) => {
    const [client, day, stats, prev] = await Promise.all([
      tx.get(doc(db, paths.client(session.cid))),
      tx.get(doc(db, paths.day(session.cid, businessDate))),
      tx.get(doc(db, paths.dailyStats(session.cid, businessDate))),
      tx.get(doc(db, paths.stockSnapshot(session.cid, addDays(businessDate, -1)))),
    ]);
    const fresh = await Promise.all(drawers.docs.map((d) => tx.get(d.ref)));
    const { plan, z, zNo } = closeDayPlan(planCtx(session, operator), {
      businessDate,
      lastZNo: (client.data() as Client | undefined)?.lastZNo ?? 0,
      day: day.exists() ? (day.data() as Day) : null,
      stats: stats.exists() ? (stats.data() as DailyStats) : null,
      drawers: fresh.filter((d) => d.exists()).map((d) => ({ ...(d.data() as Drawer), id: d.id })),
      invoices: invoices.docs.map((d) => d.data() as Invoice),
      prevSnapshot: prev.exists() ? (prev.data() as StockSnapshot).items : null,
      counts: { [session.tid]: { countedPaise } },
    });
    applyPlanInTx(tx, plan);
    return { z, zNo };
  });
}

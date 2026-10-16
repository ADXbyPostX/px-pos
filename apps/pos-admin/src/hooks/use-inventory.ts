"use client";

import { useMemo } from "react";
import { collection, documentId, limit, orderBy, query, where } from "firebase/firestore";
import { inventoryOnHand, paths, type BizDate, type DailyStats, type InventoryDoc, type Posting } from "@px-pos/core";
import { useCollection, useDoc } from "@/lib/firebase/hooks";

/** Raw-material stock on hand now (micro of each stock unit). */
export function useInventory(cid: string) {
  const live = useDoc<InventoryDoc>(paths.inventory(cid));
  const onHand = useMemo(() => inventoryOnHand(live.data), [live.data]);
  return { ...live, onHand };
}

/** Every day's stats from `from` up to today (usage works back from today's stock). */
export function useStockDays(cid: string, from: BizDate) {
  return useCollection<DailyStats>(`stockdays:${cid}:${from}`, (db) => query(collection(db, paths.col(cid, "dailyStats")), where(documentId(), ">=", from)));
}

/** Postings over a range, oldest first (the stock ledger keeps those that moved stock). */
export function usePostings(cid: string, from: BizDate, to: BizDate, max = 1500) {
  return useCollection<Posting>(`postings:${cid}:${from}:${to}:${max}`, (db) =>
    query(collection(db, paths.col(cid, "postings")), where("businessDate", ">=", from), where("businessDate", "<=", to), orderBy("businessDate"), orderBy("createdAtMs"), limit(max)),
  );
}

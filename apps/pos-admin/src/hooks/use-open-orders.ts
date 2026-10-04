"use client";

import { collection, query, where } from "firebase/firestore";
import { paths, type Order } from "@px-pos/core";
import { useCollection } from "@/lib/firebase/hooks";

/** Running (open or billed) orders of a client, live. Single-field query: no composite index. */
export function useOpenOrders(cid: string) {
  return useCollection<Order>(`orders:open:${cid}`, (db) => query(collection(db, paths.col(cid, "orders")), where("status", "in", ["open", "billed"])));
}

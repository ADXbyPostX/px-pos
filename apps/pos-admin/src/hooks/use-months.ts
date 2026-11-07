"use client";

import { useMemo } from "react";
import { collection, query } from "firebase/firestore";
import { monthOf, paths, type BizDate, type MonthDoc } from "@px-pos/core";
import { useCollection } from "@/lib/firebase/hooks";

/** Closed (and reopened) months, and a check for "is this date in a closed month" (frozen in admin). */
export function useMonths(cid: string) {
  const live = useCollection<MonthDoc>(`months:${cid}`, (db) => query(collection(db, paths.col(cid, "months"))));
  const byMonth = useMemo(() => new Map(live.data.map((m) => [m.id, m])), [live.data]);
  const closed = useMemo(() => new Set(live.data.filter((m) => m.status === "closed").map((m) => m.id)), [live.data]);
  const isFrozen = useMemo(() => (d: BizDate | null | undefined) => Boolean(d && closed.has(monthOf(d))), [closed]);
  return { ...live, byMonth, closed, isFrozen };
}

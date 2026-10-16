"use client";

import { useMemo } from "react";
import { collection, limit, orderBy, query, where } from "firebase/firestore";
import { paths, type BizDate, type Material, type Purchase, type Vendor, type VendorPayment } from "@px-pos/core";
import { useCollection } from "@/lib/firebase/hooks";

/** Every vendor (active first, then by name) and a lookup by id. */
export function useVendors(cid: string) {
  const live = useCollection<Vendor>(`vendors:${cid}`, (db) => query(collection(db, paths.col(cid, "vendors"))));
  const data = useMemo(() => [...live.data].sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name)), [live.data]);
  const byId = useMemo(() => new Map(data.map((v) => [v.id, v])), [data]);
  return { ...live, data, byId };
}

/** Raw materials (active first, then by name) and a lookup by id. */
export function useMaterials(cid: string) {
  const live = useCollection<Material>(`materials:${cid}`, (db) => query(collection(db, paths.col(cid, "materials"))));
  const data = useMemo(() => [...live.data].sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name)), [live.data]);
  const byId = useMemo(() => new Map(data.map((m) => [m.id, m])), [data]);
  return { ...live, data, byId };
}

/**
 * Every bill dated `since` or later, newest first. What a vendor still owes is always their newest
 * bills, so a window ending today is enough to mark each bill paid, part-paid or due.
 */
export function useRecentPurchases(cid: string, since: BizDate) {
  return useCollection<Purchase>(`purchases-recent:${cid}:${since}`, (db) => query(collection(db, paths.col(cid, "purchases")), where("billDate", ">=", since), orderBy("billDate", "desc")));
}

/** One vendor's bills and payments, newest first (statement, open bills, what a payment cleared). */
export function useVendorLedger(cid: string, vendorId: string | null, max = 500) {
  const bills = useCollection<Purchase>(vendorId ? `vbills:${cid}:${vendorId}:${max}` : null, (db) =>
    query(collection(db, paths.col(cid, "purchases")), where("vendorId", "==", vendorId), orderBy("billDate", "desc"), orderBy("createdAtMs", "desc"), limit(max)),
  );
  const payments = useCollection<VendorPayment>(vendorId ? `vpays:${cid}:${vendorId}:${max}` : null, (db) =>
    query(collection(db, paths.col(cid, "vendorPayments")), where("vendorId", "==", vendorId), orderBy("businessDate", "desc"), orderBy("createdAtMs", "desc"), limit(max)),
  );
  return { bills, payments };
}

/** Bills that included a material, newest first (its price history). */
export function useMaterialBills(cid: string, materialId: string | null) {
  return useCollection<Purchase>(materialId ? `mbills:${cid}:${materialId}` : null, (db) =>
    query(collection(db, paths.col(cid, "purchases")), where("materialIds", "array-contains", materialId), orderBy("billDate", "desc"), limit(50)),
  );
}

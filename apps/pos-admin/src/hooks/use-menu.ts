"use client";

import { useMemo } from "react";
import { collection, query } from "firebase/firestore";
import { paths, photoUri, type Category, type Floor, type Item, type ItemPhoto, type Staff, type StockDoc, type Table } from "@px-pos/core";
import { useCollection } from "@/lib/firebase/hooks";

const bySort = <T extends { sort: number; name?: string; label?: string }>(a: T, b: T) => a.sort - b.sort || (a.name ?? a.label ?? "").localeCompare(b.name ?? b.label ?? "");

/** Categories, sorted. */
export function useCategories(cid: string) {
  const live = useCollection<Category>(`categories:${cid}`, (db) => query(collection(db, paths.col(cid, "categories"))));
  const data = useMemo(() => [...live.data].sort(bySort), [live.data]);
  return { ...live, data };
}

/** Menu items, sorted by category order then item order. */
export function useItems(cid: string) {
  const live = useCollection<Item>(`items:${cid}`, (db) => query(collection(db, paths.col(cid, "items"))));
  const data = useMemo(() => [...live.data].sort(bySort), [live.data]);
  return { ...live, data };
}

/** Item photos as data URIs, by item id (removed photos left out). */
export function useItemPhotos(cid: string) {
  const live = useCollection<ItemPhoto>(`itemPhotos:${cid}`, (db) => query(collection(db, paths.col(cid, "itemPhotos"))));
  const map = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of live.data) {
      const uri = photoUri(p);
      if (uri) m.set(p.id, uri);
    }
    return m;
  }, [live.data]);
  return { ...live, map };
}

/** onHand per item (only tracked items have stock docs). */
export function useStock(cid: string) {
  const live = useCollection<StockDoc>(`stock:${cid}`, (db) => query(collection(db, paths.col(cid, "stock"))));
  const map = useMemo(() => new Map(live.data.map((s) => [s.id, s.onHand])), [live.data]);
  return { ...live, map };
}

export function useFloors(cid: string) {
  const live = useCollection<Floor>(`floors:${cid}`, (db) => query(collection(db, paths.col(cid, "floors"))));
  const data = useMemo(() => [...live.data].sort(bySort), [live.data]);
  return { ...live, data };
}

export function useTables(cid: string) {
  const live = useCollection<Table>(`tables:${cid}`, (db) => query(collection(db, paths.col(cid, "tables"))));
  const data = useMemo(() => [...live.data].sort((a, b) => a.sort - b.sort || a.label.localeCompare(b.label, "en", { numeric: true })), [live.data]);
  return { ...live, data };
}

export function useStaff(cid: string) {
  const live = useCollection<Staff>(`staff:${cid}`, (db) => query(collection(db, paths.col(cid, "staff"))));
  const data = useMemo(() => [...live.data].sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name)), [live.data]);
  return { ...live, data };
}

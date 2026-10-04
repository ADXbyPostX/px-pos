import { useEffect, useState } from "react";
import { doc, onSnapshot } from "@react-native-firebase/firestore";
import { getDb, type Firestore } from "@/firebase";

export type WithId<T> = T & { id: string };

export interface Live<T> {
  data: T;
  status: "loading" | "ready" | "error";
  error: Error | null;
  fromCache: boolean;
  pending: boolean;
}

type Tagged<T> = Live<T> & { key: string | null };

type QuerySnap = { docs: { id: string; data: () => unknown }[]; metadata: { fromCache: boolean; hasPendingWrites: boolean } };
/** onSnapshot for queries with a narrow local type (RNFB's Query generics are verbose). */
const listenQuery = onSnapshot as unknown as (q: unknown, opts: { includeMetadataChanges: boolean }, next: (s: QuerySnap) => void, err: (e: Error) => void) => () => void;
const EMPTY: never[] = [];

function view<T>(s: Tagged<T>, key: string | null, empty: T): Live<T> {
  if (s.key !== key) return { data: empty, status: key ? "loading" : "ready", error: null, fromCache: true, pending: false };
  return { data: s.data, status: s.status, error: s.error, fromCache: s.fromCache, pending: s.pending };
}

/** Live document from the native cache/server. Results are tagged with their path (no stale reads). */
export function useLiveDoc<T>(path: string | null): Live<WithId<T> | null> {
  const [s, set] = useState<Tagged<WithId<T> | null>>({ data: null, status: path ? "loading" : "ready", error: null, fromCache: true, pending: false, key: path });
  useEffect(() => {
    if (!path) return;
    return onSnapshot(
      doc(getDb(), path),
      { includeMetadataChanges: true },
      (snap) =>
        set({
          data: snap.exists() ? ({ id: snap.id, ...(snap.data() as T) } as WithId<T>) : null,
          status: "ready",
          error: null,
          fromCache: snap.metadata.fromCache,
          pending: snap.metadata.hasPendingWrites,
          key: path,
        }),
      (error) => set({ data: null, status: "error", error, fromCache: false, pending: false, key: path }),
    );
  }, [path]);
  return view(s, path, null);
}

/**
 * Live query. `key` identifies the query (null = idle); `build` runs only when the key changes.
 * (`build` returns an RNFB Query; typed loosely because RNFB's Query generics are verbose.)
 */
export function useLiveQuery<T>(key: string | null, build: (db: Firestore) => unknown): Live<WithId<T>[]> {
  const [s, set] = useState<Tagged<WithId<T>[]>>({ data: EMPTY, status: key ? "loading" : "ready", error: null, fromCache: true, pending: false, key });
  useEffect(() => {
    if (!key) return;
    let q: unknown;
    try {
      q = build(getDb());
    } catch (e) {
      // Report like a listener error would (async), not as a synchronous setState in the effect.
      let live = true;
      queueMicrotask(() => live && set({ data: EMPTY, status: "error", error: e as Error, fromCache: false, pending: false, key }));
      return () => {
        live = false;
      };
    }
    return listenQuery(
      q,
      { includeMetadataChanges: true },
      (snap) =>
        set({
          data: snap.docs.map((d) => ({ id: d.id, ...(d.data() as T) }) as WithId<T>),
          status: "ready",
          error: null,
          fromCache: snap.metadata.fromCache,
          pending: snap.metadata.hasPendingWrites,
          key,
        }),
      (error) => set({ data: EMPTY, status: "error", error, fromCache: false, pending: false, key }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return view(s, key, EMPTY as WithId<T>[]);
}

/** A clock that ticks (ages, timers). */
export function useNow(intervalMs = 15_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

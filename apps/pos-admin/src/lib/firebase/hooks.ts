"use client";

import { useCallback, useEffect, useEffectEvent, useState } from "react";
import { doc, getDocs, onSnapshot, type DocumentData, type Firestore, type Query } from "firebase/firestore";
import { getDb } from "./client";

/** A document with its id (and full path, for collection-group results). */
export type WithId<T> = T & { id: string; _path?: string };

export interface Live<T> {
  data: T;
  status: "loading" | "ready" | "error";
  error: Error | null;
  /** Served from the local cache (not yet confirmed by the server). */
  fromCache: boolean;
  /** Local writes not yet acknowledged by the server. */
  pending: boolean;
}

/**
 * Every result is tagged with the key (path/query id) it belongs to. When the key changes,
 * the previous result is never shown for the new key — the hook reports "loading" until the
 * new listener delivers. (Without this, a null→path transition briefly reads as "ready, empty".)
 */
type Tagged<T> = Live<T> & { key: string | null };

/** Stable empty result while loading (keeps memoised consumers from recomputing). */
const EMPTY: never[] = [];

const idle = <T,>(data: T, key: string | null): Tagged<T> => ({ data, status: key ? "loading" : "ready", error: null, fromCache: false, pending: false, key });

function view<T>(state: Tagged<T>, key: string | null, empty: T): Live<T> {
  if (state.key !== key) return { data: empty, status: key ? "loading" : "ready", error: null, fromCache: false, pending: false };
  const { key: _k, ...rest } = state;
  void _k;
  return rest;
}

/** Live document. `path` null = idle. */
export function useDoc<T = DocumentData>(path: string | null): Live<WithId<T> | null> {
  const [state, setState] = useState<Tagged<WithId<T> | null>>(() => idle<WithId<T> | null>(null, path));
  useEffect(() => {
    if (!path) return;
    return onSnapshot(
      doc(getDb(), path),
      { includeMetadataChanges: true },
      (snap) =>
        setState({
          data: snap.exists() ? ({ id: snap.id, ...(snap.data() as T) } as WithId<T>) : null,
          status: "ready",
          error: null,
          fromCache: snap.metadata.fromCache,
          pending: snap.metadata.hasPendingWrites,
          key: path,
        }),
      (error) => setState({ data: null, status: "error", error, fromCache: false, pending: false, key: path }),
    );
  }, [path]);
  return view(state, path, null);
}

/**
 * Live query. `key` identifies the query (null = idle); `build` runs only when the key
 * changes, so callers never need to memoise the Query object.
 */
export function useCollection<T = DocumentData>(key: string | null, build: (db: Firestore) => Query): Live<WithId<T>[]> & { retry: () => void } {
  const [state, setState] = useState<Tagged<WithId<T>[]>>(() => idle<WithId<T>[]>(EMPTY, key));
  const [attempt, setAttempt] = useState(0);
  const makeQuery = useEffectEvent(() => build(getDb()));
  const tag = key ? `${key}#${attempt}` : null;
  useEffect(() => {
    if (!tag) return;
    let q: Query;
    try {
      q = makeQuery();
    } catch (e) {
      // Report like a listener error would (async), not as a synchronous setState in the effect.
      let live = true;
      queueMicrotask(() => live && setState({ data: [], status: "error", error: e as Error, fromCache: false, pending: false, key: tag }));
      return () => {
        live = false;
      };
    }
    return onSnapshot(
      q,
      { includeMetadataChanges: true },
      (snap) =>
        setState({
          data: snap.docs.map((d) => ({ id: d.id, _path: d.ref.path, ...(d.data() as T) }) as WithId<T>),
          status: "ready",
          error: null,
          fromCache: snap.metadata.fromCache,
          pending: snap.metadata.hasPendingWrites,
          key: tag,
        }),
      (error) => setState({ data: [], status: "error", error, fromCache: false, pending: false, key: tag }),
    );
  }, [tag]);
  const retry = useCallback(() => setAttempt((a) => a + 1), []);
  return { ...view(state, tag, EMPTY as WithId<T>[]), retry };
}

/** One-shot query (reports over date ranges). Re-runs when `key` changes or on reload(). */
export function useQueryOnce<T = DocumentData>(key: string | null, build: (db: Firestore) => Query): Live<WithId<T>[]> & { reload: () => void } {
  const [state, setState] = useState<Tagged<WithId<T>[]>>(() => idle<WithId<T>[]>(EMPTY, key));
  const [attempt, setAttempt] = useState(0);
  const makeQuery = useEffectEvent(() => build(getDb()));
  const tag = key ? `${key}#${attempt}` : null;
  useEffect(() => {
    if (!tag) return;
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDocs(makeQuery());
        if (!cancelled) setState({ data: snap.docs.map((d) => ({ id: d.id, _path: d.ref.path, ...(d.data() as T) }) as WithId<T>), status: "ready", error: null, fromCache: snap.metadata.fromCache, pending: false, key: tag });
      } catch (error) {
        if (!cancelled) setState({ data: [], status: "error", error: error as Error, fromCache: false, pending: false, key: tag });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tag]);
  const reload = useCallback(() => setAttempt((a) => a + 1), []);
  return { ...view(state, tag, EMPTY as WithId<T>[]), reload };
}

/** Current time that ticks (for presence / ages). */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

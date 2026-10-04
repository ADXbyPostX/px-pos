import { createContext, use, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import { heartbeatPlan, terminalCountersPlan } from "@px-pos/core";
import { applyPlan } from "@/firebase/apply-plan";
import { counterKey, peekCounter } from "@/local/db";
import { onJournalChange, reconcile, syncCounts } from "@/local/sync";
import { planCtx } from "@/actions/context";
import { APP_VERSION, usePaired } from "./session";
import { useData } from "./data";

interface SyncState {
  online: boolean;
  pending: number;
  rejected: number;
  inflight: number;
}

const Ctx = createContext<SyncState | null>(null);
const HEARTBEAT_MS = 120_000;

export function useSync(): SyncState {
  const v = use(Ctx);
  if (!v) throw new Error("useSync outside SyncProvider");
  return v;
}

function tsMillis(v: unknown): number | null {
  if (v && typeof v === "object" && "toMillis" in v && typeof (v as { toMillis: () => number }).toMillis === "function") return (v as { toMillis: () => number }).toMillis();
  return null;
}

/**
 * Connectivity + journal health. Reconciles on boot and every reconnect; sends a heartbeat
 * (presence, queue size, clock skew, number mirrors) while foregrounded and online.
 */
export function SyncProvider({ children }: { children: ReactNode }) {
  const session = usePaired();
  const { bizDate } = useData();
  const [online, setOnline] = useState(true);
  const [counts, setCounts] = useState(syncCounts);
  const wasOnline = useRef(true);

  useEffect(() => onJournalChange(() => setCounts(syncCounts())), []);

  useEffect(() => {
    void reconcile().finally(() => setCounts(syncCounts()));
    return NetInfo.addEventListener((s) => {
      const up = Boolean(s.isConnected && s.isInternetReachable !== false);
      setOnline(up);
      if (up && !wasOnline.current) void reconcile().finally(() => setCounts(syncCounts()));
      wasOnline.current = up;
    });
  }, []);

  // Heartbeat: presence for the admin, and the device clock vs server clock.
  const terminal = session.terminal;
  const skewRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    const server = tsMillis(terminal.lastSeenAt);
    if (server && terminal.lastSeenAtMs) skewRef.current = terminal.lastSeenAtMs - server;
  }, [terminal.lastSeenAt, terminal.lastSeenAtMs]);

  // Refs, not deps: every heartbeat updates the terminal doc (and so `session`); depending on it
  // would re-run this effect and beat again immediately — a write loop.
  const sessionRef = useRef(session);
  const bizDateRef = useRef(bizDate);
  useEffect(() => {
    sessionRef.current = session;
    bizDateRef.current = bizDate;
  });

  useEffect(() => {
    let foreground = AppState.currentState === "active";
    const beat = () => {
      if (!foreground || !online) return;
      const session = sessionRef.current;
      const bizDate = bizDateRef.current;
      const c = syncCounts();
      const ctx = planCtx(session, null);
      void applyPlan(heartbeatPlan(ctx, { appVersion: APP_VERSION, pendingWrites: c.pending, journalRejected: c.rejected, ...(skewRef.current != null ? { clockSkewMs: skewRef.current } : {}) })).catch(() => {});
      if (bizDate) {
        // Never lower the server's mirror for the same day: it's what a reinstall re-seeds from.
        const mirror = (m: { d: string; n: number } | undefined) => (m?.d === bizDate ? m.n : 0);
        void applyPlan(
          terminalCountersPlan(ctx, {
            lastKot: { d: bizDate, n: Math.max(peekCounter(counterKey.kot(session.tid, bizDate)), mirror(session.terminal.lastKot)) },
            lastOrder: { d: bizDate, n: Math.max(peekCounter(counterKey.order(session.tid, bizDate)), mirror(session.terminal.lastOrder)) },
            lastToken: { d: bizDate, n: Math.max(peekCounter(counterKey.token(session.tid, bizDate)), mirror(session.terminal.lastToken)) },
          }),
        ).catch(() => {});
      }
    };
    beat();
    const t = setInterval(beat, HEARTBEAT_MS);
    const sub = AppState.addEventListener("change", (s) => {
      foreground = s === "active";
      if (foreground) beat();
    });
    return () => {
      clearInterval(t);
      sub.remove();
    };
  }, [online]);

  const value = useMemo(() => ({ online, pending: counts.pending, rejected: counts.rejected, inflight: counts.inflight }), [online, counts]);
  return <Ctx value={value}>{children}</Ctx>;
}

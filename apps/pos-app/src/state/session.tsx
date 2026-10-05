import { createContext, use, useCallback, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import { Platform } from "react-native";
import * as Device from "expo-device";
import Constants from "expo-constants";
import NetInfo from "@react-native-community/netinfo";
import { onAuthStateChanged, signInAnonymously } from "@react-native-firebase/auth";
import { doc, getDocFromServer, setDoc, onSnapshot } from "@react-native-firebase/firestore";
import { pairingCode, paths, type Client, type Member, type PairingRequest, type Terminal } from "@px-pos/core";
import { getAuthInstance, getDb } from "@/firebase";
import { useLiveDoc, type WithId } from "@/hooks/use-live";
import { counterKey, getMeta, journalCounts, seedCounter, setMeta } from "@/local/db";
import { applyNumberingRestart } from "@/local/sync";

export const APP_VERSION = (Constants.expoConfig?.version as string | undefined) ?? "0.1.0";

export type Session =
  | { status: "booting" }
  | BootError
  | { status: "identity_lost"; expected: string; actual: string | null }
  | { status: "unpaired"; uid: string; code: string | null; request: PairingRequest | null }
  | { status: "revoked"; uid: string; cid: string; tid: string }
  | { status: "paired"; uid: string; cid: string; tid: string; client: WithId<Client>; terminal: WithId<Terminal> };

/** First start failed: no internet, a clock far off (TLS fails), or something else. Retries by itself. */
export type BootError = { status: "error"; reason: "offline" | "clock" | "other"; message: string };

function bootError(e: unknown): BootError {
  // Factory-fresh POS boards boot at their RTC epoch (e.g. 2013) until they reach a time server.
  if (new Date().getFullYear() < 2025) return { status: "error", reason: "clock", message: "Date and time are wrong" };
  if ((e as { code?: string })?.code === "auth/network-request-failed") return { status: "error", reason: "offline", message: "No internet connection" };
  return { status: "error", reason: "other", message: (e as Error)?.message ?? String(e) };
}

interface SessionCtx {
  session: Session;
  /** Try the first start again now (it also retries on its own). */
  retry: () => void;
  /** Ask the admin for a new code (after a rejection or a long wait). */
  newCode: () => Promise<void>;
  /** Forget this terminal's pairing (only allowed with nothing left to sync). */
  unpair: () => boolean;
}

const Ctx = createContext<SessionCtx | null>(null);

export function useSession(): SessionCtx {
  const v = use(Ctx);
  if (!v) throw new Error("useSession outside SessionProvider");
  return v;
}

/** The paired session, for screens that only render after pairing. */
export function usePaired() {
  const { session } = useSession();
  if (session.status !== "paired") throw new Error("Terminal is not paired");
  return session;
}

const META = { uid: "pairedUid", cid: "cid", tid: "tid", code: "pairCode", ended: "endedPairing" } as const;

/** "cid/tid" of a pairing this device left (unpaired / revoked): never adopt it again. */
const pairingKey = (cid: string, tid: string) => `${cid}/${tid}`;

function randomCode(): string {
  const bytes = Array.from({ length: 8 }, () => Math.floor(Math.random() * 256));
  return pairingCode(bytes);
}

function deviceName() {
  return Device.deviceName ?? Device.modelName ?? (Platform.OS === "ios" ? "iPad" : "Android tablet");
}

/**
 * Boot + identity guard + pairing.
 * A terminal keeps ONE anonymous Firebase uid for life (its offline write queue belongs to it).
 * If the stored paired uid and the signed-in uid ever disagree, we stop and ask for re-pairing
 * instead of silently minting a new identity over unsynced sales.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [uid, setUid] = useState<string | null>(null);
  const [boot, setBoot] = useState<{ status: "booting" } | BootError | { status: "identity_lost"; expected: string; actual: string | null } | null>({ status: "booting" });
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [pairing, setPairing] = useState<{ cid: string; tid: string } | null>(() => {
    const cid = getMeta(META.cid);
    const tid = getMeta(META.tid);
    return cid && tid ? { cid, tid } : null;
  });
  const [code, setCode] = useState<string | null>(() => getMeta(META.code));
  const [request, setRequest] = useState<PairingRequest | null>(null);

  // 1) Auth: wait for the persisted user; never replace a paired identity.
  useEffect(() => {
    getDb();
    const auth = getAuthInstance();
    let first = true;
    return onAuthStateChanged(auth, async (user) => {
      const expected = getMeta(META.uid);
      if (user) {
        if (expected && user.uid !== expected) setBoot({ status: "identity_lost", expected, actual: user.uid });
        else {
          setUid(user.uid);
          setBoot(null);
        }
      } else if (first) {
        if (expected) setBoot({ status: "identity_lost", expected, actual: null });
        else setNeedsSignIn(true);
      }
      first = false;
    });
  }, []);

  // 1b) First start: mint this terminal's identity. Needs the internet once; retried until it works.
  useEffect(() => {
    if (!needsSignIn) return;
    let live = true;
    signInAnonymously(getAuthInstance())
      .then((res) => {
        if (!live) return;
        setNeedsSignIn(false);
        setUid(res.user.uid);
        setBoot(null);
      })
      .catch((e) => live && setBoot(bootError(e)));
    return () => {
      live = false;
    };
  }, [needsSignIn, attempt]);

  const failed = needsSignIn && boot?.status === "error";
  useEffect(() => {
    if (!failed) return;
    const tick = setInterval(() => setAttempt((n) => n + 1), 20_000);
    const unsub = NetInfo.addEventListener((s) => {
      if (s.isConnected && s.isInternetReachable !== false) setAttempt((n) => n + 1);
    });
    return () => {
      clearInterval(tick);
      unsub();
    };
  }, [failed]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  // 2) Unpaired: publish a pairing request and wait for an admin.
  useEffect(() => {
    if (!uid || pairing) return;
    const db = getDb();
    const ref = doc(db, paths.pairingRequest(uid));
    const unsub = onSnapshot(ref, (snap) => {
      const req = snap.exists() ? (snap.data() as PairingRequest) : null;
      setRequest(req);
      if (req?.status === "paired" && req.cid && req.terminalId && getMeta(META.ended) !== pairingKey(req.cid, req.terminalId)) {
        setMeta(META.cid, req.cid);
        setMeta(META.tid, req.terminalId);
        setMeta(META.uid, uid);
        setPairing({ cid: req.cid, tid: req.terminalId });
      }
    });
    (async () => {
      try {
        const existing = await getDocFromServer(ref).catch(() => null);
        const prev = existing?.exists() ? (existing.data() as PairingRequest) : null;
        // A request still marked paired to an outlet this device has left is stale: publish a fresh one.
        const stale = prev?.status === "paired" && prev.cid && prev.terminalId && getMeta(META.ended) === pairingKey(prev.cid, prev.terminalId);
        if (prev && prev.status !== "rejected" && !stale) {
          setMeta(META.code, prev.code);
          setCode(prev.code);
          return;
        }
        if (prev && !stale) return; // rejected: user presses "new code"
        const c = stale ? randomCode() : (getMeta(META.code) ?? randomCode());
        setMeta(META.code, c);
        setCode(c);
        const now = Date.now();
        await setDoc(ref, { code: c, deviceName: deviceName(), model: Device.modelName ?? "unknown", platform: Platform.OS === "ios" ? "ios" : "android", appVersion: APP_VERSION, status: "pending", createdAtMs: now, updatedAtMs: now });
      } catch {
        /* offline: the snapshot listener retries when back online */
      }
    })();
    return unsub;
  }, [uid, pairing]);

  // 3) Paired: live client, terminal and membership docs.
  const client = useLiveDoc<Client>(pairing ? paths.client(pairing.cid) : null);
  const terminal = useLiveDoc<Terminal>(pairing ? paths.terminal(pairing.cid, pairing.tid) : null);
  const member = useLiveDoc<Member>(pairing && uid ? paths.member(pairing.cid, uid) : null);

  // Numbering restarted from admin: drop local counters first. A layout effect, so it runs before
  // any passive effect (the seeding below, the boot reconcile and heartbeat in SyncProvider).
  const resetAtMs = terminal.data?.countersResetAtMs;
  useLayoutEffect(() => {
    if (pairing) applyNumberingRestart(pairing.tid, resetAtMs);
  }, [resetAtMs, pairing]);

  // First time paired: continue this terminal's numbering from what the server knows.
  useEffect(() => {
    const t = terminal.data;
    if (!t || !pairing) return;
    if (t.lastInvoiceSeq) seedCounter(counterKey.invoice(pairing.tid, t.series, t.lastInvoiceFy), t.lastInvoiceSeq);
    if (t.lastKot?.d) seedCounter(counterKey.kot(pairing.tid, t.lastKot.d), t.lastKot.n);
    if (t.lastOrder?.d) seedCounter(counterKey.order(pairing.tid, t.lastOrder.d), t.lastOrder.n);
    if (t.lastToken?.d) seedCounter(counterKey.token(pairing.tid, t.lastToken.d), t.lastToken.n);
  }, [terminal.data, pairing]);

  const newCode = useCallback(async () => {
    if (!uid) return;
    const c = randomCode();
    setMeta(META.code, c);
    setCode(c);
    const now = Date.now();
    await setDoc(doc(getDb(), paths.pairingRequest(uid)), { code: c, deviceName: deviceName(), model: Device.modelName ?? "unknown", platform: Platform.OS === "ios" ? "ios" : "android", appVersion: APP_VERSION, status: "pending", createdAtMs: now, updatedAtMs: now });
  }, [uid]);

  const unpair = useCallback(() => {
    if (journalCounts().pending > 0) return false;
    const cid = getMeta(META.cid);
    const tid = getMeta(META.tid);
    if (cid && tid) setMeta(META.ended, pairingKey(cid, tid));
    setMeta(META.cid, null);
    setMeta(META.tid, null);
    setMeta(META.code, null);
    setPairing(null);
    return true;
  }, []);

  const session: Session = useMemo(() => {
    if (boot) return boot;
    if (!uid) return { status: "booting" };
    if (!pairing) return { status: "unpaired", uid, code, request };
    const denied = [client, terminal, member].some((l) => l.status === "error");
    const revoked = terminal.data?.status === "revoked" || (member.status === "ready" && (!member.data || !member.data.active));
    if (denied || revoked) return { status: "revoked", uid, ...pairing };
    if (client.data && terminal.data) return { status: "paired", uid, ...pairing, client: client.data, terminal: terminal.data };
    return { status: "booting" };
  }, [boot, uid, pairing, code, request, client, terminal, member]);

  const value = useMemo(() => ({ session, retry, newCode, unpair }), [session, retry, newCode, unpair]);
  return <Ctx value={value}>{children}</Ctx>;
}

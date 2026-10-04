import { doc, getDocFromServer, waitForPendingWrites } from "@react-native-firebase/firestore";
import { getDb } from "@/firebase";
import { applyPlan } from "@/firebase/apply-plan";
import { journalCounts, journalRows, markJournal, pruneJournal, type JournalRow } from "./db";

/**
 * Hands journalled plans to Firestore and records the server's verdict.
 * The UI never awaits a sale write: submit() returns immediately; the native SDK queues the
 * batch on disk while offline and replays it on reconnect. If the app is killed, the promise is
 * lost — reconcile() at boot settles every still-pending row against the server.
 */

type Listener = () => void;
const listeners = new Set<Listener>();
export function onJournalChange(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
function emit() {
  for (const l of listeners) l();
}

function errorText(e: unknown): string {
  const code = (e as { code?: string })?.code ?? "";
  if (code.includes("permission-denied")) return "Rejected by the server (permission or duplicate). Check the Sync screen.";
  return e instanceof Error ? e.message : String(e);
}

const inflight = new Set<string>();

export function submit(row: JournalRow): void {
  if (inflight.has(row.id)) return;
  inflight.add(row.id);
  emit();
  applyPlan(row.plan)
    .then(() => markJournal(row.id, "synced"))
    .catch((e) => markJournal(row.id, "rejected", errorText(e)))
    .finally(() => {
      inflight.delete(row.id);
      emit();
    });
}

/** Retry a rejected row (e.g. after an admin fixed access). */
export function retry(row: JournalRow): void {
  markJournal(row.id, "pending", null);
  submit({ ...row, status: "pending" });
}

let reconciling = false;

/**
 * Boot / reconnect: every pending row either already landed (its primary doc exists on the
 * server → synced) or is re-submitted. Safe to repeat: postings are create-only and ids are
 * deterministic, so a replay can never double-count.
 */
export async function reconcile(): Promise<{ confirmed: number; resubmitted: number }> {
  if (reconciling) return { confirmed: 0, resubmitted: 0 };
  reconciling = true;
  let confirmed = 0;
  let resubmitted = 0;
  try {
    const db = getDb();
    await Promise.race([waitForPendingWrites(db), new Promise((r) => setTimeout(r, 15_000))]);
    for (const row of journalRows("pending", 500)) {
      if (inflight.has(row.id)) continue;
      try {
        const snap = await getDocFromServer(doc(db, row.primaryPath));
        if (snap.exists()) {
          markJournal(row.id, "synced");
          confirmed++;
        } else {
          submit(row);
          resubmitted++;
        }
      } catch {
        // Offline again: leave pending, try on the next reconnect.
        break;
      }
    }
    pruneJournal();
  } finally {
    reconciling = false;
    emit();
  }
  return { confirmed, resubmitted };
}

export function syncCounts() {
  const c = journalCounts();
  return { ...c, inflight: inflight.size };
}

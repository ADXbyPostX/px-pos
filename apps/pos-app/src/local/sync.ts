import { doc, getDocFromServer, waitForPendingWrites } from "@react-native-firebase/firestore";
import { getDb } from "@/firebase";
import { applyPlan } from "@/firebase/apply-plan";
import { getMeta, journalCounts, journalRows, markJournal, pruneJournal, resetLocalNumbering, setMeta, type JournalRow } from "./db";

/**
 * Hands journalled plans to Firestore and records the server's verdict.
 * The UI never awaits a sale write: submit() returns immediately; the native SDK queues the
 * batch on disk while offline and replays it on reconnect, also after a restart. If the app is
 * killed, the promise is lost — reconcile() at boot settles every row against the server once the
 * SDK's own queue has drained, and a refusal is only final when the sale really isn't there.
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

/**
 * Apply admin's "Restart numbering" once per request (`terminal.countersResetAtMs`). Runs before
 * the boot reconcile and the counter seeding, so neither sees the cleared sales.
 */
export function applyNumberingRestart(tid: string, atMs: number | undefined): boolean {
  const key = `numbersReset:${tid}`;
  if (!atMs || atMs <= Number(getMeta(key) ?? 0)) return false;
  resetLocalNumbering(tid);
  setMeta(key, String(atMs));
  emit();
  return true;
}

function errorText(e: unknown): string {
  const code = (e as { code?: string })?.code ?? "";
  if (code.includes("permission-denied")) return "Rejected by the server (permission or duplicate). Check the Sync screen.";
  return e instanceof Error ? e.message : String(e);
}

/** Is this row's batch on the server? (Its posting / primary doc exists.) null = can't tell (offline). */
async function landed(row: JournalRow): Promise<boolean | null> {
  try {
    return (await getDocFromServer(doc(getDb(), row.primaryPath))).exists();
  } catch {
    return null;
  }
}

/** The bill a sale's batch issues, if any: series, FY, number. */
function billOf(row: JournalRow): { invoiceNo: string; series: string; fy: string; seq: number; terminalPath: string } | null {
  const inv = row.plan.ops.find((o) => o.path.includes("/invoices/"));
  const term = row.plan.ops.find((o) => /\/terminals\/[^/]+$/.test(o.path) && "lastInvoiceSeq" in o.data);
  if (!inv || !term) return null;
  const d = inv.data as { invoiceNo?: string; series?: string; fy?: string; seq?: number };
  return d.invoiceNo && d.series && d.fy && typeof d.seq === "number" ? { invoiceNo: d.invoiceNo, series: d.series, fy: d.fy, seq: d.seq, terminalPath: term.path } : null;
}

/** Why the server refused a batch that isn't there, in words the counter can act on. */
async function explain(row: JournalRow, e: unknown): Promise<string> {
  const code = (e as { code?: string })?.code ?? "";
  const bill = billOf(row);
  if (code.includes("permission-denied") && bill) {
    try {
      const t = (await getDocFromServer(doc(getDb(), bill.terminalPath))).data() as { lastInvoiceSeq?: number; lastInvoiceFy?: string } | undefined;
      if (t?.lastInvoiceFy === bill.fy && (t.lastInvoiceSeq ?? 0) >= bill.seq) {
        return `Bill ${bill.invoiceNo} reached the server after bill ${bill.seq < (t.lastInvoiceSeq ?? 0) ? `no. ${t.lastInvoiceSeq}` : "with the same number"}, so the server refused it (bill numbers must arrive in order). The sale isn't on the server. Tell PostX.`;
      }
    } catch {
      /* offline: fall through */
    }
  }
  return errorText(e);
}

const inflight = new Set<string>();

export function submit(row: JournalRow): void {
  if (inflight.has(row.id)) return;
  inflight.add(row.id);
  emit();
  applyPlan(row.plan)
    .then(() => markJournal(row.id, "synced"))
    .catch(async (e) => {
      // A refusal is often our own second copy: the batch was queued before a restart, sent again,
      // and the first copy already landed. Then the sale is safely on the server.
      if ((await landed(row)) === true) markJournal(row.id, "synced");
      else markJournal(row.id, "rejected", await explain(row, e));
    })
    .finally(() => {
      inflight.delete(row.id);
      emit();
    });
}

/** Retry a rejected row: first ask the server whether it's already there. */
export async function retry(row: JournalRow): Promise<void> {
  if (inflight.has(row.id)) return;
  if ((await landed(row)) === true) {
    markJournal(row.id, "synced");
    emit();
    return;
  }
  markJournal(row.id, "pending", null);
  submit({ ...row, status: "pending" });
}

let reconciling = false;
const DRAIN_MS = 60_000;

/**
 * Boot / reconnect. Every row still pending — or rejected — is checked against the server: if its
 * posting is there, it's synced. A pending row that isn't is sent again, oldest first (bill numbers
 * must reach the server in order).
 *
 * Never while the SDK still has queued writes: they survive restarts and go out by themselves, and
 * sending a still-queued batch again makes the second copy bounce as a "rejected" duplicate (Tea
 * Room, bill 162, 2026-10-08). If the queue doesn't drain in a minute, try again on the next
 * reconnect.
 */
export async function reconcile(): Promise<{ confirmed: number; resubmitted: number }> {
  if (reconciling) return { confirmed: 0, resubmitted: 0 };
  reconciling = true;
  let confirmed = 0;
  let resubmitted = 0;
  try {
    const db = getDb();
    const drained = await Promise.race([waitForPendingWrites(db).then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), DRAIN_MS))]);
    if (!drained) return { confirmed, resubmitted };
    const rows = [...journalRows("pending", 500), ...journalRows("rejected", 200)].sort((a, b) => a.createdAt - b.createdAt);
    for (const row of rows) {
      if (inflight.has(row.id)) continue;
      const there = await landed(row);
      if (there == null) break; // offline again: next reconnect
      if (there) {
        markJournal(row.id, "synced");
        confirmed++;
      } else if (row.status === "pending") {
        submit(row);
        resubmitted++;
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

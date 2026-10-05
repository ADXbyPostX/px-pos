import { openDatabaseSync, type SQLiteDatabase } from "expo-sqlite";
import type { WritePlan } from "@px-pos/core";

/**
 * On-device SQLite for what must never depend on the network:
 *  - counters: invoice / KOT / order / token numbers (allocated offline, per terminal)
 *  - journal:  every WritePlan we hand to Firestore, until the server confirms it
 *  - drafts:   unsent ticket lines
 *  - meta:     paired identity (uid, client, terminal)
 *  - print_queue: jobs waiting for a printer
 */
let db: SQLiteDatabase | undefined;

const SCHEMA = `
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS counters (key TEXT PRIMARY KEY NOT NULL, value INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS journal (
  id TEXT PRIMARY KEY NOT NULL,
  action_key TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  posting_key TEXT,
  primary_path TEXT NOT NULL,
  plan TEXT NOT NULL,
  result TEXT,
  status TEXT NOT NULL,
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS journal_status ON journal(status);
CREATE TABLE IF NOT EXISTS drafts (order_id TEXT PRIMARY KEY NOT NULL, json TEXT NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS print_queue (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL,
  label TEXT NOT NULL,
  target TEXT NOT NULL,
  lines TEXT NOT NULL,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
`;

export function localDb(): SQLiteDatabase {
  if (db) return db;
  db = openDatabaseSync("pxpos.db");
  db.execSync(SCHEMA);
  return db;
}

// ─── meta (paired identity etc.) ────────────────────────────────────────────

export function getMeta(key: string): string | null {
  return localDb().getFirstSync<{ value: string }>("SELECT value FROM meta WHERE key = ?", key)?.value ?? null;
}

export function setMeta(key: string, value: string | null): void {
  if (value == null) localDb().runSync("DELETE FROM meta WHERE key = ?", key);
  else localDb().runSync("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", key, value);
}

// ─── counters ───────────────────────────────────────────────────────────────

/**
 * Counter keys are scoped to the terminal doc id: a device re-paired into another outlet (or as a
 * new terminal) is a new terminal and must start its own numbers, even with the same code "1".
 */
export const counterKey = {
  invoice: (tid: string, series: string, fy: string) => `inv:${tid}:${series}:${fy}`,
  kot: (tid: string, bizDate: string) => `kot:${tid}:${bizDate}`,
  order: (tid: string, bizDate: string) => `ord:${tid}:${bizDate}`,
  token: (tid: string, bizDate: string) => `tok:${tid}:${bizDate}`,
};

export function peekCounter(key: string): number {
  return localDb().getFirstSync<{ value: number }>("SELECT value FROM counters WHERE key = ?", key)?.value ?? 0;
}

/**
 * Numbering restarted from admin (test sales cleared): this terminal's counters go, and so do the
 * journal, drafts (held tickets) and print jobs of the cleared sales — replaying them would bring
 * the test orders back.
 */
export function resetLocalNumbering(tid: string): void {
  const d = localDb();
  d.withTransactionSync(() => {
    for (const kind of ["inv", "kot", "ord", "tok"]) {
      const prefix = `${kind}:${tid}:`;
      d.runSync("DELETE FROM counters WHERE substr(key, 1, ?) = ?", prefix.length, prefix);
    }
    d.runSync("DELETE FROM journal");
    d.runSync("DELETE FROM drafts");
    d.runSync("DELETE FROM print_queue");
  });
}

/** Raise a counter to at least `min` (pairing / re-pair seeding). Never lowers it. */
export function seedCounter(key: string, min: number): void {
  localDb().runSync("INSERT INTO counters (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = MAX(value, excluded.value)", key, min);
}

// ─── journal ────────────────────────────────────────────────────────────────

export type JournalStatus = "pending" | "synced" | "rejected";

export interface JournalRow<R = unknown> {
  id: string;
  actionKey: string;
  label: string;
  postingKey: string | null;
  primaryPath: string;
  plan: WritePlan;
  result: R | null;
  status: JournalStatus;
  error: string | null;
  attempts: number;
  createdAt: number;
  updatedAt: number;
}

type RawRow = {
  id: string;
  action_key: string;
  label: string;
  posting_key: string | null;
  primary_path: string;
  plan: string;
  result: string | null;
  status: JournalStatus;
  error: string | null;
  attempts: number;
  created_at: number;
  updated_at: number;
};

const toRow = <R,>(r: RawRow): JournalRow<R> => ({
  id: r.id,
  actionKey: r.action_key,
  label: r.label,
  postingKey: r.posting_key,
  primaryPath: r.primary_path,
  plan: JSON.parse(r.plan) as WritePlan,
  result: r.result ? (JSON.parse(r.result) as R) : null,
  status: r.status,
  error: r.error,
  attempts: r.attempts,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export interface CounterRequest {
  key: string;
  count: number;
}

/**
 * Allocate numbers and journal the plan in ONE SQLite transaction, idempotent per action:
 * if `actionKey` was already journalled (double tap, retry after a crash) the existing row
 * is returned and no number is consumed. `build` gets the allocated numbers per request and
 * must be pure; if it throws, the counters roll back.
 */
export function allocateAndJournal<R>(
  actionKey: string,
  counters: CounterRequest[],
  build: (numbers: number[][]) => { plan: WritePlan; result: R },
  now = Date.now(),
): { row: JournalRow<R>; existing: boolean } {
  const d = localDb();
  const found = d.getFirstSync<RawRow>("SELECT * FROM journal WHERE action_key = ?", actionKey);
  if (found) return { row: toRow<R>(found), existing: true };
  let row: JournalRow<R> | null = null;
  d.withTransactionSync(() => {
    const again = d.getFirstSync<RawRow>("SELECT * FROM journal WHERE action_key = ?", actionKey);
    if (again) {
      row = toRow<R>(again);
      return;
    }
    const numbers: number[][] = [];
    for (const c of counters) {
      const cur = d.getFirstSync<{ value: number }>("SELECT value FROM counters WHERE key = ?", c.key)?.value ?? 0;
      const next = cur + c.count;
      d.runSync("INSERT INTO counters (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", c.key, next);
      numbers.push(Array.from({ length: c.count }, (_, i) => cur + i + 1));
    }
    const { plan, result } = build(numbers);
    const id = `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    d.runSync(
      "INSERT INTO journal (id, action_key, label, posting_key, primary_path, plan, result, status, attempts, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)",
      id,
      actionKey,
      plan.label,
      plan.postingKey ?? null,
      plan.primaryPath,
      JSON.stringify(plan),
      JSON.stringify(result ?? null),
      now,
      now,
    );
    row = { id, actionKey, label: plan.label, postingKey: plan.postingKey ?? null, primaryPath: plan.primaryPath, plan, result, status: "pending", error: null, attempts: 0, createdAt: now, updatedAt: now };
  });
  if (!row) throw new Error("Journal write failed");
  return { row, existing: false };
}

export function markJournal(id: string, status: JournalStatus, error?: string | null): void {
  localDb().runSync("UPDATE journal SET status = ?, error = ?, attempts = attempts + 1, updated_at = ? WHERE id = ?", status, error ?? null, Date.now(), id);
}

export function journalRows(status?: JournalStatus, limit = 200): JournalRow[] {
  const rows = status
    ? localDb().getAllSync<RawRow>("SELECT * FROM journal WHERE status = ? ORDER BY created_at DESC LIMIT ?", status, limit)
    : localDb().getAllSync<RawRow>("SELECT * FROM journal ORDER BY created_at DESC LIMIT ?", limit);
  return rows.map((r) => toRow(r));
}

export function journalCounts(): Record<JournalStatus, number> {
  const rows = localDb().getAllSync<{ status: JournalStatus; n: number }>("SELECT status, COUNT(*) AS n FROM journal GROUP BY status");
  const out: Record<JournalStatus, number> = { pending: 0, synced: 0, rejected: 0 };
  for (const r of rows) out[r.status] = r.n;
  return out;
}

/** Forget synced rows older than `days` (keeps the table small). */
export function pruneJournal(days = 14): void {
  localDb().runSync("DELETE FROM journal WHERE status = 'synced' AND updated_at < ?", Date.now() - days * 86_400_000);
}

// ─── drafts ─────────────────────────────────────────────────────────────────

export function saveDraft(orderId: string, value: unknown): void {
  localDb().runSync("INSERT INTO drafts (order_id, json, updated_at) VALUES (?, ?, ?) ON CONFLICT(order_id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at", orderId, JSON.stringify(value), Date.now());
}

export function loadDraft<T>(orderId: string): T | null {
  const r = localDb().getFirstSync<{ json: string }>("SELECT json FROM drafts WHERE order_id = ?", orderId);
  return r ? (JSON.parse(r.json) as T) : null;
}

export function deleteDraft(orderId: string): void {
  localDb().runSync("DELETE FROM drafts WHERE order_id = ?", orderId);
}

export function listDrafts<T>(): { orderId: string; value: T; updatedAt: number }[] {
  return localDb()
    .getAllSync<{ order_id: string; json: string; updated_at: number }>("SELECT * FROM drafts ORDER BY updated_at DESC")
    .map((r) => ({ orderId: r.order_id, value: JSON.parse(r.json) as T, updatedAt: r.updated_at }));
}

import "client-only";
import { arrayUnion, deleteField, doc, increment, runTransaction, serverTimestamp, writeBatch, type Transaction } from "firebase/firestore";
import { mapSentinels, type Sentinel, type WritePlan } from "@px-pos/core";
import { getDb } from "./client";

/** Plan value → Firestore value (sentinels become FieldValues, undefined is dropped). */
export function toFirestore(value: unknown): Record<string, unknown> {
  return mapSentinels(value, (s: Sentinel) => {
    if ("$inc" in s) return increment(s.$inc);
    if ("$serverTs" in s) return serverTimestamp();
    if ("$arrayUnion" in s) return arrayUnion(...s.$arrayUnion);
    return deleteField();
  }) as Record<string, unknown>;
}

/** Apply a WritePlan as one atomic batch. Resolves when the server accepts it. */
export async function applyPlan(plan: WritePlan): Promise<void> {
  if (plan.ops.length === 0) return;
  const db = getDb();
  const batch = writeBatch(db);
  for (const op of plan.ops) {
    const ref = doc(db, op.path);
    const data = toFirestore(op.data);
    if (op.op === "set") batch.set(ref, data);
    else if (op.op === "merge") batch.set(ref, data, { merge: true });
    else batch.update(ref, data);
  }
  await batch.commit();
}

/** Apply a plan's ops inside an existing transaction (pairing, Z close, force close). */
export function applyPlanInTx(tx: Transaction, plan: WritePlan): void {
  const db = getDb();
  for (const op of plan.ops) {
    const ref = doc(db, op.path);
    const data = toFirestore(op.data);
    if (op.op === "set") tx.set(ref, data);
    else if (op.op === "merge") tx.set(ref, data, { merge: true });
    else tx.update(ref, data);
  }
}

export { runTransaction };

/** Human message for a Firestore error (permission, offline, conflict). */
export function firestoreMessage(e: unknown): string {
  const code = (e as { code?: string })?.code ?? "";
  if (code === "permission-denied") return "You don't have access to do that.";
  if (code === "unavailable") return "Offline — the change will sync when you're back online.";
  if (code === "failed-precondition") return "This changed in the meantime. Refresh and try again.";
  if (code === "not-found") return "That record no longer exists.";
  if (code === "already-exists") return "That already exists.";
  return e instanceof Error ? e.message : "Something went wrong.";
}

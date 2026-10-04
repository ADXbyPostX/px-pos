import { arrayUnion, deleteField, doc, increment, serverTimestamp, writeBatch } from "@react-native-firebase/firestore";
import { mapSentinels, type Sentinel, type WritePlan } from "@px-pos/core";
import { getDb } from "./index";

/** Plan value → native Firestore value (sentinels become FieldValues, undefined dropped). */
export function toFirestore(value: unknown): Record<string, unknown> {
  return mapSentinels(value, (s: Sentinel) => {
    if ("$inc" in s) return increment(s.$inc);
    if ("$serverTs" in s) return serverTimestamp();
    if ("$arrayUnion" in s) return arrayUnion(...s.$arrayUnion);
    return deleteField();
  }) as Record<string, unknown>;
}

/**
 * Apply a WritePlan as one atomic batch. The returned promise resolves only when the
 * server accepts it — callers on the sale path must NOT await it (offline-first);
 * the journal tracks the outcome instead.
 */
export function applyPlan(plan: WritePlan): Promise<void> {
  const db = getDb();
  const batch = writeBatch(db);
  for (const op of plan.ops) {
    const ref = doc(db, op.path);
    const data = toFirestore(op.data);
    if (op.op === "set") batch.set(ref, data);
    else if (op.op === "merge") batch.set(ref, data, { merge: true });
    else batch.update(ref, data);
  }
  return batch.commit();
}

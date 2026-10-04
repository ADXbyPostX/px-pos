import { arrayUnion, deleteField, doc, increment, serverTimestamp, writeBatch } from "firebase/firestore";
import type { Firestore } from "firebase/firestore";
import { mapSentinels } from "@px-pos/core";
import type { Sentinel, WritePlan } from "@px-pos/core";

/** Same conversion as apps/pos-admin/src/lib/firebase/apply-plan.ts (web SDK). */
export function toFirestore(value: unknown): Record<string, unknown> {
  return mapSentinels(value, (s: Sentinel) => {
    if ("$inc" in s) return increment(s.$inc);
    if ("$serverTs" in s) return serverTimestamp();
    if ("$arrayUnion" in s) return arrayUnion(...s.$arrayUnion);
    return deleteField();
  }) as Record<string, unknown>;
}

export function applyPlan(db: Firestore, plan: WritePlan): Promise<void> {
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

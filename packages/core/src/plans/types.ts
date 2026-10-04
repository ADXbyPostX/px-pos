import type { Source } from "../types";

/**
 * A WritePlan is a list of document writes applied as ONE Firestore batch
 * (apps/pos-admin/src/lib/firebase/apply-plan.ts, apps/pos-app/src/firebase/apply-plan.ts).
 * Values may contain sentinels, converted to the SDK's FieldValue at apply time.
 *
 *  - "set"    → set(ref, data)                 (create or replace)
 *  - "merge"  → set(ref, data, { merge: true }) (deep merge; nested sentinels allowed)
 *  - "update" → update(ref, data)              (keys may be dotted field paths; doc must exist)
 */
export type PlanOpKind = "set" | "merge" | "update";

export interface PlanOp {
  path: string;
  op: PlanOpKind;
  data: Record<string, unknown>;
}

export interface WritePlan {
  /** Human label for the journal / sync screen ("Settle 1-042"). */
  label: string;
  ops: PlanOp[];
  /** The posting created by this batch (exactly-once guard), if it moves stats/stock. */
  postingKey?: string;
  /** Doc whose existence on the server proves the batch landed (reconcile). */
  primaryPath: string;
}

export interface IncSentinel {
  $inc: number;
}
export interface ServerTsSentinel {
  $serverTs: true;
}
export interface ArrayUnionSentinel {
  $arrayUnion: unknown[];
}
export interface DeleteSentinel {
  $delete: true;
}
export type Sentinel = IncSentinel | ServerTsSentinel | ArrayUnionSentinel | DeleteSentinel;

export const inc = (n: number): IncSentinel => ({ $inc: n });
export const serverTs = (): ServerTsSentinel => ({ $serverTs: true });
export const arrayUnion = (...values: unknown[]): ArrayUnionSentinel => ({ $arrayUnion: values });
export const del = (): DeleteSentinel => ({ $delete: true });

export function isSentinel(v: unknown): v is Sentinel {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const keys = Object.keys(v);
  return keys.length === 1 && (keys[0] === "$inc" || keys[0] === "$serverTs" || keys[0] === "$arrayUnion" || keys[0] === "$delete");
}

/**
 * Walk a plan value, mapping sentinels with `convert` and dropping `undefined`
 * (Firestore rejects undefined). Arrays are copied; sentinels inside arrays are not allowed.
 */
export function mapSentinels<T>(value: unknown, convert: (s: Sentinel) => T): unknown {
  if (value === undefined) return undefined;
  if (isSentinel(value)) return convert(value);
  if (Array.isArray(value)) return value.map((v) => mapSentinels(v, convert)).filter((v) => v !== undefined);
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const m = mapSentinels(v, convert);
      if (m !== undefined) out[k] = m;
    }
    return out;
  }
  return value;
}

/** Actor + context for every plan. */
export interface PlanCtx {
  cid: string;
  nowMs: number;
  /** Actor id: staff id in pos-app, platform uid in pos-admin. */
  actorId: string;
  actorName?: string;
  actorKind: "staff" | "platform" | "terminal";
  terminalId?: string;
  source: Source;
  /** Fresh random id (audit entries, expenses, moves). */
  newId: () => string;
}

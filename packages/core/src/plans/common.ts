import { paths } from "../paths";
import { prune } from "../stats";
import type { AuditEntry, BizDate, PostingKind, StatsDelta } from "../types";
import { inc, isSentinel, serverTs } from "./types";
import type { PlanCtx, PlanOp } from "./types";

/** Standard metadata for a newly created document. */
export function meta(ctx: Pick<PlanCtx, "nowMs" | "source">) {
  return { schemaVersion: 1 as const, createdAtMs: ctx.nowMs, createdAt: serverTs(), updatedAtMs: ctx.nowMs, source: ctx.source };
}

/** StatsDelta → nested {$inc} tree for a merge write (zeros dropped). */
export function incTree(d: StatsDelta): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(prune(d))) {
    if (typeof v === "number") out[k] = inc(v);
    else if (v && typeof v === "object") out[k] = incTree(v);
  }
  return out;
}

export interface PostingInput {
  key: string;
  kind: PostingKind;
  businessDate: BizDate;
  refId: string;
  stats: StatsDelta;
  /** onHand delta per tracked item. */
  stock?: Record<string, number>;
  approverId?: string;
  extra?: Record<string, unknown>;
}

/**
 * The exactly-once trio: create postings/{key}; merge-increment dailyStats/{date};
 * merge-increment stock/{item}. dailyStats and stock carry lastPostingKey = key, which the
 * rules accept only if this same batch creates that posting (a replay is rejected whole).
 */
export function postingOps(ctx: PlanCtx, p: PostingInput): PlanOp[] {
  const stats = prune(p.stats);
  const stock = Object.fromEntries(Object.entries(p.stock ?? {}).filter(([, v]) => v !== 0));
  const ops: PlanOp[] = [
    {
      path: paths.posting(ctx.cid, p.key),
      op: "set",
      data: {
        kind: p.kind,
        businessDate: p.businessDate,
        refId: p.refId,
        stats,
        stock,
        staffId: ctx.actorId,
        ...(p.approverId ? { approverId: p.approverId } : {}),
        ...(ctx.terminalId ? { terminalId: ctx.terminalId } : {}),
        createdAtMs: ctx.nowMs,
        createdAt: serverTs(),
        source: ctx.source,
        ...(p.extra ?? {}),
      },
    },
  ];
  if (Object.keys(stats).length) {
    ops.push({
      path: paths.dailyStats(ctx.cid, p.businessDate),
      op: "merge",
      data: { cid: ctx.cid, businessDate: p.businessDate, lastPostingKey: p.key, updatedAtMs: ctx.nowMs, ...incTree(stats) },
    });
  }
  for (const [itemId, delta] of Object.entries(stock)) {
    ops.push({
      path: paths.stock(ctx.cid, itemId),
      op: "merge",
      data: { onHand: inc(delta), lastPostingKey: p.key, updatedAtMs: ctx.nowMs },
    });
  }
  return ops;
}

export interface AuditInput {
  action: string;
  target: AuditEntry["target"];
  before?: unknown;
  after?: unknown;
  reason?: string;
  approver?: { id: string; name?: string };
}

export function auditOp(ctx: PlanCtx, a: AuditInput): PlanOp {
  const entry: Record<string, unknown> = {
    action: a.action,
    actor: { kind: ctx.actorKind, id: ctx.actorId, ...(ctx.actorName ? { name: ctx.actorName } : {}) },
    target: a.target,
    atMs: ctx.nowMs,
    createdAt: serverTs(),
    source: ctx.source,
  };
  if (a.before !== undefined) entry.before = strip(a.before);
  if (a.after !== undefined) entry.after = strip(a.after);
  if (a.reason) entry.reason = a.reason;
  if (a.approver) entry.approver = a.approver;
  if (ctx.terminalId) entry.terminalId = ctx.terminalId;
  return { path: paths.audit(ctx.cid, ctx.newId()), op: "set", data: entry };
}

/**
 * Plain-data snapshot for audit entries: JSON round-trip (drops undefined/functions) and
 * write markers (increment/delete/serverTimestamp) become null, so an audit set() never
 * carries a FieldValue.
 */
export function strip<T>(v: T): T {
  if (v === undefined) return v;
  const plain = JSON.parse(JSON.stringify(v)) as unknown;
  const scrub = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(scrub);
    if (x && typeof x === "object") {
      if (isSentinel(x)) return null;
      return Object.fromEntries(Object.entries(x as Record<string, unknown>).map(([k, val]) => [k, scrub(val)]));
    }
    return x;
  };
  return scrub(plain) as T;
}

/** Keys whose values differ (shallow, JSON-compared) — for compact audit before/after. */
export function changedKeys<T extends Record<string, unknown>>(before: T, after: Partial<T>): Array<keyof T> {
  return (Object.keys(after) as Array<keyof T>).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
}

export function pick<T extends Record<string, unknown>>(obj: T, keys: Array<keyof T>): Partial<T> {
  const out: Partial<T> = {};
  for (const k of keys) out[k] = obj[k];
  return out;
}

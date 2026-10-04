import { paths } from "../paths";
import type { Terminal } from "../types";
import { auditOp, meta } from "./common";
import { serverTs } from "./types";
import type { PlanCtx, WritePlan } from "./types";

/** First-run: claim super admin. Rules allow it only while meta/bootstrap does not exist. */
export function bootstrapPlan(i: { uid: string; name: string; email?: string; nowMs: number }): WritePlan {
  return {
    label: "Claim super admin",
    ops: [
      { path: paths.bootstrap(), op: "set", data: { uid: i.uid, atMs: i.nowMs } },
      {
        path: paths.platformUser(i.uid),
        op: "set",
        data: { ...meta({ nowMs: i.nowMs, source: "admin" }), role: "superadmin", name: i.name, ...(i.email ? { email: i.email } : {}), active: true },
      },
    ],
    primaryPath: paths.bootstrap(),
  };
}

/** A tablet asks to be paired; it shows `code` full-screen until an admin pairs it. */
export function pairingRequestPlan(i: { uid: string; code: string; deviceName: string; model: string; platform: "android" | "ios"; appVersion: string; nowMs: number }): WritePlan {
  return {
    label: "Pairing request",
    ops: [
      {
        path: paths.pairingRequest(i.uid),
        op: "set",
        data: { code: i.code, deviceName: i.deviceName, model: i.model, platform: i.platform, appVersion: i.appVersion, status: "pending", createdAtMs: i.nowMs, updatedAtMs: i.nowMs },
      },
    ],
    primaryPath: paths.pairingRequest(i.uid),
  };
}

export interface PairInput {
  requestUid: string;
  terminalId: string;
  code: string;
  name: string;
  mode: "pos" | "kds";
  series: string;
  platform?: "android" | "ios";
  model?: string;
  appVersion?: string;
  fy: string;
  /** Replacing a device: counters to continue (never the invoice series — new code = new series). */
  lastKot?: Terminal["lastKot"];
}

/**
 * Admin pairs a tablet to a client. Run inside a transaction that re-reads the pairing
 * request and checks it is still pending.
 */
export function pairPlan(ctx: PlanCtx, p: PairInput): WritePlan {
  const terminal = {
    ...meta(ctx),
    code: p.code,
    name: p.name,
    mode: p.mode,
    authUid: p.requestUid,
    status: "active",
    series: p.series,
    lastInvoiceFy: p.fy,
    lastInvoiceSeq: 0,
    lastKot: p.lastKot ?? { d: "", n: 0 },
    lastOrder: { d: "", n: 0 },
    lastToken: { d: "", n: 0 },
    printers: {},
    ...(p.platform ? { platform: p.platform } : {}),
    ...(p.model ? { model: p.model } : {}),
    ...(p.appVersion ? { appVersion: p.appVersion } : {}),
    pendingWrites: 0,
    journalRejected: 0,
    pairedBy: ctx.actorId,
    pairedAtMs: ctx.nowMs,
  };
  return {
    label: `Pair ${p.name}`,
    ops: [
      { path: paths.terminal(ctx.cid, p.terminalId), op: "set", data: terminal },
      { path: paths.member(ctx.cid, p.requestUid), op: "set", data: { role: "terminal", terminalId: p.terminalId, active: true, createdAtMs: ctx.nowMs, updatedAtMs: ctx.nowMs } },
      { path: paths.pairingRequest(p.requestUid), op: "update", data: { status: "paired", cid: ctx.cid, terminalId: p.terminalId, updatedAtMs: ctx.nowMs } },
      auditOp(ctx, { action: "terminal.pair", target: { type: "terminal", id: p.terminalId, label: p.name }, after: { code: p.code, series: p.series, mode: p.mode } }),
    ],
    primaryPath: paths.terminal(ctx.cid, p.terminalId),
  };
}

export function rejectPairingPlan(nowMs: number, uid: string): WritePlan {
  return { label: "Reject pairing", ops: [{ path: paths.pairingRequest(uid), op: "update", data: { status: "rejected", updatedAtMs: nowMs } }], primaryPath: paths.pairingRequest(uid) };
}

/** Revoke: the member doc is disabled in the same batch, so a revoked tablet can no longer write. */
export function revokeTerminalPlan(ctx: PlanCtx, t: { id: string; authUid: string; name: string; pendingWrites?: number }, reason: string): WritePlan {
  return {
    label: `Revoke ${t.name}`,
    ops: [
      { path: paths.terminal(ctx.cid, t.id), op: "update", data: { status: "revoked", revokedAtMs: ctx.nowMs, updatedAtMs: ctx.nowMs } },
      { path: paths.member(ctx.cid, t.authUid), op: "update", data: { active: false, updatedAtMs: ctx.nowMs } },
      auditOp(ctx, { action: "terminal.revoke", target: { type: "terminal", id: t.id, label: t.name }, reason, after: { pendingWrites: t.pendingWrites ?? 0 } }),
    ],
    primaryPath: paths.terminal(ctx.cid, t.id),
  };
}

export function terminalUpdatePlan(ctx: PlanCtx, tid: string, patch: Partial<Pick<Terminal, "name" | "mode" | "printers">>, before?: Partial<Terminal>): WritePlan {
  return {
    label: "Update terminal",
    ops: [
      { path: paths.terminal(ctx.cid, tid), op: "update", data: { ...patch, updatedAtMs: ctx.nowMs } },
      auditOp(ctx, { action: "terminal.update", target: { type: "terminal", id: tid, label: before?.name }, before: before ? pickKeys(before, Object.keys(patch)) : undefined, after: patch }),
    ],
    primaryPath: paths.terminal(ctx.cid, tid),
  };
}

function pickKeys(o: Record<string, unknown>, keys: string[]) {
  return Object.fromEntries(keys.map((k) => [k, o[k]]));
}

export interface HeartbeatInput {
  appVersion: string;
  pendingWrites: number;
  journalRejected: number;
  clockSkewMs?: number;
}

/** Presence + health, every 120 s while foregrounded and online. */
export function heartbeatPlan(ctx: PlanCtx, h: HeartbeatInput): WritePlan {
  if (!ctx.terminalId) throw new Error("heartbeatPlan: terminalId required");
  const path = paths.terminal(ctx.cid, ctx.terminalId);
  return {
    label: "Heartbeat",
    ops: [
      {
        path,
        op: "merge",
        data: {
          lastSeenAt: serverTs(),
          lastSeenAtMs: ctx.nowMs,
          appVersion: h.appVersion,
          pendingWrites: h.pendingWrites,
          journalRejected: h.journalRejected,
          ...(h.clockSkewMs != null ? { clockSkewMs: h.clockSkewMs } : {}),
          updatedAtMs: ctx.nowMs,
        },
      },
    ],
    primaryPath: path,
  };
}

/** Terminal-side counters mirror (lets a re-pair continue the KOT/order numbering). */
export function terminalCountersPlan(ctx: PlanCtx, c: Partial<Pick<Terminal, "lastKot" | "lastOrder" | "lastToken">>): WritePlan {
  if (!ctx.terminalId) throw new Error("terminalCountersPlan: terminalId required");
  const path = paths.terminal(ctx.cid, ctx.terminalId);
  return { label: "Counters", ops: [{ path, op: "merge", data: { ...c, updatedAtMs: ctx.nowMs } }], primaryPath: path };
}

import type { MonthKey, MonthReport } from "../month";
import { isMonthKey, monthLabel } from "../month";
import { paths } from "../paths";
import { auditOp } from "./common";
import type { PlanCtx, WritePlan } from "./types";

/** months/{YYYY-MM}: the month's frozen report once it's closed. */
export interface MonthDoc {
  month: MonthKey;
  status: "closed" | "open";
  report: MonthReport;
  closedAtMs: number;
  closedBy: string;
  closedByName?: string;
  reopenedAtMs?: number;
  reopenedBy?: string;
  reopenReason?: string;
  updatedAtMs: number;
}

/**
 * Close a month with its report (admin, online). Check monthCloseCheck first: every day closed and
 * the month over. Closing again after a reopen replaces the report.
 */
export function closeMonthPlan(ctx: PlanCtx, i: { month: MonthKey; report: MonthReport }): WritePlan {
  if (!isMonthKey(i.month) || i.report.month !== i.month) throw new Error("Pick the month to close");
  const path = paths.month(ctx.cid, i.month);
  const doc: MonthDoc = {
    month: i.month,
    status: "closed",
    report: i.report,
    closedAtMs: ctx.nowMs,
    closedBy: ctx.actorId,
    ...(ctx.actorName ? { closedByName: ctx.actorName } : {}),
    updatedAtMs: ctx.nowMs,
  };
  return {
    label: `Close ${monthLabel(i.month)}`,
    ops: [{ path, op: "set", data: doc as unknown as Record<string, unknown> }, auditOp(ctx, { action: "month.close", target: { type: "month", id: i.month, label: monthLabel(i.month) }, after: { totalPaise: i.report.totalPaise, netPaise: i.report.netPaise, orders: i.report.orders } })],
    primaryPath: path,
  };
}

/** Super admin: open a closed month again (its report stays until it's closed again). */
export function reopenMonthPlan(ctx: PlanCtx, month: MonthKey, reason: string): WritePlan {
  if (!reason.trim()) throw new Error("Say why");
  const path = paths.month(ctx.cid, month);
  return {
    label: `Reopen ${monthLabel(month)}`,
    ops: [
      { path, op: "update", data: { status: "open", reopenedAtMs: ctx.nowMs, reopenedBy: ctx.actorId, reopenReason: reason.trim(), updatedAtMs: ctx.nowMs } },
      auditOp(ctx, { action: "month.reopen", target: { type: "month", id: month, label: monthLabel(month) }, reason: reason.trim() }),
    ],
    primaryPath: path,
  };
}

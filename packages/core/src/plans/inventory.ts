import { paths, postingKey } from "../paths";
import { materialMoveDelta } from "../stats";
import type { BizDate, PostingKind } from "../types";
import { auditOp, postingOps } from "./common";
import type { PlanCtx, WritePlan } from "./types";

/**
 * Raw-material stock moved by hand: stocked in without a bill, wasted, adjusted, or counted.
 * One posting for any number of materials (a count sheet is one batch), so it lands exactly once
 * from admin or from a till that's offline.
 */

export type MaterialMoveKind = "in" | "waste" | "adjust" | "count";

export interface MaterialMoveLine {
  materialId: string;
  /** Frozen for the ledger. */
  name: string;
  /** Micro of the stock unit: in/waste > 0; adjust signed ≠ 0; count = what was counted (≥ 0). */
  qty: number;
  /** count only: book stock when it was counted (micro). The difference becomes the adjustment. */
  book?: number;
}

export interface MaterialMoveInput {
  id: string;
  businessDate: BizDate;
  kind: MaterialMoveKind;
  lines: MaterialMoveLine[];
  reason?: string;
  approver?: { id: string; name?: string };
}

const POSTING_KIND: Record<MaterialMoveKind, PostingKind> = { in: "material_in", waste: "material_waste", adjust: "material_adjust", count: "material_count" };
const LABEL: Record<MaterialMoveKind, string> = { in: "Stock in", waste: "Wastage", adjust: "Adjust stock", count: "Stock count" };

export function validateMaterialMove(i: Pick<MaterialMoveInput, "kind" | "lines" | "reason">): string | null {
  if (!i.lines.length) return "Add at least one material";
  if (i.lines.length > 300) return "At most 300 materials at a time";
  const ids = new Set<string>();
  for (const l of i.lines) {
    if (!l.materialId) return "Pick a material on every line";
    if (ids.has(l.materialId)) return `${l.name}: listed twice`;
    ids.add(l.materialId);
    if (!Number.isSafeInteger(l.qty) || Math.abs(l.qty) > 1e15) return `${l.name}: enter the quantity`;
    if ((i.kind === "in" || i.kind === "waste") && l.qty <= 0) return `${l.name}: enter how much`;
    if (i.kind === "adjust" && l.qty === 0) return `${l.name}: enter how much to add or take off`;
    if (i.kind === "count") {
      if (l.qty < 0) return `${l.name}: a count can't be below zero`;
      if (l.book == null || !Number.isSafeInteger(l.book)) return `${l.name}: book stock is missing`;
    }
  }
  if ((i.kind === "waste" || i.kind === "adjust") && !i.reason?.trim()) return "Say why";
  if (i.reason && i.reason.trim().length > 120) return "Reason is too long (max 120 characters)";
  return null;
}

export function materialMovePlan(ctx: PlanCtx, i: MaterialMoveInput): WritePlan {
  const err = validateMaterialMove(i);
  if (err) throw new Error(err);
  const key = postingKey.materialMove(i.id);
  const reason = i.reason?.trim();
  const moves = i.lines.map((l) => ({ materialId: l.materialId, qty: i.kind === "count" ? l.qty - (l.book ?? 0) : l.qty }));
  const delta = materialMoveDelta(i.kind === "count" ? "adjust" : i.kind, moves);
  const lines = i.lines.map((l) => ({ materialId: l.materialId, name: l.name, qty: l.qty, ...(i.kind === "count" ? { book: l.book } : {}) }));
  const label = i.lines.length === 1 ? (i.lines[0]?.name ?? "") : `${i.lines.length} materials`;
  return {
    label: `${LABEL[i.kind]} · ${label}`,
    ops: [
      ...postingOps(ctx, {
        key,
        kind: POSTING_KIND[i.kind],
        businessDate: i.businessDate,
        refId: i.id,
        stats: delta.stats,
        materials: delta.materials,
        ...(i.approver ? { approverId: i.approver.id } : {}),
        extra: { lines, ...(reason ? { reason } : {}) },
      }),
      auditOp(ctx, {
        action: `inventory.${i.kind}`,
        target: { type: "inventory", id: i.id, label },
        after: { lines: lines.slice(0, 50) },
        ...(reason ? { reason } : {}),
        ...(i.approver ? { approver: i.approver } : {}),
      }),
    ],
    postingKey: key,
    primaryPath: paths.posting(ctx.cid, key),
  };
}

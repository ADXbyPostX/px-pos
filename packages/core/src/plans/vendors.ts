import { paths, postingKey } from "../paths";
import { purchaseDelta, purchaseVoidDelta, sumDeltas, vendorPayDelta, vendorPayVoidDelta } from "../stats";
import type { BizDate, Material, Paise, Purchase, Vendor, VendorPayMode, VendorPayment } from "../types";
import { validateMaterial, validatePurchase, validateVendor, validateVendorPayment } from "../validate";
import { purchaseTotals } from "../vendors";
import type { PurchaseLineInput } from "../vendors";
import { auditOp, changedKeys, meta, pick, postingOps } from "./common";
import { arrayUnion, del, inc } from "./types";
import type { PlanCtx, PlanOp, WritePlan } from "./types";

/**
 * Vendor writes. Every batch that moves money creates exactly one posting (the primaryPath) and
 * moves the vendor's running totals with inc() — rules accept those only alongside a posting
 * created in the same batch, so an offline replay can never count twice. A new vendor and its
 * first bill are two batches: never combine them (the vendor doc would appear twice).
 */

const MAX_MONEY: Paise = 10_00_00_000;

function fail(msg: string): never {
  throw new Error(msg);
}

/** Increment a vendor's totals in a posted batch (and remember what they supply). */
function vendorMoneyOp(ctx: PlanCtx, vendorId: string, key: string, d: { purchasedPaise?: Paise; paidPaise?: Paise }, materialIds: string[] = []): PlanOp {
  return {
    path: paths.vendor(ctx.cid, vendorId),
    op: "merge",
    data: {
      ...(d.purchasedPaise ? { purchasedPaise: inc(d.purchasedPaise) } : {}),
      ...(d.paidPaise ? { paidPaise: inc(d.paidPaise) } : {}),
      lastPostingKey: key,
      ...(d.purchasedPaise && d.purchasedPaise > 0 ? { lastPurchaseAtMs: ctx.nowMs } : {}),
      ...(d.paidPaise && d.paidPaise > 0 ? { lastPaymentAtMs: ctx.nowMs } : {}),
      ...(materialIds.length ? { materialIds: arrayUnion(...materialIds) } : {}),
      updatedAtMs: ctx.nowMs,
    },
  };
}

// ─── vendors and materials (no money) ───────────────────────────────────────

/** Every key present; an empty optional (phone, GSTIN, note) removes it. */
export interface VendorProfile {
  name: string;
  phone: string | undefined;
  gstin: string | undefined;
  materialIds: string[];
  creditDays: number;
  note: string | undefined;
  active: boolean;
}

const PROFILE_KEYS = ["name", "phone", "gstin", "materialIds", "creditDays", "note", "active"] as const;

function cleanProfile(v: VendorProfile): VendorProfile {
  return {
    name: v.name.trim(),
    phone: v.phone?.trim() || undefined,
    gstin: v.gstin?.trim().toUpperCase() || undefined,
    materialIds: [...new Set(v.materialIds)],
    creditDays: v.creditDays,
    note: v.note?.trim() || undefined,
    active: v.active,
  };
}

/** Add a vendor (totals start at 0) or update only the profile keys that changed. */
export function upsertVendorPlan(ctx: PlanCtx, i: { id: string; vendor: VendorProfile; before?: Vendor & { id: string } }): WritePlan {
  const v = cleanProfile(i.vendor);
  const err = validateVendor(v);
  if (err) fail(err);
  const path = paths.vendor(ctx.cid, i.id);
  if (!i.before) {
    const doc = {
      ...meta(ctx),
      name: v.name,
      ...(v.phone ? { phone: v.phone } : {}),
      ...(v.gstin ? { gstin: v.gstin } : {}),
      materialIds: v.materialIds,
      creditDays: v.creditDays,
      ...(v.note ? { note: v.note } : {}),
      active: v.active,
      purchasedPaise: 0,
      paidPaise: 0,
    };
    return {
      label: `Add vendor ${v.name}`,
      ops: [{ path, op: "set", data: doc }, auditOp(ctx, { action: "vendor.create", target: { type: "vendor", id: i.id, label: v.name }, after: pick(v as unknown as Record<string, unknown>, [...PROFILE_KEYS]) })],
      primaryPath: path,
    };
  }
  const before = pick(i.before as unknown as Record<string, unknown>, [...PROFILE_KEYS]);
  const after = Object.fromEntries(PROFILE_KEYS.map((k) => [k, v[k]])) as Record<string, unknown>;
  const keys = changedKeys(before, after) as string[];
  if (!keys.length) return { label: "No changes", ops: [], primaryPath: path };
  const data: Record<string, unknown> = { updatedAtMs: ctx.nowMs };
  for (const k of keys) data[k] = after[k] === undefined ? del() : after[k];
  return {
    label: `Update vendor ${v.name}`,
    ops: [{ path, op: "update", data }, auditOp(ctx, { action: "vendor.update", target: { type: "vendor", id: i.id, label: v.name }, before: pick(before, keys), after: pick(after, keys) })],
    primaryPath: path,
  };
}

export type MaterialInput = Pick<Material, "name" | "unit" | "taxBps" | "active">;

function materialDoc(ctx: PlanCtx, m: MaterialInput) {
  return { ...meta(ctx), name: m.name.trim(), unit: m.unit, taxBps: m.taxBps, active: m.active };
}

/** Add a material or update it. Its unit is fixed once created. */
export function upsertMaterialPlan(ctx: PlanCtx, i: { id: string; material: MaterialInput; before?: Material & { id: string } }): WritePlan {
  const m = { ...i.material, name: i.material.name.trim() };
  const err = validateMaterial(m);
  if (err) fail(err);
  const path = paths.material(ctx.cid, i.id);
  if (!i.before) {
    return {
      label: `Add material ${m.name}`,
      ops: [{ path, op: "set", data: materialDoc(ctx, m) }, auditOp(ctx, { action: "material.create", target: { type: "material", id: i.id, label: m.name }, after: m })],
      primaryPath: path,
    };
  }
  if (i.before.unit !== m.unit) fail("A material's unit can't change. Add a new material instead.");
  const keys = changedKeys(i.before as unknown as Record<string, unknown>, m as unknown as Record<string, unknown>) as Array<keyof MaterialInput>;
  if (!keys.length) return { label: "No changes", ops: [], primaryPath: path };
  const data: Record<string, unknown> = { updatedAtMs: ctx.nowMs };
  for (const k of keys) data[k] = m[k];
  return {
    label: `Update material ${m.name}`,
    ops: [{ path, op: "update", data }, auditOp(ctx, { action: "material.update", target: { type: "material", id: i.id, label: m.name }, before: pick(i.before as unknown as Record<string, unknown>, keys), after: pick(m as unknown as Record<string, unknown>, keys) })],
    primaryPath: path,
  };
}

// ─── purchases ──────────────────────────────────────────────────────────────

export interface PurchaseInput {
  id: string;
  vendor: { id: string; name: string };
  /** Date on the vendor's bill. */
  billDate: BizDate;
  /** Business day it's entered (today's open day on the till). */
  businessDate: BizDate;
  billNo?: string;
  lines: PurchaseLineInput[];
  adjustPaise?: Paise;
  note?: string;
  /** Paid on delivery, in the same batch. Drawer cash only from a till. */
  paidNow?: { id: string; amountPaise: Paise; mode: VendorPayMode; ref?: string };
  /** Materials first used on this bill, saved in the same batch. */
  newMaterials?: Array<{ id: string; material: MaterialInput }>;
  /** Today's business date, to refuse future-dated bills. */
  today?: BizDate;
}

/** A vendor bill: what's owed goes up; "Bought" counts on the day it's entered. */
export function purchasePlan(ctx: PlanCtx, i: PurchaseInput): WritePlan {
  const lines = i.lines.map((l) => ({ ...l, name: l.name.trim() }));
  const err = validatePurchase(
    { kind: "bill", billDate: i.billDate, businessDate: i.businessDate, lines, ...(i.adjustPaise ? { adjustPaise: i.adjustPaise } : {}), ...(i.billNo ? { billNo: i.billNo } : {}), ...(i.note ? { note: i.note } : {}), ...(i.paidNow ? { paidNow: i.paidNow } : {}) },
    i.today,
  );
  if (err) fail(err);
  if (i.paidNow?.mode === "drawer" && (!ctx.terminalId || ctx.actorKind === "platform")) fail("Drawer cash can only be paid at a till");
  for (const nm of i.newMaterials ?? []) {
    const e = validateMaterial(nm.material);
    if (e) fail(e);
  }
  if (new Set((i.newMaterials ?? []).map((m) => m.id)).size !== (i.newMaterials ?? []).length) fail("Duplicate new material");
  const totals = purchaseTotals(lines, i.adjustPaise ?? 0);
  const materialIds = [...new Set(totals.lines.map((l) => l.materialId).filter((x): x is string => Boolean(x)))];
  const key = postingKey.purchase(i.id);
  const billNo = i.billNo?.trim();
  const note = i.note?.trim();
  const purchase = {
    ...meta(ctx),
    outletId: "main",
    vendorId: i.vendor.id,
    vendorName: i.vendor.name,
    kind: "bill" as const,
    billDate: i.billDate,
    businessDate: i.businessDate,
    ...(billNo ? { billNo } : {}),
    lines: totals.lines.map(({ materialId, ...l }) => (materialId ? { ...l, materialId } : l)),
    materialIds,
    subtotalPaise: totals.subtotalPaise,
    adjustPaise: totals.adjustPaise,
    totalPaise: totals.totalPaise,
    gstPaise: totals.gstPaise,
    status: "active" as const,
    enteredBy: ctx.actorId,
    ...(ctx.terminalId ? { terminalId: ctx.terminalId } : {}),
    ...(i.paidNow ? { paymentId: i.paidNow.id } : {}),
    ...(note ? { note } : {}),
  };
  const ops: PlanOp[] = [{ path: paths.purchase(ctx.cid, i.id), op: "set", data: purchase }];
  let paid: (Pick<VendorPayment, "kind" | "amountPaise" | "mode" | "drawerTerminalId">) | null = null;
  if (i.paidNow) {
    const ref = i.paidNow.ref?.trim();
    paid = { kind: "payment", amountPaise: i.paidNow.amountPaise, mode: i.paidNow.mode, ...(i.paidNow.mode === "drawer" && ctx.terminalId ? { drawerTerminalId: ctx.terminalId } : {}) };
    ops.push({
      path: paths.vendorPayment(ctx.cid, i.paidNow.id),
      op: "set",
      data: {
        ...meta(ctx),
        outletId: "main",
        vendorId: i.vendor.id,
        vendorName: i.vendor.name,
        ...paid,
        businessDate: i.businessDate,
        ...(ref ? { ref } : {}),
        paidBy: ctx.actorId,
        purchaseId: i.id,
        status: "active",
        ...(ctx.terminalId ? { terminalId: ctx.terminalId } : {}),
      },
    });
  }
  for (const nm of i.newMaterials ?? []) ops.push({ path: paths.material(ctx.cid, nm.id), op: "set", data: materialDoc(ctx, nm.material) });
  const stats = sumDeltas([purchaseDelta({ kind: "bill", vendorId: i.vendor.id, totalPaise: totals.totalPaise, gstPaise: totals.gstPaise, lines: totals.lines }), paid ? vendorPayDelta(paid) : {}]);
  ops.push(...postingOps(ctx, { key, kind: "purchase", businessDate: i.businessDate, refId: i.id, stats, extra: { vendorId: i.vendor.id, vendorDelta: { purchasedPaise: totals.totalPaise, ...(paid ? { paidPaise: paid.amountPaise } : {}) } } }));
  ops.push(vendorMoneyOp(ctx, i.vendor.id, key, { purchasedPaise: totals.totalPaise, ...(paid ? { paidPaise: paid.amountPaise } : {}) }, materialIds));
  if (paid) ops.push(auditOp(ctx, { action: "vendor.pay", target: { type: "vendor", id: i.vendor.id, label: i.vendor.name }, after: { amountPaise: paid.amountPaise, mode: paid.mode, purchaseId: i.id } }));
  return { label: `Purchase ${i.vendor.name}${billNo ? ` #${billNo}` : ""}`, ops, postingKey: key, primaryPath: paths.posting(ctx.cid, key) };
}

/** Change only a bill's number or note (no money moves). */
export function purchaseEditPlan(ctx: PlanCtx, p: Pick<Purchase, "billNo" | "note" | "vendorName"> & { id: string }, next: { billNo?: string; note?: string }): WritePlan {
  const billNo = next.billNo?.trim() || undefined;
  const note = next.note?.trim() || undefined;
  if (billNo && billNo.length > 30) fail("Bill number is too long (max 30 characters)");
  if (note && note.length > 200) fail("Note is too long (max 200 characters)");
  const path = paths.purchase(ctx.cid, p.id);
  const data: Record<string, unknown> = {};
  if ((p.billNo ?? undefined) !== billNo) data.billNo = billNo ?? del();
  if ((p.note ?? undefined) !== note) data.note = note ?? del();
  if (!Object.keys(data).length) return { label: "No changes", ops: [], primaryPath: path };
  data.updatedAtMs = ctx.nowMs;
  return {
    label: `Edit bill ${p.vendorName}`,
    ops: [{ path, op: "update", data }, auditOp(ctx, { action: "purchase.edit", target: { type: "purchase", id: p.id, label: p.vendorName }, before: { billNo: p.billNo ?? null, note: p.note ?? null }, after: { billNo: billNo ?? null, note: note ?? null } })],
    primaryPath: path,
  };
}

export type PurchaseRef = Pick<Purchase, "kind" | "vendorId" | "vendorName" | "businessDate" | "totalPaise" | "gstPaise" | "lines" | "billNo" | "status"> & { id: string };

/**
 * Void a bill: what's owed drops by its total, reversed on the bill's own business day. A payment
 * made with it stays (it becomes credit) — void that separately if it was also wrong.
 */
export function purchaseVoidPlan(ctx: PlanCtx, p: PurchaseRef, reason: string): WritePlan {
  if (p.status !== "active") fail("This bill is already void");
  if (!reason.trim()) fail("Give a reason");
  const key = postingKey.purchaseVoid(p.id);
  return {
    label: `Void purchase ${p.vendorName}${p.billNo ? ` #${p.billNo}` : ""}`,
    ops: [
      { path: paths.purchase(ctx.cid, p.id), op: "update", data: { status: "void", void: { reason: reason.trim(), by: ctx.actorId, atMs: ctx.nowMs }, updatedAtMs: ctx.nowMs } },
      ...postingOps(ctx, { key, kind: "purchase_void", businessDate: p.businessDate, refId: p.id, stats: purchaseVoidDelta(p), extra: { vendorId: p.vendorId, vendorDelta: { purchasedPaise: -p.totalPaise } } }),
      vendorMoneyOp(ctx, p.vendorId, key, { purchasedPaise: -p.totalPaise }),
      auditOp(ctx, { action: "purchase.void", target: { type: "purchase", id: p.id, label: p.vendorName }, before: { totalPaise: p.totalPaise, billNo: p.billNo ?? null, kind: p.kind }, reason: reason.trim() }),
    ],
    postingKey: key,
    primaryPath: paths.posting(ctx.cid, key),
  };
}

// ─── payments ───────────────────────────────────────────────────────────────

export interface VendorPaymentInput {
  id: string;
  vendor: { id: string; name: string };
  businessDate: BizDate;
  amountPaise: Paise;
  mode: VendorPayMode;
  ref?: string;
  note?: string;
  approver?: { id: string; name?: string };
  today?: BizDate;
}

/** Pay a vendor. It settles their oldest dues first (worked out when read, never stored). */
export function vendorPaymentPlan(ctx: PlanCtx, i: VendorPaymentInput): WritePlan {
  const ref = i.ref?.trim();
  const note = i.note?.trim();
  const err = validateVendorPayment({ amountPaise: i.amountPaise, mode: i.mode, businessDate: i.businessDate, ...(ref ? { ref } : {}), ...(note ? { note } : {}) }, i.today);
  if (err) fail(err);
  if (i.mode === "drawer" && (!ctx.terminalId || ctx.actorKind === "platform")) fail("Drawer cash can only be paid at a till");
  const key = postingKey.vendorPay(i.id);
  const pay = { kind: "payment" as const, amountPaise: i.amountPaise, mode: i.mode, ...(i.mode === "drawer" && ctx.terminalId ? { drawerTerminalId: ctx.terminalId } : {}) };
  return {
    label: `Pay ${i.vendor.name}`,
    ops: [
      {
        path: paths.vendorPayment(ctx.cid, i.id),
        op: "set",
        data: {
          ...meta(ctx),
          outletId: "main",
          vendorId: i.vendor.id,
          vendorName: i.vendor.name,
          ...pay,
          businessDate: i.businessDate,
          ...(ref ? { ref } : {}),
          ...(note ? { note } : {}),
          paidBy: ctx.actorId,
          ...(i.approver ? { approvedBy: i.approver.id } : {}),
          status: "active",
          ...(ctx.terminalId ? { terminalId: ctx.terminalId } : {}),
        },
      },
      ...postingOps(ctx, { key, kind: "vendor_pay", businessDate: i.businessDate, refId: i.id, stats: vendorPayDelta(pay), ...(i.approver ? { approverId: i.approver.id } : {}), extra: { vendorId: i.vendor.id, vendorDelta: { paidPaise: i.amountPaise } } }),
      vendorMoneyOp(ctx, i.vendor.id, key, { paidPaise: i.amountPaise }),
      auditOp(ctx, { action: "vendor.pay", target: { type: "vendor", id: i.vendor.id, label: i.vendor.name }, after: { amountPaise: i.amountPaise, mode: i.mode, ...(ref ? { ref } : {}) }, ...(i.approver ? { approver: i.approver } : {}) }),
    ],
    postingKey: key,
    primaryPath: paths.posting(ctx.cid, key),
  };
}

export type VendorPaymentRef = Pick<VendorPayment, "kind" | "vendorId" | "vendorName" | "businessDate" | "amountPaise" | "mode" | "drawerTerminalId" | "status"> & { id: string };

/** Void a payment: owed goes back up (the newest bills re-open), drawer cash is reversed too. */
export function vendorPaymentVoidPlan(ctx: PlanCtx, p: VendorPaymentRef, reason: string): WritePlan {
  if (p.status !== "active") fail("This payment is already void");
  if (!reason.trim()) fail("Give a reason");
  const key = postingKey.vendorPayVoid(p.id);
  return {
    label: `Void payment ${p.vendorName}`,
    ops: [
      { path: paths.vendorPayment(ctx.cid, p.id), op: "update", data: { status: "void", void: { reason: reason.trim(), by: ctx.actorId, atMs: ctx.nowMs }, updatedAtMs: ctx.nowMs } },
      ...postingOps(ctx, { key, kind: "vendor_pay_void", businessDate: p.businessDate, refId: p.id, stats: vendorPayVoidDelta(p), extra: { vendorId: p.vendorId, vendorDelta: { paidPaise: -p.amountPaise } } }),
      vendorMoneyOp(ctx, p.vendorId, key, { paidPaise: -p.amountPaise }),
      auditOp(ctx, { action: "vendor_pay.void", target: { type: "vendor", id: p.vendorId, label: p.vendorName }, before: { amountPaise: p.amountPaise, mode: p.mode, paymentId: p.id }, reason: reason.trim() }),
    ],
    postingKey: key,
    primaryPath: paths.posting(ctx.cid, key),
  };
}

// ─── opening balance ────────────────────────────────────────────────────────

/**
 * What was owed when the outlet started using PX POS: positive = we owe the vendor (an opening
 * bill, cleared first), negative = an advance they already hold. Never counts as bought or paid
 * on any day. To correct it, void it and enter it again.
 */
export function openingBalancePlan(ctx: PlanCtx, i: { id: string; vendor: { id: string; name: string }; asOf: BizDate; amountPaise: Paise; note?: string }): WritePlan {
  const amt = i.amountPaise;
  if (!Number.isSafeInteger(amt) || amt === 0 || Math.abs(amt) > MAX_MONEY) fail("Enter the opening balance");
  const note = i.note?.trim();
  const audit = auditOp(ctx, { action: "vendor.opening", target: { type: "vendor", id: i.vendor.id, label: i.vendor.name }, after: { amountPaise: amt, asOf: i.asOf } });
  if (amt > 0) {
    const key = postingKey.purchase(i.id);
    const doc = {
      ...meta(ctx),
      outletId: "main",
      vendorId: i.vendor.id,
      vendorName: i.vendor.name,
      kind: "opening" as const,
      billDate: i.asOf,
      businessDate: i.asOf,
      lines: [],
      materialIds: [],
      subtotalPaise: amt,
      adjustPaise: 0,
      totalPaise: amt,
      gstPaise: 0,
      status: "active" as const,
      enteredBy: ctx.actorId,
      ...(ctx.terminalId ? { terminalId: ctx.terminalId } : {}),
      ...(note ? { note } : {}),
    };
    return {
      label: `Opening balance ${i.vendor.name}`,
      ops: [
        { path: paths.purchase(ctx.cid, i.id), op: "set", data: doc },
        ...postingOps(ctx, { key, kind: "vendor_opening", businessDate: i.asOf, refId: i.id, stats: {}, extra: { vendorId: i.vendor.id, vendorDelta: { purchasedPaise: amt } } }),
        vendorMoneyOp(ctx, i.vendor.id, key, { purchasedPaise: amt }),
        audit,
      ],
      postingKey: key,
      primaryPath: paths.posting(ctx.cid, key),
    };
  }
  const key = postingKey.vendorPay(i.id);
  return {
    label: `Opening advance ${i.vendor.name}`,
    ops: [
      {
        path: paths.vendorPayment(ctx.cid, i.id),
        op: "set",
        data: {
          ...meta(ctx),
          outletId: "main",
          vendorId: i.vendor.id,
          vendorName: i.vendor.name,
          kind: "opening",
          businessDate: i.asOf,
          amountPaise: -amt,
          mode: "other",
          paidBy: ctx.actorId,
          status: "active",
          ...(ctx.terminalId ? { terminalId: ctx.terminalId } : {}),
          ...(note ? { note } : {}),
        },
      },
      ...postingOps(ctx, { key, kind: "vendor_opening", businessDate: i.asOf, refId: i.id, stats: {}, extra: { vendorId: i.vendor.id, vendorDelta: { paidPaise: -amt } } }),
      vendorMoneyOp(ctx, i.vendor.id, key, { paidPaise: -amt }),
      audit,
    ],
    postingKey: key,
    primaryPath: paths.posting(ctx.cid, key),
  };
}

import type { PhotoInput } from "../menu-photos";
import { paths, postingKey } from "../paths";
import { stockMoveDelta } from "../stats";
import type { BizDate, Category, Client, Floor, Item, PlatformRole, Staff, Table } from "../types";
import { auditOp, changedKeys, meta, pick, postingOps } from "./common";
import { del, inc } from "./types";
import type { PlanCtx, PlanOp, WritePlan } from "./types";

/** Settings for a brand-new client (outlet). */
export function defaultClientSettings(): Omit<Client, keyof ReturnType<typeof meta> | "name" | "legalName" | "address" | "city" | "stateName" | "stateCode" | "fssai" | "adminUids" | "schemaVersion"> {
  return {
    status: "active",
    taxMode: "regular",
    defaultTaxBps: 500,
    priceMode: "exclusive",
    rounding: "rupee",
    orderModes: { dineIn: true, quick: true, delivery: false },
    modeOpts: { dineIn: { askCovers: true, backToTables: true }, quick: { payFirst: true }, delivery: { defaultPrepaid: false } },
    charges: { packagingPaise: 0, packagingOn: ["quick", "delivery"], deliveryPaise: 0, serviceChargeBps: 0 },
    day: { cutoffMin: 240 },
    invoicePrefix: "",
    discountCapBps: { owner: 10000, manager: 10000, cashier: 1000, captain: 0, kitchen: 0 },
    approvals: { voidAfterKot: true, discountOverCap: true, comp: true, cancelBill: true, editBill: true, reprint: false, paidOut: false, stockAdjust: true, dayClose: true },
    receipt: { header: [], footer: ["Thank you! Visit again."], showSac: true },
    kds: { warnMin: 10, lateMin: 20 },
    stockAutoOff: true,
    requirePin: false,
    lastZNo: 0,
  };
}

export type NewClientInput = Pick<Client, "name" | "legalName" | "address" | "city" | "stateName" | "stateCode" | "fssai"> &
  Partial<Omit<Client, "schemaVersion" | "createdAtMs" | "createdAt" | "updatedAtMs" | "source">>;

export function createClientPlan(ctx: PlanCtx, c: NewClientInput): WritePlan {
  const doc = { ...meta(ctx), ...defaultClientSettings(), adminUids: [] as string[], ...c };
  return {
    label: `Create client ${c.name}`,
    ops: [
      { path: paths.client(ctx.cid), op: "set", data: doc },
      auditOp(ctx, { action: "client.create", target: { type: "client", id: ctx.cid, label: c.name }, after: { name: c.name, taxMode: doc.taxMode, orderModes: doc.orderModes } }),
    ],
    primaryPath: paths.client(ctx.cid),
  };
}

/** Update client settings (shallow keys, each replaced whole) with a before/after audit. */
export function updateClientPlan(ctx: PlanCtx, before: Client, patch: Partial<Client>, action = "client.update"): WritePlan {
  const keys = changedKeys(before as unknown as Record<string, unknown>, patch as Record<string, unknown>) as Array<keyof Client>;
  if (keys.length === 0) return { label: "No changes", ops: [], primaryPath: paths.client(ctx.cid) };
  const data: Record<string, unknown> = { updatedAtMs: ctx.nowMs };
  for (const k of keys) data[k] = patch[k];
  return {
    label: `Update ${before.name}`,
    ops: [
      { path: paths.client(ctx.cid), op: "update", data },
      auditOp(ctx, {
        action,
        target: { type: "client", id: ctx.cid, label: before.name },
        before: pick(before as unknown as Record<string, unknown>, keys as string[]),
        after: pick(patch as Record<string, unknown>, keys as string[]),
      }),
    ],
    primaryPath: paths.client(ctx.cid),
  };
}

/** Super admin: set which admins manage a client. */
export function assignAdminsPlan(ctx: PlanCtx, clientName: string, before: string[], after: string[]): WritePlan {
  return {
    label: `Assign admins · ${clientName}`,
    ops: [
      { path: paths.client(ctx.cid), op: "update", data: { adminUids: [...new Set(after)].sort(), updatedAtMs: ctx.nowMs } },
      auditOp(ctx, { action: "client.admins", target: { type: "client", id: ctx.cid, label: clientName }, before, after }),
    ],
    primaryPath: paths.client(ctx.cid),
  };
}

export function platformUserPlan(i: { uid: string; role: PlatformRole; name: string; email?: string; active: boolean; nowMs: number; create: boolean }): WritePlan {
  const path = paths.platformUser(i.uid);
  const data = i.create
    ? { ...meta({ nowMs: i.nowMs, source: "admin" }), role: i.role, name: i.name, ...(i.email ? { email: i.email } : {}), active: i.active }
    : { role: i.role, name: i.name, email: i.email ?? del(), active: i.active, updatedAtMs: i.nowMs };
  return { label: `${i.create ? "Add" : "Update"} ${i.name}`, ops: [{ path, op: i.create ? "set" : "update", data }], primaryPath: path };
}

// ─── menu ───────────────────────────────────────────────────────────────────

export type ItemInput = Omit<Item, keyof ReturnType<typeof meta> | "schemaVersion" | "rev">;

export function upsertItemPlan(
  ctx: PlanCtx,
  i: { id: string; item: ItemInput; before?: Item & { id: string }; openingQty?: number; businessDate?: BizDate },
): WritePlan {
  const path = paths.item(ctx.cid, i.id);
  const ops: PlanOp[] = [];
  let key: string | undefined;
  if (!i.before) {
    ops.push({ path, op: "set", data: { ...meta(ctx), ...i.item, rev: 1 } });
    ops.push(auditOp(ctx, { action: "item.create", target: { type: "item", id: i.id, label: i.item.name }, after: { pricePaise: i.item.pricePaise, taxBps: i.item.taxBps } }));
    if (i.item.trackStock && i.openingQty && i.openingQty > 0 && i.businessDate) {
      key = postingKey.stockMove(`open-${i.id}`);
      const d = stockMoveDelta("in", i.id, i.openingQty);
      ops.push(...postingOps(ctx, { key, kind: "stock_in", businessDate: i.businessDate, refId: i.id, stats: d.stats, stock: d.stock, extra: { itemId: i.id, reason: "opening stock" } }));
    }
  } else {
    const keys = changedKeys(i.before as unknown as Record<string, unknown>, i.item as unknown as Record<string, unknown>);
    if (keys.length === 0) return { label: "No changes", ops: [], primaryPath: path };
    const data: Record<string, unknown> = { updatedAtMs: ctx.nowMs, rev: inc(1) };
    for (const k of keys) data[k as string] = (i.item as unknown as Record<string, unknown>)[k as string];
    ops.push({ path, op: "update", data });
    ops.push(
      auditOp(ctx, {
        action: keys.includes("pricePaise") || keys.includes("variants") ? "item.price" : "item.update",
        target: { type: "item", id: i.id, label: i.item.name },
        before: pick(i.before as unknown as Record<string, unknown>, keys as string[]),
        after: pick(i.item as unknown as Record<string, unknown>, keys as string[]),
      }),
    );
  }
  return { label: `${i.before ? "Update" : "Add"} ${i.item.name}`, ops, ...(key ? { postingKey: key } : {}), primaryPath: key ? paths.posting(ctx.cid, key) : path };
}

export function itemFlagPlan(ctx: PlanCtx, id: string, name: string, patch: Partial<Pick<Item, "available" | "active" | "sort" | "categoryId">>): WritePlan {
  const path = paths.item(ctx.cid, id);
  return {
    label: `${name}: ${Object.keys(patch).join(", ")}`,
    ops: [
      { path, op: "update", data: { ...patch, updatedAtMs: ctx.nowMs } },
      auditOp(ctx, { action: "item.flags", target: { type: "item", id, label: name }, after: patch }),
    ],
    primaryPath: path,
  };
}

/**
 * Set, replace or remove (photo: null) an item's photo. The audit records the change and
 * size only — never the image data.
 */
export function itemPhotoPlan(ctx: PlanCtx, i: { itemId: string; itemName: string; photo: PhotoInput | null; hadPhoto: boolean }): WritePlan {
  const path = paths.itemPhoto(ctx.cid, i.itemId);
  const data = i.photo
    ? { ...meta(ctx), itemId: i.itemId, mime: i.photo.mime, w: i.photo.w, h: i.photo.h, bytes: i.photo.bytes, data: i.photo.data, active: true }
    : { ...meta(ctx), itemId: i.itemId, mime: "image/jpeg", w: 0, h: 0, bytes: 0, data: "", active: false };
  const change = !i.photo ? "removed" : i.hadPhoto ? "replaced" : "added";
  return {
    label: `${i.itemName}: photo ${change}`,
    ops: [
      { path, op: "set", data },
      auditOp(ctx, { action: "item.photo", target: { type: "item", id: i.itemId, label: i.itemName }, after: { photo: change, ...(i.photo ? { bytes: i.photo.bytes } : {}) } }),
    ],
    primaryPath: path,
  };
}

/** Several plans as one atomic batch (e.g. save an item and its new photo together). */
export function combinePlans(label: string, plans: WritePlan[]): WritePlan {
  const withKey = plans.find((p) => p.postingKey);
  return {
    label,
    ops: plans.flatMap((p) => p.ops),
    ...(withKey?.postingKey ? { postingKey: withKey.postingKey } : {}),
    primaryPath: withKey?.primaryPath ?? plans.find((p) => p.ops.length)?.primaryPath ?? plans[0]?.primaryPath ?? "",
  };
}

export function upsertCategoryPlan(ctx: PlanCtx, id: string, c: Pick<Category, "name" | "sort" | "station" | "active">, create: boolean): WritePlan {
  const path = paths.doc(ctx.cid, "categories", id);
  return {
    label: `${create ? "Add" : "Update"} ${c.name}`,
    ops: [{ path, op: create ? "set" : "update", data: create ? { ...meta(ctx), ...c } : { ...c, updatedAtMs: ctx.nowMs } }],
    primaryPath: path,
  };
}

export function reorderPlan(ctx: PlanCtx, col: "categories" | "items" | "floors" | "tables", order: Array<{ id: string; sort: number }>): WritePlan {
  return {
    label: `Reorder ${col}`,
    ops: order.map((o) => ({ path: paths.doc(ctx.cid, col, o.id), op: "update" as const, data: { sort: o.sort, updatedAtMs: ctx.nowMs } })),
    primaryPath: paths.col(ctx.cid, col),
  };
}

// ─── floors & tables ────────────────────────────────────────────────────────

export function upsertFloorPlan(ctx: PlanCtx, id: string, f: Pick<Floor, "name" | "sort" | "active">, create: boolean): WritePlan {
  const path = paths.doc(ctx.cid, "floors", id);
  return { label: `${create ? "Add" : "Update"} ${f.name}`, ops: [{ path, op: create ? "set" : "update", data: create ? { ...meta(ctx), ...f } : { ...f, updatedAtMs: ctx.nowMs } }], primaryPath: path };
}

export function upsertTablePlan(ctx: PlanCtx, id: string, t: Pick<Table, "floorId" | "label" | "seats" | "sort" | "active">, create: boolean): WritePlan {
  const path = paths.doc(ctx.cid, "tables", id);
  return { label: `${create ? "Add" : "Update"} ${t.label}`, ops: [{ path, op: create ? "set" : "update", data: create ? { ...meta(ctx), ...t } : { ...t, updatedAtMs: ctx.nowMs } }], primaryPath: path };
}

/** Bulk-create tables "T1".."T12" on a floor. */
export function bulkTablesPlan(ctx: PlanCtx, i: { floorId: string; prefix: string; from: number; to: number; seats: number; startSort: number; ids: string[] }): WritePlan {
  const ops: PlanOp[] = [];
  let k = 0;
  for (let n = i.from; n <= i.to; n++, k++) {
    const id = i.ids[k];
    if (!id) throw new Error("bulkTablesPlan: not enough ids");
    ops.push({ path: paths.doc(ctx.cid, "tables", id), op: "set", data: { ...meta(ctx), floorId: i.floorId, label: `${i.prefix}${n}`, seats: i.seats, sort: i.startSort + k, active: true } });
  }
  return { label: `Add tables ${i.prefix}${i.from}–${i.prefix}${i.to}`, ops, primaryPath: ops[0]?.path ?? paths.col(ctx.cid, "tables") };
}

// ─── staff ──────────────────────────────────────────────────────────────────

export function upsertStaffPlan(ctx: PlanCtx, id: string, s: Pick<Staff, "name" | "role" | "active"> & Partial<Pick<Staff, "phone" | "discountCapBps">>, before?: Staff): WritePlan {
  const path = paths.doc(ctx.cid, "staff", id);
  return {
    label: `${before ? "Update" : "Add"} ${s.name}`,
    ops: [
      { path, op: before ? "update" : "set", data: before ? { ...s, updatedAtMs: ctx.nowMs } : { ...meta(ctx), ...s } },
      auditOp(ctx, { action: before ? "staff.update" : "staff.create", target: { type: "staff", id, label: s.name }, ...(before ? { before: { role: before.role, active: before.active } } : {}), after: { role: s.role, active: s.active } }),
    ],
    primaryPath: path,
  };
}

/** Membership doc for an owner/staff login (phase 2); kept here so rules stay the single source. */
export function memberPlan(ctx: PlanCtx, uid: string, role: "owner" | "staff", active: boolean): WritePlan {
  const path = paths.member(ctx.cid, uid);
  return { label: `Member ${role}`, ops: [{ path, op: "merge", data: { role, active, updatedAtMs: ctx.nowMs, createdAtMs: ctx.nowMs } }], primaryPath: path };
}


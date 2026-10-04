import { diffKot, orderWhere } from "../kot";
import { kotDocId, formatKotNo } from "../numbering";
import { paths, postingKey, phone10 } from "../paths";
import { cancelBillDelta, kotDelta, quickDelta, settleDelta, voidDelta } from "../stats";
import type { SettleDeltaInput } from "../stats";
import type { AppliedTender } from "../tenders";
import type {
  BillResult,
  BizDate,
  Buyer,
  DeliveryStage,
  DocType,
  Fy,
  InvoiceLine,
  KotItem,
  Order,
  OrderCustomer,
  OrderDelivery,
  OrderLine,
  OrderMode,
  Paise,
  PayMode,
  Station,
  Supplier,
} from "../types";
import { auditOp, meta, postingOps } from "./common";
import { arrayUnion, inc } from "./types";
import type { PlanCtx, PlanOp, WritePlan } from "./types";

// ─── shared shapes ──────────────────────────────────────────────────────────

/** The part of an order the plans need (a cached order doc + its id). */
export type OrderRef = Pick<Order, "orderNo" | "mode" | "businessDate" | "terminalId" | "kotCount" | "lines" | "status"> &
  Partial<Pick<Order, "tableId" | "tableLabel" | "covers" | "token" | "customer" | "delivery" | "invoiceId" | "invoiceNo" | "bill" | "settledAtMs" | "tipPaise" | "settledBy" | "staffId">> & {
    id: string;
  };

export interface KotAlloc {
  /** Daily KOT sequence numbers allocated for each station group, in diffKot order. */
  numbers: number[];
  terminalCode: string;
}

export interface BuiltKot {
  id: string;
  path: string;
  kotNo: string;
  station: Station;
  items: KotItem[];
}

function where(o: Pick<OrderRef, "mode" | "tableLabel" | "token" | "customer" | "orderNo">) {
  return orderWhere(o.mode, o);
}

function buildKots(ctx: PlanCtx, orderId: string, lines: OrderLine[], alloc: KotAlloc): BuiltKot[] {
  const groups = diffKot(lines);
  if (groups.length > alloc.numbers.length) throw new Error("kotPlan: not enough KOT numbers allocated");
  return groups.map((g, i) => {
    const n = alloc.numbers[i] as number;
    const id = kotDocId(orderId, alloc.terminalCode, n);
    return { id, path: paths.kot(ctx.cid, id), kotNo: formatKotNo(alloc.terminalCode, n), station: g.station, items: g.items };
  });
}

function kotDocOps(ctx: PlanCtx, o: OrderRef, kots: BuiltKot[], kind: "new" | "addon", covers?: number): PlanOp[] {
  return kots.map((k) => ({
    path: k.path,
    op: "set" as const,
    data: {
      ...meta(ctx),
      outletId: "main",
      orderId: o.id,
      orderNo: o.orderNo,
      kotNo: k.kotNo,
      businessDate: o.businessDate,
      terminalId: ctx.terminalId ?? o.terminalId,
      kind,
      mode: o.mode,
      where: where(o),
      station: k.station,
      items: k.items,
      staffId: ctx.actorId,
      status: "new",
      statusAtMs: { new: ctx.nowMs },
      reprints: 0,
      ...(covers ? { covers } : {}),
    },
  }));
}

// ─── open + KOT ─────────────────────────────────────────────────────────────

export interface NewOrderInput {
  id: string;
  orderNo: string;
  mode: OrderMode;
  businessDate: BizDate;
  tableId?: string;
  tableLabel?: string;
  covers?: number;
  token?: number;
  customer?: OrderCustomer;
  delivery?: OrderDelivery;
}

/** A fresh order document (status open, no lines yet). */
export function newOrderDoc(ctx: PlanCtx, o: NewOrderInput): Record<string, unknown> {
  if (!ctx.terminalId) throw new Error("newOrderDoc: terminalId required");
  return {
    ...meta(ctx),
    outletId: "main",
    orderNo: o.orderNo,
    mode: o.mode,
    businessDate: o.businessDate,
    terminalId: ctx.terminalId,
    status: "open",
    lines: {},
    serviceChargeOptIn: false,
    tipPaise: 0,
    billModifiedCount: 0,
    paidPaise: 0,
    payModes: [],
    openedBy: ctx.actorId,
    staffId: ctx.actorId,
    flags: {},
    kotCount: 0,
    rev: 1,
    ...(o.tableId ? { tableId: o.tableId, tableLabel: o.tableLabel } : {}),
    ...(o.covers ? { covers: o.covers } : {}),
    ...(o.token != null ? { token: o.token } : {}),
    ...(o.customer ? { customer: o.customer } : {}),
    ...(o.delivery ? { delivery: o.delivery } : {}),
  };
}

export interface KotPlanInput {
  /** Existing order, or a new one to create in the same batch (first round). */
  order: OrderRef | { create: NewOrderInput };
  /** Draft lines being sent (sentQty is set to qty). */
  lines: OrderLine[];
  alloc: KotAlloc;
  tracked: ReadonlySet<string>;
  /** Items to switch off in the same batch (stockAutoOff and this send empties them). */
  autoOff?: string[];
}

export interface KotPlanResult extends WritePlan {
  kots: BuiltKot[];
  orderId: string;
}

/** Send KOT: persist the round's lines, create one KOT per station, deduct tracked stock. */
export function kotPlan(ctx: PlanCtx, i: KotPlanInput): KotPlanResult {
  if (i.lines.length === 0) throw new Error("kotPlan: nothing to send");
  const creating = "create" in i.order;
  const o: OrderRef = creating
    ? {
        ...(i.order as { create: NewOrderInput }).create,
        terminalId: ctx.terminalId as string,
        kotCount: 0,
        lines: {},
        status: "open",
      }
    : (i.order as OrderRef);
  const kots = buildKots(ctx, o.id, i.lines, i.alloc);
  const kotByLine = new Map<string, string>();
  for (const k of kots) for (const it of k.items) kotByLine.set(it.lineId, k.id);
  const sent = i.lines.map((l) => ({ ...l, sentQty: l.qty, kotId: kotByLine.get(l.lineId) }));
  const kind = o.kotCount > 0 ? "addon" : "new";

  const ops: PlanOp[] = [];
  if (creating) {
    const doc = newOrderDoc(ctx, (i.order as { create: NewOrderInput }).create);
    doc.lines = Object.fromEntries(sent.map((l) => [l.lineId, l]));
    doc.kotCount = kots.length;
    ops.push({ path: paths.order(ctx.cid, o.id), op: "set", data: doc });
  } else {
    const upd: Record<string, unknown> = { kotCount: inc(kots.length), updatedAtMs: ctx.nowMs, rev: inc(1) };
    for (const l of sent) upd[`lines.${l.lineId}`] = l;
    ops.push({ path: paths.order(ctx.cid, o.id), op: "update", data: upd });
  }
  ops.push(...kotDocOps(ctx, o, kots, kind, o.covers));

  const first = kots[0] as BuiltKot;
  const key = postingKey.kot(first.id);
  const delta = kotDelta(
    kots.flatMap((k) => k.items.map((it) => ({ itemId: it.itemId, qty: it.qty }))),
    i.tracked,
  );
  ops.push(...postingOps(ctx, { key, kind: "kot", businessDate: o.businessDate, refId: first.id, stats: delta.stats, stock: delta.stock }));
  for (const itemId of i.autoOff ?? []) ops.push({ path: paths.item(ctx.cid, itemId), op: "update", data: { available: false, updatedAtMs: ctx.nowMs } });

  return { label: `KOT ${kots.map((k) => k.kotNo).join(", ")} · ${where(o)}`, ops, postingKey: key, primaryPath: paths.posting(ctx.cid, key), kots, orderId: o.id };
}

// ─── bill ───────────────────────────────────────────────────────────────────

export interface InvoiceAlloc {
  series: string;
  fy: Fy;
  seq: number;
  invoiceNo: string;
  invoiceId: string;
  dateIST: string;
}

export interface BillPlanInput {
  order: OrderRef;
  bill: BillResult;
  lines: InvoiceLine[];
  invoice: InvoiceAlloc;
  supplier: Supplier;
  buyer?: Buyer;
  docType: DocType;
  serviceChargeOptIn?: boolean;
}

function invoiceDoc(ctx: PlanCtx, o: OrderRef, i: Omit<BillPlanInput, "order">): Record<string, unknown> {
  return {
    ...meta(ctx),
    outletId: "main",
    invoiceNo: i.invoice.invoiceNo,
    series: i.invoice.series,
    fy: i.invoice.fy,
    seq: i.invoice.seq,
    orderId: o.id,
    orderNo: o.orderNo,
    terminalId: ctx.terminalId ?? o.terminalId,
    dateIST: i.invoice.dateIST,
    issuedAtMs: ctx.nowMs,
    businessDate: o.businessDate,
    docType: i.docType,
    mode: o.mode,
    where: where(o),
    ...(i.buyer && (i.buyer.name || i.buyer.gstin) ? { buyer: i.buyer } : {}),
    supplier: i.supplier,
    bill: i.bill,
    lines: i.lines,
    modifiedCount: 0,
    status: "issued",
    printedCount: 1,
    lastPrintedAtMs: ctx.nowMs,
    staffId: ctx.actorId,
  };
}

function terminalSeqOp(ctx: PlanCtx, inv: InvoiceAlloc): PlanOp {
  if (!ctx.terminalId) throw new Error("terminalId required to issue an invoice");
  return { path: paths.terminal(ctx.cid, ctx.terminalId), op: "merge", data: { lastInvoiceSeq: inv.seq, lastInvoiceFy: inv.fy, updatedAtMs: ctx.nowMs } };
}

/** Bill: freeze the bill on the order and issue the invoice number. No stats move here. */
export function billPlan(ctx: PlanCtx, i: BillPlanInput): WritePlan {
  const o = i.order;
  const ops: PlanOp[] = [
    {
      path: paths.order(ctx.cid, o.id),
      op: "update",
      data: {
        status: "billed",
        bill: i.bill,
        invoiceId: i.invoice.invoiceId,
        invoiceNo: i.invoice.invoiceNo,
        billedBy: ctx.actorId,
        serviceChargeOptIn: Boolean(i.serviceChargeOptIn),
        ...(i.buyer && (i.buyer.name || i.buyer.gstin) ? { "customer.name": i.buyer.name ?? null, "customer.gstin": i.buyer.gstin ?? null } : {}),
        updatedAtMs: ctx.nowMs,
        rev: inc(1),
      },
    },
    { path: paths.invoice(ctx.cid, i.invoice.invoiceId), op: "set", data: invoiceDoc(ctx, o, i) },
    terminalSeqOp(ctx, i.invoice),
  ];
  return { label: `Bill ${i.invoice.invoiceNo} · ${where(o)}`, ops, primaryPath: paths.invoice(ctx.cid, i.invoice.invoiceId) };
}

/** Edit bill, step 1 (manager): reopen a billed order for changes. Invoice number is kept. */
export function reopenBillPlan(ctx: PlanCtx, o: OrderRef, approver?: { id: string; name?: string }): WritePlan {
  if (o.status !== "billed") throw new Error("Only a billed order can be reopened");
  return {
    label: `Edit bill ${o.invoiceNo ?? o.orderNo}`,
    ops: [
      { path: paths.order(ctx.cid, o.id), op: "update", data: { status: "open", updatedAtMs: ctx.nowMs, rev: inc(1) } },
      auditOp(ctx, { action: "bill.reopen", target: { type: "order", id: o.id, label: o.orderNo }, ...(approver ? { approver } : {}) }),
    ],
    primaryPath: paths.order(ctx.cid, o.id),
  };
}

/** Edit bill, step 2: re-bill under the same invoice number. */
export function rebillPlan(ctx: PlanCtx, i: { order: OrderRef; bill: BillResult; lines: InvoiceLine[]; before?: BillResult; serviceChargeOptIn?: boolean }): WritePlan {
  const o = i.order;
  if (!o.invoiceId) throw new Error("rebillPlan: order has no invoice");
  return {
    label: `Re-bill ${o.invoiceNo}`,
    ops: [
      {
        path: paths.order(ctx.cid, o.id),
        op: "update",
        data: { status: "billed", bill: i.bill, billModifiedCount: inc(1), serviceChargeOptIn: Boolean(i.serviceChargeOptIn), updatedAtMs: ctx.nowMs, rev: inc(1) },
      },
      { path: paths.invoice(ctx.cid, o.invoiceId), op: "update", data: { bill: i.bill, lines: i.lines, modifiedCount: inc(1), updatedAtMs: ctx.nowMs } },
      auditOp(ctx, {
        action: "bill.edit",
        target: { type: "invoice", id: o.invoiceId, label: o.invoiceNo },
        before: i.before ? { grandTotalPaise: i.before.grandTotalPaise, itemQty: i.before.itemQty } : undefined,
        after: { grandTotalPaise: i.bill.grandTotalPaise, itemQty: i.bill.itemQty },
      }),
    ],
    primaryPath: paths.invoice(ctx.cid, o.invoiceId),
  };
}

// ─── settle ─────────────────────────────────────────────────────────────────

export interface SettlePlanInput {
  order: OrderRef;
  bill: BillResult;
  series: string;
  applied: AppliedTender[];
  tipPaise: Paise;
  /** Customer upsert for delivery/regulars. */
  customer?: OrderCustomer;
}

function paymentOps(ctx: PlanCtx, o: OrderRef, invoiceId: string, applied: AppliedTender[], tipPaise: Paise, kind: "payment" | "refund", prefix = ""): PlanOp[] {
  let tipLeft = tipPaise;
  return applied
    .filter((a) => a.amountPaise > 0)
    .map((a, n) => {
      const tip = kind === "payment" ? Math.min(tipLeft, a.amountPaise) : 0;
      tipLeft -= tip;
      return {
        path: paths.payment(ctx.cid, `${o.id}_${prefix}${n + 1}`),
        op: "set" as const,
        data: {
          ...meta(ctx),
          outletId: "main",
          orderId: o.id,
          invoiceId,
          businessDate: o.businessDate,
          terminalId: ctx.terminalId ?? o.terminalId,
          kind,
          mode: a.mode,
          amountPaise: a.amountPaise,
          ...(a.tenderedPaise != null ? { tenderedPaise: a.tenderedPaise } : {}),
          ...(a.changePaise ? { changePaise: a.changePaise } : {}),
          tipPaise: tip,
          ...(a.ref ? { ref: a.ref } : {}),
          staffId: ctx.actorId,
        },
      };
    });
}

function customerOp(ctx: PlanCtx, c: OrderCustomer | undefined): PlanOp | null {
  const p = phone10(c?.phone);
  if (!p) return null;
  return {
    path: paths.customer(ctx.cid, p),
    op: "merge",
    data: {
      phone: p,
      ...(c?.name ? { name: c.name } : {}),
      ...(c?.address ? { address: c.address } : {}),
      ...(c?.landmark ? { landmark: c.landmark } : {}),
      orders: inc(1),
      lastOrderAtMs: ctx.nowMs,
      updatedAtMs: ctx.nowMs,
    },
  };
}

export function settleInputFor(ctx: PlanCtx, o: OrderRef, bill: BillResult, series: string, applied: Array<Pick<AppliedTender, "mode" | "amountPaise">>, tipPaise: Paise, settledAtMs = ctx.nowMs, staffId = ctx.actorId): SettleDeltaInput {
  return {
    mode: o.mode,
    ...(o.covers ? { covers: o.covers } : {}),
    lines: o.lines,
    bill,
    applied,
    tipPaise,
    series,
    settledAtMs,
    staffId,
    terminalId: ctx.terminalId ?? o.terminalId,
  };
}

/** Settle a billed order: payments + sales recognised (posting settle:{orderId}). */
export function settlePlan(ctx: PlanCtx, i: SettlePlanInput): WritePlan {
  const o = i.order;
  if (!o.invoiceId) throw new Error("settlePlan: order is not billed");
  const payModes = [...new Set(i.applied.filter((a) => a.amountPaise > 0).map((a) => a.mode))] as PayMode[];
  const paid = i.applied.reduce((s, a) => s + a.amountPaise, 0);
  const key = postingKey.settle(o.id);
  const ops: PlanOp[] = [
    {
      path: paths.order(ctx.cid, o.id),
      op: "update",
      data: {
        status: "settled",
        paidPaise: paid,
        payModes,
        tipPaise: i.tipPaise,
        settledBy: ctx.actorId,
        settledAtMs: ctx.nowMs,
        ...(o.delivery?.pay === "cod" ? { "delivery.codSettled": true } : {}),
        updatedAtMs: ctx.nowMs,
        rev: inc(1),
      },
    },
    ...paymentOps(ctx, o, o.invoiceId, i.applied, i.tipPaise, "payment"),
    ...postingOps(ctx, { key, kind: "settle", businessDate: o.businessDate, refId: o.id, stats: settleDelta(settleInputFor(ctx, o, i.bill, i.series, i.applied, i.tipPaise)) }),
  ];
  const c = customerOp(ctx, i.customer ?? o.customer);
  if (c) ops.push(c);
  return { label: `Settle ${o.invoiceNo ?? o.orderNo}`, ops, postingKey: key, primaryPath: paths.posting(ctx.cid, key) };
}

// ─── quick order (one batch) ────────────────────────────────────────────────

export interface QuickPlanInput {
  create: NewOrderInput;
  lines: OrderLine[];
  alloc: KotAlloc;
  bill: BillResult;
  invoiceLines: InvoiceLine[];
  invoice: InvoiceAlloc;
  supplier: Supplier;
  buyer?: Buyer;
  docType: DocType;
  applied: AppliedTender[];
  tipPaise: Paise;
  tracked: ReadonlySet<string>;
  serviceChargeOptIn?: boolean;
  customer?: OrderCustomer;
}

export interface QuickPlanResult extends WritePlan {
  kots: BuiltKot[];
  orderId: string;
}

/** Quick order: order + KOT + invoice + payments + one posting quick:{orderId}, atomically. */
export function quickPlan(ctx: PlanCtx, i: QuickPlanInput): QuickPlanResult {
  const id = i.create.id;
  const kots = buildKots(ctx, id, i.lines, i.alloc);
  const kotByLine = new Map<string, string>();
  for (const k of kots) for (const it of k.items) kotByLine.set(it.lineId, k.id);
  const lines = Object.fromEntries(i.lines.map((l) => [l.lineId, { ...l, sentQty: l.qty, kotId: kotByLine.get(l.lineId) }]));
  const payModes = [...new Set(i.applied.filter((a) => a.amountPaise > 0).map((a) => a.mode))];
  const paid = i.applied.reduce((s, a) => s + a.amountPaise, 0);
  const doc = {
    ...newOrderDoc(ctx, i.create),
    lines,
    kotCount: kots.length,
    status: "settled",
    bill: i.bill,
    invoiceId: i.invoice.invoiceId,
    invoiceNo: i.invoice.invoiceNo,
    billedBy: ctx.actorId,
    settledBy: ctx.actorId,
    settledAtMs: ctx.nowMs,
    paidPaise: paid,
    payModes,
    tipPaise: i.tipPaise,
    serviceChargeOptIn: Boolean(i.serviceChargeOptIn),
  };
  const o: OrderRef = { ...i.create, terminalId: ctx.terminalId as string, kotCount: 0, lines: lines as Record<string, OrderLine>, status: "settled", invoiceId: i.invoice.invoiceId };
  const key = postingKey.quick(id);
  const delta = quickDelta(
    settleInputFor(ctx, o, i.bill, i.invoice.series, i.applied, i.tipPaise),
    kots.flatMap((k) => k.items.map((it) => ({ itemId: it.itemId, qty: it.qty }))),
    i.tracked,
  );
  const ops: PlanOp[] = [
    { path: paths.order(ctx.cid, id), op: "set", data: doc },
    ...kotDocOps(ctx, o, kots, "new", i.create.covers),
    { path: paths.invoice(ctx.cid, i.invoice.invoiceId), op: "set", data: invoiceDoc(ctx, o, { bill: i.bill, lines: i.invoiceLines, invoice: i.invoice, supplier: i.supplier, docType: i.docType, ...(i.buyer ? { buyer: i.buyer } : {}) }) },
    terminalSeqOp(ctx, i.invoice),
    ...paymentOps(ctx, o, i.invoice.invoiceId, i.applied, i.tipPaise, "payment"),
    ...postingOps(ctx, { key, kind: "quick", businessDate: i.create.businessDate, refId: id, stats: delta.stats, stock: delta.stock }),
  ];
  const c = customerOp(ctx, i.customer ?? i.create.customer);
  if (c) ops.push(c);
  return { label: `Quick ${i.invoice.invoiceNo} · ${where(o)}`, ops, postingKey: key, primaryPath: paths.posting(ctx.cid, key), kots, orderId: id };
}

// ─── void a sent line ───────────────────────────────────────────────────────

export interface VoidLineInput {
  order: OrderRef;
  line: OrderLine;
  qty: number;
  reason: string;
  prepared: boolean;
  approver?: { id: string; name?: string };
  alloc: KotAlloc;
  tracked: ReadonlySet<string>;
}

/** Void sent units of a line: cancel KOT to the kitchen, stock back (or wasted), audit. */
export function voidLinePlan(ctx: PlanCtx, i: VoidLineInput): WritePlan & { kot: BuiltKot } {
  const { order: o, line: l } = i;
  if (i.qty <= 0 || i.qty > l.sentQty - l.voidedQty) throw new Error("voidLinePlan: invalid quantity");
  if (o.status !== "open") throw new Error("voidLinePlan: reopen the bill before voiding");
  const n = (l.voids?.length ?? 0) + 1;
  const kotNoN = i.alloc.numbers[0] as number;
  const kotId = kotDocId(o.id, i.alloc.terminalCode, kotNoN);
  const kot: BuiltKot = {
    id: kotId,
    path: paths.kot(ctx.cid, kotId),
    kotNo: formatKotNo(i.alloc.terminalCode, kotNoN),
    station: l.station,
    items: [{ lineId: l.lineId, itemId: l.itemId, name: l.name, qty: i.qty, ...(l.variantName ? { variantName: l.variantName } : {}) }],
  };
  const key = postingKey.lineVoid(o.id, l.lineId, n);
  const delta = voidDelta({
    itemId: l.itemId,
    qty: i.qty,
    amountPaise: l.unitPricePaise * i.qty,
    reason: i.reason,
    prepared: i.prepared,
    staffId: ctx.actorId,
    tracked: i.tracked.has(l.itemId),
  });
  const entry = { qty: i.qty, reason: i.reason, prepared: i.prepared, by: ctx.actorId, atMs: ctx.nowMs, ...(i.approver ? { approvedBy: i.approver.id } : {}) };
  const ops: PlanOp[] = [
    {
      path: paths.order(ctx.cid, o.id),
      op: "update",
      data: {
        [`lines.${l.lineId}.voidedQty`]: l.voidedQty + i.qty,
        [`lines.${l.lineId}.voids`]: arrayUnion(entry),
        updatedAtMs: ctx.nowMs,
        rev: inc(1),
      },
    },
    {
      path: kot.path,
      op: "set",
      data: {
        ...meta(ctx),
        outletId: "main",
        orderId: o.id,
        orderNo: o.orderNo,
        kotNo: kot.kotNo,
        businessDate: o.businessDate,
        terminalId: ctx.terminalId ?? o.terminalId,
        kind: "cancel",
        mode: o.mode,
        where: where(o),
        station: kot.station,
        items: kot.items,
        staffId: ctx.actorId,
        status: "new",
        statusAtMs: { new: ctx.nowMs },
        reprints: 0,
        reason: i.reason,
      },
    },
    ...postingOps(ctx, { key, kind: "line_void", businessDate: o.businessDate, refId: `${o.id}:${l.lineId}`, stats: delta.stats, stock: delta.stock, ...(i.approver ? { approverId: i.approver.id } : {}) }),
    auditOp(ctx, {
      action: "line.void",
      target: { type: "order", id: o.id, label: o.orderNo },
      after: { item: l.name, qty: i.qty, prepared: i.prepared },
      reason: i.reason,
      ...(i.approver ? { approver: i.approver } : {}),
    }),
  ];
  return { label: `Void ${i.qty}× ${l.name} · ${where(o)}`, ops, postingKey: key, primaryPath: paths.posting(ctx.cid, key), kot };
}

// ─── cancel bill / order ────────────────────────────────────────────────────

export interface CancelPlanInput {
  order: OrderRef;
  reason: string;
  note?: string;
  prepared: boolean;
  approver?: { id: string; name?: string };
  tracked: ReadonlySet<string>;
  /** For a settled order: the original tenders to refund (same modes). */
  refunds?: AppliedTender[];
  series?: string;
}

/**
 * Cancel a bill or an unbilled order within the open day. Settled → sales reversed and refunds
 * recorded; billed → invoice cancelled; open → items returned/wasted. Credit notes are later scope.
 */
export function cancelOrderPlan(ctx: PlanCtx, i: CancelPlanInput): WritePlan {
  const o = i.order;
  if (o.status === "cancelled") throw new Error("Order is already cancelled");
  const settled = o.status === "settled";
  const items = Object.values(o.lines)
    .map((l) => ({ itemId: l.itemId, qty: Math.max(0, l.sentQty - l.voidedQty) }))
    .filter((x) => x.qty > 0);
  const key = postingKey.cancelBill(o.id);
  const series = i.series ?? "";
  const bill = o.bill;
  const refunds = settled ? (i.refunds ?? []) : [];
  const delta = bill
    ? cancelBillDelta({
        settled,
        ...(settled
          ? { settle: settleInputFor(ctx, o, bill, series, refunds, o.tipPaise ?? 0, o.settledAtMs ?? ctx.nowMs, o.settledBy ?? ctx.actorId) }
          : {}),
        bill,
        series,
        refunds,
        cancellingTerminalId: ctx.terminalId ?? o.terminalId,
        items,
        tracked: i.tracked,
        prepared: i.prepared,
      })
    : cancelBillDelta({
        settled: false,
        bill: { grandTotalPaise: 0 } as BillResult,
        series: "",
        refunds: [],
        cancellingTerminalId: ctx.terminalId ?? o.terminalId,
        items,
        tracked: i.tracked,
        prepared: i.prepared,
      });
  if (!bill) {
    delete delta.stats.cancelledBills;
    delete delta.stats.invoices;
  }
  if (!series && delta.stats.invoices) delete delta.stats.invoices;
  const cancel = { reason: i.reason, by: ctx.actorId, prepared: i.prepared, atMs: ctx.nowMs, ...(i.note ? { note: i.note } : {}), ...(i.approver ? { approvedBy: i.approver.id } : {}) };
  const ops: PlanOp[] = [{ path: paths.order(ctx.cid, o.id), op: "update", data: { status: "cancelled", cancel, updatedAtMs: ctx.nowMs, rev: inc(1) } }];
  if (o.invoiceId) {
    ops.push({
      path: paths.invoice(ctx.cid, o.invoiceId),
      op: "update",
      data: { status: "cancelled", cancel: { reason: i.reason, by: ctx.actorId, atMs: ctx.nowMs, ...(i.approver ? { approvedBy: i.approver.id } : {}) }, updatedAtMs: ctx.nowMs },
    });
  }
  if (settled && o.invoiceId) ops.push(...paymentOps(ctx, o, o.invoiceId, refunds, 0, "refund", "r"));
  ops.push(...postingOps(ctx, { key, kind: "cancel_bill", businessDate: o.businessDate, refId: o.id, stats: delta.stats, stock: delta.stock, ...(i.approver ? { approverId: i.approver.id } : {}) }));
  ops.push(
    auditOp(ctx, {
      action: settled || o.invoiceId ? "bill.cancel" : "order.cancel",
      target: { type: "order", id: o.id, label: o.invoiceNo ?? o.orderNo },
      after: { status: "cancelled", total: bill?.grandTotalPaise ?? 0, prepared: i.prepared },
      reason: i.reason,
      ...(i.approver ? { approver: i.approver } : {}),
    }),
  );
  return { label: `Cancel ${o.invoiceNo ?? o.orderNo}`, ops, postingKey: key, primaryPath: paths.posting(ctx.cid, key) };
}

// ─── table moves, delivery ──────────────────────────────────────────────────

export function transferPlan(ctx: PlanCtx, o: OrderRef, to: { tableId: string; tableLabel: string }): WritePlan {
  return {
    label: `Move ${o.tableLabel ?? o.orderNo} → ${to.tableLabel}`,
    ops: [
      { path: paths.order(ctx.cid, o.id), op: "update", data: { tableId: to.tableId, tableLabel: to.tableLabel, "flags.conflict": false, updatedAtMs: ctx.nowMs, rev: inc(1) } },
      auditOp(ctx, { action: "table.transfer", target: { type: "order", id: o.id, label: o.orderNo }, before: { table: o.tableLabel }, after: { table: to.tableLabel } }),
    ],
    primaryPath: paths.order(ctx.cid, o.id),
  };
}

/** Merge `source` into `target` (neither billed): lines move, source is cancelled as "merged". */
export function mergePlan(ctx: PlanCtx, source: OrderRef, target: OrderRef): WritePlan {
  if (source.status !== "open" || target.status !== "open") throw new Error("Only open (unbilled) orders can be merged");
  const maxSeq = Math.max(0, ...Object.values(target.lines).map((l) => l.seq));
  const upd: Record<string, unknown> = {
    kotCount: inc(source.kotCount),
    updatedAtMs: ctx.nowMs,
    rev: inc(1),
    "flags.conflict": false,
  };
  if (source.covers) upd.covers = inc(source.covers);
  Object.values(source.lines)
    .sort((a, b) => a.seq - b.seq)
    .forEach((l, idx) => {
      upd[`lines.${l.lineId}`] = { ...l, seq: maxSeq + idx + 1 };
    });
  return {
    label: `Merge ${source.tableLabel ?? source.orderNo} → ${target.tableLabel ?? target.orderNo}`,
    ops: [
      { path: paths.order(ctx.cid, target.id), op: "update", data: upd },
      {
        path: paths.order(ctx.cid, source.id),
        op: "update",
        data: { status: "cancelled", cancel: { reason: "merged", note: target.orderNo, by: ctx.actorId, prepared: true, atMs: ctx.nowMs }, "flags.conflict": false, updatedAtMs: ctx.nowMs, rev: inc(1) },
      },
      auditOp(ctx, { action: "order.merge", target: { type: "order", id: target.id, label: target.orderNo }, before: { from: source.orderNo, table: source.tableLabel } }),
    ],
    primaryPath: paths.order(ctx.cid, source.id),
  };
}

export function flagConflictPlan(ctx: PlanCtx, orderIds: string[]): WritePlan {
  return {
    label: "Flag table conflict",
    ops: orderIds.map((id) => ({ path: paths.order(ctx.cid, id), op: "update" as const, data: { "flags.conflict": true, updatedAtMs: ctx.nowMs } })),
    primaryPath: paths.order(ctx.cid, orderIds[0] ?? ""),
  };
}

export function deliveryStagePlan(ctx: PlanCtx, o: OrderRef, stage: DeliveryStage, rider?: string): WritePlan {
  return {
    label: `Delivery ${o.orderNo} → ${stage}`,
    ops: [
      {
        path: paths.order(ctx.cid, o.id),
        op: "update",
        data: { "delivery.stage": stage, [`delivery.stageAtMs.${stage}`]: ctx.nowMs, ...(rider ? { "delivery.rider": rider } : {}), updatedAtMs: ctx.nowMs },
      },
    ],
    primaryPath: paths.order(ctx.cid, o.id),
  };
}

export function kotStatusPlan(ctx: PlanCtx, kotId: string, status: "new" | "preparing" | "ready" | "served"): WritePlan {
  return {
    label: `KOT → ${status}`,
    ops: [{ path: paths.kot(ctx.cid, kotId), op: "update", data: { status, [`statusAtMs.${status}`]: ctx.nowMs, updatedAtMs: ctx.nowMs } }],
    primaryPath: paths.kot(ctx.cid, kotId),
  };
}

export function reprintPlan(ctx: PlanCtx, target: { kind: "invoice"; id: string; label: string } | { kind: "kot"; id: string; label: string }, approver?: { id: string; name?: string }): WritePlan {
  const path = target.kind === "invoice" ? paths.invoice(ctx.cid, target.id) : paths.kot(ctx.cid, target.id);
  const data = target.kind === "invoice" ? { printedCount: inc(1), lastPrintedAtMs: ctx.nowMs, updatedAtMs: ctx.nowMs } : { reprints: inc(1), updatedAtMs: ctx.nowMs };
  return {
    label: `Reprint ${target.label}`,
    ops: [{ path, op: "update", data }, auditOp(ctx, { action: `${target.kind}.reprint`, target: { type: target.kind, id: target.id, label: target.label }, ...(approver ? { approver } : {}) })],
    primaryPath: path,
  };
}

/** Order-line snapshot for invoices (names frozen at issue). */
export function invoiceLinesFor(lines: OrderLine[], bill: BillResult): InvoiceLine[] {
  const byId = new Map(bill.lines.map((b) => [b.lineId, b]));
  return lines
    .filter((l) => (byId.get(l.lineId)?.qty ?? 0) > 0)
    .sort((a, b) => a.seq - b.seq)
    .map((l) => {
      const b = byId.get(l.lineId);
      return {
        lineId: l.lineId,
        name: l.name,
        ...(l.variantName ? { variantName: l.variantName } : {}),
        qty: b?.qty ?? 0,
        unitPricePaise: l.unitPricePaise,
        amountPaise: b?.grossPaise ?? 0,
        taxBps: b?.taxBps ?? 0,
        ...(b?.comp ? { comp: true } : {}),
      };
    });
}

import {
  billForLines,
  billPlan,
  diffKot,
  formatInvoiceNo,
  formatOrderNo,
  fyFor,
  invoiceDocId,
  invoiceLinesFor,
  istDate,
  kotPlan,
  quickPlan,
  settlePlan,
  settleTenders,
  type AppliedTender,
  type BillResult,
  type BizDate,
  type Client,
  type Discount,
  type Order,
  type OrderCustomer,
  type OrderLine,
  type OrderMode,
  type Paise,
  type Staff,
  type Supplier,
  type Terminal,
  type TenderInput,
} from "@px-pos/core";
import type { WithId } from "@/hooks/use-live";
import { allocateAndJournal, counterKey, deleteDraft, type JournalRow } from "@/local/db";
import { submit } from "@/local/sync";
import { newId, planCtx } from "./context";

/** An order being built on the terminal. Unsent lines live here (and in SQLite drafts). */
export interface Ticket {
  id: string;
  /** Firestore order id once the order exists (dine-in after the first KOT). */
  orderId: string | null;
  mode: OrderMode;
  tableId?: string;
  tableLabel?: string;
  covers?: number;
  customer?: OrderCustomer;
  deliveryPay?: "cod" | "prepaid";
  lines: OrderLine[];
  billDiscount?: Discount;
  serviceChargeOptIn: boolean;
  createdAtMs: number;
  /** Outlet it was started in (a re-paired device must not resume another outlet's tickets). */
  cid?: string;
  /** Parked at the counter while the customer decides (local to this terminal). */
  held?: { atMs: number; label?: string };
}

export function newTicket(mode: OrderMode, extra: Partial<Ticket> = {}): Ticket {
  return { id: newId(), orderId: null, mode, lines: [], serviceChargeOptIn: false, createdAtMs: Date.now(), ...extra };
}

export interface ActionDeps {
  session: { cid: string; tid: string; client: WithId<Client>; terminal: WithId<Terminal> };
  operator: WithId<Staff>;
  bizDate: BizDate;
  tracked: ReadonlySet<string>;
}

export function supplierOf(c: Client): Supplier {
  return { legalName: c.legalName, ...(c.gstin ? { gstin: c.gstin } : {}), fssai: c.fssai, address: c.address, stateName: c.stateName, stateCode: c.stateCode, ...(c.phone ? { phone: c.phone } : {}) };
}

/** Bill for any set of lines under the client's current settings. */
export function billFor(c: Client, mode: OrderMode, lines: OrderLine[], opts: { billDiscount?: Discount; serviceChargeOptIn?: boolean } = {}): BillResult {
  return billForLines(c, mode, lines, opts);
}

function invoiceAlloc(series: string, seq: number, nowMs: number) {
  const fy = fyFor(nowMs);
  return { series, fy, seq, invoiceNo: formatInvoiceNo(series, fy, seq), invoiceId: invoiceDocId(series, fy, seq), dateIST: istDate(nowMs) };
}

export interface KotResult {
  orderId: string;
  orderNo: string;
  kots: { id: string; kotNo: string; station: string; items: { name: string; variantName?: string; qty: number; note?: string; itemId: string; lineId: string }[] }[];
}

/**
 * Send the ticket's unsent lines to the kitchen. The first round creates the order
 * (dine-in / delivery / quick without pay-first). Idempotent per set of lines.
 */
export function sendKot(d: ActionDeps, t: Ticket, existing: WithId<Order> | null): JournalRow<KotResult> {
  const groups = diffKot(t.lines);
  if (!groups.length) throw new Error("Nothing new to send");
  const code = d.session.terminal.code;
  const actionKey = `kot:${t.id}:${t.lines.map((l) => l.lineId).sort().join(",")}`;
  const needsOrder = !existing;
  const { row } = allocateAndJournal<KotResult>(
    actionKey,
    [{ key: counterKey.kot(d.session.tid, d.bizDate), count: groups.length }, ...(needsOrder ? [{ key: counterKey.order(d.session.tid, d.bizDate), count: 1 }, ...(t.mode === "quick" ? [{ key: counterKey.token(d.session.tid, d.bizDate), count: 1 }] : [])] : [])],
    (nums) => {
      const ctx = planCtx(d.session, d.operator);
      const kotNums = nums[0] ?? [];
      const orderNo = needsOrder ? formatOrderNo(code, nums[1]![0]!) : existing.orderNo;
      const token = needsOrder && t.mode === "quick" ? nums[2]![0]! : undefined;
      const orderId = existing?.id ?? t.id;
      const plan = kotPlan(ctx, {
        order: existing
          ? { ...existing, id: existing.id }
          : {
              create: {
                id: orderId,
                orderNo,
                mode: t.mode,
                businessDate: d.bizDate,
                ...(t.tableId ? { tableId: t.tableId, tableLabel: t.tableLabel } : {}),
                ...(t.covers ? { covers: t.covers } : {}),
                ...(token != null ? { token } : {}),
                ...(t.customer ? { customer: t.customer } : {}),
                ...(t.mode === "delivery" ? { delivery: { stage: "placed" as const, pay: t.deliveryPay ?? "cod", codSettled: false } } : {}),
              },
            },
        lines: t.lines,
        alloc: { numbers: kotNums, terminalCode: code },
        tracked: d.tracked,
      });
      return { plan, result: { orderId, orderNo, kots: plan.kots.map((k) => ({ id: k.id, kotNo: k.kotNo, station: k.station, items: k.items })) } };
    },
  );
  submit(row);
  deleteDraft(t.id);
  return row;
}

export interface BillResultInfo {
  invoiceNo: string;
  invoiceId: string;
  bill: BillResult;
}

/** Freeze the bill and issue this terminal's next invoice number. */
export function billOrder(d: ActionDeps, order: WithId<Order>, opts: { billDiscount?: Discount; serviceChargeOptIn?: boolean; buyer?: { name?: string; gstin?: string } } = {}): JournalRow<BillResultInfo> {
  const series = d.session.terminal.series;
  const now = Date.now();
  const fy = fyFor(now);
  const lines = Object.values(order.lines);
  const { row } = allocateAndJournal<BillResultInfo>(`bill:${order.id}`, [{ key: counterKey.invoice(d.session.tid, series, fy), count: 1 }], (nums) => {
    const inv = invoiceAlloc(series, nums[0]![0]!, now);
    const bill = billFor(d.session.client, order.mode, lines, opts);
    const plan = billPlan(planCtx(d.session, d.operator), {
      order,
      bill,
      lines: invoiceLinesFor(lines, bill),
      invoice: inv,
      supplier: supplierOf(d.session.client),
      docType: bill.docType,
      ...(opts.buyer ? { buyer: opts.buyer } : {}),
      serviceChargeOptIn: Boolean(opts.serviceChargeOptIn),
    });
    return { plan, result: { invoiceNo: inv.invoiceNo, invoiceId: inv.invoiceId, bill } };
  });
  submit(row);
  return row;
}

export interface SettleInfo {
  applied: AppliedTender[];
  changePaise: Paise;
}

/** Take payment for a billed order. */
export function settleOrder(d: ActionDeps, order: WithId<Order>, tenders: TenderInput[], tipPaise: Paise): JournalRow<SettleInfo> {
  if (!order.bill || !order.invoiceId) throw new Error("Bill the order first");
  const res = settleTenders(order.bill.grandTotalPaise, tipPaise, tenders);
  if (!res.ok) throw new Error(res.error === "SHORT" ? "Payment is short" : "Card/UPI can't be more than the bill");
  const { row } = allocateAndJournal<SettleInfo>(`settle:${order.id}`, [], () => {
    const plan = settlePlan(planCtx(d.session, d.operator), { order, bill: order.bill!, series: d.session.terminal.series, applied: res.applied, tipPaise, ...(order.customer ? { customer: order.customer } : {}) });
    return { plan, result: { applied: res.applied, changePaise: res.changePaise } };
  });
  submit(row);
  deleteDraft(order.id);
  return row;
}

export interface QuickResult extends KotResult, BillResultInfo, SettleInfo {
  token: number;
}

/** Quick order: order + KOT + invoice + payment in one batch (one posting). */
export function quickCheckout(d: ActionDeps, t: Ticket, tenders: TenderInput[], tipPaise: Paise): JournalRow<QuickResult> {
  const groups = diffKot(t.lines);
  if (!t.lines.length) throw new Error("The ticket is empty");
  const bill = billFor(d.session.client, t.mode, t.lines, { ...(t.billDiscount ? { billDiscount: t.billDiscount } : {}), serviceChargeOptIn: t.serviceChargeOptIn });
  const res = settleTenders(bill.grandTotalPaise, tipPaise, tenders);
  if (!res.ok) throw new Error(res.error === "SHORT" ? "Payment is short" : "Card/UPI can't be more than the bill");
  const code = d.session.terminal.code;
  const series = d.session.terminal.series;
  const now = Date.now();
  const fy = fyFor(now);
  const { row } = allocateAndJournal<QuickResult>(
    `quick:${t.id}`,
    [
      { key: counterKey.order(d.session.tid, d.bizDate), count: 1 },
      { key: counterKey.token(d.session.tid, d.bizDate), count: 1 },
      { key: counterKey.kot(d.session.tid, d.bizDate), count: Math.max(1, groups.length) },
      { key: counterKey.invoice(d.session.tid, series, fy), count: 1 },
    ],
    (nums) => {
      const orderNo = formatOrderNo(code, nums[0]![0]!);
      const token = nums[1]![0]!;
      const inv = invoiceAlloc(series, nums[3]![0]!, now);
      const plan = quickPlan(planCtx(d.session, d.operator), {
        create: { id: t.id, orderNo, mode: t.mode, businessDate: d.bizDate, token, ...(t.customer ? { customer: t.customer } : {}) },
        lines: t.lines,
        alloc: { numbers: nums[2]!, terminalCode: code },
        bill,
        invoiceLines: invoiceLinesFor(t.lines, bill),
        invoice: inv,
        supplier: supplierOf(d.session.client),
        docType: bill.docType,
        applied: res.applied,
        tipPaise,
        tracked: d.tracked,
        serviceChargeOptIn: t.serviceChargeOptIn,
      });
      return {
        plan,
        result: { orderId: t.id, orderNo, token, kots: plan.kots.map((k) => ({ id: k.id, kotNo: k.kotNo, station: k.station, items: k.items })), invoiceNo: inv.invoiceNo, invoiceId: inv.invoiceId, bill, applied: res.applied, changePaise: res.changePaise },
      };
    },
  );
  submit(row);
  deleteDraft(t.id);
  return row;
}

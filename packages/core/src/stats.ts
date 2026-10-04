import { hourKey } from "./time";
import type { AppliedTender } from "./tenders";
import type {
  BillResult,
  CashMoveKind,
  CashStats,
  DailyStats,
  Drawer,
  Expense,
  NP,
  OrderLine,
  OrderMode,
  Paise,
  PayMode,
  StatsDelta,
  ZReport,
} from "./types";

// ─── tree helpers ───────────────────────────────────────────────────────────

const isTree = (v: unknown): v is StatsDelta => typeof v === "object" && v !== null && !Array.isArray(v);

/** Deep-add `src` into `target` (mutates and returns target). */
export function addInto(target: StatsDelta, src: StatsDelta): StatsDelta {
  for (const [k, v] of Object.entries(src)) {
    if (v === undefined) continue;
    if (typeof v === "number") {
      const cur = target[k];
      target[k] = (typeof cur === "number" ? cur : 0) + v;
    } else if (isTree(v)) {
      const cur = target[k];
      target[k] = addInto(isTree(cur) ? cur : {}, v);
    }
  }
  return target;
}

export function sumDeltas(deltas: StatsDelta[]): StatsDelta {
  return deltas.reduce<StatsDelta>((acc, d) => addInto(acc, d), {});
}

export function negate(d: StatsDelta): StatsDelta {
  const out: StatsDelta = {};
  for (const [k, v] of Object.entries(d)) {
    if (typeof v === "number") out[k] = v === 0 ? 0 : -v;
    else if (isTree(v)) out[k] = negate(v);
  }
  return out;
}

/** Remove zero leaves and empty branches. */
export function prune(d: StatsDelta): StatsDelta {
  const out: StatsDelta = {};
  for (const [k, v] of Object.entries(d)) {
    if (typeof v === "number") {
      if (v !== 0) out[k] = v;
    } else if (isTree(v)) {
      const p = prune(v);
      if (Object.keys(p).length) out[k] = p;
    }
  }
  return out;
}

/** Numeric leaves that differ between two trees (missing counts as 0). */
export function diffStats(a: StatsDelta, b: StatsDelta, prefix = ""): Array<{ path: string; a: number; b: number }> {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const out: Array<{ path: string; a: number; b: number }> = [];
  for (const k of [...keys].sort()) {
    const va = a[k];
    const vb = b[k];
    const path = prefix ? `${prefix}.${k}` : k;
    if (isTree(va) || isTree(vb)) {
      out.push(...diffStats(isTree(va) ? va : {}, isTree(vb) ? vb : {}, path));
    } else {
      const na = typeof va === "number" ? va : 0;
      const nb = typeof vb === "number" ? vb : 0;
      if (na !== nb) out.push({ path, a: na, b: nb });
    }
  }
  return out;
}

/** Pick only the numeric aggregate fields of a stored DailyStats doc (drops bookkeeping keys). */
export function statsTree(doc: Partial<DailyStats> | Record<string, unknown> | undefined | null): StatsDelta {
  if (!doc) return {};
  const out: StatsDelta = {};
  for (const [k, v] of Object.entries(doc)) {
    if (k === "businessDate" || k === "lastPostingKey" || k === "cid" || k === "updatedAtMs") continue;
    if (typeof v === "number") out[k] = v;
    else if (isTree(v)) out[k] = statsTree(v as Record<string, unknown>);
  }
  return out;
}

// ─── delta builders ─────────────────────────────────────────────────────────

export interface StockDeltaResult {
  stats: StatsDelta;
  /** onHand delta per tracked item. */
  stock: Record<string, number>;
}

/** Stock sold at KOT time (tracked items only). */
export function kotDelta(items: Array<{ itemId: string; qty: number }>, tracked: ReadonlySet<string>): StockDeltaResult {
  const stats: StatsDelta = {};
  const stock: Record<string, number> = {};
  for (const it of items) {
    if (!tracked.has(it.itemId) || it.qty <= 0) continue;
    addInto(stats, { stock: { [it.itemId]: { sold: it.qty } } });
    stock[it.itemId] = (stock[it.itemId] ?? 0) - it.qty;
  }
  return { stats: prune(stats), stock };
}

export interface SettleDeltaInput {
  mode: OrderMode;
  covers?: number;
  /** Order lines keyed by lineId (for itemId/categoryId lookups). */
  lines: Record<string, Pick<OrderLine, "itemId" | "categoryId">>;
  bill: BillResult;
  applied: Array<Pick<AppliedTender, "mode" | "amountPaise">>;
  tipPaise: Paise;
  series: string;
  settledAtMs: number;
  staffId: string;
  terminalId: string;
}

/** Sales recognised at settlement. */
export function settleDelta(i: SettleDeltaInput): StatsDelta {
  const b = i.bill;
  const d: StatsDelta = {
    orders: 1,
    covers: i.covers ?? 0,
    itemQty: b.itemQty,
    grossPaise: b.grossPaise,
    itemDiscPaise: b.itemDiscPaise,
    billDiscPaise: b.billDiscPaise,
    compPaise: b.compPaise,
    taxablePaise: b.taxablePaise,
    chargesPaise: b.chargesPaise,
    cgstPaise: b.cgstPaise,
    sgstPaise: b.sgstPaise,
    roundOffPaise: b.roundOffPaise,
    totalPaise: b.grandTotalPaise,
    tipsPaise: i.tipPaise,
    byMode: { [i.mode]: { n: 1, paise: b.grandTotalPaise } },
    byHour: { [hourKey(i.settledAtMs)]: { n: 1, paise: b.grandTotalPaise } },
    invoices: { [i.series]: { count: 1 } },
  };
  for (const t of b.taxes) addInto(d, { byTaxBps: { [String(t.bps)]: { taxable: t.taxablePaise, cgst: t.cgstPaise, sgst: t.sgstPaise } } });
  let itemsNet = 0;
  for (const l of b.lines) {
    const src = i.lines[l.lineId];
    if (!src || l.qty <= 0) continue;
    itemsNet += l.taxablePaise;
    addInto(d, {
      byItem: { [src.itemId]: { qty: l.qty, net: l.taxablePaise } },
      byCat: { [src.categoryId]: { qty: l.qty, net: l.taxablePaise } },
    });
  }
  addInto(d, { byStaff: { [i.staffId]: { n: 1, net: itemsNet, disc: b.itemDiscPaise + b.billDiscPaise } } });
  let cash = 0;
  for (const a of i.applied) {
    if (a.amountPaise <= 0) continue;
    addInto(d, { byPay: { [a.mode]: a.amountPaise } });
    if (a.mode === "cash") cash += a.amountPaise;
  }
  if (cash) addInto(d, { cash: { [i.terminalId]: { sales: cash } } });
  return prune(d);
}

/** Quick order: KOT stock movement and settlement in one posting. */
export function quickDelta(settle: SettleDeltaInput, kotItems: Array<{ itemId: string; qty: number }>, tracked: ReadonlySet<string>): StockDeltaResult {
  const k = kotDelta(kotItems, tracked);
  return { stats: prune(addInto(settleDelta(settle), k.stats)), stock: k.stock };
}

export interface VoidDeltaInput {
  itemId: string;
  qty: number;
  amountPaise: Paise;
  reason: string;
  prepared: boolean;
  staffId: string;
  tracked: boolean;
}

/** A whole ticket voided before anything was sent or paid: counted as voids, no sales, no stock. */
export function ticketVoidDelta(v: { qty: number; amountPaise: Paise; reason: string; staffId: string }): StatsDelta {
  return {
    voidItems: { n: v.qty, paise: v.amountPaise },
    voidByReason: { [v.reason]: { n: v.qty, paise: v.amountPaise } },
    byStaff: { [v.staffId]: { voids: v.qty } },
  };
}

/** Void of sent units: informational counters + stock returned (not prepared) or wasted (prepared). */
export function voidDelta(v: VoidDeltaInput): StockDeltaResult {
  const stats: StatsDelta = {
    voidItems: { n: v.qty, paise: v.amountPaise },
    voidByReason: { [v.reason]: { n: v.qty, paise: v.amountPaise } },
    byStaff: { [v.staffId]: { voids: v.qty } },
  };
  const stock: Record<string, number> = {};
  if (v.tracked && v.qty > 0) {
    addInto(stats, { stock: { [v.itemId]: v.prepared ? { waste: v.qty } : { rev: v.qty } } });
    if (!v.prepared) stock[v.itemId] = v.qty;
  }
  return { stats: prune(stats), stock };
}

export interface CancelBillDeltaInput {
  settled: boolean;
  /** The original settlement (required when settled). */
  settle?: SettleDeltaInput;
  bill: BillResult;
  series: string;
  refunds: Array<{ mode: PayMode; amountPaise: Paise }>;
  cancellingTerminalId: string;
  /** Active qty per item on the order, for stock return/waste. */
  items: Array<{ itemId: string; qty: number }>;
  tracked: ReadonlySet<string>;
  prepared: boolean;
}

/**
 * Cancelling a bill (same open day). Sales are reversed; collected money stays in byPay /
 * cash.sales of the original terminal and the refund is recorded separately, so drawer
 * math stays true for both terminals.
 */
export function cancelBillDelta(c: CancelBillDeltaInput): StockDeltaResult {
  const stats: StatsDelta = {
    cancelledBills: { n: 1, paise: c.bill.grandTotalPaise },
    invoices: { [c.series]: { cancelled: 1 } },
  };
  if (c.settled && c.settle) {
    const reversal = negate(settleDelta(c.settle));
    delete reversal.byPay;
    delete reversal.cash;
    if (isTree(reversal.invoices)) delete reversal.invoices;
    addInto(stats, reversal);
    for (const r of c.refunds) {
      if (r.amountPaise <= 0) continue;
      addInto(stats, { refundsByPay: { [r.mode]: r.amountPaise } });
      if (r.mode === "cash") addInto(stats, { cash: { [c.cancellingTerminalId]: { refunds: r.amountPaise } } });
    }
  }
  const stock: Record<string, number> = {};
  for (const it of c.items) {
    if (!c.tracked.has(it.itemId) || it.qty <= 0) continue;
    addInto(stats, { stock: { [it.itemId]: c.prepared ? { waste: it.qty } : { rev: it.qty } } });
    if (!c.prepared) stock[it.itemId] = (stock[it.itemId] ?? 0) + it.qty;
  }
  return { stats: prune(stats), stock };
}

export function expenseDelta(e: Pick<Expense, "amountPaise" | "category" | "paidVia" | "drawerTerminalId">): StatsDelta {
  const d: StatsDelta = { expensesPaise: e.amountPaise, expByCat: { [e.category]: e.amountPaise } };
  if (e.paidVia === "drawer" && e.drawerTerminalId) addInto(d, { cash: { [e.drawerTerminalId]: { paidOut: e.amountPaise } } });
  return prune(d);
}

export function expenseVoidDelta(e: Pick<Expense, "amountPaise" | "category" | "paidVia" | "drawerTerminalId">): StatsDelta {
  return negate(expenseDelta(e));
}

export function cashMoveDelta(kind: CashMoveKind, amountPaise: Paise, terminalId: string): StatsDelta {
  if (kind === "paid_in") return prune({ cash: { [terminalId]: { paidIn: amountPaise } } });
  if (kind === "drop") return prune({ cash: { [terminalId]: { drops: amountPaise } } });
  return {};
}

export type StockMoveKind = "in" | "waste" | "adjust";

/** Manual stock movement. `qty` is positive for in/waste; signed for adjust. */
export function stockMoveDelta(kind: StockMoveKind, itemId: string, qty: number): StockDeltaResult {
  if (kind === "in") return { stats: { stock: { [itemId]: { in: qty } } }, stock: { [itemId]: qty } };
  if (kind === "waste") return { stats: { stock: { [itemId]: { waste: qty } } }, stock: { [itemId]: -qty } };
  return { stats: prune({ stock: { [itemId]: { adj: qty } } }), stock: qty ? { [itemId]: qty } : {} };
}

// ─── reading stored stats ───────────────────────────────────────────────────

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

export function np(v: unknown): NP {
  const o = (v ?? {}) as Partial<NP>;
  return { n: num(o.n), paise: num(o.paise) };
}

export function cashStats(v: unknown): CashStats {
  const o = (v ?? {}) as Partial<CashStats>;
  return { sales: num(o.sales), refunds: num(o.refunds), paidIn: num(o.paidIn), paidOut: num(o.paidOut), drops: num(o.drops) };
}

/** Net sales (items' taxable value after discounts, excl. tax and charges). */
export function netSales(s: Partial<DailyStats> | undefined): Paise {
  return num(s?.taxablePaise) - num(s?.chargesPaise);
}

/** Money actually collected (by pay mode, net of refunds). */
export function collected(s: Partial<DailyStats> | undefined): Paise {
  const pay = Object.values(s?.byPay ?? {}).reduce((a, v) => a + num(v), 0);
  const ref = Object.values(s?.refundsByPay ?? {}).reduce((a, v) => a + num(v), 0);
  return pay - ref;
}

/** Sum a list of stored dailyStats docs into one tree (range reports). */
export function mergeStats(docs: Array<Partial<DailyStats> | undefined>): StatsDelta {
  return sumDeltas(docs.map((d) => statsTree(d)));
}

export function compare(cur: number, prev: number): { delta: number; pct: number | null } {
  return { delta: cur - prev, pct: prev === 0 ? null : ((cur - prev) / Math.abs(prev)) * 100 };
}

// ─── Z report ───────────────────────────────────────────────────────────────

export interface ZInput {
  zNo: number;
  businessDate: string;
  closedAtMs: number;
  stats: Partial<DailyStats>;
  drawers: Array<Pick<Drawer, "terminalId" | "openingFloatPaise" | "countedPaise">>;
  invoiceRanges: ZReport["invoiceRanges"];
}

export function expectedCashFor(floatPaise: Paise, c: CashStats): Paise {
  return floatPaise + c.sales - c.refunds + c.paidIn - c.paidOut - c.drops;
}

export function zReport(z: ZInput): ZReport {
  const s = z.stats;
  const disc = num(s.itemDiscPaise) + num(s.billDiscPaise);
  const byPay: Record<string, Paise> = {};
  for (const [k, v] of Object.entries(s.byPay ?? {})) byPay[k] = num(v);
  const refundsByPay: Record<string, Paise> = {};
  for (const [k, v] of Object.entries(s.refundsByPay ?? {})) refundsByPay[k] = num(v);
  const byMode: Record<string, NP> = {};
  for (const [k, v] of Object.entries(s.byMode ?? {})) byMode[k] = np(v);
  const byTaxBps: ZReport["byTaxBps"] = {};
  for (const [k, v] of Object.entries(s.byTaxBps ?? {})) {
    const o = (v ?? {}) as { taxable?: number; cgst?: number; sgst?: number };
    byTaxBps[k] = { taxable: num(o.taxable), cgst: num(o.cgst), sgst: num(o.sgst) };
  }
  return {
    zNo: z.zNo,
    businessDate: z.businessDate,
    closedAtMs: z.closedAtMs,
    orders: num(s.orders),
    covers: num(s.covers),
    grossPaise: num(s.grossPaise),
    discountsPaise: disc,
    compPaise: num(s.compPaise),
    netPaise: netSales(s),
    chargesPaise: num(s.chargesPaise),
    cgstPaise: num(s.cgstPaise),
    sgstPaise: num(s.sgstPaise),
    roundOffPaise: num(s.roundOffPaise),
    totalPaise: num(s.totalPaise),
    tipsPaise: num(s.tipsPaise),
    byPay,
    refundsByPay,
    byMode,
    byTaxBps,
    cancelledBills: np(s.cancelledBills),
    voidItems: np(s.voidItems),
    expensesPaise: num(s.expensesPaise),
    drawers: z.drawers.map((d) => {
      const cash = cashStats((s.cash ?? {})[d.terminalId]);
      const expected = expectedCashFor(d.openingFloatPaise, cash);
      return {
        terminalId: d.terminalId,
        floatPaise: d.openingFloatPaise,
        cash,
        expectedPaise: expected,
        ...(d.countedPaise != null ? { countedPaise: d.countedPaise, variancePaise: d.countedPaise - expected } : {}),
      };
    }),
    invoiceRanges: z.invoiceRanges,
  };
}

/** A zero-filled DailyStats for display before any sale. */
export function emptyStats(businessDate: string): DailyStats {
  return {
    businessDate,
    lastPostingKey: "",
    orders: 0,
    covers: 0,
    itemQty: 0,
    grossPaise: 0,
    itemDiscPaise: 0,
    billDiscPaise: 0,
    compPaise: 0,
    taxablePaise: 0,
    chargesPaise: 0,
    cgstPaise: 0,
    sgstPaise: 0,
    roundOffPaise: 0,
    totalPaise: 0,
    tipsPaise: 0,
    cancelledBills: { n: 0, paise: 0 },
    voidItems: { n: 0, paise: 0 },
    voidByReason: {},
    expensesPaise: 0,
    expByCat: {},
    byMode: {},
    byPay: {},
    refundsByPay: {},
    byTaxBps: {},
    byItem: {},
    byCat: {},
    byHour: {},
    byStaff: {},
    cash: {},
    stock: {},
    invoices: {},
  };
}

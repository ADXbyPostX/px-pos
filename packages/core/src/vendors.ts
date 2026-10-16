import { mulDivRound } from "./money";
import { daysBetween } from "./time";
import type { BizDate, Bps, MaterialUnit, Paise, Purchase, PurchaseLine, Vendor, VendorPayMode, VendorPayment } from "./types";

/**
 * Vendors: what an outlet buys and owes. Bills create dues, payments settle the OLDEST dues
 * first. Which bills are paid is never stored — it's worked out from the vendor's running
 * totals (purchased − paid), so voids, late entries and two tills paying offline can't leave
 * a bill marked wrongly.
 */

export const MATERIAL_UNIT_LABEL: Record<MaterialUnit, string> = {
  kg: "kg",
  g: "g",
  L: "L",
  ml: "ml",
  pcs: "pcs",
  pkt: "packet",
  box: "box",
  dozen: "dozen",
  tray: "tray",
  bottle: "bottle",
  can: "can",
  cylinder: "cylinder",
};

export const VENDOR_PAY_LABEL: Record<VendorPayMode, string> = {
  drawer: "Cash from till",
  cash: "Cash (not from till)",
  upi: "UPI",
  bank: "Bank transfer",
  cheque: "Cheque",
  other: "Other",
};

/** Reasons offered when voiding a purchase or a payment. */
export const VENDOR_VOID_REASONS = ["Entered twice", "Wrong amount", "Wrong vendor", "Goods returned", "Other"] as const;

// ─── quantities and GST ─────────────────────────────────────────────────────

const MAX_QTY_MILLI = 1_000_000_000;

/** "1.5" → 1500 (thousandths). Null for empty, zero, negative, more than 3 decimals or junk. */
export function parseQty(input: string): number | null {
  const s = input.trim();
  const m = /^(\d*)(?:\.(\d{0,3}))?$/.exec(s);
  if (!m || (!m[1] && !m[2])) return null;
  const whole = Number(m[1] || "0");
  const frac = Number((m[2] ?? "").padEnd(3, "0") || "0");
  const milli = whole * 1000 + frac;
  if (!Number.isSafeInteger(milli) || milli <= 0 || milli > MAX_QTY_MILLI) return null;
  return milli;
}

/** 1500 → "1.5", 2000 → "2", 1 → "0.001". */
export function formatQty(qtyMilli: number): string {
  const whole = Math.trunc(qtyMilli / 1000);
  const frac = Math.abs(qtyMilli % 1000);
  if (!frac) return String(whole);
  return `${whole}.${String(frac).padStart(3, "0").replace(/0+$/, "")}`;
}

/** GST inside an amount that includes it (same split as computeBill: CGST = SGST, rounded). */
export function gstInclusiveSplit(amountPaise: Paise, bps: Bps): { taxablePaise: Paise; gstPaise: Paise } {
  if (!bps) return { taxablePaise: amountPaise, gstPaise: 0 };
  const half = mulDivRound(amountPaise, bps, 2 * (10000 + bps));
  return { taxablePaise: amountPaise - 2 * half, gstPaise: 2 * half };
}

/** A bill printed "+ GST": the amount owed including it. */
export function withGst(exclusivePaise: Paise, bps: Bps): Paise {
  return exclusivePaise + 2 * mulDivRound(exclusivePaise, bps, 20000);
}

/** Price per whole unit (₹ per kg/L/piece) from an amount and a quantity in thousandths. */
export function unitRatePaise(amountPaise: Paise, qtyMilli: number): Paise {
  return mulDivRound(amountPaise, 1000, qtyMilli);
}

/** Amount for a quantity at a per-unit rate. */
export function amountForRate(ratePaise: Paise, qtyMilli: number): Paise {
  return mulDivRound(ratePaise, qtyMilli, 1000);
}

export type PurchaseLineInput = Omit<PurchaseLine, "gstPaise">;

export function purchaseTotals(lines: PurchaseLineInput[], adjustPaise: Paise = 0): { lines: PurchaseLine[]; subtotalPaise: Paise; adjustPaise: Paise; totalPaise: Paise; gstPaise: Paise } {
  const out = lines.map((l) => ({ ...l, gstPaise: gstInclusiveSplit(l.amountPaise, l.taxBps).gstPaise }));
  const subtotalPaise = out.reduce((s, l) => s + l.amountPaise, 0);
  return {
    lines: out,
    subtotalPaise,
    adjustPaise,
    totalPaise: subtotalPaise + adjustPaise,
    gstPaise: out.reduce((s, l) => s + l.gstPaise, 0),
  };
}

/** "Milk 20 L, Curd 2 kg +1". */
export function purchaseSummary(p: Pick<Purchase, "kind" | "lines">, max = 2): string {
  if (p.kind === "opening") return "Opening balance";
  const parts = p.lines.slice(0, max).map((l) => `${l.name} ${formatQty(l.qtyMilli)} ${MATERIAL_UNIT_LABEL[l.unit] ?? l.unit}`);
  const more = p.lines.length - max;
  return more > 0 ? `${parts.join(", ")} +${more}` : parts.join(", ");
}

// ─── oldest-first settlement (derived) ──────────────────────────────────────

/** What settlement needs from a bill. */
export type FifoBill = Pick<Purchase, "kind" | "billDate" | "createdAtMs" | "totalPaise"> & { id: string; billNo?: string; status?: Purchase["status"] };

/** Oldest first: bill date, an opening balance before that day's bills, entry time, id. Plain `<` (never localeCompare). */
export function fifoCompare(a: FifoBill, b: FifoBill): number {
  if (a.billDate !== b.billDate) return a.billDate < b.billDate ? -1 : 1;
  if (a.kind !== b.kind) return a.kind === "opening" ? -1 : 1;
  if (a.createdAtMs !== b.createdAtMs) return a.createdAtMs < b.createdAtMs ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

const n0 = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** What the outlet owes the vendor (negative = an advance the vendor holds). */
export function vendorBalance(v: Pick<Vendor, "purchasedPaise" | "paidPaise"> | undefined | null): Paise {
  return n0(v?.purchasedPaise) - n0(v?.paidPaise);
}

export type BillState = "due" | "part" | "paid";

export interface BillStatus<B extends FifoBill = FifoBill> {
  bill: B;
  /** Still owed on this bill. */
  duePaise: Paise;
  paidPaise: Paise;
  state: BillState;
}

export interface VendorPosition<B extends FifoBill = FifoBill> {
  balancePaise: Paise;
  /** Owed in total (0 when the vendor holds an advance). */
  duePaise: Paise;
  advancePaise: Paise;
  /** Active bills only, newest first. */
  bills: Array<BillStatus<B>>;
  /** Dues older than the bills given (load more history to see them); 0 = fully explained. */
  uncoveredPaise: Paise;
  /** The oldest bill still owed — null when nothing is owed or older dues aren't loaded. */
  oldestDue: BillStatus<B> | null;
}

/**
 * Which bills are paid, part-paid or due. Paying oldest-first means what's still owed is always
 * the NEWEST bills worth the balance: walk the bills newest → oldest handing out the balance;
 * the bill where it runs out is part-paid and everything older is paid. Equal to allocating the
 * total paid oldest-first, whatever order payments came in. Give it every active bill newer than
 * the oldest one you show (a contiguous newest-first window).
 */
export function vendorPosition<B extends FifoBill>(bills: B[], balancePaise: Paise): VendorPosition<B> {
  const active = bills.filter((b) => b.status !== "void").sort((a, b) => fifoCompare(b, a));
  let left = Math.max(balancePaise, 0);
  const out: Array<BillStatus<B>> = active.map((bill) => {
    const due = Math.min(bill.totalPaise, left);
    left -= due;
    return { bill, duePaise: due, paidPaise: bill.totalPaise - due, state: due === bill.totalPaise ? "due" : due > 0 ? "part" : "paid" };
  });
  let oldestDue: BillStatus<B> | null = null;
  if (left === 0) for (const s of out) if (s.duePaise > 0) oldestDue = s;
  return {
    balancePaise,
    duePaise: Math.max(balancePaise, 0),
    advancePaise: Math.max(-balancePaise, 0),
    bills: out,
    uncoveredPaise: left,
    oldestDue,
  };
}

export interface PaymentClear {
  id: string;
  billNo?: string;
  billDate: BizDate;
  kind: Purchase["kind"];
  totalPaise: Paise;
  dueBeforePaise: Paise;
  dueAfterPaise: Paise;
  cleared: boolean;
}

export interface PaymentPreview {
  /** Bills this payment touches, oldest first. */
  clears: PaymentClear[];
  /** Part of it that goes to older dues not among the bills given. */
  olderPaise: Paise;
  /** More than is owed: kept by the vendor as an advance. */
  advancePaise: Paise;
  balanceAfterPaise: Paise;
}

/** What a payment of `amountPaise` would clear right now (oldest dues first). */
export function paymentPreview(bills: FifoBill[], balancePaise: Paise, amountPaise: Paise): PaymentPreview {
  const before = vendorPosition(bills, balancePaise);
  const after = vendorPosition(bills, balancePaise - amountPaise);
  const dueAfter = new Map(after.bills.map((s) => [s.bill.id, s.duePaise]));
  const clears: PaymentClear[] = [];
  for (const s of [...before.bills].reverse()) {
    const d = dueAfter.get(s.bill.id) ?? 0;
    if (s.duePaise > d) {
      clears.push({
        id: s.bill.id,
        ...(s.bill.billNo ? { billNo: s.bill.billNo } : {}),
        billDate: s.bill.billDate,
        kind: s.bill.kind,
        totalPaise: s.bill.totalPaise,
        dueBeforePaise: s.duePaise,
        dueAfterPaise: d,
        cleared: d === 0,
      });
    }
  }
  return {
    clears,
    olderPaise: before.uncoveredPaise - after.uncoveredPaise,
    advancePaise: Math.max(0, amountPaise - Math.max(balancePaise, 0)),
    balanceAfterPaise: balancePaise - amountPaise,
  };
}

/** Quick amounts for the pay screen: everything, the oldest bill, and up to each due bill (oldest first). */
export function payChips(pos: VendorPosition): Array<{ label: "all" | "oldest" | "upTo"; billDate?: BizDate; amountPaise: Paise }> {
  if (pos.duePaise <= 0) return [];
  const due = pos.bills.filter((s) => s.duePaise > 0).reverse();
  const out: Array<{ label: "all" | "oldest" | "upTo"; billDate?: BizDate; amountPaise: Paise }> = [{ label: "all", amountPaise: pos.duePaise }];
  if (pos.uncoveredPaise > 0 || due.length < 2) return out;
  out.push({ label: "oldest", billDate: due[0]!.bill.billDate, amountPaise: due[0]!.duePaise });
  let run = 0;
  for (const s of due.slice(0, -1)) {
    run += s.duePaise;
    if (run > due[0]!.duePaise) out.push({ label: "upTo", billDate: s.bill.billDate, amountPaise: run });
  }
  return out.slice(0, 4);
}

type PaymentLike = Pick<VendorPayment, "kind" | "businessDate" | "createdAtMs" | "amountPaise" | "status"> & { id: string };

/**
 * Which bills one past payment cleared, replaying every active payment (entry order) against
 * the bills oldest-first. A snapshot: a bill entered later with an older date, or a voided
 * earlier payment, shifts it — the bills' statuses (vendorPosition) are what stays true.
 */
export function clearedBy(bills: FifoBill[], payments: PaymentLike[], paymentId: string): { clears: Array<{ id: string; billNo?: string; billDate: BizDate; kind: Purchase["kind"]; totalPaise: Paise; appliedPaise: Paise; cleared: boolean }>; advancePaise: Paise } {
  const queue = bills.filter((b) => b.status !== "void").sort(fifoCompare).map((b) => ({ b, left: b.totalPaise }));
  const pays = payments.filter((p) => p.status !== "void").sort((a, b) => a.createdAtMs - b.createdAtMs || (a.id < b.id ? -1 : 1));
  let qi = 0;
  for (const p of pays) {
    let amt = p.amountPaise;
    const clears: Array<{ id: string; billNo?: string; billDate: BizDate; kind: Purchase["kind"]; totalPaise: Paise; appliedPaise: Paise; cleared: boolean }> = [];
    while (amt > 0 && qi < queue.length) {
      const q = queue[qi]!;
      const take = Math.min(amt, q.left);
      q.left -= take;
      amt -= take;
      clears.push({ id: q.b.id, ...(q.b.billNo ? { billNo: q.b.billNo } : {}), billDate: q.b.billDate, kind: q.b.kind, totalPaise: q.b.totalPaise, appliedPaise: take, cleared: q.left === 0 });
      if (q.left === 0) qi++;
    }
    if (p.id === paymentId) return { clears, advancePaise: amt };
  }
  return { clears: [], advancePaise: 0 };
}

// ─── statement ──────────────────────────────────────────────────────────────

export type LedgerKind = "bill" | "opening" | "payment" | "advance";

export interface LedgerRow {
  kind: LedgerKind;
  id: string;
  date: BizDate;
  createdAtMs: number;
  billNo?: string;
  /** Added to what's owed (bills). */
  billPaise: Paise;
  /** Taken off what's owed (payments). */
  paidPaise: Paise;
  /** Running balance after this row (void rows don't move it). */
  balancePaise: Paise;
  void: boolean;
  mode?: VendorPayMode;
  ref?: string;
}

export interface VendorLedger {
  /** Balance before the first row (non-zero when only a window of history was given). */
  broughtForwardPaise: Paise;
  rows: LedgerRow[];
  purchasedPaise: Paise;
  paidPaise: Paise;
  closingPaise: Paise;
}

type LedgerPurchase = Pick<Purchase, "kind" | "billDate" | "createdAtMs" | "totalPaise" | "status" | "billNo"> & { id: string };
type LedgerPayment = Pick<VendorPayment, "kind" | "businessDate" | "createdAtMs" | "amountPaise" | "status" | "mode" | "ref"> & { id: string };

/**
 * A vendor's statement, oldest first (by date, then entry time; a bill before a payment on the
 * same moment). Pass the vendor's live balance as `closingPaise` when only recent history is
 * loaded: the brought-forward line then makes the last row equal the balance.
 */
export function vendorLedger(purchases: LedgerPurchase[], payments: LedgerPayment[], opts: { closingPaise?: Paise } = {}): VendorLedger {
  type Raw = Omit<LedgerRow, "balancePaise">;
  const raw: Raw[] = [
    ...purchases.map((p): Raw => ({
      kind: p.kind === "opening" ? "opening" : "bill",
      id: p.id,
      date: p.billDate,
      createdAtMs: p.createdAtMs,
      ...(p.billNo ? { billNo: p.billNo } : {}),
      billPaise: p.totalPaise,
      paidPaise: 0,
      void: p.status === "void",
    })),
    ...payments.map((p): Raw => ({
      kind: p.kind === "opening" ? "advance" : "payment",
      id: p.id,
      date: p.businessDate,
      createdAtMs: p.createdAtMs,
      billPaise: 0,
      paidPaise: p.amountPaise,
      void: p.status === "void",
      mode: p.mode,
      ...(p.ref ? { ref: p.ref } : {}),
    })),
  ];
  const isBill = (r: Raw) => r.kind === "bill" || r.kind === "opening";
  // Opening balances lead their day; then entry order; a bill before a payment made the same moment.
  const rank = (r: Raw) => (r.kind === "opening" || r.kind === "advance" ? 0 : 1);
  raw.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    if (a.createdAtMs !== b.createdAtMs) return a.createdAtMs - b.createdAtMs;
    if (isBill(a) !== isBill(b)) return isBill(a) ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  const purchasedPaise = raw.filter((r) => !r.void).reduce((s, r) => s + r.billPaise, 0);
  const paidPaise = raw.filter((r) => !r.void).reduce((s, r) => s + r.paidPaise, 0);
  const broughtForwardPaise = opts.closingPaise != null ? opts.closingPaise - (purchasedPaise - paidPaise) : 0;
  let bal = broughtForwardPaise;
  const rows = raw.map((r) => {
    if (!r.void) bal += r.billPaise - r.paidPaise;
    return { ...r, balancePaise: bal };
  });
  return { broughtForwardPaise, rows, purchasedPaise, paidPaise, closingPaise: bal };
}

/** Σ active bills and payments (to check a vendor's stored totals). */
export function vendorTotals(purchases: Array<Pick<Purchase, "totalPaise" | "status">>, payments: Array<Pick<VendorPayment, "amountPaise" | "status">>): { purchasedPaise: Paise; paidPaise: Paise } {
  return {
    purchasedPaise: purchases.filter((p) => p.status !== "void").reduce((s, p) => s + p.totalPaise, 0),
    paidPaise: payments.filter((p) => p.status !== "void").reduce((s, p) => s + p.amountPaise, 0),
  };
}

/** Stored totals that don't match the documents (full history only). Empty = consistent. */
export function vendorDrift(v: Pick<Vendor, "purchasedPaise" | "paidPaise">, purchases: Array<Pick<Purchase, "totalPaise" | "status">>, payments: Array<Pick<VendorPayment, "amountPaise" | "status">>): Array<{ field: "purchasedPaise" | "paidPaise"; stored: Paise; actual: Paise }> {
  const t = vendorTotals(purchases, payments);
  const out: Array<{ field: "purchasedPaise" | "paidPaise"; stored: Paise; actual: Paise }> = [];
  if (n0(v.purchasedPaise) !== t.purchasedPaise) out.push({ field: "purchasedPaise", stored: n0(v.purchasedPaise), actual: t.purchasedPaise });
  if (n0(v.paidPaise) !== t.paidPaise) out.push({ field: "paidPaise", stored: n0(v.paidPaise), actual: t.paidPaise });
  return out;
}

// ─── overview ───────────────────────────────────────────────────────────────

export interface VendorRow {
  id: string;
  name: string;
  active: boolean;
  creditDays: number;
  balancePaise: Paise;
  duePaise: Paise;
  advancePaise: Paise;
  /** Bills still owed (loaded window). */
  dueBills: number;
  oldestDueDate?: BizDate;
  /** Age of the oldest due bill in days. */
  dueDays?: number;
  overdue: boolean;
  /** Owed on bills older than the loaded window. */
  uncoveredPaise: Paise;
  lastPurchaseAtMs?: number;
}

export interface VendorOverview {
  vendors: number;
  active: number;
  /** Vendors still owed something. */
  pending: number;
  overdue: number;
  duePaise: Paise;
  advancePaise: Paise;
  /** Most owed first, then by name. Inactive vendors only while their balance isn't zero. */
  rows: VendorRow[];
}

/**
 * Everyone's dues from their totals and a recent window of bills (newest bills are what's owed,
 * so a window ending today is enough). Overdue = the oldest due bill is older than the vendor's
 * credit days, or it's older than the window itself.
 */
export function vendorOverview(vendors: Array<Pick<Vendor, "name" | "active" | "creditDays" | "purchasedPaise" | "paidPaise" | "lastPurchaseAtMs"> & { id: string }>, recentPurchases: Array<FifoBill & { vendorId: string }>, today: BizDate): VendorOverview {
  const byVendor = new Map<string, Array<FifoBill & { vendorId: string }>>();
  for (const p of recentPurchases) {
    const list = byVendor.get(p.vendorId);
    if (list) list.push(p);
    else byVendor.set(p.vendorId, [p]);
  }
  const rows: VendorRow[] = [];
  for (const v of vendors) {
    const balance = vendorBalance(v);
    if (!v.active && balance === 0) continue;
    const pos = vendorPosition(byVendor.get(v.id) ?? [], balance);
    const oldest = pos.oldestDue;
    const dueDays = oldest ? Math.max(0, daysBetween(oldest.bill.billDate, today)) : undefined;
    rows.push({
      id: v.id,
      name: v.name,
      active: v.active,
      creditDays: n0(v.creditDays),
      balancePaise: balance,
      duePaise: pos.duePaise,
      advancePaise: pos.advancePaise,
      dueBills: pos.bills.filter((s) => s.duePaise > 0).length,
      ...(oldest ? { oldestDueDate: oldest.bill.billDate } : {}),
      ...(dueDays != null ? { dueDays } : {}),
      overdue: pos.duePaise > 0 && (pos.uncoveredPaise > 0 || (dueDays ?? 0) > n0(v.creditDays)),
      uncoveredPaise: pos.uncoveredPaise,
      ...(v.lastPurchaseAtMs ? { lastPurchaseAtMs: v.lastPurchaseAtMs } : {}),
    });
  }
  rows.sort((a, b) => b.duePaise - a.duePaise || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return {
    vendors: vendors.length,
    active: vendors.filter((v) => v.active).length,
    pending: rows.filter((r) => r.duePaise > 0).length,
    overdue: rows.filter((r) => r.overdue).length,
    duePaise: rows.reduce((s, r) => s + r.duePaise, 0),
    advancePaise: rows.reduce((s, r) => s + r.advancePaise, 0),
    rows,
  };
}

// ─── price history ──────────────────────────────────────────────────────────

export interface PricePoint {
  purchaseId: string;
  billDate: BizDate;
  vendorId: string;
  vendorName: string;
  qtyMilli: number;
  unit: MaterialUnit;
  amountPaise: Paise;
  /** Per whole unit. */
  ratePaise: Paise;
}

/** Every time a material was bought (active bills), newest first. */
export function priceHistory(purchases: Array<Pick<Purchase, "billDate" | "createdAtMs" | "vendorId" | "vendorName" | "lines" | "status"> & { id: string }>, materialId: string): PricePoint[] {
  const out: Array<PricePoint & { at: number }> = [];
  for (const p of purchases) {
    if (p.status === "void") continue;
    for (const l of p.lines) {
      if (l.materialId !== materialId || l.qtyMilli <= 0) continue;
      out.push({ purchaseId: p.id, billDate: p.billDate, vendorId: p.vendorId, vendorName: p.vendorName, qtyMilli: l.qtyMilli, unit: l.unit, amountPaise: l.amountPaise, ratePaise: unitRatePaise(l.amountPaise, l.qtyMilli), at: p.createdAtMs });
    }
  }
  out.sort((a, b) => (a.billDate !== b.billDate ? (a.billDate < b.billDate ? 1 : -1) : b.at - a.at));
  return out.map(({ at: _at, ...p }) => p);
}

/** The latest rate paid for each material (newest active bill first), to prefill a new bill. */
export function lastRates(purchases: Array<Pick<Purchase, "billDate" | "createdAtMs" | "vendorId" | "vendorName" | "lines" | "status"> & { id: string }>): Map<string, PricePoint> {
  const out = new Map<string, PricePoint & { at: number }>();
  for (const p of purchases) {
    if (p.status === "void") continue;
    for (const l of p.lines) {
      if (!l.materialId || l.qtyMilli <= 0) continue;
      const cur = out.get(l.materialId);
      if (cur && (cur.billDate > p.billDate || (cur.billDate === p.billDate && cur.at >= p.createdAtMs))) continue;
      out.set(l.materialId, { purchaseId: p.id, billDate: p.billDate, vendorId: p.vendorId, vendorName: p.vendorName, qtyMilli: l.qtyMilli, unit: l.unit, amountPaise: l.amountPaise, ratePaise: unitRatePaise(l.amountPaise, l.qtyMilli), at: p.createdAtMs });
    }
  }
  return new Map([...out].map(([k, { at: _at, ...v }]) => [k, v]));
}

/** A sensible unit for a new material from its name ("Milk" → L, "Sugar" → kg). */
export function guessUnit(name: string): MaterialUnit {
  const n = name.toLowerCase();
  if (/\b(milk|curd|oil|ghee|water|juice|syrup|cream|buttermilk|vinegar)\b/.test(n)) return "L";
  if (/\b(gas|lpg|cylinder)\b/.test(n)) return "cylinder";
  if (/\b(eggs?)\b/.test(n)) return "tray";
  if (/\b(bread|buns?|biscuits?|rusks?|cookies|chips|packets?|noodles|maggi)\b/.test(n)) return "pkt";
  if (/\b(sugar|rice|flour|atta|maida|dal|tea|coffee|powder|salt|onions?|tomato(es)?|potato(es)?|vegetables?|paneer|chicken|mutton|fish|besan|rava|sooji|spices?|masala)\b/.test(n)) return "kg";
  return "pcs";
}

import { allocate, divRound, mulDivRound, roundToRupee } from "./money";
import type {
  BillChargeResult,
  BillLineResult,
  BillResult,
  Bps,
  ChargeKind,
  Charges,
  Discount,
  OrderLine,
  OrderMode,
  Paise,
  PriceMode,
  Rounding,
  TaxBucket,
  TaxMode,
} from "./types";

export interface BillLineInput {
  lineId: string;
  unitPricePaise: Paise;
  qty: number;
  voidedQty: number;
  /** null → client default rate. */
  taxBps: Bps | null;
  discount?: Discount;
}

export interface BillClientInput {
  taxMode: TaxMode;
  priceMode: PriceMode;
  rounding: Rounding;
  defaultTaxBps: Bps;
}

export interface BillInput {
  lines: BillLineInput[];
  billDiscount?: Discount;
  serviceChargeOptIn: boolean;
  charges: Charges;
  mode: OrderMode;
  client: BillClientInput;
}

/** Discount amount for a base, clamped to [0, base]. pct = basis points, flat = paise. */
export function discountAmount(base: Paise, d: Discount | undefined): Paise {
  if (!d || base <= 0) return 0;
  const raw = d.kind === "pct" ? mulDivRound(base, Math.min(Math.max(d.value, 0), 10000), 10000) : Math.max(0, Math.round(d.value));
  return Math.min(raw, base);
}

interface TaxEntry {
  key: string;
  amount: Paise;
  bps: Bps;
  inclusive: boolean;
}

/**
 * Compute a bill. All money is integer paise; the result is internally consistent:
 *   grandTotal = taxable + cgst + sgst + roundOff
 * Rules:
 *  - item discount first, then the bill discount is allocated across line nets (largest remainder);
 *  - charges (packaging on configured modes, delivery on delivery orders, service charge only when opted in)
 *    are taxable pseudo-lines at the client's default rate;
 *  - exclusive pricing adds CGST = SGST = round(taxable × rate / 2) per rate bucket;
 *  - inclusive pricing backs the taxable value out of each rate bucket; the ±paise residual goes to round-off;
 *  - composition / unregistered → no tax, Bill of Supply;
 *  - rounding "rupee" rounds the grand total half-up to the nearest rupee; the tip is never part of the bill.
 */
export function computeBill(input: BillInput): BillResult {
  const { client, charges, mode } = input;
  const regular = client.taxMode === "regular";
  const inclusive = client.priceMode === "inclusive";
  const rateFor = (bps: Bps | null) => (regular ? (bps ?? client.defaultTaxBps) : 0);

  // 1. Line gross and item discounts.
  const staged = input.lines.map((l) => {
    const qty = Math.max(0, l.qty - l.voidedQty);
    const gross = l.unitPricePaise * qty;
    const itemDisc = discountAmount(gross, l.discount);
    return { l, qty, gross, itemDisc, net1: gross - itemDisc, comp: Boolean(l.discount?.comp) };
  });

  // 2. Bill discount allocated across line nets.
  const sumNet1 = staged.reduce((s, x) => s + x.net1, 0);
  const billDiscTotal = discountAmount(sumNet1, input.billDiscount);
  const billShares = allocate(billDiscTotal, staged.map((x) => x.net1));

  const lines = staged.map((x, i) => {
    const billDisc = billShares[i] ?? 0;
    return { ...x, billDisc, net2: x.net1 - billDisc, bps: rateFor(x.l.taxBps) };
  });

  // 3. Item taxable values (needed as the service-charge base).
  const entries: TaxEntry[] = lines.map((x) => ({ key: `line:${x.l.lineId}`, amount: x.net2, bps: x.bps, inclusive }));
  const itemTaxable = taxableOf(entries);

  // 4. Charges — only on a bill with something billable (an empty or fully voided ticket is ₹0).
  const chargeRate = rateFor(null);
  const chargeEntries: Array<TaxEntry & { kind: ChargeKind }> = [];
  const billable = staged.some((x) => x.qty > 0);
  if (billable && charges.packagingPaise > 0 && charges.packagingOn.includes(mode)) {
    chargeEntries.push({ key: "charge:packaging", kind: "packaging", amount: charges.packagingPaise, bps: chargeRate, inclusive });
  }
  if (billable && mode === "delivery" && charges.deliveryPaise > 0) {
    chargeEntries.push({ key: "charge:delivery", kind: "delivery", amount: charges.deliveryPaise, bps: chargeRate, inclusive });
  }
  if (input.serviceChargeOptIn && charges.serviceChargeBps > 0) {
    const base = [...itemTaxable.values()].reduce((s, v) => s + v, 0);
    const sc = mulDivRound(base, charges.serviceChargeBps, 10000);
    // Service charge is computed on the pre-tax value, so it is always an exclusive amount.
    if (sc > 0) chargeEntries.push({ key: "charge:service", kind: "service", amount: sc, bps: chargeRate, inclusive: false });
  }

  // 5. Tax per (rate, inclusive) bucket over all entries.
  const all: TaxEntry[] = [...entries, ...chargeEntries];
  const taxableByKey = taxableOf(all);
  const buckets = new Map<string, { bps: Bps; inclusive: boolean; amount: Paise; taxable: Paise }>();
  for (const e of all) {
    const k = `${e.bps}|${e.inclusive ? "i" : "e"}`;
    const b = buckets.get(k) ?? { bps: e.bps, inclusive: e.inclusive, amount: 0, taxable: 0 };
    b.amount += e.amount;
    b.taxable += taxableByKey.get(e.key) ?? 0;
    buckets.set(k, b);
  }
  const taxesByRate = new Map<Bps, TaxBucket>();
  let residual = 0;
  for (const b of buckets.values()) {
    const half = b.bps > 0 ? mulDivRound(b.taxable, b.bps, 20000) : 0;
    if (b.inclusive) residual += b.amount - (b.taxable + 2 * half);
    const t = taxesByRate.get(b.bps) ?? { bps: b.bps, taxablePaise: 0, cgstPaise: 0, sgstPaise: 0 };
    t.taxablePaise += b.taxable;
    t.cgstPaise += half;
    t.sgstPaise += half;
    taxesByRate.set(b.bps, t);
  }
  const taxes = [...taxesByRate.values()].sort((a, b) => a.bps - b.bps);

  // 6. Totals and round-off.
  const taxable = taxes.reduce((s, t) => s + t.taxablePaise, 0);
  const cgst = taxes.reduce((s, t) => s + t.cgstPaise, 0);
  const sgst = taxes.reduce((s, t) => s + t.sgstPaise, 0);
  const pre = taxable + cgst + sgst + residual;
  const grand = client.rounding === "rupee" ? roundToRupee(pre) : pre;
  const roundOff = grand - (taxable + cgst + sgst);

  const lineResults: BillLineResult[] = lines.map((x) => ({
    lineId: x.l.lineId,
    qty: x.qty,
    grossPaise: x.gross,
    itemDiscPaise: x.itemDisc,
    billDiscPaise: x.billDisc,
    taxablePaise: taxableByKey.get(`line:${x.l.lineId}`) ?? 0,
    taxBps: x.bps,
    comp: x.comp,
  }));
  const chargeResults: BillChargeResult[] = chargeEntries.map((c) => ({
    kind: c.kind,
    amountPaise: c.amount,
    taxablePaise: taxableByKey.get(c.key) ?? 0,
    taxBps: c.bps,
  }));

  const itemDisc = lines.reduce((s, x) => s + x.itemDisc, 0);
  const compPaise =
    lines.reduce((s, x) => s + (x.comp ? x.itemDisc : 0), 0) + (input.billDiscount?.comp ? billDiscTotal : 0);

  const result: BillResult = {
    lines: lineResults,
    charges: chargeResults,
    taxes,
    itemQty: lines.reduce((s, x) => s + x.qty, 0),
    grossPaise: lines.reduce((s, x) => s + x.gross, 0),
    itemDiscPaise: itemDisc,
    billDiscPaise: billDiscTotal,
    compPaise,
    chargesPaise: chargeResults.reduce((s, c) => s + c.taxablePaise, 0),
    taxablePaise: taxable,
    cgstPaise: cgst,
    sgstPaise: sgst,
    roundOffPaise: roundOff,
    grandTotalPaise: grand,
    docType: regular ? "tax_invoice" : "bill_of_supply",
    priceMode: client.priceMode,
  };
  assertBill(result);
  return result;
}

/**
 * Taxable value per entry key. Exclusive entries are their own amount; inclusive
 * entries back the tax out per rate bucket, then allocate the bucket's taxable
 * value across its entries so the parts sum exactly.
 */
function taxableOf(entries: TaxEntry[]): Map<string, Paise> {
  const out = new Map<string, Paise>();
  const inclusiveGroups = new Map<Bps, TaxEntry[]>();
  for (const e of entries) {
    if (!e.inclusive || e.bps === 0) out.set(e.key, e.amount);
    else inclusiveGroups.set(e.bps, [...(inclusiveGroups.get(e.bps) ?? []), e]);
  }
  for (const [bps, group] of inclusiveGroups) {
    const bucket = group.reduce((s, e) => s + e.amount, 0);
    const taxable = mulDivRound(bucket, 10000, 10000 + bps);
    const parts = allocate(taxable, group.map((e) => e.amount));
    group.forEach((e, i) => out.set(e.key, parts[i] ?? 0));
  }
  return out;
}

function assertBill(b: BillResult) {
  const nums = [b.grossPaise, b.itemDiscPaise, b.billDiscPaise, b.taxablePaise, b.cgstPaise, b.sgstPaise, b.roundOffPaise, b.grandTotalPaise];
  if (!nums.every(Number.isSafeInteger)) throw new Error("computeBill: non-integer money");
  if (b.grandTotalPaise !== b.taxablePaise + b.cgstPaise + b.sgstPaise + b.roundOffPaise) {
    throw new Error("computeBill: totals do not reconcile");
  }
  for (const v of [b.grossPaise, b.itemDiscPaise, b.billDiscPaise, b.taxablePaise, b.cgstPaise, b.sgstPaise, b.grandTotalPaise]) {
    if (v < 0) throw new Error("computeBill: negative amount");
  }
}

/** Effective tax label for a bucket: "CGST 2.5%". */
export function halfRateLabel(bps: Bps): string {
  const half = bps / 2 / 100;
  return `${Number.isInteger(half) ? half : half.toFixed(2).replace(/0+$/, "")}%`;
}

/** Rate label: 500 → "5%", 1800 → "18%", 250 → "2.5%". */
export function rateLabel(bps: Bps): string {
  const pct = bps / 100;
  return `${Number.isInteger(pct) ? pct : pct.toFixed(2).replace(/0+$/, "")}%`;
}

/** Discount value label: pct 1000 → "10%", flat 5000 → "₹50". */
export function discountLabel(d: Discount): string {
  if (d.comp) return "Comp";
  return d.kind === "pct" ? rateLabel(d.value) : `₹${divRound(d.value, 100)}`;
}

/** Line subtotal before discounts for the live ticket (qty − voided) × unit. */
export function lineGross(unitPricePaise: Paise, qty: number, voidedQty = 0): Paise {
  return unitPricePaise * Math.max(0, qty - voidedQty);
}

/**
 * Bill for order lines under a client's *current* settings: the running total of an unbilled
 * order. A billed order carries its frozen `bill`; prefer that when present.
 */
export function billForLines(
  client: BillClientInput & { charges: Charges },
  mode: OrderMode,
  lines: Pick<OrderLine, "lineId" | "unitPricePaise" | "qty" | "voidedQty" | "taxBps" | "discount">[],
  opts: { billDiscount?: Discount; serviceChargeOptIn?: boolean } = {},
): BillResult {
  return computeBill({
    lines: lines.map((l) => ({ lineId: l.lineId, unitPricePaise: l.unitPricePaise, qty: l.qty, voidedQty: l.voidedQty, taxBps: l.taxBps, ...(l.discount ? { discount: l.discount } : {}) })),
    ...(opts.billDiscount ? { billDiscount: opts.billDiscount } : {}),
    serviceChargeOptIn: Boolean(opts.serviceChargeOptIn),
    charges: client.charges,
    mode,
    client,
  });
}

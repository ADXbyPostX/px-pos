import { halfRateLabel } from "./bill";
import { MODE_LABEL, STATION_LABEL } from "./kot";
import { formatINR } from "./money";
import { istDateTimeLabel, istDateLabel } from "./time";
import type { BillResult, Buyer, DocType, InvoiceLine, Kot, OrderMode, Paise, PayMode, Supplier, ZReport } from "./types";

/**
 * Printer-neutral receipt model. ASCII only: ESC/POS code pages have no ₹, so printed
 * money uses "Rs." The same lines drive the thermal encoder, the on-screen preview
 * (monospace) and the A4/PDF view.
 */
export type ReceiptLine =
  | { kind: "text"; text: string; align?: "left" | "center" | "right"; bold?: boolean; size?: 1 | 2; invert?: boolean }
  | { kind: "rule"; char?: "-" | "=" }
  | { kind: "feed"; lines?: number }
  | { kind: "cut" };

export type Cols = 32 | 48;
export type CopyLabel = "ORIGINAL" | "DUPLICATE" | `REPRINT ${number}`;

const money = (p: Paise) => formatINR(p, { symbol: false });
const rs = (p: Paise) => `Rs.${formatINR(p, { symbol: false })}`;
const PAY_LABEL: Record<PayMode, string> = { cash: "Cash", card: "Card", upi: "UPI", other: "Other" };

const t = (text: string, opts: Omit<Extract<ReceiptLine, { kind: "text" }>, "kind" | "text"> = {}): ReceiptLine => ({ kind: "text", text, ...opts });
const center = (text: string, opts: Omit<Extract<ReceiptLine, { kind: "text" }>, "kind" | "text" | "align"> = {}) => t(text, { ...opts, align: "center" });
const rule = (char: "-" | "=" = "-"): ReceiptLine => ({ kind: "rule", char });

/** Replace characters thermal printers can't render. */
export function asciiSafe(s: string): string {
  return s
    .replace(/₹/g, "Rs.")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\x20-\x7E]/g, "?");
}

/** "Left ........ Right" padded to width (right side wins if too long). */
export function lr(left: string, right: string, cols: number): string {
  const r = asciiSafe(right);
  const maxLeft = Math.max(0, cols - r.length - 1);
  const l = asciiSafe(left).slice(0, maxLeft);
  return l + " ".repeat(Math.max(1, cols - l.length - r.length)) + r;
}

/** Left/right pair on one line when it fits, otherwise left then right-aligned right. */
export function lrLines(left: string, right: string, cols: number): string[] {
  const l = asciiSafe(left);
  const r = asciiSafe(right);
  if (l.length + 1 + r.length <= cols) return [l + " ".repeat(cols - l.length - r.length) + r];
  return [...wrap(l, cols), ...wrap(r, cols).map((x) => " ".repeat(Math.max(0, cols - x.length)) + x)];
}

/**
 * Final pass: wrap any text line wider than the paper (double-size text is twice as wide),
 * so nothing is ever cut off on 58 mm (32-col) printers.
 */
export function fit(lines: ReceiptLine[], cols: number): ReceiptLine[] {
  const out: ReceiptLine[] = [];
  for (const l of lines) {
    if (l.kind !== "text") {
      out.push(l);
      continue;
    }
    const width = l.size === 2 ? Math.floor(cols / 2) : cols;
    const text = asciiSafe(l.text);
    if (text.length <= width) out.push({ ...l, text });
    else out.push(...wrap(text, width).map((w) => ({ ...l, text: w })));
  }
  return out;
}

/** Word-wrap to width. */
export function wrap(text: string, width: number): string[] {
  const words = asciiSafe(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if (!cur) cur = w.length > width ? w.slice(0, width) : w;
    else if (cur.length + 1 + w.length <= width) cur += ` ${w}`;
    else {
      lines.push(cur);
      cur = w.length > width ? w.slice(0, width) : w;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}

const padL = (s: string, n: number) => (s.length >= n ? s.slice(-n) : " ".repeat(n - s.length) + s);
const padR = (s: string, n: number) => (s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length));

export interface InvoicePrint {
  invoiceNo: string;
  issuedAtMs: number;
  orderNo: string;
  mode: OrderMode;
  where: string;
  covers?: number;
  token?: number;
  docType: DocType;
  supplier: Supplier;
  buyer?: Buyer;
  lines: InvoiceLine[];
  bill: BillResult;
  payments?: Array<{ mode: PayMode; amountPaise: Paise; tenderedPaise?: Paise; changePaise?: Paise; ref?: string }>;
  tipPaise?: Paise;
  staffName?: string;
  cancelled?: boolean;
}

export interface ReceiptSettings {
  header: string[];
  footer: string[];
  showSac: boolean;
}

export const RESTAURANT_SAC = "996331";
export const COMPOSITION_DECLARATION = "Composition taxable person, not eligible to collect tax on supplies";

/** Tax invoice / bill of supply for a thermal printer. */
export function renderInvoice(inv: InvoicePrint, settings: ReceiptSettings, opts: { copy: CopyLabel; cols: Cols }): ReceiptLine[] {
  const { cols } = opts;
  const out: ReceiptLine[] = [];
  const s = inv.supplier;
  out.push(center(s.legalName, { bold: true, size: cols === 48 ? 2 : 1 }));
  for (const l of wrap(s.address, cols)) out.push(center(l));
  if (s.phone) out.push(center(`Ph: ${s.phone}`));
  if (s.gstin) out.push(center(`GSTIN: ${s.gstin}`));
  if (s.fssai) out.push(center(`FSSAI Lic. No: ${s.fssai}`));
  for (const h of settings.header) for (const l of wrap(h, cols)) out.push(center(l));
  out.push(rule());
  out.push(center(inv.docType === "tax_invoice" ? "TAX INVOICE" : "BILL OF SUPPLY", { bold: true }));
  out.push(center(opts.copy === "ORIGINAL" ? "ORIGINAL FOR RECIPIENT" : opts.copy, { bold: opts.copy !== "ORIGINAL" }));
  if (inv.cancelled) out.push(center("*** CANCELLED ***", { bold: true, invert: true }));
  out.push(t(`Invoice: ${inv.invoiceNo}`, { bold: true }));
  out.push(t(`Date: ${istDateTimeLabel(inv.issuedAtMs)}`));
  const covers = inv.covers ? `  Covers ${inv.covers}` : "";
  for (const l of lrLines(`Order: ${inv.orderNo}`, `${MODE_LABEL[inv.mode]} ${inv.where}${covers}`, cols)) out.push(t(l));
  if (inv.staffName) out.push(t(`Served by: ${inv.staffName}`));
  out.push(t(`Place of supply: ${s.stateName} (${s.stateCode})`));
  if (inv.buyer?.name || inv.buyer?.gstin) {
    out.push(rule());
    if (inv.buyer.name) out.push(t(`Bill to: ${inv.buyer.name}`));
    if (inv.buyer.gstin) out.push(t(`Buyer GSTIN: ${inv.buyer.gstin}`));
    if (inv.buyer.address) for (const l of wrap(inv.buyer.address, cols)) out.push(t(l));
    if (inv.buyer.stateName) out.push(t(`State: ${inv.buyer.stateName}${inv.buyer.stateCode ? ` (${inv.buyer.stateCode})` : ""}`));
  }
  out.push(rule());

  // Items table.
  const amtW = 10;
  const qtyW = 4;
  const rateW = cols === 48 ? 9 : 0;
  const nameW = cols - amtW - qtyW - rateW;
  out.push(t(padR("Item", nameW) + padL("Qty", qtyW) + (rateW ? padL("Rate", rateW) : "") + padL("Amount", amtW), { bold: true }));
  for (const l of inv.lines) {
    const label = l.variantName ? `${l.name} (${l.variantName})` : l.name;
    const nameLines = wrap(`${label}${l.comp ? " [COMP]" : ""}`, nameW - 1);
    const first = padR(nameLines[0] ?? "", nameW) + padL(String(l.qty), qtyW) + (rateW ? padL(money(l.unitPricePaise), rateW) : "") + padL(money(l.amountPaise), amtW);
    out.push(t(first));
    for (const extra of nameLines.slice(1)) out.push(t(`  ${extra}`));
  }
  out.push(rule());

  const b = inv.bill;
  out.push(t(lr(`Subtotal (${b.itemQty} items)`, money(b.grossPaise), cols)));
  if (b.itemDiscPaise) out.push(t(lr("Item discounts", `-${money(b.itemDiscPaise)}`, cols)));
  if (b.billDiscPaise) out.push(t(lr("Bill discount", `-${money(b.billDiscPaise)}`, cols)));
  for (const c of b.charges) {
    const label = c.kind === "packaging" ? "Packaging charge" : c.kind === "delivery" ? "Delivery charge" : "Service charge (optional)";
    out.push(t(lr(label, money(c.amountPaise), cols)));
  }
  if (inv.docType === "tax_invoice") {
    out.push(t(lr("Taxable value", money(b.taxablePaise), cols)));
    for (const tx of b.taxes) {
      if (tx.bps === 0) continue;
      out.push(t(lr(`CGST @ ${halfRateLabel(tx.bps)}`, money(tx.cgstPaise), cols)));
      out.push(t(lr(`SGST @ ${halfRateLabel(tx.bps)}`, money(tx.sgstPaise), cols)));
    }
  }
  if (b.roundOffPaise) out.push(t(lr("Round off", `${b.roundOffPaise > 0 ? "+" : ""}${money(b.roundOffPaise)}`, cols)));
  out.push(rule("="));
  // Double-size text is twice as wide: pad the TOTAL line to half the paper at 80 mm.
  out.push(t(lr("TOTAL", rs(b.grandTotalPaise), cols === 48 ? cols / 2 : cols), { bold: true, size: cols === 48 ? 2 : 1 }));
  out.push(rule("="));

  if (inv.payments?.length) {
    for (const p of inv.payments) {
      const ref = p.ref ? ` #${p.ref.slice(-6)}` : "";
      if (p.mode === "cash" && p.tenderedPaise != null) {
        out.push(t(lr(`Paid cash`, money(p.tenderedPaise), cols)));
        if (p.changePaise) out.push(t(lr("Change", money(p.changePaise), cols)));
      } else out.push(t(lr(`Paid ${PAY_LABEL[p.mode]}${ref}`, money(p.amountPaise), cols)));
    }
    if (inv.tipPaise) out.push(t(lr("Tip (not taxable)", money(inv.tipPaise), cols)));
  }
  if (inv.docType === "bill_of_supply") for (const l of wrap(COMPOSITION_DECLARATION, cols)) out.push(center(l));
  if (settings.showSac && inv.docType === "tax_invoice") out.push(center(`SAC ${RESTAURANT_SAC}`));
  if (inv.docType === "tax_invoice") out.push(center("Reverse charge: No"));
  if (inv.token != null && inv.mode === "quick") {
    out.push({ kind: "feed" });
    out.push(center(`TOKEN ${inv.token}`, { bold: true, size: 2 }));
  }
  if (settings.footer.length) {
    out.push({ kind: "feed" });
    for (const f of settings.footer) for (const l of wrap(f, cols)) out.push(center(l));
  }
  out.push({ kind: "feed", lines: 2 });
  out.push({ kind: "cut" });
  return fit(out, cols);
}

export interface KotPrint extends Pick<Kot, "kotNo" | "kind" | "mode" | "where" | "station" | "items" | "orderNo" | "createdAtMs"> {
  covers?: number;
  staffName?: string;
  reprint?: number;
  reason?: string;
}

/** Kitchen order ticket: large type, no prices. */
export function renderKot(k: KotPrint, opts: { cols: Cols }): ReceiptLine[] {
  const { cols } = opts;
  const out: ReceiptLine[] = [];
  out.push(center(`KOT ${k.kotNo}`, { bold: true, size: 2 }));
  if (k.kind === "addon") out.push(center("*** ADD-ON ***", { bold: true }));
  if (k.kind === "cancel") out.push(center("*** CANCELLED ***", { bold: true, invert: true }));
  if (k.reprint) out.push(center(`REPRINT ${k.reprint}`, { bold: true }));
  out.push(center(`${k.where}${k.covers ? ` - ${k.covers} pax` : ""}`, { bold: true, size: 2 }));
  out.push(center(`${MODE_LABEL[k.mode]} - ${STATION_LABEL[k.station]}`));
  out.push(center(`${istDateTimeLabel(k.createdAtMs)}${k.staffName ? ` - ${k.staffName}` : ""}`));
  out.push(rule());
  const big = cols === 48;
  const itemWidth = big ? cols / 2 : cols;
  for (const it of k.items) {
    const label = `${it.qty} x ${it.name}${it.variantName ? ` (${it.variantName})` : ""}`;
    const lines = wrap(label, itemWidth - 2);
    lines.forEach((l, i) => out.push(t(i === 0 ? l : `  ${l}`, { bold: true, size: big ? 2 : 1 })));
    if (it.note) for (const l of wrap(`> ${it.note}`, cols - 4)) out.push(t(`    ${l}`));
  }
  if (k.reason) {
    out.push(rule());
    out.push(t(`Reason: ${k.reason}`));
  }
  out.push(rule());
  out.push(t(lr(`Order ${k.orderNo}`, `${k.items.reduce((s, i) => s + i.qty, 0)} items`, cols)));
  out.push({ kind: "feed", lines: 2 });
  out.push({ kind: "cut" });
  return fit(out, cols);
}

/** X (running) or Z (closed) report. */
export function renderZ(z: ZReport, opts: { cols: Cols; outletName: string; title?: "Z REPORT" | "X REPORT"; terminalNames?: Record<string, string> }): ReceiptLine[] {
  const { cols } = opts;
  const title = opts.title ?? "Z REPORT";
  const out: ReceiptLine[] = [];
  out.push(center(opts.outletName, { bold: true }));
  out.push(center(title === "Z REPORT" ? `Z REPORT #${z.zNo}` : "X REPORT (day not closed)", { bold: true, size: 2 }));
  out.push(center(`Business day ${istDateLabel(Date.parse(`${z.businessDate}T12:00:00+05:30`))}`));
  out.push(center(`Printed ${istDateTimeLabel(z.closedAtMs)}`));
  out.push(rule());
  const row = (l: string, v: Paise) => out.push(t(lr(l, money(v), cols)));
  out.push(t("SALES", { bold: true }));
  row("Gross", z.grossPaise);
  row("Discounts", -z.discountsPaise);
  if (z.compPaise) row("  of which comp", -z.compPaise);
  row("Net sales", z.netPaise);
  if (z.chargesPaise) row("Charges", z.chargesPaise);
  row("CGST", z.cgstPaise);
  row("SGST", z.sgstPaise);
  row("Round off", z.roundOffPaise);
  out.push(t(lr("TOTAL", money(z.totalPaise), cols), { bold: true }));
  if (z.tipsPaise) row("Tips (outside bill)", z.tipsPaise);
  out.push(t(lr("Orders / covers", `${z.orders} / ${z.covers}`, cols)));
  if (z.orders) row("Average order", Math.round(z.totalPaise / z.orders));
  out.push(rule());
  out.push(t("BY ORDER TYPE", { bold: true }));
  for (const [mode, v] of Object.entries(z.byMode)) out.push(t(lr(`${MODE_LABEL[mode as OrderMode] ?? mode} (${v.n})`, money(v.paise), cols)));
  out.push(t("BY PAYMENT", { bold: true }));
  for (const [mode, v] of Object.entries(z.byPay)) row(PAY_LABEL[mode as PayMode] ?? mode, v);
  for (const [mode, v] of Object.entries(z.refundsByPay)) if (v) row(`Refund ${PAY_LABEL[mode as PayMode] ?? mode}`, -v);
  if (Object.keys(z.byTaxBps).length) {
    out.push(t("TAX BY RATE", { bold: true }));
    for (const [bps, v] of Object.entries(z.byTaxBps)) out.push(t(lr(`${Number(bps) / 100}% on ${money(v.taxable)}`, money(v.cgst + v.sgst), cols)));
  }
  out.push(rule());
  out.push(t(lr(`Cancelled bills (${z.cancelledBills.n})`, money(z.cancelledBills.paise), cols)));
  out.push(t(lr(`Voided items (${z.voidItems.n})`, money(z.voidItems.paise), cols)));
  row("Expenses", z.expensesPaise);
  for (const d of z.drawers) {
    out.push(rule());
    out.push(t(`DRAWER ${opts.terminalNames?.[d.terminalId] ?? d.terminalId}`, { bold: true }));
    row("Opening float", d.floatPaise);
    row("Cash sales", d.cash.sales);
    if (d.cash.refunds) row("Cash refunds", -d.cash.refunds);
    if (d.cash.paidIn) row("Paid in", d.cash.paidIn);
    if (d.cash.paidOut) row("Paid out (expenses)", -d.cash.paidOut);
    if (d.cash.drops) row("Cash drops", -d.cash.drops);
    out.push(t(lr("Expected in drawer", money(d.expectedPaise), cols), { bold: true }));
    if (d.countedPaise != null) {
      row("Counted", d.countedPaise);
      out.push(t(lr("Variance", `${(d.variancePaise ?? 0) > 0 ? "+" : ""}${money(d.variancePaise ?? 0)}`, cols), { bold: true }));
    }
  }
  if (z.invoiceRanges.length) {
    out.push(rule());
    out.push(t("INVOICES", { bold: true }));
    for (const r of z.invoiceRanges) {
      out.push(t(`${r.series}: ${r.count} issued, ${r.cancelled} cancelled`));
      out.push(t(`  ${r.first} .. ${r.last}`));
    }
  }
  out.push({ kind: "feed", lines: 2 });
  out.push({ kind: "cut" });
  return fit(out, cols);
}

/** Plain-text rendering (preview, tests, share-as-text). */
export function receiptText(lines: ReceiptLine[], cols: Cols): string {
  const out: string[] = [];
  for (const l of lines) {
    if (l.kind === "rule") out.push((l.char ?? "-").repeat(cols));
    else if (l.kind === "feed") for (let i = 0; i < (l.lines ?? 1); i++) out.push("");
    else if (l.kind === "cut") out.push("");
    else {
      const text = asciiSafe(l.text).slice(0, cols);
      if (l.align === "center") {
        const pad = Math.max(0, Math.floor((cols - text.length) / 2));
        out.push(" ".repeat(pad) + text);
      } else if (l.align === "right") out.push(padL(text, cols));
      else out.push(text);
    }
  }
  return out.join("\n");
}

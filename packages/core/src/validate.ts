import { validateReceiptLogo } from "./logo";
import { isValidInvoicePrefix } from "./numbering";
import { phone10 } from "./paths";
import { RECEIPT_PARTS } from "./receipt";
import { isBizDate } from "./time";
import { EXPENSE_CATEGORIES, MATERIAL_UNITS, ORDER_MODES, STAFF_ROLES, VENDOR_PAY_MODES } from "./types";
import type { BizDate, Buyer, Client, Expense, Item, Material, MaterialUnit, Paise, PurchaseKind, TaxMode, Vendor, VendorPayMode } from "./types";
import { validateVpa } from "./upi";

/** GST state codes (for the client's place of supply). */
export const GST_STATES: Array<{ code: string; name: string }> = [
  { code: "01", name: "Jammu and Kashmir" },
  { code: "02", name: "Himachal Pradesh" },
  { code: "03", name: "Punjab" },
  { code: "04", name: "Chandigarh" },
  { code: "05", name: "Uttarakhand" },
  { code: "06", name: "Haryana" },
  { code: "07", name: "Delhi" },
  { code: "08", name: "Rajasthan" },
  { code: "09", name: "Uttar Pradesh" },
  { code: "10", name: "Bihar" },
  { code: "11", name: "Sikkim" },
  { code: "12", name: "Arunachal Pradesh" },
  { code: "13", name: "Nagaland" },
  { code: "14", name: "Manipur" },
  { code: "15", name: "Mizoram" },
  { code: "16", name: "Tripura" },
  { code: "17", name: "Meghalaya" },
  { code: "18", name: "Assam" },
  { code: "19", name: "West Bengal" },
  { code: "20", name: "Jharkhand" },
  { code: "21", name: "Odisha" },
  { code: "22", name: "Chhattisgarh" },
  { code: "23", name: "Madhya Pradesh" },
  { code: "24", name: "Gujarat" },
  { code: "26", name: "Dadra and Nagar Haveli and Daman and Diu" },
  { code: "27", name: "Maharashtra" },
  { code: "29", name: "Karnataka" },
  { code: "30", name: "Goa" },
  { code: "31", name: "Lakshadweep" },
  { code: "32", name: "Kerala" },
  { code: "33", name: "Tamil Nadu" },
  { code: "34", name: "Puducherry" },
  { code: "35", name: "Andaman and Nicobar Islands" },
  { code: "36", name: "Telangana" },
  { code: "37", name: "Andhra Pradesh" },
  { code: "38", name: "Ladakh" },
  { code: "97", name: "Other Territory" },
];

export function stateName(code: string): string | undefined {
  return GST_STATES.find((s) => s.code === code)?.name;
}

/**
 * GST slabs (bps) since GST 2.0 (22 Sep 2025): nil, 5%, 18% and the 40% special rate.
 * Standalone restaurant/café service is 5% (no ITC); the old 12% / 28% slabs no longer exist.
 */
export const TAX_RATES = [0, 500, 1800, 4000] as const;

const GST_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/** GSTIN check character (Luhn mod 36 over the first 14 characters). */
export function gstinCheckChar(first14: string): string {
  let factor = 2;
  let sum = 0;
  for (let i = first14.length - 1; i >= 0; i--) {
    const cp = GST_CHARS.indexOf(first14[i] as string);
    let digit = factor * cp;
    factor = factor === 2 ? 1 : 2;
    digit = Math.floor(digit / 36) + (digit % 36);
    sum += digit;
  }
  return GST_CHARS[(36 - (sum % 36)) % 36] as string;
}

/** Returns an error message, or null when valid. */
export function validateGstin(input: string | undefined | null): string | null {
  const g = (input ?? "").trim().toUpperCase();
  if (!g) return "GSTIN is required";
  if (g.length !== 15) return "GSTIN must be 15 characters";
  if (!GSTIN_RE.test(g)) return "GSTIN format is invalid";
  if (!GST_STATES.some((s) => s.code === g.slice(0, 2)) && g.slice(0, 2) !== "99") return "GSTIN state code is invalid";
  if (gstinCheckChar(g.slice(0, 14)) !== g[14]) return "GSTIN check digit does not match";
  return null;
}

export function validateFssai(input: string | undefined | null): string | null {
  const f = (input ?? "").replace(/\s/g, "");
  if (!f) return "FSSAI licence number is required";
  if (!/^\d{14}$/.test(f)) return "FSSAI number must be 14 digits";
  return null;
}

const nonEmpty = (v: unknown, max: number) => typeof v === "string" && v.trim().length > 0 && v.trim().length <= max;
const MAX_PRICE: Paise = 1_00_00_000; // ₹1,00,000 per unit

export function validatePrice(p: unknown, label = "Price"): string | null {
  if (typeof p !== "number" || !Number.isSafeInteger(p)) return `${label} is required`;
  if (p <= 0) return `${label} must be more than ₹0`;
  if (p > MAX_PRICE) return `${label} is too high`;
  return null;
}

export function validateItem(i: Partial<Item>): string | null {
  if (!nonEmpty(i.name, 60)) return "Item name is required (max 60 characters)";
  if (!i.categoryId) return "Pick a category";
  const priceErr = validatePrice(i.pricePaise);
  if (priceErr) return priceErr;
  // Every item carries its own GST rate (set when it's created), so a later change to the
  // outlet default never silently re-rates the menu.
  if (i.taxBps == null) return "Pick the item's GST rate";
  if (!(TAX_RATES as readonly number[]).includes(i.taxBps)) return "GST rate must be 0, 5, 18 or 40%";
  if (!i.modes || i.modes.length === 0) return "Pick at least one order mode";
  if (i.modes.some((m) => !(ORDER_MODES as readonly string[]).includes(m))) return "Unknown order mode";
  for (const v of i.variants ?? []) {
    if (!nonEmpty(v.name, 30)) return "Every variant needs a name";
    const e = validatePrice(v.pricePaise, `Price for ${v.name}`);
    if (e) return e;
  }
  const names = (i.variants ?? []).map((v) => v.name.trim().toLowerCase());
  if (new Set(names).size !== names.length) return "Variant names must be unique";
  if (i.lowAt != null && (!Number.isInteger(i.lowAt) || i.lowAt < 0)) return "Low-stock level must be 0 or more";
  if (i.code && !/^[A-Za-z0-9-]{1,10}$/.test(i.code)) return "Short code: letters, digits or dashes, max 10";
  return null;
}

export function validateClient(c: Partial<Client>): string | null {
  if (!nonEmpty(c.name, 60)) return "Outlet name is required";
  if (!nonEmpty(c.legalName, 100)) return "Legal name is required";
  if (!nonEmpty(c.address, 200)) return "Address is required";
  if (!c.stateCode || !GST_STATES.some((s) => s.code === c.stateCode)) return "Pick the state";
  // Optional at setup (added later via Edit client); bills omit the line until then.
  if (c.fssai) {
    const f = validateFssai(c.fssai);
    if (f) return f;
  }
  if (c.gstin) {
    const g = validateGstin(c.gstin);
    if (g) return g;
    if (c.gstin.slice(0, 2) !== c.stateCode) return "GSTIN state code must match the outlet's state";
  }
  if (c.upi) {
    const u = validateVpa(c.upi.vpa);
    if (u) return u;
    if (!nonEmpty(c.upi.payee, 50)) return "Enter the name shown to UPI payers";
  }
  if (c.receipt?.logo) {
    const l = validateReceiptLogo(c.receipt.logo);
    if (l) return `Receipt logo: ${l.charAt(0).toLowerCase()}${l.slice(1)}`;
  }
  if (c.receipt?.hide && !(Array.isArray(c.receipt.hide) && c.receipt.hide.every((p) => RECEIPT_PARTS.some((x) => x.part === p)))) return "The receipt lists a part it doesn't know";
  // A regular outlet may wait for its GSTIN (bills omit the line; admin flags it as missing).
  if (c.invoicePrefix != null && !isValidInvoicePrefix(c.invoicePrefix)) return "Invoice prefix: up to 2 capital letters";
  if (c.defaultTaxBps != null && !(TAX_RATES as readonly number[]).includes(c.defaultTaxBps)) return "Default tax rate is invalid";
  if (c.day && (!Number.isInteger(c.day.cutoffMin) || c.day.cutoffMin < 0 || c.day.cutoffMin > 720)) return "Day cutoff must be between 00:00 and 12:00";
  if (c.orderModes && !c.orderModes.dineIn && !c.orderModes.quick && !c.orderModes.delivery) return "Enable at least one order mode";
  if (c.discountCapBps) {
    for (const r of STAFF_ROLES) {
      const v = c.discountCapBps[r];
      if (v != null && (!Number.isInteger(v) || v < 0 || v > 10000)) return "Discount caps must be between 0% and 100%";
    }
  }
  return null;
}

export function validateExpense(e: Partial<Expense>): string | null {
  if (typeof e.amountPaise !== "number" || !Number.isSafeInteger(e.amountPaise) || e.amountPaise <= 0) return "Enter the amount";
  if (e.amountPaise > 10_00_00_000) return "Amount is too high";
  if (!e.category || !(EXPENSE_CATEGORIES as readonly string[]).includes(e.category)) return "Pick a category";
  if (!e.paidVia) return "Pick how it was paid";
  if (e.paidVia === "drawer" && !e.drawerTerminalId) return "Drawer expenses need a terminal";
  if (e.note && e.note.length > 200) return "Note is too long";
  return null;
}

// ─── vendors ────────────────────────────────────────────────────────────────

/** ₹1 crore: the most a single bill, line or payment can be (same cap as expenses). */
const MAX_MONEY: Paise = 10_00_00_000;
const isMoney = (v: unknown, max = MAX_MONEY) => typeof v === "number" && Number.isSafeInteger(v) && v > 0 && v <= max;

export function validateVendor(v: Partial<Pick<Vendor, "name" | "phone" | "gstin" | "creditDays" | "note" | "materialIds">>): string | null {
  if (!nonEmpty(v.name, 60)) return "Vendor name is required (max 60 characters)";
  if (v.phone && !phone10(v.phone)) return "Enter a 10-digit mobile number";
  if (v.gstin) {
    const g = validateGstin(v.gstin);
    if (g) return `Vendor's ${g}`;
  }
  if (typeof v.creditDays !== "number" || !Number.isInteger(v.creditDays) || v.creditDays < 0 || v.creditDays > 90) return "Credit days must be between 0 and 90";
  if (v.note && v.note.length > 200) return "Note is too long (max 200 characters)";
  if (v.materialIds && (v.materialIds.length > 50 || new Set(v.materialIds).size !== v.materialIds.length)) return "Pick up to 50 different materials";
  return null;
}

export function validateMaterial(m: Partial<Pick<Material, "name" | "unit" | "taxBps">>): string | null {
  if (!nonEmpty(m.name, 40)) return "Material name is required (max 40 characters)";
  if (!m.unit || !(MATERIAL_UNITS as readonly string[]).includes(m.unit)) return "Pick a unit";
  if (m.taxBps == null || !(TAX_RATES as readonly number[]).includes(m.taxBps)) return "Pick a GST rate";
  return null;
}

export interface PurchaseCheck {
  kind: PurchaseKind;
  billDate: BizDate;
  businessDate: BizDate;
  lines: Array<{ lineId: string; name: string; qtyMilli: number; unit: MaterialUnit; amountPaise: Paise; taxBps: number }>;
  adjustPaise?: Paise;
  billNo?: string;
  note?: string;
  paidNow?: { amountPaise: Paise; mode: VendorPayMode };
}

/** `today` = the current business date: a bill can't be dated after it. */
export function validatePurchase(p: PurchaseCheck, today?: BizDate): string | null {
  if (!isBizDate(p.billDate)) return "Pick the bill date";
  if (today && p.billDate > today) return "Bill date can't be in the future";
  if (!isBizDate(p.businessDate)) return "Pick the business day";
  if (p.kind === "bill") {
    if (!p.lines.length) return "Add at least one item";
    if (p.lines.length > 50) return "A bill can have at most 50 items";
    if (new Set(p.lines.map((l) => l.lineId)).size !== p.lines.length) return "Duplicate line";
    for (const [i, l] of p.lines.entries()) {
      if (!nonEmpty(l.name, 60)) return `Line ${i + 1}: name the item`;
      if (!Number.isSafeInteger(l.qtyMilli) || l.qtyMilli <= 0 || l.qtyMilli > 1_000_000_000) return `${l.name}: enter the quantity`;
      if (!(MATERIAL_UNITS as readonly string[]).includes(l.unit)) return `${l.name}: pick a unit`;
      if (!isMoney(l.amountPaise)) return `${l.name}: enter the amount`;
      if (!(TAX_RATES as readonly number[]).includes(l.taxBps)) return `${l.name}: pick a GST rate`;
    }
  } else if (p.lines.length) return "An opening balance has no items";
  const adjust = p.adjustPaise ?? 0;
  if (!Number.isSafeInteger(adjust) || Math.abs(adjust) > 10000) return "Round off can be at most ₹100 either way";
  const total = p.lines.reduce((s, l) => s + l.amountPaise, 0) + adjust;
  if (total <= 0) return "The bill total must be more than ₹0";
  if (total > MAX_MONEY) return "The bill total is too high";
  if (p.billNo && p.billNo.length > 30) return "Bill number is too long (max 30 characters)";
  if (p.note && p.note.length > 200) return "Note is too long (max 200 characters)";
  if (p.paidNow) {
    if (!isMoney(p.paidNow.amountPaise)) return "Enter the amount paid";
    if (p.paidNow.amountPaise > total) return "Paid now can't be more than the bill";
    if (!(VENDOR_PAY_MODES as readonly string[]).includes(p.paidNow.mode)) return "Pick how it was paid";
  }
  return null;
}

export function validateVendorPayment(p: { amountPaise: Paise; mode: VendorPayMode; businessDate: BizDate; ref?: string; note?: string }, today?: BizDate): string | null {
  if (!isMoney(p.amountPaise)) return typeof p.amountPaise === "number" && p.amountPaise > MAX_MONEY ? "Amount is too high" : "Enter the amount";
  if (!(VENDOR_PAY_MODES as readonly string[]).includes(p.mode)) return "Pick how it was paid";
  if (!isBizDate(p.businessDate)) return "Pick the date";
  if (today && p.businessDate > today) return "Date can't be in the future";
  if (p.ref && p.ref.length > 40) return "Reference is too long (max 40 characters)";
  if (p.note && p.note.length > 200) return "Note is too long (max 200 characters)";
  return null;
}

/** B2C invoice value from which recipient name, address and state are mandatory (Rule 46). */
export const B2C_DETAIL_THRESHOLD: Paise = 50_000 * 100;

/**
 * Buyer details required before billing:
 *  - B2B (GSTIN given): valid GSTIN + name.
 *  - Unregistered buyer, tax invoice ≥ ₹50,000: name, address and state.
 */
export function validateBillBuyer(grandPaise: Paise, buyer: Buyer | undefined, taxMode: TaxMode): string | null {
  if (buyer?.gstin) {
    const g = validateGstin(buyer.gstin);
    if (g) return `Buyer's ${g}`;
    if (!nonEmpty(buyer.name, 100)) return "Buyer name is required for a B2B invoice";
    return null;
  }
  if (taxMode === "regular" && grandPaise >= B2C_DETAIL_THRESHOLD) {
    if (!nonEmpty(buyer?.name, 100) || !nonEmpty(buyer?.address, 200) || !buyer?.stateCode) {
      return "Bills of ₹50,000 or more need the customer's name, address and state";
    }
  }
  return null;
}

export const EXPENSE_LABEL: Record<(typeof EXPENSE_CATEGORIES)[number], string> = {
  raw_material: "Raw material",
  vegetables: "Vegetables",
  dairy: "Dairy",
  meat: "Meat & fish",
  beverages: "Beverages",
  gas_fuel: "Gas & fuel",
  packaging: "Packaging",
  cleaning: "Cleaning",
  maintenance: "Repairs",
  salary_advance: "Salary advance",
  rent: "Rent",
  utilities: "Power & water",
  transport: "Transport",
  misc: "Miscellaneous",
};

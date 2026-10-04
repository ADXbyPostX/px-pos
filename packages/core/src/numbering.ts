import type { Fy } from "./types";

/**
 * GST invoice numbers: consecutive, unique per series per financial year,
 * at most 16 characters from [A-Z0-9/-] (CGST Rule 46(b)). Multiple series are allowed,
 * so each terminal gets its own: series = client prefix (0–2 chars) + terminal code (1 char).
 *   formatInvoiceNo("DC1", "26-27", 123) === "DC1/26-27/000123"  (16 chars)
 */
export const INVOICE_NO_MAX = 16;
const INVOICE_CHARSET = /^[A-Z0-9/-]+$/;
const SERIES_RE = /^[A-Z]{0,2}[1-9A-Z]$/;

export function formatInvoiceNo(series: string, fy: Fy, seq: number): string {
  if (!SERIES_RE.test(series)) throw new RangeError(`Invalid invoice series "${series}"`);
  if (!Number.isInteger(seq) || seq < 1 || seq > 999_999) throw new RangeError(`Invalid invoice sequence ${seq}`);
  const no = `${series}/${fy}/${String(seq).padStart(6, "0")}`;
  assertInvoiceNo(no);
  return no;
}

export function assertInvoiceNo(no: string): void {
  if (no.length > INVOICE_NO_MAX) throw new RangeError(`Invoice number "${no}" exceeds ${INVOICE_NO_MAX} characters`);
  if (!INVOICE_CHARSET.test(no)) throw new RangeError(`Invoice number "${no}" has characters outside [A-Z0-9/-]`);
}

export function isValidInvoicePrefix(prefix: string): boolean {
  return /^[A-Z]{0,2}$/.test(prefix);
}

export function seriesFor(prefix: string, terminalCode: string): string {
  const s = `${prefix}${terminalCode}`;
  if (!SERIES_RE.test(s)) throw new RangeError(`Invalid series from prefix "${prefix}" and code "${terminalCode}"`);
  return s;
}

/** Firestore doc id for an invoice: "DC1-2627-000123" (no slashes). */
export function invoiceDocId(series: string, fy: Fy, seq: number): string {
  return `${series}-${fy.replace("-", "")}-${String(seq).padStart(6, "0")}`;
}

/** Parse "DC1/26-27/000123" → parts, or null. */
export function parseInvoiceNo(no: string): { series: string; fy: Fy; seq: number } | null {
  const m = /^([A-Z0-9]{1,3})\/(\d{2}-\d{2})\/(\d{6})$/.exec(no);
  if (!m) return null;
  return { series: m[1] as string, fy: m[2] as Fy, seq: Number(m[3]) };
}

/** Order number shown to staff: "1-042" (terminal code + daily sequence). */
export function formatOrderNo(terminalCode: string, n: number): string {
  return `${terminalCode}-${String(n).padStart(3, "0")}`;
}

/** KOT number: "1-17" (terminal code + daily sequence). */
export function formatKotNo(terminalCode: string, n: number): string {
  return `${terminalCode}-${n}`;
}

/** Deterministic KOT doc id so a replayed batch overwrites itself instead of duplicating. */
export function kotDocId(orderId: string, terminalCode: string, n: number): string {
  return `${orderId}-${terminalCode}-${n}`;
}

/** Terminal codes in allocation order (never reused within a client). */
export const TERMINAL_CODES = "123456789ABCDEFGHJKLMNPQRSTUVWXYZ".split("");

export function nextTerminalCode(used: Iterable<string>): string | null {
  const taken = new Set(used);
  return TERMINAL_CODES.find((c) => !taken.has(c)) ?? null;
}

/**
 * Missing sequence numbers in a series (e.g. a crash between allocation and write).
 * Checks from `from` (default: the smallest present) to the largest present.
 */
export function findGaps(seqs: number[], from?: number): number[] {
  if (seqs.length === 0) return [];
  const present = new Set(seqs);
  const max = Math.max(...seqs);
  const start = from ?? Math.min(...seqs);
  const gaps: number[] = [];
  for (let n = start; n <= max; n++) if (!present.has(n)) gaps.push(n);
  return gaps;
}

/** Crockford base32 (no I, L, O, U): unambiguous when read aloud or typed. */
export const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Pairing code "PXP-XXXX-XXXX" from 8 random bytes. */
export function pairingCode(bytes: ArrayLike<number>): string {
  if (bytes.length < 8) throw new RangeError("pairingCode needs 8 random bytes");
  let s = "";
  for (let i = 0; i < 8; i++) s += CROCKFORD[(bytes[i] as number) & 31];
  return `PXP-${s.slice(0, 4)}-${s.slice(4, 8)}`;
}

export function normalizePairingCode(input: string): string {
  const raw = input
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1")
    .replace(/^PXP/, "");
  if (raw.length !== 8) return input.trim().toUpperCase();
  return `PXP-${raw.slice(0, 4)}-${raw.slice(4)}`;
}

export function isPairingCode(s: string): boolean {
  return /^PXP-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/.test(s);
}

/** Alphanumeric id (Firestore-like). `rand` returns [0,1). */
export function makeId(rand: () => number, length = 20): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i = 0; i < length; i++) s += chars[Math.floor(rand() * chars.length) % chars.length];
  return s;
}

/** Order-line id: starts with a letter so it is a valid dotted field-path segment. */
export function makeLineId(rand: () => number): string {
  return `l${makeId(rand, 11)}`;
}

/** URL/doc-safe slug for client ids: "Demo Café & Bar" → "demo-cafe-bar". */
export function slugify(input: string, max = 24): string {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
}

/** Client id: slug + 4 random chars, e.g. "demo-cafe-7k2q". */
export function makeClientId(name: string, rand: () => number): string {
  const suffix = makeId(rand, 4).toLowerCase();
  return `${slugify(name) || "client"}-${suffix}`;
}

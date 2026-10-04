import type { Paise } from "./types";

/**
 * Integer division rounded half away from zero (half-up for positives).
 * Both arguments must be integers; `d` must be non-zero.
 */
export function divRound(n: number, d: number): number {
  if (d === 0) throw new RangeError("divRound: division by zero");
  if (!Number.isInteger(n) || !Number.isInteger(d)) throw new TypeError("divRound: integers only");
  const negative = n < 0 !== d < 0;
  const an = Math.abs(n);
  const ad = Math.abs(d);
  let q = Math.trunc(an / ad);
  let r = an - q * ad;
  // Guard against float error in an / ad for large magnitudes.
  while (r < 0) {
    q -= 1;
    r += ad;
  }
  while (r >= ad) {
    q += 1;
    r -= ad;
  }
  const rounded = 2 * r >= ad ? q + 1 : q;
  return negative ? -rounded : rounded;
}

/**
 * round(a × b / c), half away from zero, exact for any safe-integer inputs
 * (switches to BigInt when a × b leaves the safe range).
 */
export function mulDivRound(a: number, b: number, c: number): number {
  if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b) || !Number.isSafeInteger(c)) {
    throw new TypeError("mulDivRound: safe integers only");
  }
  if (c === 0) throw new RangeError("mulDivRound: division by zero");
  const product = a * b;
  if (Number.isSafeInteger(product)) return divRound(product, c);
  const ZERO = BigInt(0);
  const ONE = BigInt(1);
  const TWO = BigInt(2);
  const n = BigInt(a) * BigInt(b);
  const d = BigInt(c);
  const negative = n < ZERO !== d < ZERO;
  const an = n < ZERO ? -n : n;
  const ad = d < ZERO ? -d : d;
  const q = an / ad;
  const r = an - q * ad;
  const rounded = TWO * r >= ad ? q + ONE : q;
  const result = Number(negative ? -rounded : rounded);
  if (!Number.isSafeInteger(result)) throw new RangeError("mulDivRound: result out of safe range");
  return result;
}

/** floor(a × b / c) for non-negative safe integers, exact. */
function mulDivFloor(a: number, b: number, c: number): number {
  const product = a * b;
  if (Number.isSafeInteger(product)) {
    let q = Math.trunc(product / c);
    let r = product - q * c;
    while (r < 0) {
      q -= 1;
      r += c;
    }
    while (r >= c) {
      q += 1;
      r -= c;
    }
    return q;
  }
  return Number((BigInt(a) * BigInt(b)) / BigInt(c));
}

/**
 * Split `total` across `weights` proportionally with the largest-remainder method.
 * The result always sums exactly to `total`. Ties go to the lower index.
 * With all-zero weights the total is spread evenly (lower indices first).
 */
export function allocate(total: number, weights: number[]): number[] {
  if (!Number.isSafeInteger(total)) throw new TypeError("allocate: total must be a safe integer");
  if (weights.length === 0) {
    if (total !== 0) throw new RangeError("allocate: cannot allocate a non-zero total to nothing");
    return [];
  }
  if (total < 0) return allocate(-total, weights).map((v) => (v === 0 ? 0 : -v));
  for (const w of weights) {
    if (!Number.isSafeInteger(w) || w < 0) throw new TypeError("allocate: weights must be non-negative safe integers");
  }
  const sum = weights.reduce((s, w) => s + w, 0);
  if (sum === 0) {
    const base = Math.floor(total / weights.length);
    let rest = total - base * weights.length;
    return weights.map(() => {
      const extra = rest > 0 ? 1 : 0;
      rest -= extra;
      return base + extra;
    });
  }
  const shares = weights.map((w) => mulDivFloor(total, w, sum));
  // Remainder of each share, scaled to integers: (total*w) mod sum.
  const remainders = weights.map((w, i) => ({
    i,
    r: Number.isSafeInteger(total * w) ? total * w - (shares[i] as number) * sum : Number((BigInt(total) * BigInt(w)) % BigInt(sum)),
  }));
  let left = total - shares.reduce((s, v) => s + v, 0);
  remainders.sort((x, y) => y.r - x.r || x.i - y.i);
  for (const { i } of remainders) {
    if (left <= 0) break;
    shares[i] = (shares[i] as number) + 1;
    left -= 1;
  }
  return shares;
}

/** Percentage of a base in basis points: pctOf(10000, 500) = 500 (5%). */
export function bpsOf(base: Paise, bps: number): Paise {
  return mulDivRound(base, bps, 10000);
}

/** Round paise to the nearest rupee, half up (…50 goes up). */
export function roundToRupee(p: Paise): Paise {
  return divRound(p, 100) * 100;
}

/** Group an integer string the Indian way: 12345678 → "1,23,45,678". */
export function groupIN(digits: string): string {
  if (digits.length <= 3) return digits;
  const last3 = digits.slice(-3);
  let rest = digits.slice(0, -3);
  const parts: string[] = [];
  while (rest.length > 2) {
    parts.unshift(rest.slice(-2));
    rest = rest.slice(0, -2);
  }
  if (rest) parts.unshift(rest);
  return `${parts.join(",")},${last3}`;
}

export interface FormatINROptions {
  /** Prefix with ₹ (default true). */
  symbol?: boolean;
  /** 2 = always paise, 0 = whole rupees (rounded half up), "auto" = paise only when non-zero. */
  decimals?: 0 | 2 | "auto";
  /** Show "+" for positive values (deltas). */
  signed?: boolean;
}

/**
 * Format paise as Indian rupees without Intl (Hermes-safe):
 * formatINR(12345678) === "₹1,23,456.78", formatINR(-500) === "-₹5.00".
 */
export function formatINR(p: Paise, opts: FormatINROptions = {}): string {
  const { symbol = true, decimals = 2, signed = false } = opts;
  if (!Number.isFinite(p)) return "—";
  const value = Math.round(p);
  const negative = value < 0;
  let abs = Math.abs(value);
  if (decimals === 0) abs = roundToRupee(abs);
  const rupees = Math.floor(abs / 100);
  const paise = abs % 100;
  let text = groupIN(String(rupees));
  if (decimals === 2 || (decimals === "auto" && paise !== 0)) text += `.${String(paise).padStart(2, "0")}`;
  const sign = negative ? "-" : signed && value > 0 ? "+" : "";
  return `${sign}${symbol ? "₹" : ""}${text}`;
}

/** Compact rupees for charts/stats: 1234567 paise → "₹12.3K", 1_23_45_67_800 → "₹1.23Cr". */
export function formatINRCompact(p: Paise): string {
  const rupees = Math.abs(p) / 100;
  const sign = p < 0 ? "-" : "";
  const fmt = (v: number, suffix: string) => `${sign}₹${(Math.round(v * 100) / 100).toString()}${suffix}`;
  if (rupees >= 1_00_00_000) return fmt(rupees / 1_00_00_000, "Cr");
  if (rupees >= 1_00_000) return fmt(rupees / 1_00_000, "L");
  if (rupees >= 1_000) return fmt(rupees / 1_000, "K");
  return `${sign}₹${groupIN(String(Math.round(rupees)))}`;
}

/**
 * Parse a user-typed rupee amount into paise. Accepts "120", "120.5", "120.50",
 * "1,20,000.00", "₹ 99". Rejects negatives, exponents, >2 decimals and junk.
 */
export function parseINR(input: string): Paise | null {
  if (typeof input !== "string") return null;
  const s = input.replace(/[₹\s]/g, "").replace(/,/g, "");
  if (!/^\d+(\.\d{0,2})?$/.test(s) && !/^\.\d{1,2}$/.test(s)) return null;
  const [whole = "0", frac = ""] = s.split(".");
  const rupees = Number(whole || "0");
  const paise = Number((frac + "00").slice(0, 2));
  const total = rupees * 100 + paise;
  return Number.isSafeInteger(total) ? total : null;
}

/** Percentage change helper for stats: returns null when prev is 0. */
export function pctChange(cur: number, prev: number): number | null {
  if (prev === 0) return null;
  return ((cur - prev) / Math.abs(prev)) * 100;
}

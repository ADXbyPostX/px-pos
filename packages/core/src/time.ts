import type { BizDate, Fy } from "./types";

/**
 * India Standard Time helpers. IST is a fixed UTC+05:30 with no DST, so a
 * constant offset is exact and avoids Intl (Hermes on older Android lacks full ICU).
 */
export const IST_OFFSET_MIN = 330;
const IST_OFFSET_MS = IST_OFFSET_MIN * 60_000;
const DAY_MS = 86_400_000;

export const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
export const WEEKDAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export interface IstParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number; // 0 = Sunday
}

export function istParts(ms: number): IstParts {
  const d = new Date(ms + IST_OFFSET_MS);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    second: d.getUTCSeconds(),
    weekday: d.getUTCDay(),
  };
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** IST calendar date "YYYY-MM-DD". */
export function istDate(ms: number): string {
  const p = istParts(ms);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

/** "HH" in IST, used as the byHour key. */
export function hourKey(ms: number): string {
  return pad2(istParts(ms).hour);
}

/** "HH:mm" in IST. */
export function istTime(ms: number): string {
  const p = istParts(ms);
  return `${pad2(p.hour)}:${pad2(p.minute)}`;
}

/** "29 Sep 2026" in IST. */
export function istDateLabel(ms: number): string {
  const p = istParts(ms);
  return `${p.day} ${MONTHS_SHORT[p.month - 1]} ${p.year}`;
}

/** "29 Sep 2026, 14:05" in IST. */
export function istDateTimeLabel(ms: number): string {
  return `${istDateLabel(ms)}, ${istTime(ms)}`;
}

/**
 * The business date a moment belongs to: the IST date after subtracting the
 * client's cutoff (e.g. 240 = 04:00, so 01:30 IST still counts as "yesterday").
 */
export function businessDateFor(ms: number, cutoffMin: number): BizDate {
  return istDate(ms - cutoffMin * 60_000);
}

/** Financial year (India: 1 April – 31 March) of an IST moment, as "26-27". */
export function fyFor(ms: number): Fy {
  const { year, month } = istParts(ms);
  const start = month >= 4 ? year : year - 1;
  return `${pad2(start % 100)}-${pad2((start + 1) % 100)}`;
}

/** Parse "YYYY-MM-DD" into a UTC midnight timestamp (calendar arithmetic only). */
export function parseBizDate(d: BizDate): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (!m) throw new RangeError(`Invalid business date: ${d}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function isBizDate(d: unknown): d is BizDate {
  if (typeof d !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const t = parseBizDate(d);
  const back = new Date(t);
  return `${back.getUTCFullYear()}-${pad2(back.getUTCMonth() + 1)}-${pad2(back.getUTCDate())}` === d;
}

export function addDays(d: BizDate, n: number): BizDate {
  const t = parseBizDate(d) + n * DAY_MS;
  const back = new Date(t);
  return `${back.getUTCFullYear()}-${pad2(back.getUTCMonth() + 1)}-${pad2(back.getUTCDate())}`;
}

/** Inclusive list of dates from → to (empty if from > to). */
export function rangeDates(from: BizDate, to: BizDate): BizDate[] {
  const out: BizDate[] = [];
  const end = parseBizDate(to);
  for (let t = parseBizDate(from); t <= end; t += DAY_MS) {
    const d = new Date(t);
    out.push(`${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`);
  }
  return out;
}

/** Days between two business dates (b − a). */
export function daysBetween(a: BizDate, b: BizDate): number {
  return Math.round((parseBizDate(b) - parseBizDate(a)) / DAY_MS);
}

/** "Tue 29 Sep" style label for a business date. */
export function bizDateLabel(d: BizDate, withYear = false): string {
  const t = parseBizDate(d);
  const x = new Date(t);
  const base = `${WEEKDAYS_SHORT[x.getUTCDay()]} ${x.getUTCDate()} ${MONTHS_SHORT[x.getUTCMonth()]}`;
  return withYear ? `${base} ${x.getUTCFullYear()}` : base;
}

/** Minutes elapsed between two epoch-ms values, floored, never negative. */
export function minutesSince(fromMs: number, nowMs: number): number {
  return Math.max(0, Math.floor((nowMs - fromMs) / 60_000));
}

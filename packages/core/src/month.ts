import { statsTree, sumDeltas, zReport } from "./stats";
import { addDays, MONTHS_SHORT } from "./time";
import type { BizDate, DailyStats, Day, Paise, ZReport } from "./types";

/**
 * Month closing. A month is the calendar month of business dates ("2026-10"). Its report is the
 * sum of its days' figures (live dailyStats, so a late offline sale is in it). Closing needs every
 * day of the month closed (Z done) and the month over; a closed month is frozen in admin.
 */

/** "2026-10" */
export type MonthKey = string;

export const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const;

export const monthOf = (d: BizDate): MonthKey => d.slice(0, 7);

export function isMonthKey(m: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(m);
}

/** First and last business date of a month. */
export function monthRange(m: MonthKey): { from: BizDate; to: BizDate } {
  const from = `${m}-01`;
  return { from, to: addDays(nextMonthStart(m), -1) };
}

function nextMonthStart(m: MonthKey): BizDate {
  const [y, mo] = m.split("-").map(Number) as [number, number];
  return mo === 12 ? `${y + 1}-01-01` : `${y}-${String(mo + 1).padStart(2, "0")}-01`;
}

export function addMonths(m: MonthKey, n: number): MonthKey {
  const [y, mo] = m.split("-").map(Number) as [number, number];
  const t = y * 12 + (mo - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}

/** "October 2026" (or "Oct 2026" short). No Intl. */
export function monthLabel(m: MonthKey, short = false): string {
  const [y, mo] = m.split("-").map(Number) as [number, number];
  return `${(short ? MONTHS_SHORT : MONTHS_LONG)[mo - 1]} ${y}`;
}

/** Months from `from` to `to` inclusive, oldest first. */
export function monthsBetween(from: MonthKey, to: MonthKey): MonthKey[] {
  const out: MonthKey[] = [];
  for (let m = from; m <= to && out.length < 600; m = addMonths(m, 1)) out.push(m);
  return out;
}

export interface MonthReport extends Omit<ZReport, "zNo" | "businessDate" | "closedAtMs" | "drawers"> {
  month: MonthKey;
  from: BizDate;
  to: BizDate;
  /** Days that took orders or moved money. */
  tradingDays: number;
  /** Z numbers of the month's closed days. */
  zFrom?: number;
  zTo?: number;
  bestDay?: { date: BizDate; totalPaise: Paise };
  expByCat: Record<string, Paise>;
  purchaseGstPaise: Paise;
  /** Stock (raw materials + pieces) at the last prices paid, when it was closed in admin. */
  stockWorthPaise?: Paise;
  builtAtMs: number;
}

type DayLike = Pick<Day, "status" | "zNo" | "z"> & { id: BizDate };
type StatsLike = Partial<DailyStats> & { id: BizDate };

const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** One series' invoices over many days: first..last, counts added up. */
export function mergeInvoiceRanges(lists: Array<ZReport["invoiceRanges"]>): ZReport["invoiceRanges"] {
  const by = new Map<string, ZReport["invoiceRanges"][number]>();
  for (const list of lists)
    for (const r of list) {
      const cur = by.get(r.series);
      if (!cur) by.set(r.series, { ...r });
      else {
        // Same series and FY (a month never spans 1 April): zero-padded numbers sort as text.
        if (r.first < cur.first) cur.first = r.first;
        if (r.last > cur.last) cur.last = r.last;
        cur.count += r.count;
        cur.cancelled += r.cancelled;
      }
    }
  return [...by.values()].sort((a, b) => (a.series < b.series ? -1 : 1));
}

/** The month's figures from its days (any order; days outside the month are ignored). */
export function monthReport(i: { month: MonthKey; days: DayLike[]; stats: StatsLike[]; builtAtMs: number; stockWorthPaise?: Paise }): MonthReport {
  const { from, to } = monthRange(i.month);
  const inMonth = <T extends { id: BizDate }>(x: T) => x.id >= from && x.id <= to;
  const stats = i.stats.filter(inMonth);
  const days = i.days.filter(inMonth);
  const summed = sumDeltas(stats.map((s) => statsTree(s)));
  const z = zReport({ zNo: 0, businessDate: to, closedAtMs: i.builtAtMs, stats: summed as Partial<DailyStats>, drawers: [], invoiceRanges: mergeInvoiceRanges(days.map((d) => d.z?.invoiceRanges ?? [])) });
  const { zNo: _z, businessDate: _b, closedAtMs: _c, drawers: _d, ...rest } = z;
  const zNos = days.filter((d) => d.status === "closed" && d.zNo).map((d) => d.zNo!);
  let best: MonthReport["bestDay"];
  for (const s of stats) if (n(s.totalPaise) > (best?.totalPaise ?? 0)) best = { date: s.id, totalPaise: n(s.totalPaise) };
  const expByCat: Record<string, Paise> = {};
  for (const [k, v] of Object.entries((summed.expByCat ?? {}) as Record<string, unknown>)) if (n(v)) expByCat[k] = n(v);
  return {
    ...rest,
    month: i.month,
    from,
    to,
    tradingDays: stats.filter((s) => n(s.orders) || n(s.totalPaise) || n(s.expensesPaise) || n(s.purchasesPaise) || n(s.vendorPaidPaise)).length,
    ...(zNos.length ? { zFrom: Math.min(...zNos), zTo: Math.max(...zNos) } : {}),
    ...(best ? { bestDay: best } : {}),
    expByCat,
    purchaseGstPaise: n(summed.purchaseGstPaise),
    ...(i.stockWorthPaise != null ? { stockWorthPaise: i.stockWorthPaise } : {}),
    builtAtMs: i.builtAtMs,
  };
}

/** Net sales − vendor bills − expenses (vendor payments only move cash). */
export function monthProfit(r: Pick<MonthReport, "netPaise" | "purchasesPaise" | "expensesPaise">): Paise {
  return r.netPaise - (r.purchasesPaise ?? 0) - r.expensesPaise;
}

export interface MonthCheck {
  ok: boolean;
  /** The month hasn't ended yet (business date of today is still in it, or before it). */
  notOver: boolean;
  /** Days of the month still open (incl. sales on a date whose day record is missing). */
  openDays: BizDate[];
}

/** Can the month be closed: it's over and every day in it is closed. */
export function monthCloseCheck(i: { month: MonthKey; today: BizDate; days: DayLike[]; statsDates: BizDate[] }): MonthCheck {
  const { from, to } = monthRange(i.month);
  const notOver = i.today <= to;
  const closed = new Set(i.days.filter((d) => d.status === "closed").map((d) => d.id));
  const open = new Set<BizDate>();
  for (const d of i.days) if (d.id >= from && d.id <= to && d.status !== "closed") open.add(d.id);
  for (const s of i.statsDates) if (s >= from && s <= to && !closed.has(s)) open.add(s);
  const openDays = [...open].sort();
  return { ok: !notOver && openDays.length === 0, notOver, openDays };
}

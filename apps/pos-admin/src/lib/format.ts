import { format, isToday, isTomorrow, isYesterday, differenceInCalendarDays } from "date-fns";

export { formatINR, formatINRCompact, parseINR, bizDateLabel, istDateTimeLabel, istTime, istDateLabel, rateLabel } from "@px-pos/core";

const d = (v: string | number | Date) => (typeof v === "string" || typeof v === "number" ? new Date(v) : v);

export const fmtTime = (v: string | number | Date) => format(d(v), "HH:mm");
export const fmtDate = (v: string | number | Date) => format(d(v), "d MMM yyyy");
export const fmtDateShort = (v: string | number | Date) => format(d(v), "d MMM");
export const fmtDateTime = (v: string | number | Date) => format(d(v), "d MMM, HH:mm");

export function fmtDay(v: string | number | Date) {
  const date = d(v);
  if (isToday(date)) return "Today";
  if (isTomorrow(date)) return "Tomorrow";
  if (isYesterday(date)) return "Yesterday";
  return format(date, "EEE, d MMM");
}

/** Days from today, signed. Negative means in the past. */
export const daysUntil = (v: string | number | Date) => differenceInCalendarDays(d(v), new Date());

/** "3m ago", "2h ago", "5d ago". */
export function ago(ms: number | undefined, now = Date.now()): string {
  if (!ms) return "never";
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join("");
}

/** 12,345 in Indian grouping for counts. */
export function fmtCount(n: number): string {
  return Math.round(n).toLocaleString("en-IN");
}

export function pct(part: number, whole: number): string {
  if (!whole) return "0%";
  return `${Math.round((part / whole) * 100)}%`;
}

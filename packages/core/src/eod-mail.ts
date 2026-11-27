import { formatINR } from "./money";
import { bizDateLabel } from "./time";
import type { BizDate, Paise, ZReport } from "./types";

/*
 * End-of-day email (admin › End of day › Email list): when a day closes, the device that closed it
 * asks pos-admin's /api/eod-mail to send the Z report and item sales, as PDFs, to the outlet's list.
 */

/** Where the admin (and its email endpoint) lives. */
export const ADMIN_ORIGIN = "https://pxpos.postx.in";

export const MAX_EOD_RECIPIENTS = 10;

/** The outlet's list, on the client doc (`client.eodMail`). Empty or missing = no email. */
export interface EodMailSettings {
  to: string[];
  updatedAtMs?: number;
}

/** What happened to one business day's email (`eodMails/{bizDate}`), written by the endpoint. */
export interface EodMailLog {
  businessDate: BizDate;
  status: "sending" | "sent" | "failed";
  to: string[];
  attempts: number;
  lastAttemptMs: number;
  sentAtMs?: number;
  messageId?: string;
  error?: string;
  /** Who asked for it: a till or an admin (uid). */
  by: string;
  source: "app" | "admin";
  updatedAtMs: number;
}

export const normalizeEmail = (s: string) => s.trim().toLowerCase();

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@.]{2,}$/;

/** A reason the address won't work, or null. */
export function validateEmail(s: string): string | null {
  const e = normalizeEmail(s);
  if (!e) return "Enter an email address.";
  if (e.length > 254 || !EMAIL.test(e)) return `${s.trim()} doesn't look like an email address.`;
  return null;
}

/** Valid, lower-cased, without repeats, at most MAX_EOD_RECIPIENTS. */
export function cleanRecipients(list: readonly string[] | undefined | null): string[] {
  const out: string[] = [];
  for (const raw of list ?? []) {
    const e = normalizeEmail(raw);
    if (!validateEmail(e) && !out.includes(e)) out.push(e);
  }
  return out.slice(0, MAX_EOD_RECIPIENTS);
}

const rs = (p: Paise) => formatINR(p);

/** "Tea Room · End of day Mon 23 Nov 2026 · Z 49". */
export function eodMailSubject(outletName: string, z: Pick<ZReport, "businessDate" | "zNo">): string {
  return `${outletName} · End of day ${bizDateLabel(z.businessDate, true)} · Z ${z.zNo}`;
}

/** The figures that head the email, as label/value pairs (payments biggest first). */
export function eodMailSummary(z: ZReport): Array<[string, string]> {
  const pay = Object.entries(z.byPay)
    .filter(([, v]) => v)
    .sort(([, a], [, b]) => b - a)
    .map(([k, v]): [string, string] => [k === "upi" ? "UPI" : k[0]!.toUpperCase() + k.slice(1), rs(v)]);
  return [
    ["Total billed", rs(z.totalPaise)],
    ["Orders", String(z.orders)],
    ...(z.orders ? ([["Average order", rs(Math.round(z.totalPaise / z.orders))]] as Array<[string, string]>) : []),
    ...pay,
  ];
}

/** File names for the two attachments: "Z-49-2026-11-23.pdf", "Items-2026-11-23.pdf". */
export const eodFileNames = (z: Pick<ZReport, "businessDate" | "zNo">) => ({ z: `Z-${z.zNo}-${z.businessDate}.pdf`, items: `Items-${z.businessDate}.pdf` });

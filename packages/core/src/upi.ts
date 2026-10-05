import type { Paise } from "./types";

/** The outlet's UPI collect account: a VPA like "tearoom@okicici" and the name payers see. */
export interface UpiAccount {
  vpa: string;
  payee: string;
}

const VPA = /^[A-Za-z0-9][A-Za-z0-9._-]{1,63}@[A-Za-z][A-Za-z0-9.-]{1,63}$/;

export function validateVpa(vpa: string | undefined | null): string | null {
  if (!vpa) return "Enter the UPI ID";
  return VPA.test(vpa.trim()) ? null : "UPI ID looks like name@bank (for example tearoom@okicici)";
}

/** "125" / "125.50" — UPI wants rupees with at most two decimals. */
function rupees(p: Paise): string {
  const r = Math.floor(p / 100);
  const ps = p % 100;
  return ps ? `${r}.${String(ps).padStart(2, "0")}` : String(r);
}

/**
 * NPCI `upi://pay` link with the amount filled in. Any UPI app (GPay, PhonePe, Paytm, BHIM)
 * opens it with the payee and amount locked; the money goes straight to the outlet's account.
 * `compact` drops escaping and spaces so the QR fits the 65-dot customer display (version 3).
 */
export function upiPayUri(a: UpiAccount, amountPaise: Paise, opts: { note?: string; compact?: boolean } = {}): string {
  const payee = a.payee.trim().slice(0, 25);
  const q = [
    // The UPI ID goes in as typed: validateVpa allows only URL-safe characters, and some bank UPI
    // apps reject an escaped "@" (%40) as an invalid ID. The payee name is escaped (spaces, commas).
    `pa=${a.vpa.trim()}`,
    // Compact keeps the name before any comma ("Tea Room, Kodambakkam" → "TeaRoom").
    `pn=${opts.compact ? (payee.split(",")[0] ?? payee).replace(/[^A-Za-z0-9]/g, "").slice(0, 12) : encodeURIComponent(payee)}`,
    `am=${rupees(amountPaise)}`,
    "cu=INR",
    ...(opts.note && !opts.compact ? [`tn=${encodeURIComponent(opts.note.slice(0, 30))}`] : []),
  ];
  return `upi://pay?${q.join("&")}`;
}

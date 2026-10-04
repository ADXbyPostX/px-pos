import type { Paise, PayMode } from "./types";

export interface TenderInput {
  mode: PayMode;
  /** Amount handed over / charged in this mode. For cash this may exceed what is due (change). */
  amountPaise: Paise;
  ref?: string;
}

export interface AppliedTender {
  mode: PayMode;
  /** Amount kept against the bill (cash: net of change). */
  amountPaise: Paise;
  /** What the customer handed over (cash only). */
  tenderedPaise?: Paise;
  changePaise?: Paise;
  ref?: string;
}

export type TenderResult =
  | { ok: true; duePaise: Paise; changePaise: Paise; applied: AppliedTender[]; remainingPaise: 0 }
  | { ok: false; error: "SHORT" | "OVERPAY_NONCASH" | "EMPTY" | "INVALID"; duePaise: Paise; remainingPaise: Paise; changePaise: 0 };

/**
 * Validate and apply tenders against a bill.
 * due = grand + tip. Non-cash tenders may not exceed what is due (no change on card/UPI);
 * cash covers the rest and any excess becomes change (taken from the last cash tender).
 */
export function settleTenders(grandPaise: Paise, tipPaise: Paise, tenders: TenderInput[]): TenderResult {
  const due = grandPaise + Math.max(0, tipPaise);
  const fail = (error: "SHORT" | "OVERPAY_NONCASH" | "EMPTY" | "INVALID", remaining: Paise): TenderResult => ({
    ok: false,
    error,
    duePaise: due,
    remainingPaise: remaining,
    changePaise: 0,
  });
  if (tenders.some((t) => !Number.isSafeInteger(t.amountPaise) || t.amountPaise < 0)) return fail("INVALID", due);
  const live = tenders.filter((t) => t.amountPaise > 0);
  if (due === 0) return { ok: true, duePaise: 0, changePaise: 0, applied: [], remainingPaise: 0 };
  if (live.length === 0) return fail("EMPTY", due);

  const nonCash = live.filter((t) => t.mode !== "cash").reduce((s, t) => s + t.amountPaise, 0);
  if (nonCash > due) return fail("OVERPAY_NONCASH", 0);
  const cashNeeded = due - nonCash;
  const cashGiven = live.filter((t) => t.mode === "cash").reduce((s, t) => s + t.amountPaise, 0);
  if (cashGiven < cashNeeded) return fail("SHORT", cashNeeded - cashGiven);

  let change = cashGiven - cashNeeded;
  const applied: AppliedTender[] = [];
  // Apply change against cash tenders from the last one backwards.
  const cashIdx = live.map((t, i) => (t.mode === "cash" ? i : -1)).filter((i) => i >= 0);
  const changeByIdx = new Map<number, Paise>();
  for (let k = cashIdx.length - 1; k >= 0 && change > 0; k--) {
    const i = cashIdx[k] as number;
    const take = Math.min(change, (live[i] as TenderInput).amountPaise);
    changeByIdx.set(i, take);
    change -= take;
  }
  live.forEach((t, i) => {
    if (t.mode === "cash") {
      const ch = changeByIdx.get(i) ?? 0;
      applied.push({ mode: "cash", amountPaise: t.amountPaise - ch, tenderedPaise: t.amountPaise, changePaise: ch, ...(t.ref ? { ref: t.ref } : {}) });
    } else {
      applied.push({ mode: t.mode, amountPaise: t.amountPaise, ...(t.ref ? { ref: t.ref } : {}) });
    }
  });
  return { ok: true, duePaise: due, changePaise: cashGiven - cashNeeded, applied: applied.filter((a) => a.amountPaise > 0 || a.mode === "cash"), remainingPaise: 0 };
}

/** Live status for the PayPanel while tenders are being entered. */
export function tenderStatus(grandPaise: Paise, tipPaise: Paise, tenders: TenderInput[]) {
  const due = grandPaise + Math.max(0, tipPaise);
  const paid = tenders.reduce((s, t) => s + Math.max(0, t.amountPaise), 0);
  const nonCash = tenders.filter((t) => t.mode !== "cash").reduce((s, t) => s + Math.max(0, t.amountPaise), 0);
  return {
    duePaise: due,
    paidPaise: paid,
    remainingPaise: Math.max(0, due - paid),
    changePaise: nonCash <= due ? Math.max(0, paid - due) : 0,
    overpaidNonCash: nonCash > due,
  };
}

/** Quick-cash buttons for a due amount: exact, next ₹100, ₹500, ₹2000 (deduplicated, ascending). */
export function quickCash(duePaise: Paise): Paise[] {
  if (duePaise <= 0) return [];
  const up = (step: Paise) => Math.ceil(duePaise / step) * step;
  const values = [duePaise, up(10000), up(50000), up(200000)];
  return [...new Set(values)].filter((v) => v >= duePaise).sort((a, b) => a - b).slice(0, 4);
}

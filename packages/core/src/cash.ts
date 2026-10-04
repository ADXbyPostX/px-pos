import { expectedCashFor } from "./stats";
import type { CashStats, Paise } from "./types";

/** Indian notes and coins, in paise, for the drawer count grid (largest first). */
export const DENOMS: Paise[] = [50000, 20000, 10000, 5000, 2000, 1000, 500, 200, 100];

export const DENOM_LABEL = (p: Paise) => `₹${p / 100}`;

/** Expected cash in a drawer: float + cash sales − refunds + paid-in − paid-out (drawer expenses) − drops. */
export function expectedCash(floatPaise: Paise, cash: CashStats): Paise {
  return expectedCashFor(floatPaise, cash);
}

/** Total of a denomination count { "50000": 3, "100": 7 } in paise. Ignores junk. */
export function countDenoms(counts: Record<string, number>): Paise {
  let total = 0;
  for (const [denom, n] of Object.entries(counts)) {
    const d = Number(denom);
    if (!Number.isSafeInteger(d) || d <= 0 || !Number.isInteger(n) || n < 0) continue;
    total += d * n;
  }
  return total;
}

/** Cash-drawer variance: counted − expected (negative = short). */
export function variance(countedPaise: Paise, expectedPaise: Paise): Paise {
  return countedPaise - expectedPaise;
}

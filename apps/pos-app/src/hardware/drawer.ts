import type { TenderInput } from "@px-pos/core";
import { listUsbPrinters, openCashDrawer } from "../../modules/pos-hardware";

/** A cash drawer hangs off the printer board; machines without one skip the kick. */
export function hasDrawerPort(): boolean {
  return listUsbPrinters().length > 0;
}

/** Open the drawer for a payment that took cash. Resolves to an error message, or null. */
export async function kickDrawerFor(tenders: TenderInput[]): Promise<string | null> {
  if (!tenders.some((t) => t.mode === "cash") || !hasDrawerPort()) return null;
  try {
    await openCashDrawer();
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

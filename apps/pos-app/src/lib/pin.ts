import { parsePinHash, sameHash } from "@px-pos/core";
import { pbkdf2Sha256 } from "../../modules/pos-hardware";

/**
 * Does `pin` match a staff entry's stored PIN hash? Checked on the terminal against the
 * cached staff list, so sign-in works offline. False for a missing or unreadable hash.
 */
export async function pinMatches(pin: string, stored: string | undefined): Promise<boolean> {
  const h = parsePinHash(stored);
  if (!h || pin.length !== h.length) return false;
  return sameHash(await pbkdf2Sha256(pin, h.salt, h.iterations), h.hash);
}

/** Digits in a staff member's PIN (4–6), or null when they have none. */
export function pinLength(stored: string | undefined): number | null {
  return parsePinHash(stored)?.length ?? null;
}

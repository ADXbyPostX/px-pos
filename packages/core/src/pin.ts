/**
 * Till sign-in PINs (staff and admins): 4–6 digits, stored only as a salted PBKDF2-SHA256 hash.
 * The terminal checks a PIN against the cached staff entry, so sign-in works offline. A short
 * PIN can't resist an offline guess at its hash, so this keeps people from working as each
 * other and keeps PINs out of plain sight; it is not a security boundary.
 *
 * Hashing is platform code (WebCrypto in pos-admin, javax.crypto in the app's native module);
 * both are standard PBKDF2-HMAC-SHA256 with a 32-byte key. This file only shapes the string.
 */

export const PIN_ITERATIONS = 50_000;
export const PIN_SALT_BYTES = 16;
export const PIN_KEY_BYTES = 32;
const PREFIX = "pbkdf2-sha256";

export interface PinHash {
  iterations: number;
  /** Digits in the PIN, so the keypad can sign in as soon as the last one is typed. */
  length: number;
  /** base64 */
  salt: string;
  /** base64, PIN_KEY_BYTES long */
  hash: string;
}

/** null when the PIN is acceptable. */
export function validatePin(pin: string): string | null {
  if (!/^\d{4,6}$/.test(pin)) return "PIN must be 4 to 6 digits";
  if (/^(\d)\1+$/.test(pin)) return "Avoid a PIN of one repeated digit";
  if ("0123456789".includes(pin) || "9876543210".includes(pin)) return "Avoid a PIN that counts up or down";
  return null;
}

/** "pbkdf2-sha256$50000$4$<salt>$<hash>" */
export function formatPinHash(h: PinHash): string {
  return [PREFIX, h.iterations, h.length, h.salt, h.hash].join("$");
}

export function parsePinHash(s: string | null | undefined): PinHash | null {
  if (!s) return null;
  const [prefix, iter, len, salt, hash, ...rest] = s.split("$");
  const iterations = Number(iter);
  const length = Number(len);
  if (prefix !== PREFIX || rest.length || !salt || !hash) return null;
  if (!Number.isInteger(iterations) || iterations < 1 || !Number.isInteger(length) || length < 4 || length > 6) return null;
  return { iterations, length, salt, hash };
}

/** Compare two hashes without stopping at the first difference. */
export function sameHash(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

/** The staff entry that stands for a platform admin inside a client they're assigned to. */
export function adminStaffId(uid: string): string {
  return `adm_${uid}`;
}

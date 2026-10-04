import { formatPinHash, PIN_ITERATIONS, PIN_KEY_BYTES, PIN_SALT_BYTES, validatePin } from "@px-pos/core";
import { cryptoRand } from "./ids";

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

/**
 * Hash a till PIN in the browser (WebCrypto PBKDF2-SHA256, fresh salt). The terminal checks it
 * with the same parameters in its native module, offline.
 */
export async function hashPin(pin: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(PIN_SALT_BYTES));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: PIN_ITERATIONS }, key, PIN_KEY_BYTES * 8);
  return formatPinHash({ iterations: PIN_ITERATIONS, length: pin.length, salt: b64(salt), hash: b64(new Uint8Array(bits)) });
}

/** A random 4-digit PIN that passes validatePin (no 1111, no 1234). */
export function suggestPin(): string {
  for (;;) {
    const pin = String(Math.floor(cryptoRand() * 10000)).padStart(4, "0");
    if (!validatePin(pin)) return pin;
  }
}

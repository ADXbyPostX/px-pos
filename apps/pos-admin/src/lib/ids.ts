import { makeId } from "@px-pos/core";

/** Crypto-backed [0,1) for id generation in the browser. */
export function cryptoRand(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return (buf[0] as number) / 2 ** 32;
}

/** Firestore-like 20-char id. */
export function newId(length = 20): string {
  return makeId(cryptoRand, length);
}

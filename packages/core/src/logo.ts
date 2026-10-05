import type { ReceiptLogo } from "./types";

/** 58 mm thermal paper is 384 dots wide (80 mm is 576), so a logo this size fits both. */
export const LOGO_MAX_W = 384;
/** About 25 mm of paper at 8 dots/mm. */
export const LOGO_MAX_H = 200;

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** base64 → bytes (Hermes has no Buffer; no Intl/atob reliance). Null when it isn't valid base64. */
export function decodeBase64(b64: string): Uint8Array | null {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(b64) || b64.length % 4 !== 0) return null;
  const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  const out = new Uint8Array((b64.length / 4) * 3 - pad);
  let o = 0;
  for (let i = 0; i < b64.length; i += 4) {
    const n = (B64.indexOf(b64[i]!) << 18) | (B64.indexOf(b64[i + 1]!) << 12) | ((B64.indexOf(b64[i + 2]!) & 63) << 6) | (B64.indexOf(b64[i + 3]!) & 63);
    if (o < out.length) out[o++] = (n >> 16) & 255;
    if (o < out.length) out[o++] = (n >> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return out;
}

/** bytes → base64. */
export function encodeBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    s += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + (i + 1 < bytes.length ? B64[(n >> 6) & 63]! : "=") + (i + 2 < bytes.length ? B64[n & 63]! : "=");
  }
  return s;
}

export function validateReceiptLogo(l: Partial<ReceiptLogo> | undefined): string | null {
  if (!l || !Number.isInteger(l.w) || !Number.isInteger(l.h) || typeof l.data !== "string") return "The logo is missing or damaged";
  if (l.w! < 8 || l.w! > LOGO_MAX_W || l.w! % 8 !== 0) return `The logo must be 8 to ${LOGO_MAX_W} dots wide`;
  if (l.h! < 1 || l.h! > LOGO_MAX_H) return `The logo must be 1 to ${LOGO_MAX_H} dots tall`;
  const bytes = decodeBase64(l.data);
  if (!bytes || bytes.length !== (l.w! / 8) * l.h!) return "The logo data is damaged";
  return null;
}

/** The logo's packed rows, or null when it's missing or damaged (printing then skips it). */
export function logoRows(l: ReceiptLogo | undefined | null): Uint8Array | null {
  if (!l || validateReceiptLogo(l)) return null;
  return decodeBase64(l.data);
}

import type { Item, ItemPhoto, PhotoMime } from "./types";

/** Photos are stored as PHOTO_SIZE × PHOTO_SIZE JPEGs: sharp on an item tile, small in Firestore. */
export const PHOTO_SIZE = 400;
/** Decoded size cap per photo (the whole doc must stay well under Firestore's 1 MiB). */
export const PHOTO_MAX_BYTES = 200_000;
export const PHOTO_MIMES: readonly PhotoMime[] = ["image/jpeg", "image/webp", "image/png"];

export type PhotoInput = Pick<ItemPhoto, "mime" | "w" | "h" | "bytes" | "data">;

/** Bytes encoded by a base64 string (no data: prefix). */
export function base64Bytes(b64: string): number {
  const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - pad;
}

export function validateItemPhoto(p: Partial<PhotoInput>): string | null {
  if (!p.mime || !PHOTO_MIMES.includes(p.mime)) return "Photos must be JPEG, PNG or WebP";
  if (!p.data || !/^[A-Za-z0-9+/]+={0,2}$/.test(p.data)) return "The photo data is damaged";
  const bytes = base64Bytes(p.data);
  if (bytes > PHOTO_MAX_BYTES) return `The photo is too large (${Math.round(bytes / 1000)} KB, max ${PHOTO_MAX_BYTES / 1000} KB)`;
  if (!Number.isInteger(p.w) || !Number.isInteger(p.h) || (p.w ?? 0) < 32 || (p.h ?? 0) < 32 || (p.w ?? 0) > 2048 || (p.h ?? 0) > 2048) return "The photo size is out of range";
  return null;
}

/** `data:` URI for an <img>/<Image> source, or null when the photo is missing or removed. */
export function photoUri(p: Pick<ItemPhoto, "mime" | "data" | "active"> | null | undefined): string | null {
  return p && p.active && p.data ? `data:${p.mime};base64,${p.data}` : null;
}

// ─── matching photo files to items (bulk upload) ────────────────────────────

const IMAGE_EXT = /\.(jpe?g|png|webp|gif|avif|heic|heif|bmp)$/i;

/** Comparable key for an item name or a file name: "Ginger-Lemon_Tea.JPG" → "gingerlemontea". */
export function photoKey(s: string): string {
  return s
    .toLowerCase()
    .replace(IMAGE_EXT, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "");
}

/** The same key with a trailing copy marker dropped: "Tea (2)", "Tea copy", "tea_1", "Tea-03". */
function looseKey(fileName: string): string {
  return photoKey(fileName.replace(IMAGE_EXT, "").replace(/\s*(\(\d+\)|\bcopy\b|[-_ ]\d{1,2})\s*$/i, ""));
}

export type PhotoMatch =
  | { file: string; status: "matched"; itemId: string }
  | { file: string; status: "duplicate"; itemId: string }
  | { file: string; status: "ambiguous"; itemIds: string[] }
  | { file: string; status: "none" };

/**
 * Match image file names to menu items by name, short name or code — case, spacing,
 * punctuation and "(1)"-style copy markers don't matter. The first file for an item wins;
 * later ones come back as "duplicate".
 */
export function matchPhotoFiles(files: string[], items: Array<Pick<Item, "name" | "shortName" | "code"> & { id: string }>): PhotoMatch[] {
  const byKey = new Map<string, Set<string>>();
  const add = (k: string, id: string) => {
    if (!k) return;
    const s = byKey.get(k) ?? new Set<string>();
    s.add(id);
    byKey.set(k, s);
  };
  for (const i of items) {
    add(photoKey(i.name), i.id);
    if (i.shortName) add(photoKey(i.shortName), i.id);
    if (i.code) add(photoKey(i.code), i.id);
  }
  const taken = new Set<string>();
  return files.map((file): PhotoMatch => {
    const hit = byKey.get(photoKey(file)) ?? byKey.get(looseKey(file));
    if (!hit || hit.size === 0) return { file, status: "none" };
    if (hit.size > 1) return { file, status: "ambiguous", itemIds: [...hit] };
    const itemId = [...hit][0]!;
    if (taken.has(itemId)) return { file, status: "duplicate", itemId };
    taken.add(itemId);
    return { file, status: "matched", itemId };
  });
}

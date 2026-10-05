"use client";

import { encodeBase64, LOGO_MAX_H, LOGO_MAX_W, validateReceiptLogo, type ReceiptLogo } from "@px-pos/core";

export type LogoSize = "s" | "m" | "l";
/** Widths in printer dots: half, three quarters and all of 58 mm paper. */
export const LOGO_SIZES: Record<LogoSize, { label: string; w: number; h: number }> = {
  s: { label: "Small", w: 192, h: 96 },
  m: { label: "Medium", w: 288, h: 144 },
  l: { label: "Large", w: LOGO_MAX_W, h: LOGO_MAX_H },
};

export interface LogoOptions {
  size: LogoSize;
  /** Dither (for photos and gradients) instead of a clean black/white split (for logos). */
  shaded: boolean;
  /** For a light logo (on a dark or transparent background). */
  invert: boolean;
}

/** Big sources are drawn at most this size first; the printer needs a few hundred dots. */
const SOURCE_MAX = 1600;
/** Lighter than this counts as paper when trimming the margins. */
const PAPER = 240;

/** Any image the browser can decode → a canvas, transparency kept (see `flatten`). */
export async function loadLogoSource(file: File): Promise<HTMLCanvasElement> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(`${file.name} isn't an image this browser can read (use PNG, JPEG or WebP).`);
  }
  try {
    const k = Math.min(1, SOURCE_MAX / Math.max(bitmap.width, bitmap.height));
    const c = canvas(Math.max(1, Math.round(bitmap.width * k)), Math.max(1, Math.round(bitmap.height * k)));
    const ctx = c.getContext("2d")!;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, c.width, c.height);
    return c;
  } finally {
    bitmap.close();
  }
}

/**
 * A white logo on a transparent background (made for dark websites): on paper it would vanish,
 * so the field suggests Invert.
 */
export function looksWhite(src: HTMLCanvasElement): boolean {
  const d = src.getContext("2d")!.getImageData(0, 0, src.width, src.height).data;
  let clear = 0;
  let solid = 0;
  let light = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3]! < 16) clear++;
    else if (d[i + 3]! > 128) {
      solid++;
      if (0.299 * d[i]! + 0.587 * d[i + 1]! + 0.114 * d[i + 2]! > 200) light++;
    }
  }
  return clear > d.length / 4 / 10 && solid > 0 && light / solid > 0.5;
}

/**
 * The source on paper. Normally that's white paper; with Invert it's laid on black and then
 * inverted, so a light logo prints black while its transparent background stays paper.
 */
function flatten(src: HTMLCanvasElement, invert: boolean): HTMLCanvasElement {
  const c = canvas(src.width, src.height);
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = invert ? "#000000" : "#ffffff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(src, 0, 0);
  return c;
}

/**
 * The source → the 1-bit logo the printer draws: margins trimmed, scaled to the chosen size,
 * centred in a multiple of 8 dots, then split into black and white (Otsu's threshold, so a
 * light-coloured logo still prints) or dithered.
 */
export function makeReceiptLogo(source: HTMLCanvasElement, o: LogoOptions): ReceiptLogo {
  const src = flatten(source, o.invert);
  const lum = luminance(src.getContext("2d")!.getImageData(0, 0, src.width, src.height), o.invert);
  // Trim to the ink.
  let x0 = src.width;
  let y0 = src.height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < src.height; y++)
    for (let x = 0; x < src.width; x++)
      if (lum[y * src.width + x]! < PAPER) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  if (x1 < 0) throw new Error(o.invert ? "With Invert on, this image has nothing to print." : "This image is blank (all white or transparent).");
  const bw = x1 - x0 + 1;
  const bh = y1 - y0 + 1;
  const box = LOGO_SIZES[o.size];
  const k = Math.min(box.w / bw, box.h / bh);
  const w = Math.max(1, Math.min(box.w, Math.round(bw * k)));
  const h = Math.max(1, Math.min(box.h, Math.round(bh * k)));
  const out = canvas(w, h);
  const ctx = out.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, x0, y0, bw, bh, 0, 0, w, h);
  const px = luminance(ctx.getImageData(0, 0, w, h), o.invert);
  const ink = o.shaded ? dither(px, w, h) : split(px);

  const w8 = Math.ceil(w / 8) * 8;
  const pad = Math.floor((w8 - w) / 2);
  const rows = new Uint8Array((w8 / 8) * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (ink[y * w + x]) {
        const X = x + pad;
        rows[y * (w8 / 8) + (X >> 3)]! |= 0x80 >> (X & 7);
      }
  const logo: ReceiptLogo = { w: w8, h, data: encodeBase64(rows) };
  const err = validateReceiptLogo(logo);
  if (err) throw new Error(err);
  return logo;
}

/** Share of black dots: a logo that prints mostly black usually wants Invert. */
export function inkShare(logo: ReceiptLogo): number {
  const bin = atob(logo.data);
  let on = 0;
  for (let i = 0; i < bin.length; i++) {
    let b = bin.charCodeAt(i);
    while (b) {
      on += b & 1;
      b >>= 1;
    }
  }
  return on / (logo.w * logo.h);
}

/** Black-on-white PNG of exactly what the printer will draw (one pixel per dot). */
export function logoPreviewUrl(logo: ReceiptLogo): string | null {
  if (typeof document === "undefined" || validateReceiptLogo(logo)) return null;
  const bin = atob(logo.data);
  const c = canvas(logo.w, logo.h);
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(logo.w, logo.h);
  const wb = logo.w / 8;
  for (let y = 0; y < logo.h; y++)
    for (let x = 0; x < logo.w; x++) {
      const v = bin.charCodeAt(y * wb + (x >> 3)) & (0x80 >> (x & 7)) ? 0 : 255;
      const i = (y * logo.w + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  return c.toDataURL("image/png");
}

function luminance(img: ImageData, invert: boolean): Uint8ClampedArray {
  const out = new Uint8ClampedArray(img.width * img.height);
  for (let i = 0; i < out.length; i++) {
    const v = 0.299 * img.data[i * 4]! + 0.587 * img.data[i * 4 + 1]! + 0.114 * img.data[i * 4 + 2]!;
    out[i] = invert ? 255 - v : v;
  }
  return out;
}

/** Otsu: the grey level that best separates ink from paper. */
function split(px: Uint8ClampedArray): Uint8Array {
  const hist = new Array<number>(256).fill(0);
  for (const v of px) hist[v]!++;
  const total = px.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i]!;
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let t = 128;
  for (let i = 0; i < 256; i++) {
    wB += hist[i]!;
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += i * hist[i]!;
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) {
      best = between;
      t = i;
    }
  }
  // Never call near-white paper ink, even on an image with almost no contrast.
  t = Math.min(t, PAPER - 1);
  const ink = new Uint8Array(px.length);
  for (let i = 0; i < px.length; i++) ink[i] = px[i]! <= t ? 1 : 0;
  return ink;
}

/** Floyd–Steinberg dithering. */
function dither(px: Uint8ClampedArray, w: number, h: number): Uint8Array {
  const f = Float32Array.from(px);
  const ink = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const old = f[i]!;
      const black = old < 128;
      ink[i] = black ? 1 : 0;
      const err = old - (black ? 0 : 255);
      if (x + 1 < w) f[i + 1]! += (err * 7) / 16;
      if (y + 1 < h) {
        if (x > 0) f[i + w - 1]! += (err * 3) / 16;
        f[i + w]! += (err * 5) / 16;
        if (x + 1 < w) f[i + w + 1]! += err / 16;
      }
    }
  return ink;
}

function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

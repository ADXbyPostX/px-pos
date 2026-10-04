"use client";

import { base64Bytes, PHOTO_MAX_BYTES, PHOTO_SIZE, validateItemPhoto, type PhotoInput } from "@px-pos/core";

export type PreparedPhoto = PhotoInput & { uri: string };

const MIN_SIDE = 120;

/**
 * Any photo the browser can decode → a centre-cropped PHOTO_SIZE square JPEG, small enough to
 * store inline. Large camera photos are halved step by step first, which keeps them sharp.
 */
export async function prepareItemPhoto(file: File): Promise<PreparedPhoto> {
  if (/\.(heic|heif)$/i.test(file.name) || /heic|heif/i.test(file.type)) {
    throw new Error(`${file.name}: HEIC photos can't be read in the browser. Open it in Preview, choose File › Export, pick JPEG, then upload that.`);
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error(`${file.name} isn't an image this browser can read (use JPEG, PNG or WebP).`);
  }
  try {
    const side = Math.min(bitmap.width, bitmap.height);
    if (side < MIN_SIDE) throw new Error(`${file.name} is too small (${bitmap.width}×${bitmap.height}). Use a photo at least ${MIN_SIDE} px on each side.`);
    const size = Math.min(PHOTO_SIZE, side);

    // Square crop from the centre, then halve until within 2× of the target.
    let src: CanvasImageSource = bitmap;
    let s = side;
    let sx = (bitmap.width - side) / 2;
    let sy = (bitmap.height - side) / 2;
    while (s / 2 >= size * 1.5) {
      const half = Math.round(s / 2);
      const step = canvas(half);
      step.getContext("2d")!.drawImage(src, sx, sy, s, s, 0, 0, half, half);
      src = step;
      s = half;
      sx = 0;
      sy = 0;
    }
    const out = canvas(size);
    const ctx = out.getContext("2d")!;
    ctx.fillStyle = "#ffffff"; // transparent PNGs become white, not black
    ctx.fillRect(0, 0, size, size);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(src, sx, sy, s, s, 0, 0, size, size);

    for (const q of [0.82, 0.72, 0.6, 0.5]) {
      const uri = out.toDataURL("image/jpeg", q);
      const data = uri.slice(uri.indexOf(",") + 1);
      const bytes = base64Bytes(data);
      if (bytes > PHOTO_MAX_BYTES) continue;
      const photo: PhotoInput = { mime: "image/jpeg", w: size, h: size, bytes, data };
      const err = validateItemPhoto(photo);
      if (err) throw new Error(`${file.name}: ${err}`);
      return { ...photo, uri };
    }
    throw new Error(`${file.name} is too detailed to shrink enough. Try a simpler photo.`);
  } finally {
    bitmap.close();
  }
}

function canvas(side: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = side;
  c.height = side;
  return c;
}

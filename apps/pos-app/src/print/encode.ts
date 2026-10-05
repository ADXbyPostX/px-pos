import ReceiptPrinterEncoder from "@point-of-sale/receipt-printer-encoder";
import { logoRows, type Cols, type ReceiptLine, type ReceiptLogo } from "@px-pos/core";

/** Rows per GS v 0 band: small enough for printers with tiny buffers and band-height limits. */
const BAND = 24;

/**
 * The logo as centred ESC/POS raster bands (GS v 0). Alignment is set and reset here because
 * the encoder only emits it for text lines.
 */
export function logoBytes(logo: ReceiptLogo): Uint8Array | null {
  const rows = logoRows(logo);
  if (!rows) return null;
  const wb = logo.w / 8;
  const out: number[] = [0x1b, 0x61, 0x01];
  for (let y = 0; y < logo.h; y += BAND) {
    const h = Math.min(BAND, logo.h - y);
    out.push(0x1d, 0x76, 0x30, 0x00, wb & 0xff, wb >> 8, h & 0xff, h >> 8);
    for (let i = y * wb; i < (y + h) * wb; i++) out.push(rows[i]!);
  }
  out.push(0x1b, 0x61, 0x00);
  return Uint8Array.from(out);
}

const encoder = (cols: Cols) => new ReceiptPrinterEncoder({ language: "esc-pos", columns: cols, feedBeforeCut: 3 });

/**
 * Receipt lines (from @px-pos/core renderInvoice/renderKot/renderZ, already fitted to the
 * paper width) → ESC/POS bytes. 32 columns = 58 mm, 48 columns = 80 mm. The encoder pads
 * centred text with spaces inside its line buffer, so the logo goes out between encoder runs,
 * never through it.
 */
export function encodeReceipt(lines: ReceiptLine[], cols: Cols): Uint8Array {
  const parts: Uint8Array[] = [];
  let enc = encoder(cols);
  enc.initialize();
  for (const l of lines) {
    if (l.kind === "image") {
      const bytes = logoBytes(l.logo);
      if (!bytes) continue;
      parts.push(enc.encode(), bytes);
      enc = encoder(cols);
    } else if (l.kind === "rule") enc.line((l.char ?? "-").repeat(cols));
    else if (l.kind === "feed") enc.newline(l.lines ?? 1);
    else if (l.kind === "cut") enc.cut("partial");
    else {
      enc.align(l.align ?? "left");
      if (l.bold) enc.bold(true);
      if (l.invert) enc.invert(true);
      if (l.size === 2) enc.size(2, 2);
      enc.line(l.text);
      if (l.size === 2) enc.size(1, 1);
      if (l.invert) enc.invert(false);
      if (l.bold) enc.bold(false);
      enc.align("left");
    }
  }
  parts.push(enc.encode());
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** A tiny self-test page (printer setup screen). */
export function testPage(cols: Cols, terminalName: string): Uint8Array {
  const lines: ReceiptLine[] = [
    { kind: "text", text: "PX POS", align: "center", bold: true, size: 2 },
    { kind: "text", text: "Printer test", align: "center" },
    { kind: "rule" },
    { kind: "text", text: `Terminal: ${terminalName}` },
    { kind: "text", text: `Paper: ${cols === 48 ? "80 mm" : "58 mm"} (${cols} columns)` },
    { kind: "text", text: "0123456789".repeat(Math.ceil(cols / 10)).slice(0, cols) },
    { kind: "rule", char: "=" },
    { kind: "feed", lines: 2 },
    { kind: "cut" },
  ];
  return encodeReceipt(lines, cols);
}

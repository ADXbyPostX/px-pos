import ReceiptPrinterEncoder from "@point-of-sale/receipt-printer-encoder";
import type { Cols, ReceiptLine } from "@px-pos/core";

/**
 * Receipt lines (from @px-pos/core renderInvoice/renderKot/renderZ, already fitted to the
 * paper width) → ESC/POS bytes. 32 columns = 58 mm, 48 columns = 80 mm.
 */
export function encodeReceipt(lines: ReceiptLine[], cols: Cols): Uint8Array {
  const enc = new ReceiptPrinterEncoder({ language: "esc-pos", columns: cols, feedBeforeCut: 3 });
  enc.initialize();
  for (const l of lines) {
    if (l.kind === "rule") enc.line((l.char ?? "-").repeat(cols));
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
  return enc.encode();
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

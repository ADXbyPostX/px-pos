import { printsKots, renderInvoice, renderKot, type Client, type Cols, type InvoicePrint, type KotPrint, type Terminal } from "@px-pos/core";
import { btPrinterPref } from "@/local/prefs";
import { encodeReceipt } from "./encode";
import { bluetoothPrinter, builtInPrinter, lanPrinter, type PrinterTransport } from "./transport";

type PrinterCfg = NonNullable<Terminal["printers"]["receipt"]>;
const cols = (p: PrinterCfg): Cols => (p.width === 58 ? 32 : 48);

export interface Route {
  transport: PrinterTransport;
  cols: Cols;
  kind: "bluetooth" | "lan" | "usb";
  label: string;
}

/**
 * Where a job goes: the Bluetooth printer chosen on this machine (Sync › Hardware), else the
 * configured LAN printer, else the terminal's own USB printer (built-in ones like the TP-482C's
 * are 2-inch: 32 columns). Null = nothing to print on.
 */
export function route(p: PrinterCfg | undefined): Route | null {
  const bt = btPrinterPref();
  if (bt) return { transport: bluetoothPrinter(bt.address), cols: bt.width === 80 ? 48 : 32, kind: "bluetooth", label: `Bluetooth printer ${bt.name}` };
  if (p?.host) return { transport: lanPrinter({ host: p.host, port: p.port || 9100 }), cols: cols(p), kind: "lan", label: `Network printer ${p.host}` };
  const usb = builtInPrinter();
  return usb ? { transport: usb.transport, cols: p?.width === 80 ? 48 : 32, kind: "usb", label: `Built-in printer (${usb.name})` } : null;
}

/**
 * Best-effort printing (never blocks a sale). The retrying print queue arrives in M8;
 * until then a failure is reported to the caller for a toast.
 */
export async function printInvoice(terminal: Terminal, client: Client, inv: InvoicePrint, copy: "ORIGINAL" | "DUPLICATE" = "ORIGINAL"): Promise<string | null> {
  const r = route(terminal.printers?.receipt);
  if (!r) return null;
  try {
    await r.transport.send(encodeReceipt(renderInvoice(inv, client.receipt, { copy, cols: r.cols }), r.cols));
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

/** KOT tickets, unless the outlet's kitchen or its KOT printing is off (admin › Order modes). */
export async function printKots(terminal: Terminal, client: Pick<Client, "kitchen">, kots: KotPrint[]): Promise<string | null> {
  if (!printsKots(client)) return null;
  const r = route(terminal.printers?.kot ?? terminal.printers?.receipt);
  if (!r || kots.length === 0) return null;
  try {
    for (const k of kots) await r.transport.send(encodeReceipt(renderKot(k, { cols: r.cols }), r.cols));
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

import { formatINR, upiPayUri, type Paise, type UpiAccount } from "@px-pos/core";
import { qrRows } from "@/lib/qr";
import { customerDisplayShow, customerDisplayShowQr, type DisplayLine } from "../../modules/pos-hardware";

const rs = (p: Paise) => formatINR(p, { decimals: "auto" });

/** "Tea Room, Kodambakkam" → ["Tea Room", "Kodambakkam"]. */
function splitOutlet(name: string): [string, string] {
  const i = name.indexOf(",");
  return i > 0 ? [name.slice(0, i).trim(), name.slice(i + 1).trim()] : [name.trim(), ""];
}

/** The pictures on the customer display (132×65 dots), as lines the native side lays out. */
export const screens = {
  welcome(outlet: string): DisplayLine[] {
    const [name, place] = splitOutlet(outlet);
    return [
      { text: "Welcome to", size: 12, bold: false, center: true },
      { text: name.toUpperCase(), size: 22, center: true },
      ...(place ? [{ text: place, size: 12, bold: false, center: true }] : []),
    ];
  },
  cart(last: { name: string; qty: number; unitPaise: Paise }, totalPaise: Paise): DisplayLine[] {
    return [
      { text: last.name, size: 14 },
      { text: `${last.qty} × ${rs(last.unitPaise)}`, right: rs(last.unitPaise * last.qty), size: 12, bold: false },
      { text: "", rule: true },
      { text: "Total", right: rs(totalPaise), size: 20 },
    ];
  },
  pay(totalPaise: Paise, how?: string): DisplayLine[] {
    return [
      { text: how ? `Please pay by ${how}` : "Please pay", size: 13, bold: false, center: true },
      { text: rs(totalPaise), size: 30, center: true },
    ];
  },
  /** Beside the QR (~64 dots wide). */
  upi(amountPaise: Paise): DisplayLine[] {
    return [
      { text: "Scan to pay", size: 11, bold: false, center: true },
      { text: "UPI", size: 13, center: true },
      { text: rs(amountPaise), size: 17, center: true },
    ];
  },
  thanks(changePaise: Paise): DisplayLine[] {
    return changePaise > 0
      ? [
          { text: "Thank you!", size: 20, center: true },
          { text: "", rule: true },
          { text: "Change", right: rs(changePaise), size: 16 },
        ]
      : [
          { text: "Thank you!", size: 22, center: true },
          { text: "Please visit again", size: 12, bold: false, center: true },
        ];
  },
  test(): DisplayLine[] {
    return [
      { text: "PX POS", size: 22, center: true },
      { text: "Customer display OK", size: 12, bold: false, center: true },
      { text: "Total", right: rs(12500), size: 16 },
    ];
  },
};

const THANKS_MS = 6000;
let outlet = "";
let holding: ReturnType<typeof setTimeout> | null = null;

function release() {
  if (holding) clearTimeout(holding);
  holding = null;
}

/**
 * What the customer sees, driven by the register. "Thank you" stays up for a few seconds
 * even if the cashier starts a new ticket at once; the first item added replaces it.
 * Silently does nothing on machines without a customer display.
 */
export const customerDisplay = {
  setOutlet(name: string) {
    outlet = name;
  },
  idle() {
    if (!holding) customerDisplayShow(screens.welcome(outlet));
  },
  cart(last: { name: string; qty: number; unitPaise: Paise }, totalPaise: Paise) {
    release();
    customerDisplayShow(screens.cart(last, totalPaise));
  },
  pay(totalPaise: Paise, how?: string) {
    release();
    customerDisplayShow(screens.pay(totalPaise, how));
  },
  /**
   * UPI QR with the amount. The display is 65 dots tall, so the QR must be version 3
   * (29 modules, 2 dots each); a longer UPI ID falls back to "Please pay by UPI".
   */
  upi(account: UpiAccount, amountPaise: Paise) {
    release();
    const rows = qrRows(upiPayUri(account, amountPaise, { compact: true }), "L");
    if (rows.length <= 29) customerDisplayShowQr(rows, screens.upi(amountPaise));
    else customerDisplayShow(screens.pay(amountPaise, "UPI"));
  },
  thanks(changePaise: Paise) {
    release();
    customerDisplayShow(screens.thanks(changePaise));
    holding = setTimeout(() => {
      holding = null;
      customerDisplayShow(screens.welcome(outlet));
    }, THANKS_MS);
  },
};

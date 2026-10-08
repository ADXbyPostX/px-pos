"use client";

import { RECEIPT_PARTS, type Client, type ReceiptPart, type TaxMode } from "@px-pos/core";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

type Receipt = Client["receipt"];
type Row = { key: string; label: string; checked: boolean; locked?: boolean; onChange?: (on: boolean) => void };

/** The receipt with `part` printed or left off; `hide` keeps print order and is dropped when empty. */
function withPart(r: Receipt, part: ReceiptPart, on: boolean): Receipt {
  const hide = RECEIPT_PARTS.map((p) => p.part).filter((p) => (p === part ? !on : (r.hide ?? []).includes(p)));
  const next = { ...r };
  if (hide.length) next.hide = hide;
  else delete next.hide;
  return next;
}

/**
 * What prints on a bill, top to bottom like the receipt. Items, the items total and TOTAL always
 * print (shown ticked and locked); everything else can be left off.
 */
export function ReceiptPartsField({ receipt, taxMode, onChange }: { receipt: Receipt; taxMode: TaxMode; onChange: (r: Receipt) => void }) {
  const regular = taxMode === "regular";
  const logoPrints = Boolean(receipt.logo) && receipt.showLogo !== false;
  const part = (p: ReceiptPart, label?: string): Row => ({
    key: p,
    label: label ?? RECEIPT_PARTS.find((x) => x.part === p)?.label ?? p,
    checked: !receipt.hide?.includes(p),
    onChange: (on) => onChange(withPart(receipt, p, on)),
  });
  const rows: Row[] = [
    ...(receipt.logo ? [{ key: "logo", label: "Logo (replaces the outlet name)", checked: receipt.showLogo !== false, onChange: (on: boolean) => onChange({ ...receipt, showLogo: on }) }] : []),
    ...(logoPrints ? [] : [part("name")]),
    part("address"),
    part("phone"),
    part("gstin"),
    part("fssai"),
    part("docTitle", regular ? "Tax invoice heading" : "Bill of supply heading"),
    part("copy"),
    part("invoiceNo"),
    part("date"),
    part("orderNo"),
    part("orderType"),
    part("staff"),
    part("placeOfSupply"),
    { key: "items", label: "Items", checked: true, locked: true },
    { key: "itemsTotal", label: regular ? "Items total incl. GST" : "Items subtotal", checked: true, locked: true },
    ...(regular ? [part("taxes")] : []),
    { key: "total", label: "TOTAL", checked: true, locked: true },
    part("payments"),
    ...(regular ? [{ key: "sac", label: "SAC code 996331", checked: receipt.showSac, onChange: (on: boolean) => onChange({ ...receipt, showSac: on }) }] : []),
    part("taxNote", regular ? "Reverse charge: No" : "Composition declaration"),
    part("token", "Token number (quick orders)"),
  ];

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="pb-2 text-sm font-medium">Print on the bill</legend>
      <div className="gap-x-6 sm:columns-2">
        {rows.map((r) => {
          const id = `st-receipt-${r.key}`;
          return (
            <div key={r.key} className="flex min-h-11 break-inside-avoid items-center gap-2.5 sm:min-h-9">
              <Checkbox id={id} checked={r.checked} disabled={r.locked} onCheckedChange={(v) => r.onChange?.(v === true)} />
              <Label htmlFor={id} className={r.locked ? "font-normal text-muted-foreground" : "cursor-pointer font-normal"}>
                {r.label}
              </Label>
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}

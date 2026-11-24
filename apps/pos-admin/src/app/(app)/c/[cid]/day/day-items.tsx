"use client";

import { collection, query, where } from "firebase/firestore";
import { Download, Printer, ReceiptText } from "lucide-react";
import { bizDateLabel, itemLabel, itemSales, paths, receiptText, renderItemSales, type BizDate, type Invoice, type ItemSales } from "@px-pos/core";
import { Button } from "@/components/ui/button";
import { Loadable } from "@/components/shared/loadable";
import { csvRupees, csvText, downloadCsv, fileSafe, printText } from "@/lib/export";
import { useCollection, useNow } from "@/lib/firebase/hooks";

/** Per dish, for the accountant: quantity, gross (GST incl.), discounts and taxable value. */
function itemsCsv(s: ItemSales): string {
  const rows: Array<Array<string | number>> = [["Item", "Size", "Qty", "Gross (incl. GST)", "Discounts", "Taxable value (excl. GST)"]];
  for (const r of s.rows) rows.push([r.name, r.variantName ?? "", r.qty, csvRupees(r.grossPaise), csvRupees(r.discPaise), csvRupees(r.taxablePaise)]);
  rows.push(["Total", "", s.qty, csvRupees(s.grossPaise), csvRupees(s.discPaise), csvRupees(s.taxablePaise)]);
  return csvText(rows);
}

/**
 * Item sales for one business day, added up from that day's bills (cancelled ones left out), so
 * it works for any day already closed. Loaded only while the Items tab is open; live while the
 * day is open.
 */
export function DayItems({ cid, outletName, businessDate, live }: { cid: string; outletName: string; businessDate: BizDate; live: boolean }) {
  const now = useNow(60_000);
  const invoices = useCollection<Invoice>(`invoices-day:${cid}:${businessDate}`, (db) => query(collection(db, paths.col(cid, "invoices")), where("businessDate", "==", businessDate)));
  const sales = itemSales(invoices.data);
  const text = receiptText(renderItemSales(sales, { cols: 48, outletName, businessDate, printedAtMs: now, live }), 48);

  return (
    <Loadable state={invoices} onRetry={invoices.retry} empty={{ icon: ReceiptText, label: "No bills on this day." }} isEmpty={() => !sales.rows.length}>
      {() => (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-end gap-1">
            <Button variant="ghost" size="sm" onClick={() => printText(`${outletName} · Item sales · ${bizDateLabel(businessDate, true)}`, text)}>
              <Printer data-icon="inline-start" aria-hidden />
              Print
            </Button>
            <Button variant="ghost" size="sm" onClick={() => downloadCsv(`${fileSafe(outletName)}-items-${businessDate}.csv`, itemsCsv(sales))}>
              <Download data-icon="inline-start" aria-hidden />
              CSV
            </Button>
          </div>
          <pre aria-label={`Item sales, ${sales.rows.length} items`} className="overflow-x-auto rounded-lg border bg-white px-3 py-3 font-mono text-[11px] leading-snug text-black">
            {text}
          </pre>
          {/* The receipt is one block of text; screen readers also get the list. */}
          <ul className="sr-only">
            {sales.rows.map((r) => (
              <li key={itemLabel(r)}>{`${itemLabel(r)}: ${r.qty} sold, gross ${csvRupees(r.grossPaise)} rupees`}</li>
            ))}
          </ul>
        </div>
      )}
    </Loadable>
  );
}

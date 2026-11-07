"use client";

import { useMemo, useState } from "react";
import { collection, documentId, limit, orderBy, query, where } from "firebase/firestore";
import { CalendarRange, Download, Loader2, Printer } from "lucide-react";
import {
  addMonths,
  bizDateLabel,
  businessDateFor,
  closeMonthPlan,
  formatINR,
  lastRates,
  monthCloseCheck,
  monthLabel,
  monthOf,
  monthProfit,
  monthRange,
  monthReport,
  monthsBetween,
  netSales,
  paths,
  receiptText,
  renderMonth,
  reopenMonthPlan,
  addDays,
  type DailyStats,
  type Day,
  type MonthKey,
  type MonthReport,
  type StockSnapshot,
} from "@px-pos/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { DataTable, type Column } from "@/components/shared/data-table";
import { Field } from "@/components/shared/field";
import { Loadable } from "@/components/shared/loadable";
import { Money } from "@/components/shared/money";
import { PageHeader } from "@/components/shared/page-header";
import { KV } from "@/components/shared/panel";
import { RecordSheet } from "@/components/shared/record-sheet";
import { Stat, Stats } from "@/components/shared/stat";
import { Flag, Pill } from "@/components/shared/status-badge";
import { useClient } from "@/components/providers/client-provider";
import { usePrincipal } from "@/components/providers/principal-provider";
import { stockValue } from "@/components/inventory/material-sheet";
import { useMonths } from "@/hooks/use-months";
import { useMaterials, useRecentPurchases } from "@/hooks/use-vendors";
import { useCollection, useDoc, useNow, type WithId } from "@/lib/firebase/hooks";
import { fmtDateTime } from "@/lib/format";
import { useRunPlan } from "@/lib/run-plan";

type Status = "closed" | "ready" | "open-days" | "current";
interface Row {
  month: MonthKey;
  status: Status;
  /** The frozen report once closed, else the live one. */
  report: MonthReport;
  live: MonthReport;
  openDays: string[];
  closedAtMs?: number;
  closedBy?: string;
  /** Live total − frozen total: sales that arrived after it was closed. */
  lateDiff: number;
}

const rs = (p: number) => formatINR(p, { decimals: "auto" });

function StatusPill({ r }: { r: Row }) {
  if (r.status === "closed") return <Pill tone="white" label="Closed" />;
  if (r.status === "ready") return <Pill tone="green" label="Ready to close" />;
  if (r.status === "current") return <Pill tone="zinc" label="This month" muted />;
  return <Pill tone="yellow" label={`${r.openDays.length} day${r.openDays.length === 1 ? "" : "s"} open`} />;
}

/** Comma-separated, quoted where needed. */
const csvCell = (v: string | number) => (typeof v === "number" ? String(v) : /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const paise = (p: number | undefined) => ((p ?? 0) / 100).toFixed(2);

/** Per-day lines, GST by rate and the month's totals, for the accountant. */
function monthCsv(r: MonthReport, days: Array<WithId<DailyStats>>, zOf: Map<string, number | undefined>): string {
  const head = ["Date", "Z", "Orders", "Gross", "Discounts", "Net sales", "CGST", "SGST", "Round off", "Total billed", "Cash", "UPI", "Card", "Other", "Expenses", "Bought (vendor bills)", "Paid to vendors"];
  const lines = [head];
  for (const d of [...days].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const disc = (d.itemDiscPaise ?? 0) + (d.billDiscPaise ?? 0);
    lines.push([d.id, String(zOf.get(d.id) ?? ""), String(d.orders ?? 0), paise(d.grossPaise), paise(disc), paise(netSales(d)), paise(d.cgstPaise), paise(d.sgstPaise), paise(d.roundOffPaise), paise(d.totalPaise), paise(d.byPay?.cash), paise(d.byPay?.upi), paise(d.byPay?.card), paise(d.byPay?.other), paise(d.expensesPaise), paise(d.purchasesPaise), paise(d.vendorPaidPaise)]);
  }
  lines.push(["Total", r.zFrom != null ? `${r.zFrom}-${r.zTo}` : "", String(r.orders), paise(r.grossPaise), paise(r.discountsPaise), paise(r.netPaise), paise(r.cgstPaise), paise(r.sgstPaise), paise(r.roundOffPaise), paise(r.totalPaise), paise(r.byPay.cash), paise(r.byPay.upi), paise(r.byPay.card), paise(r.byPay.other), paise(r.expensesPaise), paise(r.purchasesPaise), paise(r.vendorPaidPaise)]);
  lines.push([]);
  lines.push(["GST rate", "Taxable value", "CGST", "SGST", "Total GST"]);
  for (const [bps, v] of Object.entries(r.byTaxBps)) lines.push([`${Number(bps) / 100}%`, paise(v.taxable), paise(v.cgst), paise(v.sgst), paise(v.cgst + v.sgst)]);
  lines.push([]);
  lines.push(["Invoice series", "First", "Last", "Issued", "Cancelled"]);
  for (const ir of r.invoiceRanges) lines.push([ir.series, ir.first, ir.last, String(ir.count), String(ir.cancelled)]);
  return lines.map((l) => l.map(csvCell).join(",")).join("\n");
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The report as it prints on the till, in a print window. */
function printText(title: string, text: string) {
  const w = window.open("", "_blank", "width=480,height=720");
  if (!w) return;
  const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  w.document.write(`<!doctype html><title>${title}</title><pre style="font:12px/1.35 ui-monospace,Menlo,monospace;margin:16px">${esc}</pre>`);
  w.document.close();
  w.focus();
  w.print();
}

/**
 * Months: each month's report from its days, and Close month once it's over and every day is
 * closed. A closed month is frozen in admin; the super admin can open it again.
 */
export function MonthsView() {
  const { cid, client } = useClient();
  const { planCtx, isSuper } = usePrincipal();
  const { run } = useRunPlan();
  const now = useNow(60_000);
  const today = businessDateFor(now, client.day.cutoffMin);
  const thisMonth = monthOf(today);
  const months = useMonths(cid);
  // From the outlet's first month: its creation, or its first day if older (a copied outlet, back-filled days).
  const firstDay = useCollection<Day>(`firstday:${cid}`, (db) => query(collection(db, paths.col(cid, "days")), orderBy(documentId()), limit(1)));
  const firstStats = useCollection<DailyStats>(`firststats:${cid}`, (db) => query(collection(db, paths.col(cid, "dailyStats")), orderBy(documentId()), limit(1)));
  const first = [monthOf(businessDateFor(client.createdAtMs ?? now, client.day.cutoffMin)), ...[firstDay.data[0]?.id, firstStats.data[0]?.id].filter((d): d is string => Boolean(d)).map(monthOf)].sort()[0]!;
  const loadedFirst = months.status === "ready" && firstDay.status !== "loading" && firstStats.status !== "loading";
  // The earliest month still open (or the first month): every day from there, live.
  const firstOpen = monthsBetween(first, thisMonth).find((m) => months.byMonth.get(m)?.status !== "closed") ?? thisMonth;
  const since = monthRange(loadedFirst ? (firstOpen < addMonths(thisMonth, -2) ? firstOpen : addMonths(thisMonth, -2)) : thisMonth).from;
  const stats = useCollection<DailyStats>(loadedFirst ? `mstats:${cid}:${since}` : null, (db) => query(collection(db, paths.col(cid, "dailyStats")), where(documentId(), ">=", since)));
  const days = useCollection<Day>(loadedFirst ? `mdays:${cid}:${since}` : null, (db) => query(collection(db, paths.col(cid, "days")), where(documentId(), ">=", since)));
  const materials = useMaterials(cid);
  const recent = useRecentPurchases(cid, addDays(today, -120));
  const [openMonth, setOpenMonth] = useState<MonthKey | null>(null);
  const [closing, setClosing] = useState<MonthKey | null>(null);
  const [reopening, setReopening] = useState<MonthKey | null>(null);
  const [reason, setReason] = useState("");
  const closingTo = closing ? monthRange(closing).to : null;
  const snapshot = useDoc<StockSnapshot>(closingTo ? paths.stockSnapshot(cid, closingTo) : null);

  const rows = useMemo<Row[]>(() => {
    const list = monthsBetween(first, thisMonth).reverse();
    return list.map((m) => {
      const doc = months.byMonth.get(m);
      const live = monthReport({ month: m, days: days.data, stats: stats.data, builtAtMs: now });
      const check = monthCloseCheck({ month: m, today, days: days.data, statsDates: stats.data.map((s) => s.id) });
      const closed = doc?.status === "closed";
      const loaded = monthRange(m).from >= since;
      return {
        month: m,
        status: closed ? "closed" : m >= thisMonth ? "current" : check.ok ? "ready" : "open-days",
        report: closed ? doc!.report : live,
        live,
        openDays: check.openDays,
        ...(doc?.closedAtMs ? { closedAtMs: doc.closedAtMs } : {}),
        ...(doc?.closedByName || doc?.closedBy ? { closedBy: doc.closedByName ?? "Admin" } : {}),
        lateDiff: closed && loaded ? live.totalPaise - doc!.report.totalPaise : 0,
      };
    });
  }, [first, thisMonth, months.byMonth, days.data, stats.data, now, today, since]);

  const open = openMonth ? (rows.find((r) => r.month === openMonth) ?? null) : null;
  const ready = rows.filter((r) => r.status === "ready");
  const last = rows.find((r) => r.status === "closed");
  const current = rows.find((r) => r.month === thisMonth);

  async function close(m: MonthKey) {
    if (snapshot.status === "loading" || recent.status === "loading" || materials.status === "loading") throw new Error("Still reading the stock at the month end. Try again in a moment.");
    const rates = lastRates(recent.data);
    let worth: number | undefined;
    const snap = snapshot.data?.materials;
    if (snap) {
      worth = 0;
      for (const [id, micro] of Object.entries(snap)) {
        const mat = materials.byId.get(id);
        const v = mat && micro > 0 ? stockValue(micro, mat, rates.get(id)) : null;
        if (v) worth += v;
      }
    }
    const report = monthReport({ month: m, days: days.data, stats: stats.data, builtAtMs: Date.now(), ...(worth != null ? { stockWorthPaise: worth } : {}) });
    if (!(await run(closeMonthPlan(planCtx(cid), { month: m, report }), `${monthLabel(m)} closed`))) throw new Error("Couldn't close the month.");
  }

  const columns: Column<Row>[] = [
    { key: "month", header: "Month", sort: (r) => r.month, cell: (r) => <span className="font-medium">{monthLabel(r.month)}</span> },
    {
      key: "status",
      header: "Status",
      sort: (r) => ["current", "open-days", "ready", "closed"].indexOf(r.status),
      cell: (r) => (
        <span className="flex items-center gap-2">
          <StatusPill r={r} />
          {r.lateDiff ? <Flag>{`${rs(Math.abs(r.lateDiff))} after closing`}</Flag> : null}
        </span>
      ),
    },
    { key: "days", header: "Days", align: "right", sort: (r) => r.report.tradingDays, cell: (r) => <span className="tabular-nums">{r.report.tradingDays}</span>, hideBelow: "md" },
    { key: "z", header: "Z", align: "right", cell: (r) => <span className="text-muted-foreground tabular-nums">{r.report.zFrom != null ? (r.report.zFrom === r.report.zTo ? `#${r.report.zFrom}` : `#${r.report.zFrom}–${r.report.zTo}`) : "—"}</span>, hideBelow: "xl" },
    { key: "total", header: "Total billed", align: "right", sort: (r) => r.report.totalPaise, cell: (r) => <Money value={r.report.totalPaise} /> },
    { key: "gst", header: "GST", align: "right", sort: (r) => r.report.cgstPaise + r.report.sgstPaise, cell: (r) => <Money value={r.report.cgstPaise + r.report.sgstPaise} />, hideBelow: "lg" },
    { key: "spent", header: "Bought + expenses", align: "right", sort: (r) => (r.report.purchasesPaise ?? 0) + r.report.expensesPaise, cell: (r) => <Money value={(r.report.purchasesPaise ?? 0) + r.report.expensesPaise} dimZero />, hideBelow: "xl" },
    { key: "profit", header: "Net − bought − expenses", align: "right", sort: (r) => monthProfit(r.report), cell: (r) => <Money value={monthProfit(r.report)} />, hideBelow: "2xl" },
    {
      key: "action",
      header: <span className="sr-only">Actions</span>,
      align: "right",
      cell: (r) =>
        r.status === "ready" ? (
          <Button
            size="sm"
            variant="outline"
            onClick={(e) => {
              e.stopPropagation();
              setClosing(r.month);
            }}
          >
            Close month
          </Button>
        ) : null,
    },
  ];

  const text = open ? receiptText(renderMonth(open.report, { cols: 48, outletName: client.name, live: open.status !== "closed", ...(open.closedAtMs ? { closedAtMs: open.closedAtMs } : {}) }), 48) : "";
  const loading = !loadedFirst || stats.status === "loading" || days.status === "loading";
  return (
    <>
      <PageHeader title="Months" />
      <Stats>
        <Stat label="This month so far" value={<Money value={current?.live.totalPaise ?? 0} decimals={0} />} sub={current ? `${current.live.tradingDays} days · ${current.live.orders} orders` : undefined} />
        <Stat label="Ready to close" value={ready.length} accent={ready.length > 0} sub={ready.length ? ready.map((r) => monthLabel(r.month, true)).join(", ") : undefined} />
        <Stat label="Last closed" value={last ? monthLabel(last.month, true) : "—"} sub={last?.closedAtMs ? `${fmtDateTime(last.closedAtMs)}${last.closedBy ? ` · ${last.closedBy}` : ""}` : undefined} />
        <Stat label="Last closed total" value={last ? <Money value={last.report.totalPaise} decimals={0} /> : "—"} />
      </Stats>
      <Loadable
        state={{ data: rows, status: loading ? "loading" : months.status === "error" || stats.status === "error" || days.status === "error" ? "error" : "ready", error: months.error ?? stats.error ?? days.error }}
        onRetry={() => {
          months.retry();
          stats.retry();
          days.retry();
        }}
        empty={{ icon: CalendarRange, label: "No months yet." }}
      >
        {() => (
          <DataTable
            rows={rows}
            columns={columns}
            rowKey={(r) => r.month}
            onRowClick={(r) => setOpenMonth(r.month)}
            selectedKey={openMonth}
            caption="Months"
            mobileRow={(r) => (
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{monthLabel(r.month)}</div>
                  <div className="mt-0.5">
                    <StatusPill r={r} />
                  </div>
                </div>
                <Money value={r.report.totalPaise} />
              </div>
            )}
          />
        )}
      </Loadable>
      <RecordSheet
        open={Boolean(open)}
        onOpenChange={(o) => !o && setOpenMonth(null)}
        title={open ? monthLabel(open.month) : ""}
        meta={open ? <StatusPill r={open} /> : null}
        footer={
          open ? (
            <>
              <Button variant="ghost" onClick={() => printText(`${client.name} · ${monthLabel(open.month)}`, text)}>
                <Printer data-icon="inline-start" aria-hidden />
                Print
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  const { from, to } = monthRange(open.month);
                  const inMonth = stats.data.filter((s) => s.id >= from && s.id <= to);
                  const zOf = new Map(days.data.map((d) => [d.id, d.zNo]));
                  download(`${client.name.replace(/[^\w]+/g, "-")}-${open.month}.csv`, monthCsv(open.report, inMonth, zOf));
                }}
              >
                <Download data-icon="inline-start" aria-hidden />
                CSV
              </Button>
              {open.status === "ready" ? (
                <Button variant="destructive" onClick={() => setClosing(open.month)}>
                  Close month
                </Button>
              ) : null}
              {open.status === "closed" && isSuper ? (
                <Button
                  variant="outline"
                  onClick={() => {
                    setReason("");
                    setReopening(open.month);
                  }}
                >
                  Reopen
                </Button>
              ) : null}
            </>
          ) : null
        }
      >
        {open ? (
          <div className="flex flex-col gap-5">
            <KV
              items={[
                { label: "Days", value: `${bizDateLabel(open.report.from)} – ${bizDateLabel(open.report.to)}` },
                ...(open.status === "open-days" ? [{ label: "Still open", value: <span className="text-warning">{open.openDays.map((d) => bizDateLabel(d)).join(", ")}</span> }] : []),
                ...(open.status === "current" ? [{ label: "Closes", value: `After ${bizDateLabel(open.report.to, true)}, once every day is closed` }] : []),
                ...(open.closedAtMs ? [{ label: "Closed", value: `${fmtDateTime(open.closedAtMs)}${open.closedBy ? ` · ${open.closedBy}` : ""}` }] : []),
                ...(open.lateDiff ? [{ label: "After closing", value: <span className="text-warning">{`${open.lateDiff > 0 ? "+" : "−"}${rs(Math.abs(open.lateDiff))} billed on its days since it was closed (late offline sales)`}</span> }] : []),
              ]}
            />
            <pre aria-label="Month report" className="overflow-x-auto rounded-lg border bg-white px-3 py-3 font-mono text-[11px] leading-snug text-black">
              {text}
            </pre>
          </div>
        ) : null}
      </RecordSheet>
      <ConfirmDialog
        open={Boolean(closing)}
        onOpenChange={(o) => !o && setClosing(null)}
        title={closing ? `Close ${monthLabel(closing)}?` : "Close month"}
        description={
          closing ? (
            <div className="flex flex-col gap-2">
              <p>Every day of {monthLabel(closing)} is closed. Its report is saved as it stands, and the month is frozen: no voids or changes dated in it from admin.</p>
              <p className="tabular-nums">
                Total billed {rs(rows.find((r) => r.month === closing)?.live.totalPaise ?? 0)} · {rows.find((r) => r.month === closing)?.live.orders ?? 0} orders
              </p>
              {snapshot.status === "loading" ? (
                <p className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" aria-hidden /> Reading the stock at the month end…
                </p>
              ) : null}
            </div>
          ) : null
        }
        confirmLabel="Close month"
        onConfirm={() => (closing ? close(closing) : undefined)}
      />
      <ConfirmDialog
        open={Boolean(reopening)}
        onOpenChange={(o) => !o && setReopening(null)}
        title={reopening ? `Reopen ${monthLabel(reopening)}?` : "Reopen month"}
        description="It can be changed again until it's closed again. Its saved report stays until then."
        confirmLabel="Reopen"
        onConfirm={async () => {
          if (!reopening) return;
          if (!reason.trim()) throw new Error("Say why");
          if (!(await run(reopenMonthPlan(planCtx(cid), reopening, reason), `${monthLabel(reopening)} reopened`))) throw new Error("Couldn't reopen it.");
        }}
      >
        <Field label="Why" htmlFor="reopen-why">
          <Input id="reopen-why" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={120} autoComplete="off" />
        </Field>
      </ConfirmDialog>
    </>
  );
}

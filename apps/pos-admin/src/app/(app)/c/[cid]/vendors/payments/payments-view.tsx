"use client";

import { useState } from "react";
import { collection, orderBy, query, where } from "firebase/firestore";
import { MoreHorizontal, Plus, Wallet } from "lucide-react";
import { bizDateLabel, paths, vendorOverview, type VendorPayment } from "@px-pos/core";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { RowMenuContent } from "@/components/shared/row-menu";
import { DataTable, type Column } from "@/components/shared/data-table";
import { Empty } from "@/components/shared/empty";
import { Loadable } from "@/components/shared/loadable";
import { Money } from "@/components/shared/money";
import { PageHeader } from "@/components/shared/page-header";
import { RangePicker, useBizRange } from "@/components/shared/range-picker";
import { SearchInput } from "@/components/shared/search-input";
import { Stat, Stats } from "@/components/shared/stat";
import { Flag, Pill } from "@/components/shared/status-badge";
import { useClient } from "@/components/providers/client-provider";
import { useVendorActions } from "@/components/vendors/context";
import { wayLabel } from "@/components/vendors/vendor-status";
import { useCollection, type WithId } from "@/lib/firebase/hooks";
import { fmtTime } from "@/lib/format";

type Row = WithId<VendorPayment>;

/** Payments to vendors: how much, how, from which till, and what each one cleared. */
export function PaymentsView() {
  const { cid, client } = useClient();
  const a = useVendorActions();
  const range = useBizRange(client.day.cutoffMin, "30");
  const payments = useCollection<VendorPayment>(`vpays-range:${cid}:${range.from}:${range.to}`, (db) =>
    query(collection(db, paths.col(cid, "vendorPayments")), where("businessDate", ">=", range.from), where("businessDate", "<=", range.to), orderBy("businessDate", "desc"), orderBy("createdAtMs", "desc")),
  );
  const [q, setQ] = useState("");

  // The search narrows everything on the page (stats too): a vendor, how it was paid, a reference.
  const needle = q.trim().toLowerCase();
  const wayOf = (p: Row) => (p.kind === "opening" ? "Opening advance" : wayLabel(p.mode, p.drawerTerminalId ? a.terminalName(p.drawerTerminalId) : undefined));
  const rows = payments.data.filter((p) => !needle || [p.vendorName, wayOf(p), p.ref ?? "", p.note ?? ""].some((t) => t.toLowerCase().includes(needle)));

  const paid = rows.filter((p) => p.status !== "void" && p.kind === "payment");
  const total = paid.reduce((n, p) => n + p.amountPaise, 0);
  const drawer = paid.filter((p) => p.mode === "drawer").reduce((n, p) => n + p.amountPaise, 0);
  const digital = paid.filter((p) => p.mode === "upi" || p.mode === "bank").reduce((n, p) => n + p.amountPaise, 0);
  const owed = vendorOverview(a.vendors.data.filter((v) => !needle || v.name.toLowerCase().includes(needle)), a.recent.data, a.today);
  const multiDay = range.from !== range.to;

  const menu = (p: Row) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Actions for the payment to ${p.vendorName}`} onClick={(e) => e.stopPropagation()}>
          <MoreHorizontal aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <RowMenuContent>
        <DropdownMenuItem onSelect={() => a.open({ kind: "payment", id: p.id })}>Open</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => a.open({ kind: "vendor", id: p.vendorId })}>Vendor</DropdownMenuItem>
        {p.status !== "void" ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => a.voidPayment(p)}>
              Void
            </DropdownMenuItem>
          </>
        ) : null}
      </RowMenuContent>
    </DropdownMenu>
  );

  const columns: Column<Row>[] = [
    {
      key: "date",
      header: "Date",
      sort: (p) => `${p.businessDate}${String(p.createdAtMs).padStart(15, "0")}`,
      cell: (p) => <span className="text-muted-foreground tabular-nums">{multiDay ? `${bizDateLabel(p.businessDate)}, ${fmtTime(p.createdAtMs)}` : fmtTime(p.createdAtMs)}</span>,
    },
    { key: "vendor", header: "Vendor", sort: (p) => p.vendorName, cell: (p) => <span className="font-medium">{p.vendorName}</span> },
    { key: "way", header: "Paid by", sort: (p) => p.mode, cell: (p) => <span className="text-muted-foreground">{wayOf(p)}</span> },
    { key: "ref", header: "Reference", cell: (p) => <span className="font-mono text-xs text-muted-foreground">{p.ref ?? "—"}</span>, hideBelow: "lg" },
    { key: "by", header: "Entered by", cell: (p) => <span className="text-muted-foreground">{a.who(p.paidBy, p.terminalId)}</span>, hideBelow: "xl" },
    {
      key: "status",
      header: "Status",
      sort: (p) => p.status,
      cell: (p) => (p.status === "void" ? <Pill tone="dim" label="Void" muted /> : p.purchaseId ? <Flag tone="zinc">With bill</Flag> : <Pill tone="green" label="Paid" />),
      hideBelow: "md",
    },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      sort: (p) => p.amountPaise,
      cell: (p) => <Money value={p.amountPaise} className={p.status === "void" ? "text-muted-foreground line-through" : undefined} />,
      footer: <Money value={rows.filter((p) => p.status !== "void" && p.kind === "payment").reduce((n, p) => n + p.amountPaise, 0)} className="font-semibold" />,
    },
    { key: "menu", header: <span className="sr-only">Actions</span>, align: "right", className: "w-12", cell: menu },
  ];

  return (
    <>
      <PageHeader
        title="Vendor payments"
        actions={
          <>
            <SearchInput value={q} onChange={setQ} placeholder="Vendor, UPI, till, reference" className="md:w-56" />
            <RangePicker range={range} presets={["7", "30", "90"]} />
            <Button size="sm" onClick={() => a.pay()} disabled={!a.vendors.data.length}>
              <Plus data-icon="inline-start" aria-hidden />
              Record payment
            </Button>
          </>
        }
      />
      <Stats>
        <Stat label="Paid" value={<Money value={total} decimals={0} />} sub={`${paid.length} payment${paid.length === 1 ? "" : "s"}`} />
        <Stat label="From till drawers" value={<Money value={drawer} decimals={0} />} />
        <Stat label="UPI & bank" value={<Money value={digital} decimals={0} />} />
        <Stat label="Still to pay" value={<Money value={owed.duePaise} decimals={0} />} accent={owed.overdue > 0} sub={owed.pending ? `${owed.pending} vendor${owed.pending === 1 ? "" : "s"}` : undefined} />
      </Stats>
      <Loadable state={payments} onRetry={payments.retry} empty={{ icon: Wallet, label: "No payments in this range.", action: a.vendors.data.length ? <Button size="sm" onClick={() => a.pay()}>Record payment</Button> : undefined }} isEmpty={() => !payments.data.length}>
        {() =>
          rows.length ? (
            <DataTable
              rows={rows}
              columns={columns}
              rowKey={(p) => p.id}
              onRowClick={(p) => a.open({ kind: "payment", id: p.id })}
              selectedKey={a.stack[0]?.kind === "payment" ? a.stack[0].id : null}
              initialSort={{ key: "date", dir: "desc" }}
              caption="Vendor payments"
              rowClassName={(p) => (p.status === "void" ? "opacity-60" : undefined)}
              mobileRow={(p) => (
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{p.vendorName}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {bizDateLabel(p.businessDate)} · {wayOf(p)}
                    </div>
                  </div>
                  <Money value={p.amountPaise} className={p.status === "void" ? "text-muted-foreground line-through" : undefined} />
                </div>
              )}
            />
          ) : (
            <Empty icon={Wallet} label="No payments match." />
          )
        }
      </Loadable>
    </>
  );
}

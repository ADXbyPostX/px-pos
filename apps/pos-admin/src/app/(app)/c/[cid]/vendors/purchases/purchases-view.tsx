"use client";

import { useMemo, useState } from "react";
import { FileText, MoreHorizontal, Package, Plus } from "lucide-react";
import { bizDateLabel, daysBetween, MATERIAL_UNIT_LABEL, purchaseSummary, unitRatePaise, vendorBalance, vendorPosition, type BillStatus as BillStatusOf, type MaterialUnit, type Purchase } from "@px-pos/core";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { DataTable, type Column } from "@/components/shared/data-table";
import { Empty } from "@/components/shared/empty";
import { SelectField } from "@/components/shared/form-controls";
import { Loadable } from "@/components/shared/loadable";
import { Money } from "@/components/shared/money";
import { PageHeader } from "@/components/shared/page-header";
import { RangePicker, useBizRange } from "@/components/shared/range-picker";
import { SearchInput } from "@/components/shared/search-input";
import { Stat, Stats } from "@/components/shared/stat";
import { useClient } from "@/components/providers/client-provider";
import { useVendorActions } from "@/components/vendors/context";
import { BillStatus, qtyLabel, rs } from "@/components/vendors/vendor-status";
import { useRecentPurchases } from "@/hooks/use-vendors";
import type { WithId } from "@/lib/firebase/hooks";
import { cn } from "@/lib/utils";

type Row = WithId<Purchase> & { st: BillStatusOf | null; overdue: boolean };
type Show = "all" | "unpaid" | "paid" | "void" | "materials";
const SHOW: { value: Show; label: string }[] = [
  { value: "all", label: "All bills" },
  { value: "unpaid", label: "Unpaid bills" },
  { value: "paid", label: "Paid bills" },
  { value: "void", label: "Void bills" },
  { value: "materials", label: "By material" },
];

interface MaterialRow {
  id: string;
  name: string;
  unit: MaterialUnit;
  qtyMilli: number;
  amountPaise: number;
  bills: number;
  lastRate: number;
  firstRate: number;
  lastDate: string;
}


/** Purchases: every bill in the range with its status, or what was bought per material. */
export function PurchasesView() {
  const { cid, client } = useClient();
  const a = useVendorActions();
  const range = useBizRange(client.day.cutoffMin, "30");
  // Every bill dated from the start of the range up to today: a bill's status depends on the newer ones.
  const bills = useRecentPurchases(cid, range.from);
  const [q, setQ] = useState("");
  const [show, setShow] = useState<Show>("all");

  const states = useMemo(() => {
    const byVendor = new Map<string, WithId<Purchase>[]>();
    for (const b of bills.data) byVendor.set(b.vendorId, [...(byVendor.get(b.vendorId) ?? []), b]);
    const out = new Map<string, BillStatusOf>();
    for (const [vid, list] of byVendor) for (const s of vendorPosition(list, vendorBalance(a.vendors.byId.get(vid))).bills) out.set(s.bill.id, s);
    return out;
  }, [bills.data, a.vendors.byId]);

  // The search narrows everything on the page (stats too): a vendor, a bill number or an item.
  const needle = q.trim().toLowerCase();
  const inRange = useMemo<Row[]>(
    () =>
      bills.data
        .filter((b) => b.billDate <= range.to && (!needle || [b.vendorName, b.billNo ?? "", b.note ?? "", ...b.lines.map((l) => l.name)].some((t) => t.toLowerCase().includes(needle))))
        .map((b) => {
          const st = b.status === "void" ? null : (states.get(b.id) ?? null);
          const v = a.vendors.byId.get(b.vendorId);
          return { ...b, st, overdue: Boolean(st && st.duePaise > 0 && v && daysBetween(b.billDate, a.today) > v.creditDays) };
        }),
    [bills.data, range.to, needle, states, a.vendors.byId, a.today],
  );
  const rows = useMemo(
    () =>
      inRange.filter((b) => {
        if (show === "void") return b.status === "void";
        if (show === "paid") return b.status !== "void" && b.st?.state === "paid";
        if (show === "unpaid") return b.status !== "void" && Boolean(b.st && b.st.duePaise > 0);
        return true;
      }),
    [inRange, show],
  );

  const active = useMemo(() => inRange.filter((b) => b.status !== "void" && b.kind === "bill"), [inRange]);
  const anyInRange = bills.data.some((b) => b.billDate <= range.to);
  const bought = active.reduce((n, b) => n + b.totalPaise, 0);
  const unpaid = inRange.filter((b) => b.status !== "void").reduce((n, b) => n + (b.st?.duePaise ?? 0), 0);
  const gst = active.reduce((n, b) => n + b.gstPaise, 0);
  const top = useMemo(() => {
    const by = new Map<string, { name: string; paise: number }>();
    for (const b of active) by.set(b.vendorId, { name: b.vendorName, paise: (by.get(b.vendorId)?.paise ?? 0) + b.totalPaise });
    return [...by.values()].sort((x, y) => y.paise - x.paise)[0] ?? null;
  }, [active]);

  const materialRows = useMemo<MaterialRow[]>(() => {
    const by = new Map<string, MaterialRow>();
    // Oldest first, so the last rate seen is the latest.
    const ordered = [...active].sort((x, y) => (x.billDate !== y.billDate ? (x.billDate < y.billDate ? -1 : 1) : x.createdAtMs - y.createdAtMs));
    for (const b of ordered)
      for (const l of b.lines) {
        if (!l.materialId || l.qtyMilli <= 0) continue;
        const rate = unitRatePaise(l.amountPaise, l.qtyMilli);
        const cur = by.get(l.materialId);
        if (cur) {
          cur.qtyMilli += l.qtyMilli;
          cur.amountPaise += l.amountPaise;
          cur.bills += 1;
          cur.lastRate = rate;
          cur.lastDate = b.billDate;
        } else by.set(l.materialId, { id: l.materialId, name: a.materials.byId.get(l.materialId)?.name ?? l.name, unit: l.unit, qtyMilli: l.qtyMilli, amountPaise: l.amountPaise, bills: 1, lastRate: rate, firstRate: rate, lastDate: b.billDate });
      }
    return [...by.values()];
  }, [active, a.materials.byId]);

  const menu = (b: Row) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Actions for the bill from ${b.vendorName}`} onClick={(e) => e.stopPropagation()}>
          <MoreHorizontal aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => a.open({ kind: "purchase", id: b.id })}>Open</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => a.open({ kind: "vendor", id: b.vendorId })}>Vendor</DropdownMenuItem>
        {b.status !== "void" ? (
          <>
            {b.kind === "bill" ? <DropdownMenuItem onSelect={() => a.editBill(b)}>Edit bill no. / note</DropdownMenuItem> : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => a.voidPurchase(b)}>
              Void
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const columns: Column<Row>[] = [
    { key: "date", header: "Bill date", sort: (b) => `${b.billDate}${String(b.createdAtMs).padStart(15, "0")}`, cell: (b) => <span className="tabular-nums">{bizDateLabel(b.billDate)}</span> },
    { key: "vendor", header: "Vendor", sort: (b) => b.vendorName, cell: (b) => <span className="font-medium">{b.vendorName}</span> },
    { key: "no", header: "Bill no.", sort: (b) => b.billNo ?? "", cell: (b) => <span className="text-muted-foreground">{b.billNo ?? "—"}</span>, hideBelow: "lg" },
    { key: "items", header: "Items", cell: (b) => <span className="block max-w-80 truncate text-muted-foreground">{purchaseSummary(b, 3)}</span>, hideBelow: "md" },
    {
      key: "entered",
      header: "Entered",
      sort: (b) => b.createdAtMs,
      cell: (b) => (
        <span className="text-muted-foreground">
          {b.businessDate !== b.billDate ? `${bizDateLabel(b.businessDate)} · ` : ""}
          {a.who(b.enteredBy, b.terminalId)}
        </span>
      ),
      hideBelow: "2xl",
    },
    { key: "status", header: "Status", sort: (b) => (b.status === "void" ? -1 : (b.st?.duePaise ?? 0)), cell: (b) => <BillStatus state={b.st?.state ?? null} duePaise={b.st?.duePaise ?? 0} voided={b.status === "void"} overdue={b.overdue} /> },
    {
      key: "total",
      header: "Total",
      align: "right",
      sort: (b) => b.totalPaise,
      cell: (b) => <Money value={b.totalPaise} className={b.status === "void" ? "text-muted-foreground line-through" : undefined} />,
      footer: <Money value={rows.filter((b) => b.status !== "void").reduce((n, b) => n + b.totalPaise, 0)} className="font-semibold" />,
    },
    { key: "menu", header: <span className="sr-only">Actions</span>, align: "right", className: "w-12", cell: menu },
  ];

  const unitOf = (m: MaterialRow) => MATERIAL_UNIT_LABEL[m.unit];
  const change = (m: MaterialRow) => (m.firstRate ? Math.round(((m.lastRate - m.firstRate) / m.firstRate) * 100) : 0);
  const materialColumns: Column<MaterialRow>[] = [
    { key: "name", header: "Material", sort: (m) => m.name, cell: (m) => <span className="font-medium">{m.name}</span> },
    { key: "qty", header: "Bought", align: "right", sort: (m) => m.qtyMilli, cell: (m) => <span className="whitespace-nowrap">{qtyLabel(m.qtyMilli, m.unit)}</span> },
    { key: "bills", header: "Bills", align: "right", sort: (m) => m.bills, cell: (m) => m.bills, hideBelow: "lg" },
    { key: "spent", header: "Spent", align: "right", sort: (m) => m.amountPaise, cell: (m) => <Money value={m.amountPaise} />, footer: <Money value={materialRows.reduce((n, m) => n + m.amountPaise, 0)} className="font-semibold" /> },
    { key: "avg", header: "Average rate", align: "right", sort: (m) => unitRatePaise(m.amountPaise, m.qtyMilli), cell: (m) => <span className="whitespace-nowrap">{`${rs(unitRatePaise(m.amountPaise, m.qtyMilli))}/${unitOf(m)}`}</span>, hideBelow: "md" },
    { key: "last", header: "Last rate", align: "right", sort: (m) => m.lastRate, cell: (m) => <span className="whitespace-nowrap">{`${rs(m.lastRate)}/${unitOf(m)}`}</span> },
    {
      key: "change",
      header: "Change",
      align: "right",
      sort: change,
      cell: (m) => {
        const c = change(m);
        return <span className={cn("tabular-nums", c > 0 ? "text-brand" : c < 0 ? "text-success" : "text-muted-foreground")}>{c > 0 ? `+${c}%` : `${c}%`}</span>;
      },
      hideBelow: "lg",
    },
  ];

  return (
    <>
      <PageHeader
        title="Purchases"
        actions={
          <>
            <SearchInput value={q} onChange={setQ} placeholder="Vendor, bill no., item" className="md:w-48" />
            <SelectField aria-label="Show" className="md:w-36" value={show} onValueChange={setShow} options={SHOW} />
            <RangePicker range={range} presets={["7", "30", "90"]} />
            <Button size="sm" onClick={() => a.recordPurchase()} disabled={!a.vendors.data.length}>
              <Plus data-icon="inline-start" aria-hidden />
              Record purchase
            </Button>
          </>
        }
      />
      <Stats>
        <Stat label="Bought" value={<Money value={bought} decimals={0} />} sub={`${active.length} bill${active.length === 1 ? "" : "s"}`} />
        <Stat label="Still unpaid" value={<Money value={unpaid} decimals={0} />} accent={unpaid > 0} />
        <Stat label="GST in bills" value={<Money value={gst} decimals={0} />} />
        <Stat label="Top vendor" value={top ? top.name : "—"} sub={top ? rs(top.paise) : undefined} />
      </Stats>
      <Loadable
        state={{ data: bills.data, status: bills.status === "loading" || a.vendors.status === "loading" ? "loading" : bills.status === "error" || a.vendors.status === "error" ? "error" : "ready", error: bills.error ?? a.vendors.error }}
        onRetry={() => {
          bills.retry();
          a.vendors.retry();
        }}
        empty={{ icon: FileText, label: "No bills in this range.", action: a.vendors.data.length ? <Button size="sm" onClick={() => a.recordPurchase()}>Record purchase</Button> : undefined }} isEmpty={() => !anyInRange}>
        {() =>
          show !== "materials" ? (
            rows.length ? (
              <DataTable
                rows={rows}
                columns={columns}
                rowKey={(b) => b.id}
                onRowClick={(b) => a.open({ kind: "purchase", id: b.id })}
                selectedKey={a.stack[0]?.kind === "purchase" ? a.stack[0].id : null}
                initialSort={{ key: "date", dir: "desc" }}
                caption="Bills"
                rowClassName={(b) => (b.status === "void" ? "opacity-60" : undefined)}
                mobileRow={(b) => (
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{b.vendorName}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {bizDateLabel(b.billDate)} · {purchaseSummary(b)}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <Money value={b.totalPaise} className={b.status === "void" ? "text-muted-foreground line-through" : undefined} />
                      <BillStatus state={b.st?.state ?? null} duePaise={b.st?.duePaise ?? 0} voided={b.status === "void"} overdue={b.overdue} />
                    </div>
                  </div>
                )}
              />
            ) : (
              <Empty icon={FileText} label="No bills match." />
            )
          ) : materialRows.length ? (
            <DataTable
              rows={materialRows}
              columns={materialColumns}
              rowKey={(m) => m.id}
              onRowClick={(m) => a.open({ kind: "material", id: m.id })}
              initialSort={{ key: "spent", dir: "desc" }}
              caption="Materials bought"
              mobileRow={(m) => (
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{m.name}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {qtyLabel(m.qtyMilli, m.unit)} · last {rs(m.lastRate)}/{unitOf(m)}
                    </div>
                  </div>
                  <Money value={m.amountPaise} />
                </div>
              )}
            />
          ) : (
            <Empty icon={Package} label="No materials match." />
          )
        }
      </Loadable>
    </>
  );
}

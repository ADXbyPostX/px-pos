"use client";

import { useMemo, useState } from "react";
import { collection, documentId, query, where } from "firebase/firestore";
import { MoreHorizontal, Plus, Truck } from "lucide-react";
import { addDays, bizDateLabel, paths, vendorBalance, vendorDay, vendorOverview, type DailyStats, type VendorRow } from "@px-pos/core";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { RankedBars } from "@/components/dashboard/charts";
import { DataTable, type Column } from "@/components/shared/data-table";
import { SelectField } from "@/components/shared/form-controls";
import { Grid } from "@/components/shared/grid";
import { Loadable } from "@/components/shared/loadable";
import { Money } from "@/components/shared/money";
import { PageHeader } from "@/components/shared/page-header";
import { Panel } from "@/components/shared/panel";
import { SearchInput } from "@/components/shared/search-input";
import { Stat, Stats } from "@/components/shared/stat";
import { useClient } from "@/components/providers/client-provider";
import { useVendorActions } from "@/components/vendors/context";
import { rs, termsLabel, VendorStatus } from "@/components/vendors/vendor-status";
import { useCollection } from "@/lib/firebase/hooks";
import { palette } from "@/lib/dashboard/palette";
import { ago } from "@/lib/format";
import { cn } from "@/lib/utils";

type Show = "active" | "due" | "advance" | "all";
const SHOW: { value: Show; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "due", label: "To pay" },
  { value: "advance", label: "Advance" },
  { value: "all", label: "All vendors" },
];

type Row = VendorRow & { supplies: string; phone?: string };

/** Vendors: who supplies what, who is owed, and what was bought and paid lately. */
export function VendorsView() {
  const { cid } = useClient();
  const a = useVendorActions();
  const { today, vendors, materials, recent } = a;
  const [q, setQ] = useState("");
  const [show, setShow] = useState<Show>("active");

  // This month and the last 30 days of Bought / Paid (≤ 31 day docs).
  const monthStart = `${today.slice(0, 8)}01`;
  const since30 = addDays(today, -29);
  const from = monthStart < since30 ? monthStart : since30;
  const stats = useCollection<DailyStats>(`vstats:${cid}:${from}`, (db) => query(collection(db, paths.col(cid, "dailyStats")), where(documentId(), ">=", from)));

  const overview = useMemo(() => vendorOverview(vendors.data, recent.data, today), [vendors.data, recent.data, today]);
  const rows = useMemo<Row[]>(() => {
    const byId = new Map(overview.rows.map((r) => [r.id, r]));
    return vendors.data.map((v) => {
      const r: VendorRow = byId.get(v.id) ?? { id: v.id, name: v.name, active: v.active, creditDays: v.creditDays, balancePaise: vendorBalance(v), duePaise: 0, advancePaise: 0, dueBills: 0, overdue: false, uncoveredPaise: 0, ...(v.lastPurchaseAtMs ? { lastPurchaseAtMs: v.lastPurchaseAtMs } : {}) };
      const supplies = v.materialIds.map((m) => materials.byId.get(m)?.name).filter(Boolean).join(", ");
      return { ...r, supplies, ...(v.phone ? { phone: v.phone } : {}) };
    });
  }, [overview.rows, vendors.data, materials.byId]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (show === "active" && !r.active && r.balancePaise === 0) return false;
      if (show === "due" && r.duePaise <= 0) return false;
      if (show === "advance" && r.advancePaise <= 0) return false;
      return !needle || [r.name, r.phone ?? "", r.supplies].some((s) => s.toLowerCase().includes(needle));
    });
  }, [rows, show, q]);

  const month = stats.data.filter((s) => s.id >= monthStart).map((s) => vendorDay(s));
  const boughtMonth = month.reduce((n, d) => n + d.boughtPaise, 0);
  const paidMonth = month.reduce((n, d) => n + d.paidPaise, 0);
  const bought30 = useMemo(() => {
    const by = new Map<string, number>();
    for (const s of stats.data) {
      if (s.id < since30) continue;
      for (const [vid, p] of Object.entries(s.purchByVendor ?? {})) by.set(vid, (by.get(vid) ?? 0) + (Number(p) || 0));
    }
    return [...by]
      .filter(([, p]) => p > 0)
      .sort((x, y) => y[1] - x[1])
      .slice(0, 8)
      .map(([vid, p]) => ({ name: vendors.byId.get(vid)?.name ?? "Vendor", paise: p }));
  }, [stats.data, since30, vendors.byId]);
  const dues = overview.rows.filter((r) => r.duePaise > 0).sort((x, y) => Number(y.overdue) - Number(x.overdue) || (y.dueDays ?? 0) - (x.dueDays ?? 0) || y.duePaise - x.duePaise);

  const menu = (r: Row) => {
    const v = vendors.byId.get(r.id);
    if (!v) return null;
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${r.name}`} onClick={(e) => e.stopPropagation()}>
            <MoreHorizontal aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => a.recordPurchase(r.id)}>Record purchase</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => a.pay(r.id)}>Pay</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => a.open({ kind: "vendor", id: r.id })}>Statement</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => a.editVendor(v)}>Edit</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  const balanceCell = (r: Row) =>
    r.balancePaise > 0 ? <Money value={r.balancePaise} /> : r.balancePaise < 0 ? <span className="text-muted-foreground tabular-nums">{rs(-r.balancePaise)} adv.</span> : <span className="text-muted-foreground">—</span>;

  const columns: Column<Row>[] = [
    {
      key: "name",
      header: "Vendor",
      sort: (r) => r.name,
      cell: (r) => (
        <span className="flex min-w-0 flex-col">
          <span className={cn("truncate font-medium", !r.active && "text-muted-foreground")}>{r.name}</span>
          {r.supplies ? <span className="max-w-72 truncate text-xs text-muted-foreground">{r.supplies}</span> : null}
        </span>
      ),
    },
    { key: "terms", header: "Terms", sort: (r) => r.creditDays, cell: (r) => <span className="text-muted-foreground">{termsLabel(r.creditDays)}</span>, hideBelow: "lg" },
    { key: "phone", header: "Phone", cell: (r) => <span className="text-muted-foreground tabular-nums">{r.phone ?? "—"}</span>, hideBelow: "xl" },
    { key: "last", header: "Last bill", sort: (r) => r.lastPurchaseAtMs ?? 0, cell: (r) => <span className="text-muted-foreground">{r.lastPurchaseAtMs ? ago(r.lastPurchaseAtMs) : "—"}</span>, hideBelow: "md" },
    {
      key: "oldest",
      header: "Oldest due",
      sort: (r) => r.dueDays ?? -1,
      cell: (r) => (r.oldestDueDate ? <span className={cn("tabular-nums", r.overdue ? "text-brand" : "text-muted-foreground")}>{`${bizDateLabel(r.oldestDueDate)} · ${r.dueDays}d`}</span> : r.uncoveredPaise > 0 ? <span className="text-brand">Older bills</span> : <span className="text-muted-foreground">—</span>),
      hideBelow: "lg",
    },
    { key: "status", header: "Status", sort: (r) => (r.overdue ? 3 : r.duePaise > 0 ? 2 : r.advancePaise > 0 ? 1 : 0), cell: (r) => <VendorStatus duePaise={r.duePaise} advancePaise={r.advancePaise} overdue={r.overdue} active={r.active} /> },
    { key: "balance", header: "To pay", align: "right", sort: (r) => r.balancePaise, cell: balanceCell, footer: <Money value={shown.reduce((n, r) => n + r.duePaise, 0)} className="font-semibold" /> },
    { key: "menu", header: <span className="sr-only">Actions</span>, align: "right", className: "w-12", cell: menu },
  ];

  const loading = vendors.status === "loading" || recent.status === "loading";
  return (
    <>
      <PageHeader
        title="Vendors"
        actions={
          <>
            <SearchInput value={q} onChange={setQ} placeholder="Vendor, phone, material" />
            <SelectField aria-label="Show" className="md:w-32" value={show} onValueChange={setShow} options={SHOW} />
            <Button size="sm" variant="outline" onClick={() => a.pay()} disabled={!vendors.data.length}>
              Pay vendor
            </Button>
            <Button size="sm" variant="outline" onClick={() => a.recordPurchase()} disabled={!vendors.data.length}>
              Record purchase
            </Button>
            <Button size="sm" onClick={a.addVendor}>
              <Plus data-icon="inline-start" aria-hidden />
              Add vendor
            </Button>
          </>
        }
      />
      <Stats>
        <Stat label="Vendors" value={overview.active} sub={`${overview.pending} to pay`} />
        <Stat label="To pay" value={<Money value={overview.duePaise} decimals={0} />} accent={overview.overdue > 0} sub={overview.overdue ? `${overview.overdue} overdue` : overview.advancePaise ? `${rs(overview.advancePaise)} in advances` : undefined} />
        <Stat label="Bought this month" value={<Money value={boughtMonth} decimals={0} />} sub={`${month.reduce((n, d) => n + d.bills, 0)} bills`} />
        <Stat label="Paid this month" value={<Money value={paidMonth} decimals={0} />} />
      </Stats>
      <Loadable
        state={{ data: vendors.data, status: loading ? "loading" : vendors.status === "error" ? "error" : recent.status === "error" ? "error" : "ready", error: vendors.error ?? recent.error }}
        onRetry={() => {
          vendors.retry();
          recent.retry();
        }}
        empty={{ icon: Truck, label: "No vendors yet. Add the people who deliver milk, vegetables, gas and the rest.", action: <Button size="sm" onClick={a.addVendor}>Add vendor</Button> }}
      >
        {() => (
          <>
            {dues.length || bought30.length ? (
              <Grid className="2xl:grid-cols-2">
                <Panel title="To pay" bodyClassName="p-0">
                  {dues.length ? (
                    <ul className="divide-y">
                      {dues.slice(0, 8).map((r) => (
                        <li key={r.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                          <button type="button" onClick={() => a.open({ kind: "vendor", id: r.id })} className="min-w-0 flex-1 text-left focus-visible:outline-none">
                            <span className="block truncate font-medium hover:underline">{r.name}</span>
                            <span className={cn("block truncate text-xs", r.overdue ? "text-brand" : "text-muted-foreground")}>
                              {r.oldestDueDate ? `${r.dueBills} bill${r.dueBills === 1 ? "" : "s"} · oldest ${bizDateLabel(r.oldestDueDate)} (${r.dueDays}d)` : "Older bills"}
                              {r.overdue ? " · overdue" : ""}
                            </span>
                          </button>
                          <Money value={r.duePaise} className="shrink-0" />
                          <Button size="sm" variant="outline" onClick={() => a.pay(r.id)} className="shrink-0">
                            Pay
                          </Button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="px-4 py-6 text-center text-sm text-muted-foreground">Nothing to pay. Every vendor is settled.</p>
                  )}
                </Panel>
                <Panel title="Bought · 30 days" bodyClassName="p-4">
                  {bought30.length ? (
                    <RankedBars data={bought30} series={[{ key: "paise", label: "Bought", color: palette.brand }]} format={(v) => rs(v)} />
                  ) : (
                    <p className="py-6 text-center text-sm text-muted-foreground">No bills in the last 30 days.</p>
                  )}
                </Panel>
              </Grid>
            ) : null}
            {shown.length ? (
              <DataTable
                rows={shown}
                columns={columns}
                rowKey={(r) => r.id}
                onRowClick={(r) => a.open({ kind: "vendor", id: r.id })}
                selectedKey={a.stack[0]?.kind === "vendor" ? a.stack[0].id : null}
                caption="Vendors"
                rowClassName={(r) => (r.active ? undefined : "opacity-60")}
                mobileRow={(r) => (
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{r.name}</div>
                      <div className="truncate text-xs text-muted-foreground">{r.supplies || termsLabel(r.creditDays)}</div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      {balanceCell(r)}
                      <VendorStatus duePaise={r.duePaise} advancePaise={r.advancePaise} overdue={r.overdue} active={r.active} />
                    </div>
                  </div>
                )}
              />
            ) : (
              <p className="rounded-xl border border-dashed px-6 py-10 text-center text-sm text-muted-foreground">No vendors match.</p>
            )}
          </>
        )}
      </Loadable>
    </>
  );
}

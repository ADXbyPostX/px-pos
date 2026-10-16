"use client";

import { useMemo, useState } from "react";
import { ChartColumn } from "lucide-react";
import { formatStock, usageReport, type Material, type UsageRow } from "@px-pos/core";
import { DataTable, type Column } from "@/components/shared/data-table";
import { Empty } from "@/components/shared/empty";
import { Loadable } from "@/components/shared/loadable";
import { Money } from "@/components/shared/money";
import { PageHeader } from "@/components/shared/page-header";
import { RangePicker, useBizRange } from "@/components/shared/range-picker";
import { SearchInput } from "@/components/shared/search-input";
import { Stat, Stats } from "@/components/shared/stat";
import { useClient } from "@/components/providers/client-provider";
import { useInventoryActions } from "@/components/inventory/context";
import { stockValue } from "@/components/inventory/material-sheet";
import { useStockDays } from "@/hooks/use-inventory";
import type { WithId } from "@/lib/firebase/hooks";
import { cn } from "@/lib/utils";

type Row = UsageRow & { m: WithId<Material>; usedNet: number; usedWorth: number | null; wasteWorth: number | null; diffWorth: number | null };

const signed = (micro: number, m: Material) => (micro ? `${micro > 0 ? "+" : "−"}${formatStock(Math.abs(micro), m)}` : "—");

/**
 * Where stock went over a range: opening → bought → used by sales → wasted → count difference →
 * closing. The count difference is what counts found missing (or extra) against the books.
 */
export function UsageView() {
  const { cid, client } = useClient();
  const a = useInventoryActions();
  const range = useBizRange(client.day.cutoffMin, "7");
  const days = useStockDays(cid, range.from);
  const [q, setQ] = useState("");

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    for (const r of usageReport(a.inventory.onHand, days.data, range.from, range.to)) {
      const m = a.materials.byId.get(r.materialId);
      if (!m) continue;
      const last = a.rates.get(m.id);
      const usedNet = r.used - r.rev;
      out.push({ ...r, m, usedNet, usedWorth: stockValue(usedNet, m, last), wasteWorth: stockValue(r.waste, m, last), diffWorth: r.adj ? stockValue(r.adj, m, last) : 0 });
    }
    return out;
  }, [a.inventory.onHand, a.materials.byId, a.rates, days.data, range.from, range.to]);

  const needle = q.trim().toLowerCase();
  const shown = rows.filter((r) => !needle || r.m.name.toLowerCase().includes(needle));
  const sum = (k: "usedWorth" | "wasteWorth" | "diffWorth") => shown.reduce((n, r) => n + (r[k] ?? 0), 0);
  const bought = shown.reduce((n, r) => n + (stockValue(r.in, r.m, a.rates.get(r.m.id)) ?? 0), 0);
  const top = [...shown].filter((r) => r.usedWorth).sort((x, y) => (y.usedWorth ?? 0) - (x.usedWorth ?? 0))[0];

  const columns: Column<Row>[] = [
    { key: "name", header: "Material", sort: (r) => r.m.name, cell: (r) => <span className="font-medium">{r.m.name}</span> },
    { key: "opening", header: "Opening", align: "right", sort: (r) => r.opening, cell: (r) => <span className="text-muted-foreground">{formatStock(r.opening, r.m)}</span>, hideBelow: "lg" },
    { key: "in", header: "Bought / in", align: "right", sort: (r) => r.in, cell: (r) => (r.in ? formatStock(r.in, r.m) : <span className="text-muted-foreground">—</span>) },
    { key: "used", header: "Used by sales", align: "right", sort: (r) => r.usedNet, cell: (r) => (r.usedNet ? formatStock(r.usedNet, r.m) : <span className="text-muted-foreground">—</span>) },
    { key: "waste", header: "Wasted", align: "right", sort: (r) => r.waste, cell: (r) => (r.waste ? formatStock(r.waste, r.m) : <span className="text-muted-foreground">—</span>), hideBelow: "md" },
    { key: "adj", header: "Count difference", align: "right", sort: (r) => r.adj, cell: (r) => <span className={cn(r.adj < 0 ? "text-brand" : r.adj > 0 ? "text-success" : "text-muted-foreground")}>{signed(r.adj, r.m)}</span> },
    { key: "closing", header: "Closing", align: "right", sort: (r) => r.closing, cell: (r) => <span className={r.closing < 0 ? "text-brand" : undefined}>{formatStock(r.closing, r.m)}</span>, hideBelow: "lg" },
    { key: "worth", header: "Used worth", align: "right", sort: (r) => r.usedWorth ?? -1, cell: (r) => (r.usedWorth == null ? <span className="text-muted-foreground">—</span> : <Money value={r.usedWorth} />), footer: <Money value={sum("usedWorth")} className="font-semibold" />, hideBelow: "xl" },
  ];

  return (
    <>
      <PageHeader
        title="Stock usage"
        actions={
          <>
            <SearchInput value={q} onChange={setQ} placeholder="Material" className="md:w-48" />
            <RangePicker range={range} />
          </>
        }
      />
      <Stats>
        <Stat label="Used by sales" value={<Money value={sum("usedWorth")} decimals={0} />} sub={top ? `Most: ${top.m.name}` : "At the last prices paid"} />
        <Stat label="Wasted" value={<Money value={sum("wasteWorth")} decimals={0} />} accent={sum("wasteWorth") > 0} />
        <Stat label="Count difference" value={<Money value={sum("diffWorth")} decimals={0} signed />} accent={sum("diffWorth") < 0} sub={sum("diffWorth") < 0 ? "Missing against the books" : undefined} />
        <Stat label="Bought / stocked in" value={<Money value={bought} decimals={0} />} />
      </Stats>
      <Loadable state={days} onRetry={days.retry} isEmpty={() => !rows.length} empty={{ icon: ChartColumn, label: "No stock moved in this range." }}>
        {() =>
          shown.length ? (
            <DataTable
              rows={shown}
              columns={columns}
              rowKey={(r) => r.materialId}
              onRowClick={(r) => a.openMaterial(r.materialId)}
              selectedKey={a.sheet}
              initialSort={{ key: "used", dir: "desc" }}
              caption="Stock usage"
              mobileRow={(r) => (
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{r.m.name}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      Used {r.usedNet ? formatStock(r.usedNet, r.m) : "nothing"}
                      {r.waste ? ` · wasted ${formatStock(r.waste, r.m)}` : ""}
                    </div>
                  </div>
                  <span className={cn("text-sm tabular-nums", r.adj < 0 ? "text-brand" : "text-muted-foreground")}>{r.adj ? signed(r.adj, r.m) : formatStock(r.closing, r.m)}</span>
                </div>
              )}
            />
          ) : (
            <Empty icon={ChartColumn} label="No materials match." />
          )
        }
      </Loadable>
    </>
  );
}

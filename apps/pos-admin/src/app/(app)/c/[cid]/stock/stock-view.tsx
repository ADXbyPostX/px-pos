"use client";

import { useMemo, useState } from "react";
import { collection, query } from "firebase/firestore";
import { Boxes, MoreHorizontal, Plus } from "lucide-react";
import { addDays, formatStock, hasRecipe, materialLevel, materialStats, MATERIAL_UNIT_LABEL, paths, stockLevel, stockStats, type Item, type Material, type MaterialLevel, type Terminal } from "@px-pos/core";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { RowMenuContent } from "@/components/shared/row-menu";
import { DataTable, type Column } from "@/components/shared/data-table";
import { Empty } from "@/components/shared/empty";
import { SelectField } from "@/components/shared/form-controls";
import { Loadable } from "@/components/shared/loadable";
import { Money } from "@/components/shared/money";
import { PageHeader } from "@/components/shared/page-header";
import { SearchInput } from "@/components/shared/search-input";
import { Stat, Stats } from "@/components/shared/stat";
import { Pill } from "@/components/shared/status-badge";
import { useClient } from "@/components/providers/client-provider";
import { useInventoryActions } from "@/components/inventory/context";
import { LevelPill, stockValue } from "@/components/inventory/material-sheet";
import { rs } from "@/components/vendors/vendor-status";
import { useCollection, type WithId } from "@/lib/firebase/hooks";

type Show = "materials" | "attention" | "items";
const SHOW: { value: Show; label: string }[] = [
  { value: "materials", label: "Raw materials" },
  { value: "attention", label: "Low, out or below zero" },
  { value: "items", label: "Items in pieces" },
];

interface MatRow {
  id: string;
  m: WithId<Material>;
  onHand: number;
  level: MaterialLevel;
  used7: number;
  value: number | null;
  formulas: number;
}

interface ItemRow {
  id: string;
  item: WithId<Item>;
  onHand: number;
  sold7: number;
}

/** Sales use up stock only from till v1.1.0: older tills still sell, without moving it. */
const older = (v: string | undefined) => {
  const [a = 0, b = 0] = (v ?? "0").split(".").map((x) => Number.parseInt(x, 10) || 0);
  return a < 1 || (a === 1 && b < 1);
};

/** What's in stock: raw materials (bills, formulas, counts) and items counted in pieces. */
export function StockView() {
  const { cid } = useClient();
  const a = useInventoryActions();
  const { materials, inventory, items, stock, days, rates, usedIn, today } = a;
  const [q, setQ] = useState("");
  const [show, setShow] = useState<Show>("materials");
  const terminals = useCollection<Terminal>(`terminals:${cid}`, (db) => query(collection(db, paths.col(cid, "terminals"))));
  const since = addDays(today, -6);

  const rows = useMemo<MatRow[]>(
    () =>
      materials.data
        .filter((m) => m.active || (inventory.onHand[m.id] ?? 0) !== 0)
        .map((m) => {
          const onHand = inventory.onHand[m.id] ?? 0;
          let used7 = 0;
          for (const d of days.data) if (d.id >= since) {
            const s = materialStats(d.mat?.[m.id]);
            used7 += s.used - s.rev;
          }
          return { id: m.id, m, onHand, level: materialLevel(onHand, m.lowAt), used7, value: stockValue(Math.max(onHand, 0), m, rates.get(m.id)), formulas: new Set((usedIn.get(m.id) ?? []).map((u) => u.itemId)).size };
        }),
    [materials.data, inventory.onHand, days.data, since, rates, usedIn],
  );
  const itemRows = useMemo<ItemRow[]>(
    () =>
      items.data
        .filter((i) => i.trackStock)
        .map((i) => ({ id: i.id, item: i, onHand: stock.map.get(i.id) ?? 0, sold7: days.data.filter((d) => d.id >= since).reduce((n, d) => n + stockStats(d.stock?.[i.id]).sold, 0) })),
    [items.data, stock.map, days.data, since],
  );

  const needle = q.trim().toLowerCase();
  const shown = rows.filter((r) => (show !== "attention" || r.level !== "ok") && (!needle || r.m.name.toLowerCase().includes(needle)));
  const shownItems = itemRows.filter((r) => !needle || r.item.name.toLowerCase().includes(needle));
  const attention = rows.filter((r) => r.level === "low" || r.level === "out");
  const negative = rows.filter((r) => r.level === "negative");
  const worth = rows.reduce((n, r) => n + (r.value ?? 0), 0);
  const formulaItems = items.data.filter((i) => i.active && hasRecipe(i));
  const oldTills = formulaItems.length ? terminals.data.filter((t) => t.status === "active" && t.mode !== "kds" && older(t.appVersion)) : [];

  const matMenu = (r: MatRow) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${r.m.name}`} onClick={(e) => e.stopPropagation()}>
          <MoreHorizontal aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <RowMenuContent>
        <DropdownMenuItem onSelect={() => a.move("in", r.id)}>Stock in</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => a.move("waste", r.id)}>Wastage</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => a.count([r.id])}>Count</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => a.move("adjust", r.id)}>Adjust</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => a.editMaterial(r.m)}>Edit</DropdownMenuItem>
      </RowMenuContent>
    </DropdownMenu>
  );

  const columns: Column<MatRow>[] = [
    {
      key: "name",
      header: "Material",
      sort: (r) => r.m.name,
      cell: (r) => (
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-medium">{r.m.name}</span>
          <span className="truncate text-xs text-muted-foreground">{r.formulas ? `In ${r.formulas} formula${r.formulas === 1 ? "" : "s"}` : "Not in a formula"}</span>
        </span>
      ),
    },
    { key: "onHand", header: "On hand", align: "right", sort: (r) => r.onHand, cell: (r) => <span className={r.level === "negative" ? "text-brand" : undefined}>{formatStock(r.onHand, r.m)}</span> },
    { key: "low", header: "Low at", align: "right", sort: (r) => r.m.lowAt ?? 0, cell: (r) => <span className="text-muted-foreground">{r.m.lowAt ? formatStock(r.m.lowAt, r.m) : "—"}</span>, hideBelow: "xl" },
    { key: "status", header: "Status", sort: (r) => ["negative", "out", "low", "ok"].indexOf(r.level), cell: (r) => <LevelPill level={r.level} /> },
    { key: "used", header: "Used · 7 days", align: "right", sort: (r) => r.used7, cell: (r) => <span className="text-muted-foreground">{r.used7 ? formatStock(r.used7, r.m) : "—"}</span>, hideBelow: "lg" },
    {
      key: "rate",
      header: "Last price",
      align: "right",
      sort: (r) => rates.get(r.id)?.ratePaise ?? -1,
      cell: (r) => {
        const p = rates.get(r.id);
        return <span className="text-muted-foreground">{p ? `${rs(p.ratePaise)}/${MATERIAL_UNIT_LABEL[p.unit]}` : "—"}</span>;
      },
      hideBelow: "xl",
    },
    { key: "worth", header: "Worth", align: "right", sort: (r) => r.value ?? -1, cell: (r) => (r.value == null ? <span className="text-muted-foreground">—</span> : <Money value={r.value} />), footer: <Money value={shown.reduce((n, r) => n + (r.value ?? 0), 0)} className="font-semibold" /> },
    { key: "menu", header: <span className="sr-only">Actions</span>, align: "right", className: "w-12", cell: matMenu },
  ];

  const itemColumns: Column<ItemRow>[] = [
    { key: "name", header: "Item", sort: (r) => r.item.name, cell: (r) => <span className="font-medium">{r.item.name}</span> },
    { key: "onHand", header: "On hand", align: "right", sort: (r) => r.onHand, cell: (r) => <span className={r.onHand < 0 ? "text-brand" : undefined}>{r.onHand}</span> },
    { key: "low", header: "Low at", align: "right", sort: (r) => r.item.lowAt, cell: (r) => <span className="text-muted-foreground">{r.item.lowAt || "—"}</span>, hideBelow: "lg" },
    {
      key: "status",
      header: "Status",
      cell: (r) => {
        const l = r.onHand < 0 ? "negative" : stockLevel(r.onHand, r.item.lowAt);
        return l === "ok" ? <Pill tone="green" label="In stock" /> : l === "low" ? <Pill tone="yellow" label="Low" /> : <Pill tone="red" label={l === "negative" ? "Below zero" : "Out"} />;
      },
    },
    { key: "sold", header: "Sold · 7 days", align: "right", sort: (r) => r.sold7, cell: (r) => <span className="text-muted-foreground">{r.sold7 || "—"}</span>, hideBelow: "md" },
    {
      key: "menu",
      header: <span className="sr-only">Actions</span>,
      align: "right",
      className: "w-12",
      cell: (r) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${r.item.name}`} onClick={(e) => e.stopPropagation()}>
              <MoreHorizontal aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <RowMenuContent>
            <DropdownMenuItem onSelect={() => a.itemMove("in", r.id)}>Stock in</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => a.itemMove("waste", r.id)}>Wastage</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => a.itemMove("count", r.id)}>Count</DropdownMenuItem>
          </RowMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  const loading = materials.status === "loading" || inventory.status === "loading" || items.status === "loading";
  const failed = materials.status === "error" || inventory.status === "error" || items.status === "error";
  return (
    <>
      <PageHeader
        title="Stock"
        actions={
          <>
            <SearchInput value={q} onChange={setQ} placeholder={show === "items" ? "Item" : "Material"} className="md:w-48" />
            <SelectField aria-label="Show" className="md:w-44" value={show} onValueChange={setShow} options={SHOW} />
            <Button size="sm" variant="outline" onClick={() => a.count()} disabled={!materials.data.length}>
              Count stock
            </Button>
            <Button size="sm" variant="outline" onClick={() => a.move("waste")} disabled={!materials.data.length}>
              Wastage
            </Button>
            <Button size="sm" variant="outline" onClick={() => a.move("in")} disabled={!materials.data.length}>
              Stock in
            </Button>
            <Button size="sm" onClick={a.addMaterial}>
              <Plus data-icon="inline-start" aria-hidden />
              Add material
            </Button>
          </>
        }
      />
      <Stats>
        <Stat label="Raw materials" value={rows.filter((r) => r.m.active).length} sub={`${rows.filter((r) => r.formulas).length} in formulas · ${formulaItems.length} items made from them`} />
        <Stat label="Low or out" value={attention.length} accent={attention.length > 0} />
        <Stat label="Below zero" value={negative.length} accent={negative.length > 0} sub={negative.length ? "Count these" : undefined} />
        <Stat label="Stock worth" value={<Money value={worth} decimals={0} />} sub="At the last prices paid" />
      </Stats>
      {oldTills.length ? (
        <p role="status" className="rounded-xl border border-warning/40 px-4 py-3 text-sm text-warning">
          Sales on {oldTills.map((t) => `${t.name} (v${t.appVersion ?? "?"})`).join(", ")} don&apos;t use up stock yet. Update {oldTills.length === 1 ? "that till" : "those tills"} to v1.1.0.
        </p>
      ) : null}
      <Loadable
        state={{ data: rows, status: loading ? "loading" : failed ? "error" : "ready", error: materials.error ?? inventory.error ?? items.error }}
        onRetry={() => {
          materials.retry();
          items.retry();
        }}
        isEmpty={() => show !== "items" && !materials.data.length}
        empty={{ icon: Boxes, label: "No raw materials yet. Add them here, or they come in with vendor bills and formulas.", action: <Button size="sm" onClick={a.addMaterial}>Add material</Button> }}
      >
        {() =>
          show === "items" ? (
            shownItems.length ? (
              <DataTable rows={shownItems} columns={itemColumns} rowKey={(r) => r.id} initialSort={{ key: "name", dir: "asc" }} caption="Items counted in pieces" />
            ) : (
              <Empty icon={Boxes} label={itemRows.length ? "No items match." : "No items are counted in pieces. Choose Count pieces on an item (Menu › item › Stock)."} />
            )
          ) : shown.length ? (
            <DataTable
              rows={shown}
              columns={columns}
              rowKey={(r) => r.id}
              onRowClick={(r) => a.openMaterial(r.id)}
              selectedKey={a.sheet}
              initialSort={{ key: "status", dir: "asc" }}
              caption="Raw materials"
              rowClassName={(r) => (r.m.active ? undefined : "opacity-60")}
              mobileRow={(r) => (
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{r.m.name}</div>
                    <div className="truncate text-xs text-muted-foreground">{r.used7 ? `${formatStock(r.used7, r.m)} used this week` : r.formulas ? `In ${r.formulas} formula${r.formulas === 1 ? "" : "s"}` : "Not in a formula"}</div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className={r.level === "negative" ? "text-brand tabular-nums" : "tabular-nums"}>{formatStock(r.onHand, r.m)}</span>
                    <LevelPill level={r.level} />
                  </div>
                </div>
              )}
            />
          ) : (
            <Empty icon={Boxes} label={show === "attention" ? "Nothing is low, out or below zero." : "No materials match."} />
          )
        }
      </Loadable>
    </>
  );
}

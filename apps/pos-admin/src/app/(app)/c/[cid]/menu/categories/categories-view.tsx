"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, FolderOpen, Plus } from "lucide-react";
import { reorderPlan, STATION_LABEL, type Category } from "@px-pos/core";
import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/shared/data-table";
import { Loadable } from "@/components/shared/loadable";
import { PageHeader } from "@/components/shared/page-header";
import { ActiveBadge } from "@/components/shared/status-badge";
import { useClient } from "@/components/providers/client-provider";
import { usePrincipal } from "@/components/providers/principal-provider";
import { useCategories, useItems } from "@/hooks/use-menu";
import type { WithId } from "@/lib/firebase/hooks";
import { useRunPlan } from "@/lib/run-plan";
import { CategoryDialog } from "../category-dialog";

type Row = WithId<Category>;

export function CategoriesView() {
  const { cid } = useClient();
  const { planCtx } = usePrincipal();
  const { run, pending } = useRunPlan();
  const categories = useCategories(cid);
  const items = useItems(cid);
  const [editing, setEditing] = useState<Row | null>(null);
  const [open, setOpen] = useState(false);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of items.data) m.set(i.categoryId, (m.get(i.categoryId) ?? 0) + 1);
    return m;
  }, [items.data]);

  const move = (idx: number, dir: -1 | 1) => {
    const list = [...categories.data];
    const j = idx + dir;
    if (j < 0 || j >= list.length) return;
    [list[idx], list[j]] = [list[j]!, list[idx]!];
    void run(reorderPlan(planCtx(cid), "categories", list.map((c, k) => ({ id: c.id, sort: k + 1 }))));
  };

  const columns: Column<Row>[] = [
    {
      key: "order",
      header: "Order",
      cell: (c) => {
        const idx = categories.data.findIndex((x) => x.id === c.id);
        return (
          <span className="flex items-center gap-1">
            <span className="w-5 text-muted-foreground tabular-nums">{idx + 1}</span>
            <Button variant="ghost" size="icon-xs" disabled={idx === 0 || pending} onClick={(e) => { e.stopPropagation(); move(idx, -1); }} aria-label={`Move ${c.name} up`}>
              <ArrowUp aria-hidden />
            </Button>
            <Button variant="ghost" size="icon-xs" disabled={idx === categories.data.length - 1 || pending} onClick={(e) => { e.stopPropagation(); move(idx, 1); }} aria-label={`Move ${c.name} down`}>
              <ArrowDown aria-hidden />
            </Button>
          </span>
        );
      },
    },
    { key: "name", header: "Category", cell: (c) => <span className="font-medium">{c.name}</span> },
    { key: "station", header: "KOT goes to", cell: (c) => <span className="text-muted-foreground">{STATION_LABEL[c.station]}</span> },
    { key: "items", header: "Items", align: "right", cell: (c) => counts.get(c.id) ?? 0 },
    { key: "active", header: "Status", cell: (c) => <ActiveBadge active={c.active} on="Shown" off="Hidden" /> },
  ];

  return (
    <>
      <PageHeader
        title="Categories"
        actions={
          <Button
            size="sm"
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
          >
            <Plus data-icon="inline-start" aria-hidden />
            Add category
          </Button>
        }
      />
      <Loadable state={categories} onRetry={categories.retry} empty={{ icon: FolderOpen, label: "No categories yet. Start with Starters, Main course and Beverages.", action: <Button size="sm" onClick={() => setOpen(true)}>Add category</Button> }}>
        {(rows) => (
          <DataTable
            rows={rows}
            columns={columns}
            rowKey={(c) => c.id}
            onRowClick={(c) => {
              setEditing(c);
              setOpen(true);
            }}
            caption="Categories"
          />
        )}
      </Loadable>
      <CategoryDialog open={open} onOpenChange={setOpen} category={editing} nextSort={(categories.data.at(-1)?.sort ?? 0) + 1} />
    </>
  );
}

"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, FileUp, ImageUp, Pencil, Plus, UtensilsCrossed } from "lucide-react";
import { itemFlagPlan, MODE_LABEL, rateLabel, reorderPlan, stockLevel, upsertItemPlan, type Item, type Paise } from "@px-pos/core";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { DataTable, type Column } from "@/components/shared/data-table";
import { Empty } from "@/components/shared/empty";
import { MoneyInput } from "@/components/shared/form-controls";
import { Loadable, TableSkeleton } from "@/components/shared/loadable";
import { FoodMark, Money } from "@/components/shared/money";
import { PageHeader } from "@/components/shared/page-header";
import { Panel } from "@/components/shared/panel";
import { SearchInput } from "@/components/shared/search-input";
import { Flag } from "@/components/shared/status-badge";
import { useClient } from "@/components/providers/client-provider";
import { usePrincipal } from "@/components/providers/principal-provider";
import { useCategories, useItemPhotos, useItems, useStock } from "@/hooks/use-menu";
import type { WithId } from "@/lib/firebase/hooks";
import { useRunPlan } from "@/lib/run-plan";
import { cn } from "@/lib/utils";
import { CategoryDialog } from "./category-dialog";
import { ImportDialog } from "./import-dialog";
import { ItemThumb } from "./item-photo";
import { ItemSheet } from "./item-sheet";
import { PhotosDialog } from "./photos-dialog";

type Row = WithId<Item>;

/** Click the price to edit it in place: Enter saves (audited as a price change), Esc cancels. */
function InlinePrice({ item, onSave }: { item: Row; onSave: (p: Paise) => Promise<boolean> }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Paise | null>(item.pricePaise);
  const saving = useRef(false);
  if (item.variants.length) {
    return (
      <span className="text-muted-foreground">
        {item.variants.length} sizes · from <Money value={item.pricePaise} decimals="auto" className="text-foreground" />
      </span>
    );
  }
  if (!editing) {
    return (
      <button
        type="button"
        className="group/price -mx-1 inline-flex items-center gap-1 rounded px-1 py-0.5 hover:bg-muted"
        onClick={(e) => {
          e.stopPropagation();
          setDraft(item.pricePaise);
          setEditing(true);
        }}
        aria-label={`Edit price of ${item.name}`}
      >
        <Money value={item.pricePaise} decimals="auto" />
        <Pencil className="size-3 opacity-0 group-hover/price:opacity-60" aria-hidden />
      </button>
    );
  }
  return (
    <div
      className="ml-auto w-28"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={async (e) => {
        e.stopPropagation();
        if (e.key === "Escape") setEditing(false);
      }}
    >
      <MoneyInput
        value={draft}
        onChange={setDraft}
        autoFocus
        onEnter={async () => {
          if (saving.current || draft == null || draft <= 0) return;
          saving.current = true;
          const ok = draft === item.pricePaise ? true : await onSave(draft);
          saving.current = false;
          if (ok) setEditing(false);
        }}
      />
    </div>
  );
}

export function MenuView() {
  const { cid, client } = useClient();
  const { planCtx } = usePrincipal();
  const { run } = useRunPlan();
  const categories = useCategories(cid);
  const items = useItems(cid);
  const stock = useStock(cid);
  const photos = useItemPhotos(cid);
  const [cat, setCat] = useState<string>("all");
  const [q, setQ] = useState("");
  const [food, setFood] = useState<"all" | "veg" | "nonveg">("all");
  const [editing, setEditing] = useState<Row | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [catDialog, setCatDialog] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [photosOpen, setPhotosOpen] = useState(false);

  const catName = useMemo(() => new Map(categories.data.map((c) => [c.id, c.name])), [categories.data]);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of items.data) m.set(i.categoryId, (m.get(i.categoryId) ?? 0) + 1);
    return m;
  }, [items.data]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return items.data.filter(
      (i) =>
        (cat === "all" || i.categoryId === cat) &&
        (food === "all" || (food === "veg" ? i.foodType === "veg" : i.foodType !== "veg")) &&
        (!needle || [i.name, i.shortName ?? "", i.code ?? ""].some((v) => v.toLowerCase().includes(needle))),
    );
  }, [items.data, cat, food, q]);

  const openNew = () => {
    setEditing(null);
    setSheetOpen(true);
  };
  const moveCategory = (idx: number, dir: -1 | 1) => {
    const list = [...categories.data];
    const j = idx + dir;
    if (j < 0 || j >= list.length) return;
    [list[idx], list[j]] = [list[j]!, list[idx]!];
    void run(reorderPlan(planCtx(cid), "categories", list.map((c, k) => ({ id: c.id, sort: k + 1 }))));
  };

  const columns: Column<Row>[] = [
    {
      key: "name",
      header: "Item",
      sort: (i) => i.name,
      cell: (i) => (
        <span className="flex items-center gap-2.5">
          <ItemThumb uri={photos.map.get(i.id)} />
          <FoodMark type={i.foodType} />
          <span className="flex min-w-0 flex-col">
            <span className={cn("truncate font-medium", !i.active && "text-muted-foreground line-through")}>{i.name}</span>
            {i.code || i.shortName ? <span className="truncate text-xs text-muted-foreground">{[i.code, i.shortName].filter(Boolean).join(" · ")}</span> : null}
          </span>
        </span>
      ),
    },
    { key: "category", header: "Category", sort: (i) => catName.get(i.categoryId) ?? "", cell: (i) => <span className="text-muted-foreground">{catName.get(i.categoryId) ?? "—"}</span>, hideBelow: "md" },
    {
      key: "price",
      header: "Rate",
      align: "right",
      sort: (i) => i.pricePaise,
      cell: (i) => <InlinePrice item={i} onSave={(p) => run(upsertItemPlan(planCtx(cid), { id: i.id, item: { ...stripMeta(i), pricePaise: p }, before: i }), `${i.name}: new rate saved`)} />,
    },
    { key: "tax", header: "GST", align: "right", sort: (i) => i.taxBps ?? client.defaultTaxBps, cell: (i) => (i.taxBps == null ? <span className="text-warning tabular-nums" title="No rate saved on this item: billed at the outlet default">{rateLabel(client.defaultTaxBps)}*</span> : <span className="text-muted-foreground tabular-nums">{rateLabel(i.taxBps)}</span>), hideBelow: "lg" },
    { key: "modes", header: "Sold in", cell: (i) => <span className="text-xs text-muted-foreground">{i.modes.map((m) => MODE_LABEL[m]).join(" · ")}</span>, hideBelow: "xl" },
    {
      key: "stock",
      header: "Stock",
      align: "right",
      sort: (i) => (i.trackStock ? (stock.map.get(i.id) ?? 0) : -1e9),
      cell: (i) => {
        if (!i.trackStock) return <span className="text-xs text-muted-foreground">Not tracked</span>;
        const onHand = stock.map.get(i.id) ?? 0;
        const level = stockLevel(onHand, i.lowAt);
        return (
          <span className="inline-flex items-center gap-2">
            {level !== "ok" ? <Flag tone={level === "out" ? "red" : "yellow"}>{level === "out" ? "Out" : "Low"}</Flag> : null}
            <span className="tabular-nums">{onHand}</span>
          </span>
        );
      },
      hideBelow: "lg",
    },
    {
      key: "available",
      header: "Available",
      align: "center",
      sort: (i) => (i.available ? 1 : 0),
      cell: (i) => (
        <Switch
          checked={i.available}
          onClick={(e) => e.stopPropagation()}
          onCheckedChange={(v) => void run(itemFlagPlan(planCtx(cid), i.id, i.name, { available: v }), v ? `${i.name} is available` : `${i.name} marked out of stock`)}
          aria-label={`${i.name} available`}
        />
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Menu items"
        actions={
          <>
            <SearchInput value={q} onChange={setQ} placeholder="Search items" />
            <ToggleGroup type="single" variant="outline" size="sm" value={food} onValueChange={(v) => v && setFood(v as typeof food)} aria-label="Veg filter">
              <ToggleGroupItem value="all" className="px-3">All</ToggleGroupItem>
              <ToggleGroupItem value="veg" className="gap-1.5 px-3">
                <FoodMark type="veg" /> Veg
              </ToggleGroupItem>
              <ToggleGroupItem value="nonveg" className="gap-1.5 px-3">
                <FoodMark type="nonveg" /> Non-veg
              </ToggleGroupItem>
            </ToggleGroup>
            <Button size="sm" variant="outline" onClick={() => setImportOpen(true)} disabled={categories.status === "loading" || items.status === "loading"}>
              <FileUp data-icon="inline-start" aria-hidden />
              Import
            </Button>
            <Button size="sm" variant="outline" onClick={() => setPhotosOpen(true)} disabled={items.data.length === 0 || photos.status === "loading"}>
              <ImageUp data-icon="inline-start" aria-hidden />
              Photos
            </Button>
            <Button size="sm" onClick={openNew} disabled={categories.data.length === 0}>
              <Plus data-icon="inline-start" aria-hidden />
              Add item
            </Button>
          </>
        }
      />
      <div className="grid min-h-0 grid-cols-1 gap-4 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <Panel
          title="Categories"
          className="self-start lg:sticky lg:-top-6"
          action={
            <Button variant="ghost" size="icon-sm" onClick={() => setCatDialog(true)} aria-label="Add category">
              <Plus aria-hidden />
            </Button>
          }
        >
          {categories.status === "loading" ? (
            <div className="p-4 text-sm text-muted-foreground">Loading…</div>
          ) : (
            <ul className="flex flex-row gap-1 overflow-x-auto p-2 lg:flex-col lg:overflow-visible">
              <li>
                <button type="button" onClick={() => setCat("all")} className={cn("flex min-h-9 w-full items-center justify-between gap-3 rounded-md px-2.5 text-sm whitespace-nowrap hover:bg-muted", cat === "all" && "bg-muted font-medium")}>
                  All items
                  <span className="text-xs text-muted-foreground tabular-nums">{items.data.length}</span>
                </button>
              </li>
              {categories.data.map((c, idx) => (
                <li key={c.id} className="group/cat flex items-center gap-0.5">
                  <button type="button" onClick={() => setCat(c.id)} className={cn("flex min-h-9 flex-1 items-center justify-between gap-3 rounded-md px-2.5 text-sm whitespace-nowrap hover:bg-muted", cat === c.id && "bg-muted font-medium", !c.active && "text-muted-foreground")}>
                    <span className="truncate">{c.name}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">{counts.get(c.id) ?? 0}</span>
                  </button>
                  <span className="hidden flex-col lg:flex">
                    <button type="button" onClick={() => moveCategory(idx, -1)} disabled={idx === 0} className="rounded p-0.5 text-muted-foreground opacity-0 group-hover/cat:opacity-100 hover:text-foreground focus-visible:opacity-100 disabled:invisible" aria-label={`Move ${c.name} up`}>
                      <ArrowUp className="size-3" aria-hidden />
                    </button>
                    <button type="button" onClick={() => moveCategory(idx, 1)} disabled={idx === categories.data.length - 1} className="rounded p-0.5 text-muted-foreground opacity-0 group-hover/cat:opacity-100 hover:text-foreground focus-visible:opacity-100 disabled:invisible" aria-label={`Move ${c.name} down`}>
                      <ArrowDown className="size-3" aria-hidden />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="border-t px-4 py-2.5">
            <Link href={`/c/${cid}/menu/categories`} className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
              Manage categories
            </Link>
          </div>
        </Panel>

        <div className="min-w-0">
          {categories.status === "ready" && categories.data.length === 0 ? (
            <Empty icon={UtensilsCrossed} label="Create a category first (Starters, Main course, Beverages…), then add items with their rates." action={
                <div className="flex flex-wrap justify-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}>
                    <FileUp data-icon="inline-start" aria-hidden />
                    Import menu
                  </Button>
                  <Button size="sm" onClick={() => setCatDialog(true)}>
                    Add category
                  </Button>
                </div>
              }
            />
          ) : (
            <Loadable state={items} onRetry={items.retry} skeleton={<TableSkeleton />} empty={{ icon: UtensilsCrossed, label: "No items yet. Add the first dish with its rate.", action: <Button size="sm" onClick={openNew}>Add item</Button> }}>
              {() =>
                rows.length ? (
                  <DataTable
                    rows={rows}
                    columns={columns}
                    rowKey={(i) => i.id}
                    onRowClick={(i) => {
                      setEditing(i);
                      setSheetOpen(true);
                    }}
                    selectedKey={sheetOpen ? editing?.id : null}
                    caption="Menu items"
                    mobileRow={(i) => (
                      <div className="flex items-center justify-between gap-3">
                        <span className="flex min-w-0 items-center gap-2">
                          <ItemThumb uri={photos.map.get(i.id)} className="size-8" />
                          <FoodMark type={i.foodType} />
                          <span className="truncate">{i.name}</span>
                        </span>
                        <Money value={i.pricePaise} decimals="auto" />
                      </div>
                    )}
                  />
                ) : (
                  <p className="rounded-xl border border-dashed px-6 py-12 text-center text-sm text-muted-foreground">No items match these filters.</p>
                )
              }
            </Loadable>
          )}
        </div>
      </div>
      <ItemSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        item={editing}
        photo={editing ? (photos.map.get(editing.id) ?? null) : null}
        categories={categories.data}
        defaultCategoryId={cat !== "all" ? cat : (categories.data[0]?.id ?? "")}
        nextSort={(items.data.at(-1)?.sort ?? 0) + 1}
      />
      <PhotosDialog open={photosOpen} onOpenChange={setPhotosOpen} items={items.data} photos={photos.map} />
      <ImportDialog open={importOpen} onOpenChange={setImportOpen} categories={categories.data} items={items.data} />
      <CategoryDialog open={catDialog} onOpenChange={setCatDialog} category={null} nextSort={(categories.data.at(-1)?.sort ?? 0) + 1} />
    </>
  );
}

/** Item doc → editable input (drop metadata fields). */
function stripMeta(i: Row) {
  const { id: _id, _path, schemaVersion: _v, createdAtMs: _c, createdAt: _ca, updatedAtMs: _u, source: _s, rev: _r, ...rest } = i;
  void _id;
  void _path;
  void _v;
  void _c;
  void _ca;
  void _u;
  void _s;
  void _r;
  return rest;
}

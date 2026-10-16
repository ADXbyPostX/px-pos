"use client";

import { useMemo, useState } from "react";
import { ScrollText } from "lucide-react";
import { bizDateLabel, formatStock, type Material, type Posting, type PostingKind } from "@px-pos/core";
import { DataTable, type Column } from "@/components/shared/data-table";
import { Empty } from "@/components/shared/empty";
import { SelectField } from "@/components/shared/form-controls";
import { Loadable } from "@/components/shared/loadable";
import { PageHeader } from "@/components/shared/page-header";
import { KV } from "@/components/shared/panel";
import { RangePicker, useBizRange } from "@/components/shared/range-picker";
import { RecordSheet } from "@/components/shared/record-sheet";
import { SearchInput } from "@/components/shared/search-input";
import { useClient } from "@/components/providers/client-provider";
import { useInventoryActions } from "@/components/inventory/context";
import { usePostings } from "@/hooks/use-inventory";
import type { WithId } from "@/lib/firebase/hooks";
import { fmtDateTime, fmtTime } from "@/lib/format";
import { cn } from "@/lib/utils";

type Group = "all" | "sales" | "bills" | "counts" | "waste" | "in";
const GROUPS: { value: Group; label: string; kinds: PostingKind[] }[] = [
  { value: "all", label: "Everything", kinds: [] },
  { value: "sales", label: "Sales and voids", kinds: ["kot", "quick", "line_void", "cancel_bill"] },
  { value: "bills", label: "Vendor bills", kinds: ["purchase", "purchase_void"] },
  { value: "counts", label: "Counts", kinds: ["material_count", "count"] },
  { value: "waste", label: "Wastage", kinds: ["material_waste", "wastage"] },
  { value: "in", label: "Stock in and adjustments", kinds: ["material_in", "material_adjust", "stock_in", "adjust"] },
];

const KIND_LABEL: Partial<Record<PostingKind, string>> = {
  kot: "Sale (KOT)",
  quick: "Sale",
  line_void: "Item voided",
  cancel_bill: "Bill cancelled",
  purchase: "Vendor bill",
  purchase_void: "Vendor bill voided",
  material_in: "Stock in",
  material_waste: "Wastage",
  material_adjust: "Adjusted",
  material_count: "Count",
  stock_in: "Stock in (pieces)",
  wastage: "Wastage (pieces)",
  adjust: "Adjusted (pieces)",
  count: "Count (pieces)",
};

type Row = WithId<Posting> & { reason?: string; lines?: Array<{ materialId: string; name: string; qty: number; book?: number }>; itemId?: string };

interface Change {
  key: string;
  name: string;
  text: string;
  delta: number;
}

/** Every batch that moved stock, newest first: sales, vendor bills, counts, wastage, stock in. */
export function LedgerView() {
  const { cid, client } = useClient();
  const a = useInventoryActions();
  const range = useBizRange(client.day.cutoffMin, "7");
  const postings = usePostings(cid, range.from, range.to);
  const [q, setQ] = useState("");
  const [group, setGroup] = useState<Group>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const itemName = useMemo(() => new Map(a.items.data.map((i) => [i.id, i.name])), [a.items.data]);

  const changesOf = (p: Row): Change[] => {
    const out: Change[] = [];
    for (const [id, d] of Object.entries(p.materials ?? {})) {
      const m: Material | undefined = a.materials.byId.get(id);
      out.push({ key: `m:${id}`, name: m?.name ?? "Material", text: m ? `${d > 0 ? "+" : "−"}${formatStock(Math.abs(d), m)}` : String(d), delta: d });
    }
    for (const [id, d] of Object.entries(p.stock ?? {})) out.push({ key: `i:${id}`, name: itemName.get(id) ?? "Item", text: `${d > 0 ? "+" : "−"}${Math.abs(d)}`, delta: d });
    return out;
  };

  const rows = useMemo(() => {
    const kinds = GROUPS.find((g) => g.value === group)?.kinds ?? [];
    const needle = q.trim().toLowerCase();
    return (postings.data as Row[])
      .filter((p) => Object.keys(p.materials ?? {}).length || Object.keys(p.stock ?? {}).length)
      .filter((p) => !kinds.length || kinds.includes(p.kind))
      .filter((p) => !needle || changesOf(p).some((c) => c.name.toLowerCase().includes(needle)) || (p.reason ?? "").toLowerCase().includes(needle))
      .reverse();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postings.data, group, q, a.materials.byId, itemName]);
  const multiDay = range.from !== range.to;
  const open = openId ? (rows.find((r) => r.id === openId) ?? null) : null;

  const columns: Column<Row>[] = [
    { key: "when", header: "When", sort: (r) => r.createdAtMs, cell: (r) => <span className="text-muted-foreground tabular-nums">{multiDay ? `${bizDateLabel(r.businessDate)}, ${fmtTime(r.createdAtMs)}` : fmtTime(r.createdAtMs)}</span> },
    {
      key: "what",
      header: "What",
      sort: (r) => r.kind,
      cell: (r) => (
        <span className="flex min-w-0 flex-col">
          <span className="font-medium">{KIND_LABEL[r.kind] ?? r.kind}</span>
          {r.reason ? <span className="max-w-64 truncate text-xs text-muted-foreground">{r.reason}</span> : null}
        </span>
      ),
    },
    { key: "where", header: "Where", cell: (r) => <span className="text-muted-foreground">{r.terminalId ? a.terminalName(r.terminalId) : "Admin panel"}</span>, hideBelow: "lg" },
    {
      key: "changes",
      header: "Stock",
      cell: (r) => {
        const c = changesOf(r);
        return (
          <span className="block max-w-[28rem] truncate text-sm">
            {c.slice(0, 3).map((x, i) => (
              <span key={x.key}>
                {i ? ", " : ""}
                {x.name} <span className={cn("tabular-nums", x.delta < 0 ? "text-brand" : "text-success")}>{x.text}</span>
              </span>
            ))}
            {c.length > 3 ? <span className="text-muted-foreground"> +{c.length - 3}</span> : null}
          </span>
        );
      },
    },
  ];

  return (
    <>
      <PageHeader
        title="Stock ledger"
        actions={
          <>
            <SearchInput value={q} onChange={setQ} placeholder="Material, item, reason" className="md:w-48" />
            <SelectField aria-label="Show" className="md:w-48" value={group} onValueChange={setGroup} options={GROUPS.map((g) => ({ value: g.value, label: g.label }))} />
            <RangePicker range={range} maxDays={31} />
          </>
        }
      />
      <Loadable state={postings} onRetry={postings.retry} isEmpty={() => !rows.length && !q && group === "all"} empty={{ icon: ScrollText, label: "Nothing moved stock in this range." }}>
        {() =>
          rows.length ? (
            <DataTable
              rows={rows}
              columns={columns}
              rowKey={(r) => r.id}
              onRowClick={(r) => setOpenId(r.id)}
              selectedKey={openId}
              caption="Stock ledger"
              mobileRow={(r) => {
                const c = changesOf(r);
                return (
                  <div className="flex flex-col gap-0.5">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-medium">{KIND_LABEL[r.kind] ?? r.kind}</span>
                      <span className="text-xs text-muted-foreground tabular-nums">{multiDay ? `${bizDateLabel(r.businessDate)}, ${fmtTime(r.createdAtMs)}` : fmtTime(r.createdAtMs)}</span>
                    </div>
                    <span className="truncate text-xs text-muted-foreground">{c.map((x) => `${x.name} ${x.text}`).join(", ")}</span>
                  </div>
                );
              }}
            />
          ) : (
            <Empty icon={ScrollText} label="Nothing matches." />
          )
        }
      </Loadable>
      <RecordSheet open={Boolean(open)} onOpenChange={(o) => !o && setOpenId(null)} title={open ? (KIND_LABEL[open.kind] ?? open.kind) : ""} meta={open ? fmtDateTime(open.createdAtMs) : null}>
        {open ? (
          <div className="flex flex-col gap-5">
            <KV
              items={[
                { label: "Business day", value: bizDateLabel(open.businessDate, true) },
                { label: "Where", value: open.terminalId ? a.terminalName(open.terminalId) : "Admin panel" },
                ...(open.reason ? [{ label: "Reason", value: open.reason }] : []),
              ]}
            />
            <ul className="divide-y overflow-clip rounded-xl border text-sm">
              {changesOf(open).map((c) => {
                const counted = open.kind === "material_count" ? open.lines?.find((l) => `m:${l.materialId}` === c.key) : undefined;
                const m = counted ? a.materials.byId.get(counted.materialId) : undefined;
                return (
                  <li key={c.key} className="flex items-center justify-between gap-3 px-3 py-2">
                    <span className="min-w-0 truncate">
                      {c.name}
                      {counted && m ? <span className="block text-xs text-muted-foreground">Book {formatStock(counted.book ?? 0, m)} · counted {formatStock(counted.qty, m)}</span> : null}
                    </span>
                    <span className={cn("shrink-0 tabular-nums", c.delta < 0 ? "text-brand" : "text-success")}>{c.text}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </RecordSheet>
    </>
  );
}

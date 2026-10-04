"use client";

import { useMemo, useState } from "react";
import { collection, limit, orderBy, query } from "firebase/firestore";
import { History } from "lucide-react";
import { paths, type AuditEntry } from "@px-pos/core";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { DataTable, type Column } from "@/components/shared/data-table";
import { Loadable } from "@/components/shared/loadable";
import { PageHeader } from "@/components/shared/page-header";
import { KV } from "@/components/shared/panel";
import { RecordSheet } from "@/components/shared/record-sheet";
import { SearchInput } from "@/components/shared/search-input";
import { useClient } from "@/components/providers/client-provider";
import { useQueryOnce, type WithId } from "@/lib/firebase/hooks";
import { fmtDateTime } from "@/lib/format";

type Row = WithId<AuditEntry>;

const GROUPS: Record<string, { label: string; prefixes: string[] }> = {
  all: { label: "All", prefixes: [] },
  bills: { label: "Bills", prefixes: ["bill.", "order.", "line.", "invoice."] },
  menu: { label: "Menu", prefixes: ["item.", "staff."] },
  stock: { label: "Stock", prefixes: ["stock."] },
  cash: { label: "Cash & day", prefixes: ["cash.", "drawer.", "day.", "expense."] },
  setup: { label: "Setup", prefixes: ["client.", "terminal.", "table.", "kot."] },
};

const ACTION_LABEL: Record<string, string> = {
  "bill.reopen": "Bill reopened for edit",
  "bill.edit": "Bill edited",
  "bill.cancel": "Bill cancelled",
  "order.cancel": "Order cancelled",
  "order.merge": "Tables merged",
  "line.void": "Item voided",
  "invoice.reprint": "Bill reprinted",
  "kot.reprint": "KOT reprinted",
  "invoice.void_unused": "Unused invoice number voided",
  "item.create": "Item added",
  "item.update": "Item changed",
  "item.price": "Rate changed",
  "item.flags": "Item availability changed",
  "staff.create": "Staff added",
  "staff.update": "Staff changed",
  "stock.in": "Stock received",
  "stock.waste": "Wastage",
  "stock.adjust": "Stock adjusted",
  "stock.count": "Stock counted",
  "cash.paid_in": "Cash paid in",
  "cash.drop": "Cash drop",
  "cash.no_sale": "Drawer opened (no sale)",
  "drawer.open": "Drawer opened",
  "drawer.close": "Drawer closed",
  "day.close": "Day closed (Z)",
  "day.reopen": "Day reopened",
  "day.carry_forward": "Day carried forward",
  "expense.void": "Expense voided",
  "client.create": "Client created",
  "client.update": "Client changed",
  "client.settings": "Settings changed",
  "client.modes": "Order modes changed",
  "client.admins": "Admins assigned",
  "client.status": "Client status changed",
  "terminal.pair": "Terminal paired",
  "terminal.revoke": "Terminal revoked",
  "terminal.update": "Terminal changed",
  "table.transfer": "Table moved",
};

const PAGE = 200;

function Json({ value }: { value: unknown }) {
  if (value === undefined) return <span className="text-muted-foreground">—</span>;
  return <pre className="max-h-64 overflow-auto rounded-md border bg-background p-2 font-mono text-xs whitespace-pre-wrap">{JSON.stringify(value, null, 2)}</pre>;
}

export function AuditView() {
  const { cid } = useClient();
  const [pages, setPages] = useState(1);
  const [group, setGroup] = useState("all");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Row | null>(null);
  const log = useQueryOnce<AuditEntry>(`audit:${cid}:${pages}`, (db) => query(collection(db, paths.col(cid, "auditLog")), orderBy("atMs", "desc"), limit(PAGE * pages)));

  const rows = useMemo(() => {
    const prefixes = GROUPS[group]?.prefixes ?? [];
    const needle = q.trim().toLowerCase();
    return log.data.filter(
      (r) =>
        (!prefixes.length || prefixes.some((p) => r.action.startsWith(p))) &&
        (!needle || [r.action, ACTION_LABEL[r.action] ?? "", r.target.label ?? "", r.actor.name ?? r.actor.id, r.reason ?? ""].some((v) => v.toLowerCase().includes(needle))),
    );
  }, [log.data, group, q]);

  const columns: Column<Row>[] = [
    { key: "at", header: "When", sort: (r) => r.atMs, cell: (r) => <span className="text-muted-foreground tabular-nums">{fmtDateTime(r.atMs)}</span> },
    { key: "action", header: "What", sort: (r) => r.action, cell: (r) => ACTION_LABEL[r.action] ?? r.action },
    { key: "target", header: "On", cell: (r) => r.target.label ?? r.target.id, hideBelow: "md" },
    { key: "actor", header: "By", sort: (r) => r.actor.name ?? r.actor.id, cell: (r) => <span className="text-muted-foreground">{r.actor.name ?? `${r.actor.kind} ${r.actor.id.slice(0, 6)}`}{r.approver ? ` · approved by ${r.approver.name ?? r.approver.id.slice(0, 6)}` : ""}</span>, hideBelow: "lg" },
    { key: "reason", header: "Reason", cell: (r) => <span className="text-muted-foreground">{r.reason ?? ""}</span>, hideBelow: "xl" },
  ];

  return (
    <>
      <PageHeader
        title="Audit log"
        actions={
          <>
            <SearchInput value={q} onChange={setQ} placeholder="Search log" />
            <ToggleGroup type="single" variant="outline" size="sm" value={group} onValueChange={(v) => v && setGroup(v)} aria-label="Type">
              {Object.entries(GROUPS).map(([k, g]) => (
                <ToggleGroupItem key={k} value={k} className="px-3">{g.label}</ToggleGroupItem>
              ))}
            </ToggleGroup>
          </>
        }
      />
      <Loadable state={log} onRetry={log.reload} empty={{ icon: History, label: "Nothing has been changed yet." }}>
        {() => (
          <>
            <DataTable rows={rows} columns={columns} rowKey={(r) => r.id} onRowClick={setOpen} caption="Audit log" />
            {log.data.length >= PAGE * pages ? (
              <Button variant="outline" size="sm" className="self-center" onClick={() => setPages((p) => p + 1)}>
                Load older entries
              </Button>
            ) : null}
          </>
        )}
      </Loadable>
      <RecordSheet open={Boolean(open)} onOpenChange={(o) => !o && setOpen(null)} title={open ? (ACTION_LABEL[open.action] ?? open.action) : ""} meta={open ? fmtDateTime(open.atMs) : null}>
        {open ? (
          <div className="flex flex-col gap-5">
            <KV
              items={[
                { label: "Action", value: <span className="font-mono text-xs">{open.action}</span> },
                { label: "On", value: `${open.target.type} · ${open.target.label ?? open.target.id}` },
                { label: "By", value: `${open.actor.name ?? open.actor.id} (${open.actor.kind})` },
                { label: "Approved by", value: open.approver ? (open.approver.name ?? open.approver.id) : "—" },
                { label: "Terminal", value: open.terminalId ?? "—" },
                { label: "Reason", value: open.reason ?? "—" },
              ]}
            />
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">Before</span>
                <Json value={open.before} />
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">After</span>
                <Json value={open.after} />
              </div>
            </div>
          </div>
        ) : null}
      </RecordSheet>
    </>
  );
}

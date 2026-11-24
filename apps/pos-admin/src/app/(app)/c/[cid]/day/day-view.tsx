"use client";

import { useMemo, useState } from "react";
import { collection, documentId, limit, orderBy, query, where } from "firebase/firestore";
import { CalendarCheck, ChevronDown } from "lucide-react";
import { addDays, bizDateLabel, businessDateFor, paths, receiptText, renderZ, vendorDay, zReport, type DailyStats, type Day, type Drawer, type Staff, type Terminal, type ZReport } from "@px-pos/core";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DataTable, type Column } from "@/components/shared/data-table";
import { Loadable } from "@/components/shared/loadable";
import { Money } from "@/components/shared/money";
import { PageHeader } from "@/components/shared/page-header";
import { RecordSheet } from "@/components/shared/record-sheet";
import { Stat, Stats } from "@/components/shared/stat";
import { Flag } from "@/components/shared/status-badge";
import { useClient } from "@/components/providers/client-provider";
import { useMonths } from "@/hooks/use-months";
import { useCollection, useNow, type WithId } from "@/lib/firebase/hooks";
import { fmtDateTime } from "@/lib/format";
import { CloseDayDialog } from "./close-day-dialog";
import { MoveBillsDialog, PendingMoves, RecountDialog, ReopenDialog } from "./day-fix";
import { DayItems } from "./day-items";

type Row = WithId<Day> & { stats?: WithId<DailyStats> };

/** Cash counted minus expected over the drawers that were counted; null when none was. */
function cashDiff(z: ZReport | undefined): number | null {
  const counted = z?.drawers.filter((d) => d.variancePaise != null) ?? [];
  return counted.length ? counted.reduce((n, d) => n + (d.variancePaise ?? 0), 0) : null;
}

function Diff({ z }: { z: ZReport | undefined }) {
  if (!z) return <span className="text-muted-foreground">—</span>;
  const v = cashDiff(z);
  if (v == null) return <span className="text-muted-foreground">Not counted</span>;
  if (v === 0) return <span className="text-success">Matches</span>;
  return (
    <span className={v < 0 ? "text-brand" : "text-warning"}>
      {v < 0 ? "Short " : "Over "}
      <Money value={Math.abs(v)} decimals="auto" className="text-inherit" />
    </span>
  );
}

/**
 * End of day: every business day with its Z (or live X while open). Super admins and the outlet's
 * admins can close a day the till didn't — the till then asks to open the next one.
 */
export function DayView() {
  const { cid, client } = useClient();
  const now = useNow(60_000);
  const today = businessDateFor(now, client.day.cutoffMin);
  const days = useCollection<Day>(`days:${cid}`, (db) => query(collection(db, paths.col(cid, "days")), orderBy("openedAtMs", "desc"), limit(120)));
  // The last ~5 months of totals, by date id (a descending key scan isn't supported everywhere).
  const since = addDays(today, -150);
  const stats = useCollection<DailyStats>(`dailyStats:${cid}:${since}`, (db) => query(collection(db, paths.col(cid, "dailyStats")), where(documentId(), ">=", since)));
  const staff = useCollection<Staff>(`staff-all:${cid}`, (db) => query(collection(db, paths.col(cid, "staff"))));
  const terminals = useCollection<Terminal>(`terminals:${cid}`, (db) => query(collection(db, paths.col(cid, "terminals"))));
  const [openId, setOpenId] = useState<string | null>(null);
  const [closing, setClosing] = useState<string | null>(null);
  // Stays on the tab you picked while you move between days.
  const [tab, setTab] = useState<"z" | "items">("z");
  const [asPrinted, setAsPrinted] = useState(false);
  const [moving, setMoving] = useState<string | null>(null);
  const [recounting, setRecounting] = useState<string | null>(null);
  const [reopening, setReopening] = useState<string | null>(null);
  const months = useMonths(cid);

  const rows = useMemo<Row[]>(() => {
    const byDate = new Map(stats.data.map((s) => [s.id, s]));
    const listed = new Set(days.data.map((d) => d.id));
    // Sales on a date whose day record is gone (test data wiped while a till kept that day open)
    // still need a close: list them as open.
    const orphans: Row[] = stats.data.filter((s) => !listed.has(s.id)).map((s) => ({ id: s.id, status: "open", openedAtMs: 0, openedBy: "", updatedAtMs: 0, stats: s }));
    return [...days.data.map((d) => ({ ...d, stats: byDate.get(d.id) })), ...orphans];
  }, [days.data, stats.data]);
  const staffName = useMemo(() => {
    const m = new Map(staff.data.map((s) => [s.id, s.name]));
    return (id?: string) => (!id ? "—" : (m.get(id) ?? (id.startsWith("terminal:") ? "Terminal" : "Admin panel")));
  }, [staff.data]);
  const terminalNames = useMemo(() => Object.fromEntries(terminals.data.map((t) => [t.id, t.name])), [terminals.data]);

  const openDays = rows.filter((r) => r.status !== "closed");
  const late = openDays.filter((r) => r.id < today);
  const lastClosed = rows.find((r) => r.status === "closed");
  // A closed day shows its Z; an open (or reopened) one its live totals.
  const zOf = (r: Row) => (r.status === "closed" ? r.z : undefined);
  const totalOf = (r: Row) => zOf(r)?.totalPaise ?? r.stats?.totalPaise ?? 0;
  const ordersOf = (r: Row) => zOf(r)?.orders ?? r.stats?.orders ?? 0;
  const boughtOf = (r: Row) => zOf(r)?.purchasesPaise ?? vendorDay(r.stats).boughtPaise;
  const vendorPaidOf = (r: Row) => zOf(r)?.vendorPaidPaise ?? vendorDay(r.stats).paidPaise;
  const totalOn = (d: string) => {
    const r = rows.find((x) => x.id === d);
    return r ? totalOf(r) : 0;
  };
  const corrected = (r: Row) => Boolean(r.corrections?.some((c) => c.kind !== "reopen"));

  const columns: Column<Row>[] = [
    { key: "date", header: "Business day", sort: (r) => r.id, cell: (r) => <span className="font-medium">{bizDateLabel(r.id, true)}</span> },
    {
      key: "status",
      header: "Status",
      sort: (r) => r.status,
      cell: (r) =>
        r.status === "closed" ? (
          <span className="inline-flex items-center gap-2 text-muted-foreground">
            Closed
            {corrected(r) ? <Flag tone="zinc">Corrected</Flag> : null}
          </span>
        ) : r.reopenedAtMs ? (
          <Flag>Reopened</Flag>
        ) : r.id < today ? (
          <Flag>Still open</Flag>
        ) : (
          <span className="text-success">Open</span>
        ),
    },
    { key: "z", header: "Z", align: "right", sort: (r) => r.zNo ?? 0, cell: (r) => <span className="tabular-nums">{r.zNo ?? "—"}</span> },
    { key: "orders", header: "Orders", align: "right", sort: ordersOf, cell: (r) => <span className="tabular-nums">{ordersOf(r)}</span>, hideBelow: "md" },
    { key: "total", header: "Total billed", align: "right", sort: totalOf, cell: (r) => <Money value={totalOf(r)} /> },
    { key: "bought", header: "Bought", align: "right", sort: boughtOf, cell: (r) => <Money value={boughtOf(r)} dimZero />, hideBelow: "lg" },
    { key: "vendorPaid", header: "Paid to vendors", align: "right", sort: vendorPaidOf, cell: (r) => <Money value={vendorPaidOf(r)} dimZero />, hideBelow: "2xl" },
    { key: "cash", header: "Cash count", cell: (r) => <Diff z={zOf(r)} />, hideBelow: "lg" },
    { key: "closed", header: "Closed", sort: (r) => r.closedAtMs ?? 0, cell: (r) => <span className="text-muted-foreground">{r.closedAtMs ? `${fmtDateTime(r.closedAtMs)} · ${staffName(r.closedBy)}` : "—"}</span>, hideBelow: "xl" },
    {
      key: "action",
      header: <span className="sr-only">Actions</span>,
      align: "right",
      cell: (r) =>
        r.status !== "closed" ? (
          <Button
            size="sm"
            variant="outline"
            onClick={(e) => {
              e.stopPropagation();
              setClosing(r.id);
            }}
          >
            Close day
          </Button>
        ) : null,
    },
  ];

  const open = openId ? (rows.find((r) => r.id === openId) ?? null) : null;
  // The X report of an open day shows its drawers so far (a till that took cash without a drawer record counts with no float).
  const liveDate = open && open.status !== "closed" ? open.id : null;
  const drawers = useCollection<Drawer>(liveDate ? `drawers:${cid}:${liveDate}` : null, (db) => query(collection(db, paths.col(cid, "drawers")), where("businessDate", "==", liveDate)));
  const xDrawers = useMemo(() => {
    const list = drawers.data.map((d) => ({ terminalId: d.terminalId, openingFloatPaise: d.openingFloatPaise, ...(d.status === "closed" && d.countedPaise != null ? { countedPaise: d.countedPaise } : {}) }));
    const known = new Set(list.map((d) => d.terminalId));
    for (const tid of Object.keys(open?.stats?.cash ?? {})) if (!known.has(tid)) list.push({ terminalId: tid, openingFloatPaise: 0 });
    return list;
  }, [drawers.data, open?.stats?.cash]);
  const recountRow = recounting ? rows.find((x) => x.id === recounting) : undefined;
  const recountDay = recountRow?.status === "closed" && recountRow.z ? (recountRow as Day & { z: ZReport }) : null;
  const showFirst = Boolean(asPrinted && open?.status === "closed" && open.zFirst);
  const report = open ? ((showFirst ? open.zFirst : zOf(open)) ?? zReport({ zNo: 0, businessDate: open.id, closedAtMs: now, stats: open.stats ?? {}, drawers: xDrawers, invoiceRanges: [] })) : null;

  return (
    <>
      <PageHeader title="End of day" />
      <Stats>
        <Stat label="Open days" value={openDays.length} accent={late.length > 0} sub={late.length ? `${late.length} from an earlier date` : undefined} />
        <Stat label="Last Z" value={lastClosed ? `#${lastClosed.zNo ?? "—"}` : "—"} sub={lastClosed ? bizDateLabel(lastClosed.id, true) : undefined} />
        <Stat label="Last cash count" value={lastClosed ? <Diff z={lastClosed.z} /> : "—"} />
        <Stat label="Days closed" value={rows.filter((r) => r.status === "closed").length} />
      </Stats>
      <Loadable state={days} onRetry={days.retry} empty={{ icon: CalendarCheck, label: "No business days yet. The till opens the first one." }} isEmpty={() => !rows.length}>
        {() => (
          <DataTable
            rows={rows}
            columns={columns}
            rowKey={(r) => r.id}
            onRowClick={(r) => setOpenId(r.id)}
            selectedKey={openId}
            initialSort={{ key: "date", dir: "desc" }}
            caption="Business days"
            mobileRow={(r) => (
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{bizDateLabel(r.id, true)}</div>
                  <div className="truncate text-xs text-muted-foreground">{r.status === "closed" ? `Closed · Z ${r.zNo ?? "—"}` : r.id < today ? "Still open" : "Open"}</div>
                </div>
                <Money value={totalOf(r)} />
              </div>
            )}
          />
        )}
      </Loadable>
      <RecordSheet
        open={Boolean(open)}
        onOpenChange={(o) => !o && setOpenId(null)}
        title={open ? `Business day ${bizDateLabel(open.id, true)}` : ""}
        meta={open ? (open.status === "closed" ? `Closed · Z ${open.zNo ?? "—"}${corrected(open) ? " · Corrected" : ""}` : open.reopenedAtMs ? `Reopened · closes again as Z ${open.zNo ?? "—"}` : "Open · live totals") : null}
        footer={
          open ? (
            <>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline">
                    Fix day
                    <ChevronDown data-icon="inline-end" aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem disabled={months.isFrozen(open.id)} onSelect={() => setMoving(open.id)}>
                    Move bills to the day they were sold
                  </DropdownMenuItem>
                  {open.status === "closed" ? (
                    <>
                      <DropdownMenuItem disabled={months.isFrozen(open.id) || !open.z} onSelect={() => setRecounting(open.id)}>
                        Correct the cash count
                      </DropdownMenuItem>
                      <DropdownMenuItem disabled={months.isFrozen(open.id)} onSelect={() => setReopening(open.id)}>
                        Reopen this day
                      </DropdownMenuItem>
                    </>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
              {open.status !== "closed" ? (
                <Button variant="destructive" onClick={() => setClosing(open.id)}>
                  Close day
                </Button>
              ) : null}
            </>
          ) : null
        }
      >
        {open && months.isFrozen(open.id) ? <p className="mb-3 text-sm text-muted-foreground">This day is in a closed month, so it can&apos;t be changed. Only the super admin can reopen the month (End of day › Months).</p> : null}
        {open ? <PendingMoves cid={cid} businessDate={open.id} /> : null}
        {open && report ? (
          <Tabs value={tab} onValueChange={(v) => setTab(v as "z" | "items")} className="gap-3">
            <TabsList className="w-full">
              <TabsTrigger value="z">{open.status === "closed" ? "Z report" : "X report"}</TabsTrigger>
              <TabsTrigger value="items">Items</TabsTrigger>
            </TabsList>
            <TabsContent value="z" className="flex flex-col gap-3">
              {open.status === "closed" && open.zFirst ? (
                <div className="flex justify-end">
                  <Button variant="ghost" size="sm" aria-pressed={asPrinted} onClick={() => setAsPrinted((v) => !v)}>
                    {asPrinted ? "Show the corrected Z" : "Show the Z as printed"}
                  </Button>
                </div>
              ) : null}
              <pre aria-label={open.status === "closed" ? "Z report" : "X report"} className="overflow-x-auto rounded-lg border bg-white px-3 py-3 font-mono text-[11px] leading-snug text-black">
                {receiptText(renderZ(report, { cols: 48, outletName: client.name, terminalNames, ...(open.status === "closed" ? {} : { title: "X REPORT" as const }), ...(showFirst ? {} : { corrections: open.corrections }) }), 48)}
              </pre>
            </TabsContent>
            <TabsContent value="items">
              <DayItems cid={cid} outletName={client.name} businessDate={open.id} live={open.status !== "closed"} />
            </TabsContent>
          </Tabs>
        ) : null}
      </RecordSheet>
      <MoveBillsDialog cid={cid} from={moving} cutoffMin={client.day.cutoffMin} totalOf={totalOn} isFrozen={months.isFrozen} onOpenChange={(o) => !o && setMoving(null)} />
      <RecountDialog cid={cid} businessDate={recounting} day={recountDay} terminalNames={terminalNames} onOpenChange={(o) => !o && setRecounting(null)} />
      <ReopenDialog cid={cid} businessDate={reopening} day={reopening ? (rows.find((x) => x.id === reopening) ?? null) : null} today={today} onOpenChange={(o) => !o && setReopening(null)} />
      <CloseDayDialog cid={cid} businessDate={closing} today={today} stats={closing ? rows.find((r) => r.id === closing)?.stats : undefined} terminals={terminals.data} onOpenChange={(o) => !o && setClosing(null)} />
    </>
  );
}

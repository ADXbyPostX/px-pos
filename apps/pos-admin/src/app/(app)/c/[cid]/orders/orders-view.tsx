"use client";

import { useMemo, useState } from "react";
import { collection, limit, orderBy, query, where, type Firestore } from "firebase/firestore";
import { Receipt } from "lucide-react";
import { activeQty, billForLines, halfRateLabel, MODE_LABEL, orderWhere, paths, reasonLabel, type BillResult, type Order, type OrderMode, type Payment, type Staff, type Terminal } from "@px-pos/core";
import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/shared/data-table";
import { SelectField } from "@/components/shared/form-controls";
import { Loadable } from "@/components/shared/loadable";
import { Money } from "@/components/shared/money";
import { PageHeader } from "@/components/shared/page-header";
import { KV, Panel } from "@/components/shared/panel";
import { RangePicker, useBizRange } from "@/components/shared/range-picker";
import { RecordSheet } from "@/components/shared/record-sheet";
import { SearchInput } from "@/components/shared/search-input";
import { Stat, Stats } from "@/components/shared/stat";
import { DeliveryBadge, Flag, OrderStatusBadge } from "@/components/shared/status-badge";
import { useClient } from "@/components/providers/client-provider";
import { useCollection, useQueryOnce, type WithId } from "@/lib/firebase/hooks";
import { fmtDateTime, fmtTime, formatINR } from "@/lib/format";

type Row = WithId<Order>;
type StatusFilter = "all" | "running" | "settled" | "cancelled";

const PAGE = 200;
const PAY_LABEL: Record<string, string> = { cash: "Cash", card: "Card", upi: "UPI", other: "Other" };
const STATUS_FILTERS: Record<StatusFilter, string> = { all: "All", running: "Running", settled: "Settled", cancelled: "Cancelled" };

function matchesStatus(o: Order, f: StatusFilter) {
  if (f === "all") return true;
  if (f === "running") return o.status === "open" || o.status === "billed";
  return o.status === f;
}

function BillBreakdown({ bill }: { bill: BillResult }) {
  const disc = bill.itemDiscPaise + bill.billDiscPaise;
  // Tax-inclusive menus: show the taxable value GST was backed out of, so the rows add up.
  const incl = bill.priceMode === "inclusive" && bill.taxes.some((t) => t.bps > 0);
  const rows: { label: string; value: number; signed?: boolean }[] = [
    { label: `Items (${bill.itemQty})${incl ? " incl. GST" : ""}`, value: bill.grossPaise },
    ...(disc ? [{ label: "Discount", value: -disc }] : []),
    ...bill.charges.map((c) => ({ label: c.kind === "packaging" ? "Packaging" : c.kind === "delivery" ? "Delivery" : "Service charge", value: c.amountPaise })),
    ...(incl ? [{ label: "Taxable value", value: bill.taxablePaise }] : []),
    ...bill.taxes.filter((t) => t.bps > 0).map((t) => ({ label: `CGST ${halfRateLabel(t.bps)} + SGST ${halfRateLabel(t.bps)}`, value: t.cgstPaise + t.sgstPaise })),
    ...(bill.roundOffPaise ? [{ label: "Round off", value: bill.roundOffPaise, signed: true }] : []),
  ];
  return (
    <div className="flex flex-col gap-2 text-sm">
      {rows.map((r) => (
        <div key={r.label} className="flex items-center justify-between gap-4">
          <span className="text-muted-foreground">{r.label}</span>
          <Money value={r.value} signed={r.signed} />
        </div>
      ))}
      <div className="flex items-center justify-between gap-4 border-t pt-2 font-semibold">
        <span>Total{bill.docType === "bill_of_supply" ? " (bill of supply)" : ""}</span>
        <Money value={bill.grandTotalPaise} />
      </div>
    </div>
  );
}

function OrderDetail({ order, cid, staffName, terminalName }: { order: Row; cid: string; staffName: (id?: string) => string; terminalName: (id: string) => string }) {
  const { client } = useClient();
  const payments = useCollection<Payment>(`payments:${cid}:${order.id}`, (db) => query(collection(db, paths.col(cid, "payments")), where("orderId", "==", order.id)));
  const lines = Object.values(order.lines).sort((a, b) => a.seq - b.seq);
  const bill = order.bill ?? billForLines(client, order.mode, lines, { ...(order.billDiscount ? { billDiscount: order.billDiscount } : {}), serviceChargeOptIn: order.serviceChargeOptIn });

  return (
    <div className="flex flex-col gap-5">
      <KV
        items={[
          { label: "Type", value: MODE_LABEL[order.mode] },
          { label: "Status", value: <OrderStatusBadge status={order.status} /> },
          { label: "Bill no", value: order.invoiceNo ? <span className="font-mono text-xs">{order.invoiceNo}</span> : "—" },
          ...(order.covers ? [{ label: "Guests", value: order.covers }] : []),
          ...(order.customer?.name || order.customer?.phone ? [{ label: "Customer", value: [order.customer.name, order.customer.phone].filter(Boolean).join(" · ") }] : []),
          ...(order.customer?.address ? [{ label: "Address", value: [order.customer.address, order.customer.landmark].filter(Boolean).join(", ") }] : []),
          ...(order.delivery ? [{ label: "Delivery", value: <span className="flex items-center gap-2"><DeliveryBadge stage={order.delivery.stage} /> {order.delivery.pay === "cod" ? "COD" : "Prepaid"}{order.delivery.rider ? ` · ${order.delivery.rider}` : ""}</span> }] : []),
          { label: "Opened", value: `${fmtDateTime(order.createdAtMs)} · ${staffName(order.openedBy)}` },
          ...(order.settledAtMs ? [{ label: "Settled", value: `${fmtDateTime(order.settledAtMs)} · ${staffName(order.settledBy)}` }] : []),
          { label: "Terminal", value: terminalName(order.terminalId) },
          { label: "KOTs", value: order.kotCount },
        ]}
      />
      <Panel title="Items" bodyClassName="p-0">
        <ul className="divide-y">
          {lines.map((l) => {
            const q = activeQty(l);
            return (
              <li key={l.lineId} className="flex items-start gap-3 px-4 py-2 text-sm">
                <span className="w-8 shrink-0 text-muted-foreground tabular-nums">{q}×</span>
                <span className="min-w-0 flex-1">
                  <span className={q === 0 ? "text-muted-foreground line-through" : ""}>
                    {l.name}
                    {l.variantName ? ` (${l.variantName})` : ""}
                  </span>
                  {l.note ? <span className="block text-xs text-muted-foreground">{l.note}</span> : null}
                  {l.voidedQty ? <span className="block text-xs text-warning">{l.voidedQty} voided{l.voids?.[0]?.reason ? ` · ${reasonLabel(l.voids[0].reason)}` : ""}</span> : null}
                  {l.sentQty < l.qty ? <span className="block text-xs text-muted-foreground">{l.qty - l.sentQty} not sent to kitchen</span> : null}
                </span>
                <Money value={l.unitPricePaise * q} className="shrink-0" />
              </li>
            );
          })}
        </ul>
      </Panel>
      <Panel title={order.bill ? "Bill" : "Running total"} bodyClassName="p-4">
        <BillBreakdown bill={bill} />
      </Panel>
      <Panel title="Payments" bodyClassName="p-0">
        <Loadable state={payments} onRetry={payments.retry} skeleton={<div className="h-16" />} empty={{ icon: Receipt, label: "No payments yet." }}>
          {(rows) => (
            <ul className="divide-y">
              {rows
                .sort((a, b) => a.createdAtMs - b.createdAtMs)
                .map((p) => (
                  <li key={p.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                    <span className="w-14 font-medium">{PAY_LABEL[p.mode] ?? p.mode}</span>
                    <span className="flex-1 text-muted-foreground">
                      {p.kind === "refund" ? "Refund · " : ""}
                      {p.tenderedPaise ? `given ${formatINR(p.tenderedPaise, { decimals: "auto" })}` : ""}
                      {p.changePaise ? ` · change ${formatINR(p.changePaise, { decimals: "auto" })}` : ""}
                      {p.tipPaise ? ` · tip ${formatINR(p.tipPaise, { decimals: "auto" })}` : ""}
                      {p.ref ? ` · ${p.ref}` : ""}
                    </span>
                    <Money value={p.kind === "refund" ? -p.amountPaise : p.amountPaise} />
                  </li>
                ))}
            </ul>
          )}
        </Loadable>
      </Panel>
      {order.cancel ? (
        <Panel title="Cancelled" bodyClassName="p-4">
          <KV
            items={[
              { label: "Reason", value: reasonLabel(order.cancel.reason) },
              ...(order.cancel.note ? [{ label: "Note", value: order.cancel.note }] : []),
              { label: "By", value: staffName(order.cancel.by) },
              ...(order.cancel.approvedBy ? [{ label: "Approved by", value: staffName(order.cancel.approvedBy) }] : []),
              { label: "Food prepared", value: order.kotCount === 0 ? "No (voided before it was sent)" : order.cancel.prepared ? "Yes (wastage)" : "No (back to stock)" },
              { label: "When", value: fmtDateTime(order.cancel.atMs) },
            ]}
          />
        </Panel>
      ) : null}
    </div>
  );
}

export function OrdersView() {
  const { cid, client } = useClient();
  const range = useBizRange(client.day.cutoffMin);
  const [pages, setPages] = useState(1);
  const [mode, setMode] = useState<"all" | OrderMode>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  // Today is live; past ranges are one-shot (cheaper) with "Load more".
  const isToday = range.from === range.today && range.to === range.today;
  const key = `orders:${cid}:${range.from}:${range.to}:${pages}`;
  const build = (db: Firestore) =>
    query(collection(db, paths.col(cid, "orders")), where("businessDate", ">=", range.from), where("businessDate", "<=", range.to), orderBy("businessDate", "desc"), orderBy("createdAtMs", "desc"), limit(PAGE * pages));
  const live = useCollection<Order>(isToday ? key : null, build);
  const once = useQueryOnce<Order>(isToday ? null : key, build);
  const orders = isToday ? live : once;
  const retry = isToday ? live.retry : once.reload;

  const staff = useCollection<Staff>(`staff-all:${cid}`, (db) => query(collection(db, paths.col(cid, "staff"))));
  const terminals = useCollection<Terminal>(`terminals:${cid}`, (db) => query(collection(db, paths.col(cid, "terminals"))));
  const staffName = useMemo(() => {
    const m = new Map(staff.data.map((s) => [s.id, s.name]));
    return (id?: string) => (!id ? "—" : (m.get(id) ?? (id.startsWith("terminal:") ? "Terminal" : id.slice(0, 6))));
  }, [staff.data]);
  const terminalName = useMemo(() => {
    const m = new Map(terminals.data.map((t) => [t.id, `${t.name} (${t.code})`]));
    return (id: string) => m.get(id) ?? id.slice(0, 6);
  }, [terminals.data]);

  const totalOf = (o: Order) => o.bill?.grandTotalPaise ?? billForLines(client, o.mode, Object.values(o.lines), { ...(o.billDiscount ? { billDiscount: o.billDiscount } : {}), serviceChargeOptIn: o.serviceChargeOptIn }).grandTotalPaise;

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return orders.data.filter(
      (o) =>
        (mode === "all" || o.mode === mode) &&
        matchesStatus(o, status) &&
        (!needle || [o.orderNo, o.invoiceNo ?? "", o.tableLabel ?? "", o.token != null ? `token ${o.token}` : "", o.customer?.phone ?? "", o.customer?.name ?? ""].some((v) => v.toLowerCase().includes(needle))),
    );
  }, [orders.data, mode, status, q]);

  const all = orders.data;
  const settled = all.filter((o) => o.status === "settled");
  const settledValue = settled.reduce((n, o) => n + (o.bill?.grandTotalPaise ?? 0), 0);
  const running = all.filter((o) => o.status === "open" || o.status === "billed");
  const cancelled = all.filter((o) => o.status === "cancelled");
  const shownTotal = rows.filter((o) => o.status !== "cancelled").reduce((n, o) => n + totalOf(o), 0);
  const multiDay = range.from !== range.to;
  const modes = (["dineIn", "quick", "delivery"] as const).filter((m) => client.orderModes[m] || all.some((o) => o.mode === m));
  const open = openId ? (all.find((o) => o.id === openId) ?? null) : null;

  const columns: Column<Row>[] = [
    { key: "time", header: "Time", sort: (r) => r.createdAtMs, cell: (r) => <span className="text-muted-foreground tabular-nums">{multiDay ? fmtDateTime(r.createdAtMs) : fmtTime(r.createdAtMs)}</span> },
    { key: "no", header: "Order", sort: (r) => r.orderNo, cell: (r) => <span className="font-mono text-xs">{r.orderNo}</span> },
    { key: "where", header: "Where", cell: (r) => orderWhere(r.mode, { tableLabel: r.tableLabel, token: r.token, customer: r.customer, orderNo: r.orderNo }) },
    { key: "mode", header: "Type", sort: (r) => r.mode, cell: (r) => <span className="text-muted-foreground">{MODE_LABEL[r.mode]}</span>, hideBelow: "md" },
    { key: "bill", header: "Bill no", sort: (r) => r.invoiceNo ?? "", cell: (r) => <span className="font-mono text-xs text-muted-foreground">{r.invoiceNo ?? "—"}</span>, hideBelow: "lg" },
    { key: "items", header: "Items", align: "right", sort: (r) => Object.values(r.lines).reduce((n, l) => n + activeQty(l), 0), cell: (r) => <span className="tabular-nums">{Object.values(r.lines).reduce((n, l) => n + activeQty(l), 0)}</span>, hideBelow: "xl" },
    { key: "pay", header: "Paid by", cell: (r) => <span className="text-muted-foreground">{r.payModes?.map((m) => PAY_LABEL[m] ?? m).join(" + ") || "—"}</span>, hideBelow: "xl" },
    { key: "staff", header: "Staff", cell: (r) => <span className="text-muted-foreground">{staffName(r.openedBy)}</span>, hideBelow: "2xl" },
    { key: "terminal", header: "Terminal", cell: (r) => <span className="text-muted-foreground">{terminalName(r.terminalId)}</span>, hideBelow: "2xl" },
    {
      key: "status",
      header: "Status",
      sort: (r) => r.status,
      cell: (r) => (
        <span className="flex items-center gap-2">
          <OrderStatusBadge status={r.status} />
          {r.flags?.conflict ? <Flag>Merge</Flag> : null}
          {r.flags?.lateAfterClose ? <Flag>After Z</Flag> : null}
          {r.billModifiedCount ? <Flag tone="zinc">Edited</Flag> : null}
        </span>
      ),
    },
    {
      key: "total",
      header: "Total",
      align: "right",
      sort: (r) => totalOf(r),
      cell: (r) => <Money value={totalOf(r)} className={r.status === "cancelled" ? "text-muted-foreground line-through" : undefined} />,
      footer: <Money value={shownTotal} className="font-semibold" />,
    },
  ];

  return (
    <>
      <PageHeader
        title="Orders"
        actions={
          <>
            <SearchInput value={q} onChange={setQ} placeholder="Order, bill, table, phone" />
            {modes.length > 1 ? (
              <SelectField
                aria-label="Order type"
                className="md:w-32"
                value={mode}
                onValueChange={setMode}
                options={[{ value: "all" as const, label: "All types" }, ...modes.map((m) => ({ value: m, label: MODE_LABEL[m] }))]}
              />
            ) : null}
            <SelectField
              aria-label="Status"
              className="md:w-32"
              value={status}
              onValueChange={setStatus}
              options={(Object.keys(STATUS_FILTERS) as StatusFilter[]).map((k) => ({ value: k, label: k === "all" ? "Any status" : STATUS_FILTERS[k] }))}
            />
            <RangePicker range={range} />
          </>
        }
      />
      <Stats>
        <Stat label="Orders" value={all.length - cancelled.length} />
        <Stat label="Running" value={running.length} accent={running.length > 0} />
        <Stat label="Settled value" value={<Money value={settledValue} decimals={0} />} />
        <Stat label="Cancelled" value={cancelled.length} />
      </Stats>
      <Loadable state={orders} onRetry={retry} empty={{ icon: Receipt, label: isToday ? "No orders yet today." : "No orders in this range." }}>
        {() => (
          <>
            <DataTable
              rows={rows}
              columns={columns}
              rowKey={(r) => r.id}
              onRowClick={(r) => setOpenId(r.id)}
              selectedKey={openId}
              caption="Orders"
              mobileRow={(r) => (
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{orderWhere(r.mode, { tableLabel: r.tableLabel, token: r.token, customer: r.customer, orderNo: r.orderNo })}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {fmtTime(r.createdAtMs)} · {MODE_LABEL[r.mode]} · {r.orderNo}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <Money value={totalOf(r)} />
                    <OrderStatusBadge status={r.status} />
                  </div>
                </div>
              )}
            />
            {all.length >= PAGE * pages ? (
              <Button variant="outline" size="sm" className="self-center" onClick={() => setPages((p) => p + 1)}>
                Load more
              </Button>
            ) : null}
          </>
        )}
      </Loadable>
      <RecordSheet
        open={Boolean(open)}
        onOpenChange={(o) => !o && setOpenId(null)}
        title={open ? `${orderWhere(open.mode, { tableLabel: open.tableLabel, token: open.token, customer: open.customer, orderNo: open.orderNo })} · ${open.orderNo}` : ""}
        meta={open ? `${MODE_LABEL[open.mode]} · ${formatINR(totalOf(open), { decimals: "auto" })}` : null}
      >
        {open ? <OrderDetail order={open} cid={cid} staffName={staffName} terminalName={terminalName} /> : null}
      </RecordSheet>
    </>
  );
}

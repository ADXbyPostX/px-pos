"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ChevronLeft, FileText, Package, Truck, Wallet } from "lucide-react";
import {
  bizDateLabel,
  clearedBy,
  daysBetween,
  lastRates,
  MATERIAL_UNIT_LABEL,
  paths,
  priceHistory,
  purchaseSummary,
  rateLabel,
  unitRatePaise,
  vendorBalance,
  vendorLedger,
  vendorPosition,
  type BillStatus as BillStatusOf,
  type Purchase,
  type VendorPayment,
} from "@px-pos/core";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Empty } from "@/components/shared/empty";
import { Money } from "@/components/shared/money";
import { KV, Panel } from "@/components/shared/panel";
import { Pill } from "@/components/shared/status-badge";
import { useClient } from "@/components/providers/client-provider";
import { useIsMobile } from "@/hooks/use-mobile";
import { useMaterialBills, useVendorLedger } from "@/hooks/use-vendors";
import { useDoc } from "@/lib/firebase/hooks";
import { fmtDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useVendorActions, type SheetTarget } from "./context";
import { BillStatus, qtyLabel, rs, termsLabel, VendorStatus, wayLabel } from "./vendor-status";

const billTitle = (p: Pick<Purchase, "kind" | "billNo">) => (p.kind === "opening" ? "Opening balance" : p.billNo ? `Bill ${p.billNo}` : "Bill");

/** Header, scrolling body and footer — the RecordSheet layout, inside one sheet that swaps content. */
function Chrome({ title, meta, children, footer }: { title: ReactNode; meta?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  const a = useVendorActions();
  return (
    <>
      <SheetHeader className="gap-1 border-b px-5 py-4 pr-12">
        <SheetTitle className="flex min-w-0 items-center gap-1 text-base">
          {a.stack.length > 1 ? (
            <Button variant="ghost" size="icon-sm" onClick={a.back} aria-label="Back" className="-ml-2 shrink-0">
              <ChevronLeft aria-hidden />
            </Button>
          ) : null}
          <span className="truncate">{title}</span>
        </SheetTitle>
        {meta ? (
          <SheetDescription asChild>
            <div className="text-xs text-muted-foreground">{meta}</div>
          </SheetDescription>
        ) : (
          <SheetDescription className="sr-only">Details</SheetDescription>
        )}
      </SheetHeader>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">{children}</div>
      {footer ? <div className="flex flex-wrap items-center justify-end gap-2 border-t px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">{footer}</div> : null}
    </>
  );
}

function SheetSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy aria-label="Loading">
      <Skeleton className="h-16 rounded-xl" />
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-40 rounded-xl" />
    </div>
  );
}

/** Three numbers across the top of a sheet. */
function Strip({ items }: { items: { label: string; value: ReactNode; accent?: boolean }[] }) {
  return (
    <div className="grid grid-cols-3 gap-px overflow-clip rounded-xl border bg-border">
      {items.map((it) => (
        <div key={it.label} className="flex min-w-0 flex-col gap-0.5 bg-card px-3 py-2.5">
          <span className="truncate text-xs text-muted-foreground">{it.label}</span>
          <span className={cn("truncate text-base font-semibold tabular-nums", it.accent && "text-brand")}>{it.value}</span>
        </div>
      ))}
    </div>
  );
}

/** A tappable row in a sheet list. */
function RowButton({ onClick, children, muted }: { onClick: () => void; children: ReactNode; muted?: boolean }) {
  return (
    <li>
      <button type="button" onClick={onClick} className={cn("flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm hover:bg-muted/50 focus-visible:bg-muted/60 focus-visible:outline-none", muted && "opacity-60")}>
        {children}
      </button>
    </li>
  );
}

function LinkButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="text-left underline decoration-muted-foreground/40 underline-offset-4 hover:decoration-foreground">
      {children}
    </button>
  );
}

// ─── vendor ─────────────────────────────────────────────────────────────────

function VendorBody({ id }: { id: string }) {
  const { cid } = useClient();
  const a = useVendorActions();
  const v = a.vendors.byId.get(id);
  const { bills, payments } = useVendorLedger(cid, id);
  const balance = vendorBalance(v);
  const pos = vendorPosition(bills.data, balance);
  const states = new Map(pos.bills.map((s) => [s.bill.id, s]));
  const ledger = vendorLedger(bills.data, payments.data, { closingPaise: balance });
  const nameOf = (mid: string) => a.materials.byId.get(mid)?.name ?? "";
  const rates = [...lastRates(bills.data)].map(([mid, r]) => ({ mid, ...r })).sort((x, y) => nameOf(x.mid).localeCompare(nameOf(y.mid)));
  const [tab, setTab] = useState("bills");

  if (!v) return <Chrome title="Vendor">{a.vendors.status === "loading" ? <SheetSkeleton /> : <Empty icon={Truck} label="This vendor doesn't exist." />}</Chrome>;
  const supplies = v.materialIds.map((m) => a.materials.byId.get(m)?.name).filter(Boolean).join(", ");
  const oldest = pos.oldestDue;
  const overdue = (s: BillStatusOf | undefined) => Boolean(s && s.duePaise > 0 && daysBetween(s.bill.billDate, a.today) > v.creditDays);
  const loading = bills.status === "loading" || payments.status === "loading";

  return (
    <Chrome
      title={v.name}
      meta={
        <span className="flex items-center gap-2">
          <VendorStatus duePaise={pos.duePaise} advancePaise={pos.advancePaise} overdue={Boolean(oldest && daysBetween(oldest.bill.billDate, a.today) > v.creditDays) || pos.uncoveredPaise > 0} active={v.active} />
          <span>· {termsLabel(v.creditDays)}</span>
        </span>
      }
      footer={
        <>
          <Button variant="ghost" onClick={() => a.editVendor(v)}>
            Edit
          </Button>
          <Button variant="outline" onClick={() => a.recordPurchase(v.id)}>
            Record purchase
          </Button>
          <Button onClick={() => a.pay(v.id)}>{balance > 0 ? `Pay ${rs(balance)}` : "Pay"}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <Strip
          items={[
            { label: "Bought", value: rs(v.purchasedPaise) },
            { label: "Paid", value: rs(v.paidPaise) },
            { label: balance < 0 ? "Advance" : "To pay", value: rs(Math.abs(balance)), accent: balance > 0 },
          ]}
        />
        <KV
          items={[
            ...(v.phone ? [{ label: "Phone", value: <a href={`tel:${v.phone}`} className="tabular-nums underline-offset-4 hover:underline">{v.phone}</a> }] : []),
            { label: "Supplies", value: supplies || "—" },
            ...(v.gstin ? [{ label: "GSTIN", value: <span className="font-mono text-xs">{v.gstin}</span> }] : []),
            ...(oldest ? [{ label: "Oldest due", value: `${bizDateLabel(oldest.bill.billDate, true)} · ${daysBetween(oldest.bill.billDate, a.today)} days` }] : []),
            ...(v.note ? [{ label: "Note", value: v.note }] : []),
          ]}
        />
        <Tabs value={tab} onValueChange={setTab} className="gap-3">
          <TabsList className="w-full">
            <TabsTrigger value="bills">Bills</TabsTrigger>
            <TabsTrigger value="statement">Statement</TabsTrigger>
            <TabsTrigger value="rates">Rates</TabsTrigger>
          </TabsList>
          <TabsContent value="bills">
            {loading ? (
              <Skeleton className="h-40 rounded-xl" />
            ) : bills.status === "error" ? (
              <Empty icon={FileText} label="Couldn't load the bills." />
            ) : !bills.data.length ? (
              <Empty icon={FileText} label="No bills yet." />
            ) : (
              <ul className="divide-y overflow-clip rounded-xl border" aria-label="Bills">
                {bills.data.map((b) => {
                  const s = states.get(b.id);
                  const voided = b.status === "void";
                  return (
                    <RowButton key={b.id} onClick={() => a.push({ kind: "purchase", id: b.id })} muted={voided}>
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">
                          {bizDateLabel(b.billDate)} · {billTitle(b)}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">{b.kind === "opening" ? (b.note ?? "Owed before PX POS") : purchaseSummary(b)}</div>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <Money value={b.totalPaise} className={voided ? "text-muted-foreground line-through" : undefined} />
                        <BillStatus state={s?.state ?? null} duePaise={s?.duePaise ?? 0} voided={voided} overdue={overdue(s)} />
                      </div>
                    </RowButton>
                  );
                })}
                {pos.uncoveredPaise > 0 ? (
                  <li className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
                    <span className="text-muted-foreground">Older bills not shown</span>
                    <span className="tabular-nums">{rs(pos.uncoveredPaise)} due</span>
                  </li>
                ) : null}
              </ul>
            )}
          </TabsContent>
          <TabsContent value="statement">
            {loading ? (
              <Skeleton className="h-40 rounded-xl" />
            ) : !ledger.rows.length ? (
              <Empty icon={FileText} label="Nothing yet." />
            ) : (
              <div className="overflow-clip rounded-xl border">
                <table className="w-full text-sm">
                  <caption className="sr-only">Statement, newest first</caption>
                  <thead>
                    <tr className="border-b text-xs text-muted-foreground">
                      <th className="px-3 py-2 text-left font-medium">Entry</th>
                      <th className="px-3 py-2 text-right font-medium">Amount</th>
                      <th className="px-3 py-2 text-right font-medium">Balance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {[...ledger.rows].reverse().map((r) => {
                      const isBill = r.kind === "bill" || r.kind === "opening";
                      const label = r.kind === "opening" ? "Opening balance" : r.kind === "bill" ? (r.billNo ? `Bill ${r.billNo}` : "Bill") : r.kind === "advance" ? "Advance (opening)" : `Paid · ${r.mode ? wayLabel(r.mode) : ""}`;
                      return (
                        <tr key={`${r.kind}${r.id}`} className={cn("cursor-pointer hover:bg-muted/50", r.void && "opacity-60")} onClick={() => a.push({ kind: isBill ? "purchase" : "payment", id: r.id })}>
                          <td className="px-3 py-2">
                            <button type="button" className="text-left focus-visible:outline-none" onClick={(e) => { e.stopPropagation(); a.push({ kind: isBill ? "purchase" : "payment", id: r.id }); }}>
                              <span className={cn("block", r.void && "line-through")}>{label}</span>
                              <span className="block text-xs text-muted-foreground">
                                {bizDateLabel(r.date)}
                                {r.void ? " · void" : ""}
                              </span>
                            </button>
                          </td>
                          <td className={cn("px-3 py-2 text-right tabular-nums", r.void && "line-through", !isBill && !r.void && "text-success")}>{isBill ? `+${rs(r.billPaise)}` : `−${rs(r.paidPaise)}`}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{rs(r.balancePaise)}</td>
                        </tr>
                      );
                    })}
                    {ledger.broughtForwardPaise ? (
                      <tr>
                        <td className="px-3 py-2 text-muted-foreground">Brought forward</td>
                        <td />
                        <td className="px-3 py-2 text-right tabular-nums">{rs(ledger.broughtForwardPaise)}</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            )}
          </TabsContent>
          <TabsContent value="rates">
            {loading ? (
              <Skeleton className="h-40 rounded-xl" />
            ) : !rates.length ? (
              <Empty icon={Package} label="No prices yet." />
            ) : (
              <ul className="divide-y overflow-clip rounded-xl border" aria-label="Last rates">
                {rates.map((r) => (
                  <RowButton key={r.mid} onClick={() => a.push({ kind: "material", id: r.mid })}>
                    <span className="min-w-0 flex-1 truncate font-medium">{a.materials.byId.get(r.mid)?.name ?? "Material"}</span>
                    <span className="shrink-0 text-right">
                      <span className="block tabular-nums">
                        {rs(r.ratePaise)}/{MATERIAL_UNIT_LABEL[r.unit]}
                      </span>
                      <span className="block text-xs text-muted-foreground">{bizDateLabel(r.billDate)}</span>
                    </span>
                  </RowButton>
                ))}
              </ul>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </Chrome>
  );
}

// ─── bill ───────────────────────────────────────────────────────────────────

function PurchaseBody({ id }: { id: string }) {
  const { cid } = useClient();
  const a = useVendorActions();
  const doc = useDoc<Purchase>(paths.purchase(cid, id));
  const p = doc.data;
  const { bills } = useVendorLedger(cid, p?.vendorId ?? null);
  const v = p ? a.vendors.byId.get(p.vendorId) : undefined;
  const balance = vendorBalance(v);
  const state = useMemo(() => vendorPosition(bills.data, balance).bills.find((s) => s.bill.id === id), [bills.data, balance, id]);
  const paidWith = useDoc<VendorPayment>(p?.paymentId ? paths.vendorPayment(cid, p.paymentId) : null);

  if (!p) return <Chrome title="Bill">{doc.status === "loading" ? <SheetSkeleton /> : <Empty icon={FileText} label="This bill doesn't exist." />}</Chrome>;
  const voided = p.status === "void";
  const overdue = Boolean(v && state && state.duePaise > 0 && daysBetween(p.billDate, a.today) > v.creditDays);

  return (
    <Chrome
      title={`${billTitle(p)} · ${p.vendorName}`}
      meta={`${bizDateLabel(p.billDate, true)} · ${rs(p.totalPaise)}`}
      footer={
        !voided ? (
          <>
            {p.kind === "bill" ? (
              <Button variant="ghost" onClick={() => a.editBill(p)}>
                Edit
              </Button>
            ) : null}
            <Button variant="outline" className="text-brand" onClick={() => a.voidPurchase(p)}>
              Void
            </Button>
          </>
        ) : null
      }
    >
      <div className="flex flex-col gap-5">
        <KV
          items={[
            { label: "Vendor", value: <LinkButton onClick={() => a.push({ kind: "vendor", id: p.vendorId })}>{p.vendorName}</LinkButton> },
            { label: "Status", value: bills.status === "loading" && !voided ? <Skeleton className="h-4 w-16" /> : <BillStatus state={state?.state ?? null} duePaise={state?.duePaise ?? 0} voided={voided} overdue={overdue} /> },
            { label: "Bill date", value: bizDateLabel(p.billDate, true) },
            ...(p.billNo ? [{ label: "Bill no.", value: p.billNo }] : []),
            { label: "Entered", value: `${p.kind === "opening" ? "Opening balance" : `Counted on ${bizDateLabel(p.businessDate)}`} · ${a.who(p.enteredBy, p.terminalId)}` },
            ...(p.note ? [{ label: "Note", value: p.note }] : []),
          ]}
        />
        {p.kind === "bill" ? (
          <Panel title="Items" bodyClassName="p-0">
            <table className="w-full text-sm">
              <caption className="sr-only">Items on the bill</caption>
              <thead>
                <tr className="border-b text-xs text-muted-foreground">
                  <th className="px-4 py-2 text-left font-medium">Material</th>
                  <th className="px-3 py-2 text-right font-medium">Qty</th>
                  <th className="hidden px-3 py-2 text-right font-medium sm:table-cell">Rate</th>
                  <th className="px-4 py-2 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {p.lines.map((l) => (
                  <tr key={l.lineId}>
                    <td className="px-4 py-2">
                      {l.materialId ? <LinkButton onClick={() => a.push({ kind: "material", id: l.materialId! })}>{l.name}</LinkButton> : l.name}
                      <span className="block text-xs text-muted-foreground">GST {rateLabel(l.taxBps)}{l.gstPaise ? ` · ${rs(l.gstPaise)}` : ""}</span>
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">{qtyLabel(l.qtyMilli, l.unit)}</td>
                    <td className="hidden px-3 py-2 text-right whitespace-nowrap tabular-nums sm:table-cell">{rs(unitRatePaise(l.amountPaise, l.qtyMilli))}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{rs(l.amountPaise)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <dl className="flex flex-col gap-1.5 border-t px-4 py-3 text-sm tabular-nums">
              {p.adjustPaise ? (
                <>
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Items</dt>
                    <dd>{rs(p.subtotalPaise)}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Round off</dt>
                    <dd>
                      {p.adjustPaise > 0 ? "+" : "−"}
                      {rs(Math.abs(p.adjustPaise))}
                    </dd>
                  </div>
                </>
              ) : null}
              <div className="flex justify-between gap-4 font-semibold">
                <dt>Total</dt>
                <dd className={voided ? "line-through" : undefined}>{rs(p.totalPaise)}</dd>
              </div>
              <div className="flex justify-between gap-4 text-xs text-muted-foreground">
                <dt>GST included</dt>
                <dd>{rs(p.gstPaise)}</dd>
              </div>
            </dl>
          </Panel>
        ) : null}
        {paidWith.data ? (
          <Panel title="Paid on delivery" bodyClassName="p-0">
            <ul>
              <RowButton onClick={() => a.push({ kind: "payment", id: paidWith.data!.id })} muted={paidWith.data.status === "void"}>
                <span className="min-w-0 flex-1 truncate">{wayLabel(paidWith.data.mode, paidWith.data.drawerTerminalId ? a.terminalName(paidWith.data.drawerTerminalId) : undefined)}</span>
                {paidWith.data.status === "void" ? <Pill tone="dim" label="Void" muted /> : null}
                <Money value={paidWith.data.amountPaise} />
              </RowButton>
            </ul>
          </Panel>
        ) : null}
        {p.void ? (
          <Panel title="Voided" bodyClassName="p-4">
            <KV
              items={[
                { label: "Reason", value: p.void.reason },
                { label: "By", value: a.who(p.void.by) },
                { label: "When", value: fmtDateTime(p.void.atMs) },
              ]}
            />
          </Panel>
        ) : null}
      </div>
    </Chrome>
  );
}

// ─── payment ────────────────────────────────────────────────────────────────

function PaymentBody({ id }: { id: string }) {
  const { cid } = useClient();
  const a = useVendorActions();
  const doc = useDoc<VendorPayment>(paths.vendorPayment(cid, id));
  const p = doc.data;
  const { bills, payments } = useVendorLedger(cid, p?.vendorId ?? null);
  const cleared = useMemo(
    () => (p && p.status === "active" && bills.status === "ready" && payments.status === "ready" ? clearedBy(bills.data, payments.data, id) : null),
    [p, bills.status, bills.data, payments.status, payments.data, id],
  );

  if (!p) return <Chrome title="Payment">{doc.status === "loading" ? <SheetSkeleton /> : <Empty icon={Wallet} label="This payment doesn't exist." />}</Chrome>;
  const voided = p.status === "void";

  return (
    <Chrome
      title={`${p.kind === "opening" ? "Opening advance" : "Payment"} · ${p.vendorName}`}
      meta={`${bizDateLabel(p.businessDate, true)} · ${rs(p.amountPaise)}${voided ? " · void" : ""}`}
      footer={
        !voided ? (
          <Button variant="outline" className="text-brand" onClick={() => a.voidPayment(p)}>
            Void
          </Button>
        ) : null
      }
    >
      <div className="flex flex-col gap-5">
        <KV
          items={[
            { label: "Vendor", value: <LinkButton onClick={() => a.push({ kind: "vendor", id: p.vendorId })}>{p.vendorName}</LinkButton> },
            { label: "Amount", value: <Money value={p.amountPaise} className={voided ? "line-through" : undefined} /> },
            ...(p.kind === "payment" ? [{ label: "Paid by", value: wayLabel(p.mode, p.drawerTerminalId ? a.terminalName(p.drawerTerminalId) : undefined) }] : []),
            ...(p.ref ? [{ label: "Reference", value: <span className="font-mono text-xs">{p.ref}</span> }] : []),
            { label: "Date", value: bizDateLabel(p.businessDate, true) },
            { label: "Entered", value: `${fmtDateTime(p.createdAtMs)} · ${a.who(p.paidBy, p.terminalId)}` },
            ...(p.purchaseId ? [{ label: "With bill", value: <LinkButton onClick={() => a.push({ kind: "purchase", id: p.purchaseId! })}>Paid on delivery</LinkButton> }] : []),
            ...(p.note ? [{ label: "Note", value: p.note }] : []),
          ]}
        />
        {!voided ? (
          <Panel title="Cleared" bodyClassName="p-0">
            {!cleared ? (
              <Skeleton className="m-4 h-10" />
            ) : !cleared.clears.length && !cleared.advancePaise ? (
              <p className="px-4 py-3 text-sm text-muted-foreground">Nothing was owed when it was paid.</p>
            ) : (
              <ul className="divide-y">
                {cleared.clears.map((c) => (
                  <RowButton key={c.id} onClick={() => a.push({ kind: "purchase", id: c.id })}>
                    <span className="min-w-0 flex-1 truncate">
                      {billTitle(c)} · {bizDateLabel(c.billDate)}
                    </span>
                    <span className="shrink-0 text-right tabular-nums">
                      {rs(c.appliedPaise)}
                      <span className={cn("block text-xs", c.cleared ? "text-success" : "text-muted-foreground")}>{c.cleared ? "Paid off" : `of ${rs(c.totalPaise)}`}</span>
                    </span>
                  </RowButton>
                ))}
                {cleared.advancePaise ? (
                  <li className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
                    <span>Kept as advance</span>
                    <span className="tabular-nums">{rs(cleared.advancePaise)}</span>
                  </li>
                ) : null}
              </ul>
            )}
          </Panel>
        ) : null}
        {p.void ? (
          <Panel title="Voided" bodyClassName="p-4">
            <KV
              items={[
                { label: "Reason", value: p.void.reason },
                { label: "By", value: a.who(p.void.by) },
                { label: "When", value: fmtDateTime(p.void.atMs) },
              ]}
            />
          </Panel>
        ) : null}
      </div>
    </Chrome>
  );
}

// ─── material ───────────────────────────────────────────────────────────────

function MaterialBody({ id }: { id: string }) {
  const { cid } = useClient();
  const a = useVendorActions();
  const m = a.materials.byId.get(id);
  const bills = useMaterialBills(cid, id);
  const history = useMemo(() => priceHistory(bills.data, id), [bills.data, id]);
  const suppliers = a.vendors.data.filter((v) => v.materialIds.includes(id));

  if (!m) return <Chrome title="Material">{a.materials.status === "loading" ? <SheetSkeleton /> : <Empty icon={Package} label="This material doesn't exist." />}</Chrome>;
  const unit = MATERIAL_UNIT_LABEL[m.unit];
  const qty = history.reduce((s, h) => s + h.qtyMilli, 0);
  const spent = history.reduce((s, h) => s + h.amountPaise, 0);
  const last = history[0];
  const prev = history.find((h) => last && h.ratePaise !== last.ratePaise && h.billDate <= last.billDate);

  return (
    <Chrome
      title={m.name}
      meta={`${unit} · GST ${rateLabel(m.taxBps)}${m.active ? "" : " · inactive"}`}
      footer={
        <Button variant="ghost" onClick={() => a.editMaterial(m)}>
          Edit
        </Button>
      }
    >
      <div className="flex flex-col gap-5">
        <Strip
          items={[
            { label: "Last rate", value: last ? `${rs(last.ratePaise)}/${unit}` : "—" },
            { label: "Average", value: qty ? `${rs(unitRatePaise(spent, qty))}/${unit}` : "—" },
            { label: "Before that", value: prev ? `${rs(prev.ratePaise)}/${unit}` : "—" },
          ]}
        />
        {suppliers.length ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-sm text-muted-foreground">Supplied by</span>
            {suppliers.map((v) => (
              <Button key={v.id} variant="outline" size="sm" onClick={() => a.push({ kind: "vendor", id: v.id })}>
                {v.name}
              </Button>
            ))}
          </div>
        ) : null}
        <Panel title="Price history" bodyClassName="p-0">
          {bills.status === "loading" ? (
            <Skeleton className="m-4 h-24" />
          ) : !history.length ? (
            <p className="px-4 py-3 text-sm text-muted-foreground">Not bought yet.</p>
          ) : (
            <ul className="divide-y">
              {history.map((h) => (
                <RowButton key={`${h.purchaseId}${h.qtyMilli}${h.amountPaise}`} onClick={() => a.push({ kind: "purchase", id: h.purchaseId })}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{h.vendorName}</span>
                    <span className="block text-xs text-muted-foreground">
                      {bizDateLabel(h.billDate)} · {qtyLabel(h.qtyMilli, h.unit)}
                    </span>
                  </span>
                  <span className="shrink-0 text-right tabular-nums">
                    {rs(h.ratePaise)}/{MATERIAL_UNIT_LABEL[h.unit]}
                    <span className="block text-xs text-muted-foreground">{rs(h.amountPaise)}</span>
                  </span>
                </RowButton>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </Chrome>
  );
}

function Body({ target }: { target: SheetTarget }) {
  if (target.kind === "vendor") return <VendorBody id={target.id} />;
  if (target.kind === "purchase") return <PurchaseBody id={target.id} />;
  if (target.kind === "payment") return <PaymentBody id={target.id} />;
  return <MaterialBody id={target.id} />;
}

const keyOf = (t: SheetTarget | null) => (t ? `${t.kind}:${t.id}` : "");

/** One sheet for every vendor record; its content follows the top of the stack. */
export function VendorSheetHost() {
  const a = useVendorActions();
  const mobile = useIsMobile();
  const top = a.stack.at(-1) ?? null;
  // Keep showing the last record while the sheet animates closed.
  const [shown, setShown] = useState<SheetTarget | null>(top);
  if (top && keyOf(top) !== keyOf(shown)) setShown(top);
  return (
    <Sheet open={Boolean(top)} onOpenChange={(o) => !o && a.closeSheets()}>
      <SheetContent side={mobile ? "bottom" : "right"} className={cn("flex flex-col gap-0 p-0", mobile ? "max-h-[94dvh] rounded-t-2xl" : "w-full sm:max-w-xl")}>
        {shown ? <Body key={keyOf(shown)} target={shown} /> : null}
      </SheetContent>
    </Sheet>
  );
}

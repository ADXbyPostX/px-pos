import { useEffect, useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { CheckCircle2, ChevronRight } from "lucide-react-native";
import { formatINR, kitchenOn, MODE_LABEL, orderWhere, type OrderMode, type Paise, type TenderInput } from "@px-pos/core";
import { billFor, billOrder, quickCheckout, sendKot, settleOrder, supplierOf, voidTicket, type QuickResult, type Ticket } from "@/actions/orders";
import { newId } from "@/actions/context";
import { CategoryRail } from "@/components/pos/register/category-rail";
import { HeldSheet, HoldButton } from "@/components/pos/register/held-sheet";
import { ItemGrid } from "@/components/pos/register/item-grid";
import { PayPanel } from "@/components/pos/register/pay-panel";
import { TicketPanel } from "@/components/pos/register/ticket-panel";
import { ClearButton, VoidButton, VoidSheet } from "@/components/pos/register/void-sheet";
import { ModeGate } from "@/components/pos/mode-gate";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { customerDisplay } from "@/hardware/customer-display";
import { kickDrawerFor } from "@/hardware/drawer";
import { useBreakpoint } from "@/hooks/use-breakpoint";
import { useTicket } from "@/hooks/use-ticket";
import { discardHeld, holdTicket, markOpen, takeHeld, useHeld, type HeldTicket } from "@/local/held";
import { useTilePhotos } from "@/local/prefs";
import { colors } from "@/lib/colors";
import { cn } from "@/lib/utils";
import { printInvoice, printKots } from "@/print/print";
import { useData } from "@/state/data";
import { useHoldCheckoutFocus } from "@/state/checkout-focus";
import { useOperator } from "@/state/operator";
import { usePaired } from "@/state/session";

type Params = { mode?: string; id?: string; table?: string; label?: string; covers?: string; phone?: string; name?: string; address?: string; landmark?: string; pay?: string };
type TicketInit = Pick<Partial<Ticket>, "tableId" | "tableLabel" | "covers" | "customer" | "deliveryPay">;

function Register({ mode, ticketId, orderId, init, onDone, onSwitch }: { mode: OrderMode; ticketId: string; orderId: string | null; init: TicketInit; onDone: () => void; onSwitch: (t: Ticket) => void }) {
  const session = usePaired();
  const data = useData();
  const { operator } = useOperator();
  const { size } = useBreakpoint();
  const t = useTicket({ ticketId, orderId, mode, init });
  const [category, setCategory] = useState("all");
  const [paying, setPaying] = useState(false);
  const [showTicket, setShowTicket] = useState(false);
  const [done, setDone] = useState<QuickResult | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [holdOpen, setHoldOpen] = useState(false);
  const [dropping, setDropping] = useState<"void" | "clear" | null>(null);
  // A held ticket being discarded goes through the same void sheet (and into the day's voids).
  const [voidingHeld, setVoidingHeld] = useState<HeldTicket | null>(null);
  const held = useHeld(session.cid);
  const tilePhotos = useTilePhotos();
  // The ticket on screen is never listed as held; once it's left, an unfinished one is.
  useEffect(() => markOpen(t.ticket.id), [t.ticket.id]);

  // ── Customer display: the last dish added and the total, "please pay", "thank you" ──────
  const lastLine = mode === "dineIn" ? undefined : t.ticket.lines.at(-1);
  const displayTotal = t.order?.status === "billed" && t.order.bill ? t.order.bill.grandTotalPaise : t.bill.grandTotalPaise;
  useEffect(() => {
    if (done) customerDisplay.thanks(done.changePaise);
    else if (paying) return; // the pay panel shows the amount (or the UPI QR)
    else if (lastLine) customerDisplay.cart({ name: lastLine.variantName ? `${lastLine.name} ${lastLine.variantName}` : lastLine.name, qty: lastLine.qty, unitPaise: lastLine.unitPricePaise }, displayTotal);
    else customerDisplay.idle();
  }, [done, paying, lastLine, displayTotal]);
  useEffect(() => () => customerDisplay.idle(), []);
  useHoldCheckoutFocus(paying && !done);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of data.items) m.set(i.categoryId, (m.get(i.categoryId) ?? 0) + 1);
    return m;
  }, [data.items]);

  if (!operator || !data.bizDate) return null;
  const deps = { session, operator, bizDate: data.bizDate, tracked: data.tracked };
  const quickPayFirst = mode === "quick" && session.client.modeOpts.quick.payFirst;
  const order = t.order;
  const hasNew = t.ticket.lines.length > 0;
  const where = orderWhere(mode, { tableLabel: t.ticket.tableLabel ?? order?.tableLabel, token: order?.token, customer: t.ticket.customer ?? order?.customer, orderNo: order?.orderNo });

  function onSettle(tenders: TenderInput[], tip: Paise) {
    try {
      let settled = false;
      if (quickPayFirst || (!order && mode !== "dineIn")) {
        const row = quickCheckout(deps, t.ticket, tenders, tip);
        const r = row.result!;
        const called = orderWhere(mode, { token: r.token, customer: t.ticket.customer });
        settled = true;
        setDone(r);
        void printKots(session.terminal, session.client, r.kots.map((k) => ({ ...k, kind: "new" as const, mode, where: called, orderNo: r.orderNo, createdAtMs: Date.now(), station: k.station as "kitchen" })));
        void printInvoice(session.terminal, session.client, {
          invoiceNo: r.invoiceNo,
          issuedAtMs: Date.now(),
          orderNo: r.orderNo,
          mode,
          where: called,
          token: r.token,
          docType: r.bill.docType,
          supplier: supplierOf(session.client),
          lines: t.ticket.lines.map((l) => ({ lineId: l.lineId, name: l.name, ...(l.variantName ? { variantName: l.variantName } : {}), qty: l.qty, unitPricePaise: l.unitPricePaise, amountPaise: l.unitPricePaise * l.qty, taxBps: l.taxBps ?? session.client.defaultTaxBps })),
          bill: r.bill,
          payments: r.applied,
          staffName: operator!.name,
        }).then((err) => err && setNotice(`Printer: ${err}`));
      } else if (order) {
        const row = settleOrder(deps, order, tenders, tip);
        settled = true;
        customerDisplay.thanks(row.result?.changePaise ?? 0);
        router.replace(mode === "dineIn" ? "/till/tables" : "/till/orders");
      }
      // Only a payment that went through opens the drawer.
      if (settled) void kickDrawerFor(tenders).then((err) => err && setNotice(`Cash drawer: ${err}`));
      setPaying(false);
      setShowTicket(false);
    } catch (e) {
      setNotice((e as Error).message);
    }
  }

  function onSendKot() {
    try {
      const row = sendKot(deps, t.ticket, order);
      const r = row.result!;
      void printKots(session.terminal, session.client, r.kots.map((k) => ({ ...k, kind: order ? ("addon" as const) : ("new" as const), mode, where, orderNo: r.orderNo, createdAtMs: Date.now(), station: k.station as "kitchen", ...(t.ticket.covers ? { covers: t.ticket.covers } : {}) }))).then((err) => err && setNotice(`Printer: ${err}`));
      t.sent(r.orderId);
      if (mode === "dineIn" && session.client.modeOpts.dineIn.backToTables) router.replace("/till/tables");
    } catch (e) {
      setNotice((e as Error).message);
    }
  }

  // ── Hold: park this ticket while the customer decides; serve the next one ──────────────
  const canHold = !order && mode !== "dineIn" && !done;
  function hold(label?: string) {
    holdTicket(t.ticket, label);
    setHoldOpen(false);
    setPaying(false);
    setShowTicket(false);
    onDone();
  }
  function resume(h: HeldTicket) {
    // Swap: whatever is on screen gets parked in its place.
    if (canHold && hasNew) holdTicket(t.ticket);
    const back = takeHeld(h.id);
    setHoldOpen(false);
    if (back) onSwitch(back);
  }
  const heldTotal = (h: HeldTicket) => billFor(session.client, h.mode, h.lines, { ...(h.billDiscount ? { billDiscount: h.billDiscount } : {}), serviceChargeOptIn: h.serviceChargeOptIn }).grandTotalPaise;
  const heldSheet = (
    <HeldSheet
      open={holdOpen}
      onClose={() => setHoldOpen(false)}
      current={canHold && hasNew ? { items: t.bill.itemQty, totalPaise: t.bill.grandTotalPaise, ...(t.ticket.customer?.name ? { suggested: t.ticket.customer.name } : {}) } : null}
      held={held}
      totalOf={heldTotal}
      onHold={hold}
      onResume={resume}
      onDiscard={(h) => {
        setHoldOpen(false);
        setVoidingHeld(h);
      }}
    />
  );
  const holdButton = canHold && (hasNew || held.length > 0) ? <HoldButton count={held.length} onPress={() => setHoldOpen(true)} /> : null;

  // ── Void: drop an order nobody has sent to the kitchen or paid for ─────────────────────
  // Recorded as a cancelled order with the reason, so it shows in the day's voids.
  const canVoid = !order && hasNew && !done;
  function confirmDrop(reason: string) {
    if (dropping === "clear") t.clear();
    else {
      try {
        voidTicket(deps, t.ticket, reason);
      } catch (e) {
        setNotice((e as Error).message);
      }
      discardHeld(t.ticket.id);
      setPaying(false);
      setShowTicket(false);
      onDone();
    }
    setDropping(null);
  }
  function confirmHeldVoid(reason: string) {
    if (!voidingHeld) return;
    try {
      if (voidingHeld.lines.length) voidTicket(deps, voidingHeld, reason);
    } catch (e) {
      setNotice((e as Error).message);
    }
    discardHeld(voidingHeld.id);
    setVoidingHeld(null);
  }
  const heldVoidCount = voidingHeld?.lines.reduce((s, l) => s + l.qty, 0) ?? 0;
  const heldVoidSheet = <VoidSheet kind="void" open={voidingHeld !== null} onClose={() => setVoidingHeld(null)} onConfirm={confirmHeldVoid} items={heldVoidCount} totalPaise={voidingHeld ? heldTotal(voidingHeld) : 0} />;
  const sheets = (
    <>
      {heldSheet}
      <VoidSheet kind={dropping ?? "void"} open={dropping !== null} onClose={() => setDropping(null)} onConfirm={confirmDrop} items={t.bill.itemQty} totalPaise={t.bill.grandTotalPaise} />
      {heldVoidSheet}
    </>
  );

  function onBill() {
    if (!order) return;
    try {
      billOrder(deps, order, { ...(t.ticket.billDiscount ? { billDiscount: t.ticket.billDiscount } : {}), serviceChargeOptIn: t.ticket.serviceChargeOptIn });
      setNotice("Bill issued");
    } catch (e) {
      setNotice((e as Error).message);
    }
  }

  if (done) {
    return (
      <View className="flex-1 items-center justify-center gap-6">
        <CheckCircle2 color={colors.success} size={64} />
        <Text className="text-2xl text-muted-foreground">Token</Text>
        <Text className="text-8xl font-bold">{done.token}</Text>
        {t.ticket.customer?.name ? <Text className="text-3xl font-semibold">{t.ticket.customer.name}</Text> : null}
        <Text className="text-xl">Bill {done.invoiceNo} · {formatINR(done.bill.grandTotalPaise, { decimals: "auto" })}</Text>
        {done.changePaise ? <Text className="text-4xl font-bold text-success">Give change {formatINR(done.changePaise, { decimals: "auto" })}</Text> : null}
        {notice ? <Text className="text-warning">{notice}</Text> : null}
        <Button size="xl" onPress={onDone} className="mt-4 min-w-80">
          <Text>New order</Text>
        </Button>
        {held.length ? (
          <Button size="lg" variant="outline" onPress={() => setHoldOpen(true)} className="min-w-80">
            <Text>Held orders ({held.length})</Text>
          </Button>
        ) : null}
        {heldSheet}
        {heldVoidSheet}
      </View>
    );
  }

  const billed = order?.status === "billed";
  const actions = paying ? null : quickPayFirst ? (
    <View className="flex-row gap-2">
      <Button size="xl" className="flex-1" disabled={!hasNew} onPress={() => setPaying(true)}>
        <Text>Pay {formatINR(t.bill.grandTotalPaise, { decimals: "auto" })}</Text>
      </Button>
      {canVoid ? <VoidButton onPress={() => setDropping("void")} /> : null}
    </View>
  ) : (
    <View className="flex-row gap-2">
      <Button size="lg" className="flex-1" disabled={!hasNew || billed} onPress={onSendKot}>
        {/* No kitchen: the same step just saves the round to the order (stock, table, records). */}
        <Text>{kitchenOn(session.client) ? "Send KOT" : "Save order"}</Text>
      </Button>
      <Button size="lg" variant="secondary" className="flex-1" disabled={!order || hasNew || billed} onPress={onBill}>
        <Text>Bill</Text>
      </Button>
      <Button size="lg" variant="success" className="flex-1" disabled={!billed} onPress={() => setPaying(true)}>
        <Text>Pay</Text>
      </Button>
      {canVoid ? <VoidButton size="lg" onPress={() => setDropping("void")} /> : null}
    </View>
  );

  const title = where && where !== MODE_LABEL[mode] ? `${MODE_LABEL[mode]} · ${where}` : MODE_LABEL[mode];
  const subtitle = order ? `Order ${order.orderNo}${order.invoiceNo ? ` · Bill ${order.invoiceNo}` : ""}` : "New order";
  const shownBill = billed && order?.bill ? order.bill : t.bill;
  const payPanel = <PayPanel compact={size === "phone"} upi={session.client.upi} grandPaise={shownBill.grandTotalPaise} onCancel={() => setPaying(false)} onSettle={onSettle} {...(canHold ? { onHold: () => setHoldOpen(true) } : {})} {...(canVoid ? { onVoid: () => setDropping("void") } : {})} />;
  const noticeBar =
    notice && !paying ? (
      <View className="border-t border-border bg-card px-4 py-2">
        <Text className="text-warning" onPress={() => setNotice(null)}>
          {notice}
        </Text>
      </View>
    ) : null;
  const ticketPanel = (className: string, onBack?: () => void) => (
    <TicketPanel className={className} title={title} subtitle={subtitle} order={order} lines={t.ticket.lines} bill={shownBill} onQty={t.setQty} actions={actions} headerAction={holdButton} {...(onBack ? { onBack } : {})} />
  );

  // Phones: menu full width with a cart bar; the ticket and payment each take the whole screen.
  if (size === "phone") {
    if (paying)
      return (
        <>
          {payPanel}
          {sheets}
        </>
      );
    if (showTicket)
      return (
        <View className="flex-1">
          {ticketPanel("flex-1 border-l-0", () => setShowTicket(false))}
          {noticeBar}
          {sheets}
        </View>
      );
    const qty = shownBill.itemQty;
    return (
      <View className="flex-1">
        <CategoryRail horizontal categories={data.categories} value={category} onChange={setCategory} counts={counts} />
        <ItemGrid items={data.items} categoryId={category} mode={mode} stock={data.stock} qtyByItem={t.qtyByItem} onAdd={t.add} photos={data.photos} showPhotos={tilePhotos} minTile={136} />
        {noticeBar}
        <View className="flex-row gap-2 border-t border-border bg-background p-2">
          {canHold && (hasNew || held.length > 0) ? <HoldButton square count={held.length} onPress={() => setHoldOpen(true)} /> : null}
          <Pressable
            onPress={() => setShowTicket(true)}
            accessibilityRole="button"
            accessibilityLabel={`View order, ${qty} items, ${formatINR(shownBill.grandTotalPaise, { decimals: "auto" })}`}
            className={cn("h-14 flex-1 flex-row items-center gap-3 rounded-xl px-4", qty ? "bg-primary active:opacity-90" : "border border-border bg-card")}
          >
            <View className="flex-1">
              <Text className={cn("text-base font-semibold", qty ? "text-white" : "")} numberOfLines={1}>
                {qty ? `${qty} item${qty === 1 ? "" : "s"}${hasNew && order ? " · new not sent" : ""}` : where}
              </Text>
              {qty ? <Text className="text-xs text-white/80" numberOfLines={1}>{where}</Text> : <Text className="text-xs text-muted-foreground">Tap dishes to add them</Text>}
            </View>
            <Text className={cn("text-lg font-bold tabular-nums", qty ? "text-white" : "")}>{formatINR(shownBill.grandTotalPaise, { decimals: "auto" })}</Text>
            <ChevronRight color={qty ? "#fff" : colors.muted} size={22} />
          </Pressable>
          {canVoid ? <ClearButton onPress={() => setDropping("clear")} /> : null}
        </View>
        {sheets}
      </View>
    );
  }

  return (
    <View className="flex-1 flex-row">
      {size === "tabletL" && !paying ? <CategoryRail categories={data.categories} value={category} onChange={setCategory} counts={counts} /> : null}
      <View className="flex-1">
        {paying ? (
          payPanel
        ) : (
          <>
            {size !== "tabletL" ? <CategoryRail horizontal categories={data.categories} value={category} onChange={setCategory} counts={counts} /> : null}
            <ItemGrid items={data.items} categoryId={category} mode={mode} stock={data.stock} qtyByItem={t.qtyByItem} onAdd={t.add} photos={data.photos} showPhotos={tilePhotos} minTile={156} />
          </>
        )}
        {noticeBar}
      </View>
      {ticketPanel(size === "tabletP" ? "w-[340px]" : "w-[392px]")}
      {sheets}
    </View>
  );
}

function initFrom(p: Params): TicketInit {
  return {
    ...(p.table ? { tableId: p.table, tableLabel: p.label } : {}),
    ...(p.covers ? { covers: Number(p.covers) } : {}),
    ...(p.phone ? { customer: { phone: p.phone, ...(p.name ? { name: p.name } : {}), ...(p.address ? { address: p.address } : {}), ...(p.landmark ? { landmark: p.landmark } : {}) } } : {}),
    ...(p.pay === "cod" || p.pay === "prepaid" ? { deliveryPay: p.pay } : {}),
  };
}

/** /till/order?mode=quick | ?mode=dineIn&table=…&label=…&covers=… | ?mode=delivery&phone=…&name=…&address=…&pay=cod | ?id=<orderId> */
export default function OrderScreen() {
  const p = useLocalSearchParams<Params>();
  const data = useData();
  const existing = p.id ? data.openOrders.find((o) => o.id === p.id) : undefined;
  // Which ticket is on screen; `mode` is set when a held ticket of another mode is resumed.
  const [slot, setSlot] = useState<{ key: string; mode?: OrderMode }>(() => ({ key: p.id ?? newId() }));
  // Opened for an order that is no longer running (settled/cancelled elsewhere) — or not loaded yet.
  if (p.id && slot.key === p.id && !existing) {
    return (
      <View className="flex-1 items-center justify-center gap-4 p-6">
        <Text className="text-center text-lg text-muted-foreground">{data.ordersReady ? "This order is no longer open." : "Loading order…"}</Text>
        {data.ordersReady ? (
          <Button variant="secondary" onPress={() => router.replace("/till/orders")}>
            <Text>Running orders</Text>
          </Button>
        ) : null}
      </View>
    );
  }
  const mode = (slot.mode ?? existing?.mode ?? p.mode ?? "quick") as OrderMode;
  const register = (
    <Register
      key={slot.key}
      mode={mode}
      ticketId={slot.key}
      orderId={slot.key === p.id ? (existing?.id ?? null) : null}
      init={slot.mode ? {} : initFrom(p)}
      onDone={() => setSlot({ key: newId() })}
      onSwitch={(t) => setSlot({ key: t.id, mode: t.mode })}
    />
  );
  // Running orders can always be finished; a *new* ticket needs its mode switched on.
  return existing && slot.key === p.id ? register : <ModeGate mode={mode}>{register}</ModeGate>;
}

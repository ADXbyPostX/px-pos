import { useCallback, useMemo, useState } from "react";
import { makeLineId, type Discount, type Item, type OrderLine, type OrderMode, type Variant } from "@px-pos/core";
import { billFor, newTicket, type Ticket } from "@/actions/orders";
import type { WithId } from "@/hooks/use-live";
import { loadDraft, saveDraft } from "@/local/db";
import { usePaired } from "@/state/session";
import { useData } from "@/state/data";
import { useOperator } from "@/state/operator";

/**
 * The ticket being built. Unsent lines are persisted to SQLite on every change, so a crash
 * or app kill never loses an order in progress. Sent lines come from the live Firestore order.
 */
export function useTicket(opts: { ticketId?: string; orderId?: string | null; mode: OrderMode; init?: Partial<Ticket> }) {
  const session = usePaired();
  const { categories, openOrders } = useData();
  const { operator } = useOperator();
  const [ticket, setTicketState] = useState<Ticket>(() => {
    const key = opts.orderId ?? opts.ticketId;
    const saved = key ? loadDraft<Ticket>(key) : null;
    if (saved) return opts.orderId ? { ...saved, orderId: opts.orderId } : saved;
    return newTicket(opts.mode, { cid: session.cid, ...(opts.orderId ? { id: opts.orderId, orderId: opts.orderId } : opts.ticketId ? { id: opts.ticketId } : {}), ...opts.init });
  });
  const order = useMemo(() => (ticket.orderId ? (openOrders.find((o) => o.id === ticket.orderId) ?? null) : null), [openOrders, ticket.orderId]);

  const setTicket = useCallback((next: Ticket | ((t: Ticket) => Ticket)) => {
    setTicketState((cur) => {
      const t = typeof next === "function" ? next(cur) : next;
      saveDraft(t.id, t);
      return t;
    });
  }, []);

  const stationOf = useCallback((categoryId: string) => categories.find((c) => c.id === categoryId)?.station ?? "kitchen", [categories]);

  const add = useCallback(
    (item: WithId<Item>, variant?: Variant, qty = 1, note?: string) => {
      setTicket((t) => {
        const unit = variant?.pricePaise ?? item.pricePaise;
        // Merge into an identical unsent line (same item, variant, price, no note).
        const same = t.lines.find((l) => l.itemId === item.id && (l.variantId ?? null) === (variant?.id ?? null) && l.unitPricePaise === unit && !l.note && !note && !l.discount);
        if (same) return { ...t, lines: t.lines.map((l) => (l === same ? { ...l, qty: l.qty + qty } : l)) };
        const seq = Math.max(0, ...t.lines.map((l) => l.seq), ...(order ? Object.values(order.lines).map((l) => l.seq) : [])) + 1;
        const line: OrderLine = {
          lineId: makeLineId(Math.random),
          seq,
          itemId: item.id,
          name: item.shortName || item.name,
          ...(variant ? { variantId: variant.id, variantName: variant.name } : {}),
          categoryId: item.categoryId,
          station: stationOf(item.categoryId),
          unitPricePaise: unit,
          qty,
          taxBps: item.taxBps,
          ...(note ? { note } : {}),
          sentQty: 0,
          voidedQty: 0,
          addedBy: operator?.id ?? "unknown",
          addedAtMs: Date.now(),
        };
        return { ...t, lines: [...t.lines, line] };
      });
    },
    [setTicket, stationOf, order, operator?.id],
  );

  const setQty = useCallback((lineId: string, qty: number) => setTicket((t) => ({ ...t, lines: qty <= 0 ? t.lines.filter((l) => l.lineId !== lineId) : t.lines.map((l) => (l.lineId === lineId ? { ...l, qty } : l)) })), [setTicket]);
  const setNote = useCallback((lineId: string, note: string) => setTicket((t) => ({ ...t, lines: t.lines.map((l) => (l.lineId === lineId ? { ...l, ...(note ? { note } : { note: undefined }) } : l)) })), [setTicket]);
  const setBillDiscount = useCallback((d: Discount | undefined) => setTicket((t) => ({ ...t, billDiscount: d })), [setTicket]);
  const clear = useCallback(() => setTicket((t) => ({ ...t, lines: [], billDiscount: undefined })), [setTicket]);
  /** After a KOT: the sent lines now live on the order; keep the ticket attached to it. */
  const sent = useCallback((orderId: string) => setTicket((t) => ({ ...t, orderId, lines: [] })), [setTicket]);

  /** Everything on the bill so far: sent lines (from Firestore) + unsent draft lines. */
  const allLines = useMemo(() => [...(order ? Object.values(order.lines) : []), ...ticket.lines], [order, ticket.lines]);
  const bill = useMemo(
    () => billFor(session.client, ticket.mode, allLines, { ...(ticket.billDiscount ? { billDiscount: ticket.billDiscount } : {}), serviceChargeOptIn: ticket.serviceChargeOptIn }),
    [session.client, ticket.mode, allLines, ticket.billDiscount, ticket.serviceChargeOptIn],
  );
  const qtyByItem = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of ticket.lines) m.set(l.itemId, (m.get(l.itemId) ?? 0) + l.qty);
    return m;
  }, [ticket.lines]);

  return { ticket, setTicket, order, add, setQty, setNote, setBillDiscount, clear, sent, allLines, bill, qtyByItem };
}

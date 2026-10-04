import { useEffect, useState } from "react";
import type { Ticket } from "@/actions/orders";
import { deleteDraft, listDrafts, loadDraft, saveDraft } from "./db";

/**
 * Held (parked) tickets: an unsent quick/delivery ticket set aside while the customer decides,
 * so the counter can serve the next person. They are ordinary SQLite drafts with a `held`
 * marker — instant, offline, survive an app kill — and live on this terminal only.
 * A ticket left unfinished (cashier switched screens) shows up here too, so nothing is lost.
 */

type Listener = () => void;
const listeners = new Set<Listener>();
const emit = () => listeners.forEach((l) => l());

/** Tickets currently on screen in a register (never listed as held). */
const open = new Set<string>();

export function markOpen(id: string): () => void {
  open.add(id);
  emit();
  return () => {
    open.delete(id);
    emit();
  };
}

export interface HeldTicket extends Ticket {
  /** When it was parked (or last touched, for an unfinished ticket). */
  sinceMs: number;
  /** True when parked on purpose; false when left unfinished. */
  parked: boolean;
}

export function listHeld(cid: string): HeldTicket[] {
  return listDrafts<Ticket>()
    .filter(({ orderId, value: t }) => t.cid === cid && !t.orderId && t.mode !== "dineIn" && t.lines.length > 0 && !open.has(orderId))
    .map(({ value: t, updatedAt }) => ({ ...t, sinceMs: t.held?.atMs ?? updatedAt, parked: Boolean(t.held) }))
    .sort((a, b) => a.sinceMs - b.sinceMs);
}

export function holdTicket(t: Ticket, label?: string): void {
  const name = label?.trim();
  saveDraft(t.id, { ...t, held: { atMs: Date.now(), ...(name ? { label: name } : {}) } });
  emit();
}

/** Take a held ticket back out (clears the marker) to open it in the register. */
export function takeHeld(id: string): Ticket | null {
  const t = loadDraft<Ticket>(id);
  if (!t) return null;
  const { held, ...rest } = t;
  // The name it was held under ("Ravi") becomes the order's customer name, so it follows the order.
  const back: Ticket = held?.label && !rest.customer?.name ? { ...rest, customer: { ...rest.customer, name: held.label } } : rest;
  saveDraft(id, back);
  emit();
  return back;
}

/** The customer left: drop it (nothing was sent anywhere, so nothing to reverse). */
export function discardHeld(id: string): void {
  deleteDraft(id);
  emit();
}

/** Live list of this outlet's held tickets. */
export function useHeld(cid: string): HeldTicket[] {
  const [list, setList] = useState(() => listHeld(cid));
  useEffect(() => {
    const load = () => setList(listHeld(cid));
    load();
    listeners.add(load);
    return () => {
      listeners.delete(load);
    };
  }, [cid]);
  return list;
}

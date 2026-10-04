import { useEffect, useSyncExternalStore } from "react";

/** While a payment is on screen, phones hide the bottom tabs: more room, no stray navigation. */
let paying = false;
const listeners = new Set<() => void>();

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

function set(on: boolean) {
  if (paying === on) return;
  paying = on;
  for (const l of listeners) l();
}

export function useCheckoutFocus(): boolean {
  return useSyncExternalStore(subscribe, () => paying);
}

/** Mark the payment screen as open for as long as `on` holds (and the caller is mounted). */
export function useHoldCheckoutFocus(on: boolean): void {
  useEffect(() => {
    set(on);
    return () => set(false);
  }, [on]);
}

import type { StockStats } from "./types";

const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

export function stockStats(v: unknown): StockStats {
  const o = (v ?? {}) as Partial<StockStats>;
  return { in: n(o.in), sold: n(o.sold), rev: n(o.rev), waste: n(o.waste), adj: n(o.adj) };
}

/** Closing = opening + in − sold + returned − wasted ± adjustments. */
export function stockEod(opening: number, s: Partial<StockStats>): number {
  const x = stockStats(s);
  return opening + x.in - x.sold + x.rev - x.waste + x.adj;
}

/**
 * Next day's snapshot computed from the ledger (never from live onHand, which may
 * already include the next day's sales): snapshot[D] = snapshot[D−1] + deltas[D].
 * Items that appear only in today's movements start from 0 (their opening qty is posted as "in").
 */
export function snapshotFromLedger(prev: Record<string, number>, day: Record<string, Partial<StockStats>> | undefined): Record<string, number> {
  const out: Record<string, number> = { ...prev };
  for (const [itemId, s] of Object.entries(day ?? {})) out[itemId] = stockEod(out[itemId] ?? 0, s);
  return out;
}

export type StockLevel = "ok" | "low" | "out";

export function stockLevel(onHand: number | undefined, lowAt: number): StockLevel {
  const q = n(onHand);
  if (q <= 0) return "out";
  if (lowAt > 0 && q <= lowAt) return "low";
  return "ok";
}

/** EOD report row for one item on one day. */
export function eodRow(itemId: string, opening: number, s: Partial<StockStats> | undefined, counted?: number) {
  const x = stockStats(s);
  const closing = stockEod(opening, x);
  return {
    itemId,
    opening,
    ...x,
    closing,
    counted,
    variance: counted == null ? undefined : counted - closing,
  };
}

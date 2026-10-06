"use client";

import { useState } from "react";
import { collection, query, where } from "firebase/firestore";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { bizDateLabel, cashStats, expectedCashFor, parseINR, paths, type DailyStats, type Drawer, type Order, type Terminal } from "@px-pos/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormDialog } from "@/components/shared/form-dialog";
import { FormError } from "@/components/shared/form-controls";
import { Money } from "@/components/shared/money";
import { usePrincipal } from "@/components/providers/principal-provider";
import { closeDayFromAdmin } from "@/lib/day-close";
import { firestoreMessage } from "@/lib/firebase/apply-plan";
import { useCollection, type WithId } from "@/lib/firebase/hooks";

/**
 * Close a business day from admin. Each drawer still open takes the cash someone counted (or
 * stays "not counted"); running orders and unsynced tills are warned about, not blocked — this is
 * the way out when the till can't close it.
 */
export function CloseDayDialog({ cid, businessDate, today, stats, terminals, onOpenChange }: { cid: string; businessDate: string | null; today: string; stats: Partial<DailyStats> | undefined; terminals: WithId<Terminal>[]; onOpenChange: (open: boolean) => void }) {
  const { planCtx } = usePrincipal();
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const d = businessDate;
  const drawers = useCollection<Drawer>(d ? `drawers:${cid}:${d}` : null, (db) => query(collection(db, paths.col(cid, "drawers")), where("businessDate", "==", d)));
  const running = useCollection<Order>(d ? `running:${cid}` : null, (db) => query(collection(db, paths.col(cid, "orders")), where("status", "in", ["open", "billed"])));
  const runningHere = running.data.filter((o) => o.businessDate === d).length;
  const unsynced = terminals.filter((t) => t.status === "active" && (t.pendingWrites ?? 0) > 0);
  const name = (tid: string) => terminals.find((t) => t.id === tid)?.name ?? "A terminal";
  const open = drawers.data.filter((x) => x.status === "open");

  async function close() {
    if (!d) return;
    const parsed: Record<string, { countedPaise?: number }> = {};
    for (const x of open) {
      const raw = (counts[x.terminalId] ?? "").trim();
      if (!raw) continue;
      const p = parseINR(raw);
      if (p == null || p < 0) return setError(`Enter the cash counted at ${name(x.terminalId)} in rupees, or leave it empty.`);
      parsed[x.terminalId] = { countedPaise: p };
    }
    setBusy(true);
    setError(null);
    try {
      const { zNo } = await closeDayFromAdmin(planCtx(cid), d, parsed);
      toast.success(`Business day ${bizDateLabel(d)} closed · Z ${zNo}`);
      setCounts({});
      onOpenChange(false);
    } catch (e) {
      setError(firestoreMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <FormDialog
      open={Boolean(d)}
      onOpenChange={(o) => !busy && onOpenChange(o)}
      title={d ? `Close business day ${bizDateLabel(d, true)}?` : "Close day"}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={() => void close()} disabled={busy || drawers.status === "loading"}>
            {busy ? <Loader2 className="animate-spin" data-icon="inline-start" aria-hidden /> : null}
            Close day
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 text-sm">
        {d === today ? <p className="text-warning">The till is still using this day. Once it&apos;s closed here, the till asks to open the next one.</p> : null}
        {runningHere > 0 ? (
          <p className="text-warning">
            {runningHere} running order{runningHere === 1 ? " is" : "s are"} still open on this day. If settled later, {runningHere === 1 ? "it's" : "they're"} added to this day after its Z.
          </p>
        ) : null}
        {unsynced.map((t) => (
          <p key={t.id} className="text-warning">
            {t.name} has {t.pendingWrites} change{t.pendingWrites === 1 ? "" : "s"} not synced yet. Anything for this day that arrives later is added after the Z.
          </p>
        ))}
        {drawers.status === "loading" ? (
          <p className="text-muted-foreground">Loading the drawers…</p>
        ) : drawers.data.length === 0 ? (
          <p className="text-muted-foreground">No drawer was recorded for this day, so it closes without a cash count.</p>
        ) : open.length === 0 ? (
          <p className="text-muted-foreground">Every drawer is already closed.</p>
        ) : (
          <ul className="flex flex-col divide-y rounded-lg border">
            {open.map((x) => {
              const expected = expectedCashFor(x.openingFloatPaise, cashStats(stats?.cash?.[x.terminalId]));
              const id = `count-${x.terminalId}`;
              return (
                <li key={x.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                  <label htmlFor={id} className="min-w-40 flex-1">
                    <span className="block font-medium">{name(x.terminalId)} drawer</span>
                    <span className="text-muted-foreground">
                      Should hold <Money value={expected} decimals="auto" />
                    </span>
                  </label>
                  <Input id={id} inputMode="decimal" placeholder="Not counted" value={counts[x.terminalId] ?? ""} onChange={(e) => setCounts((c) => ({ ...c, [x.terminalId]: e.target.value }))} className="w-36 text-right tabular-nums" aria-label={`Cash counted at ${name(x.terminalId)}, in rupees`} />
                </li>
              );
            })}
          </ul>
        )}
        <FormError error={error} />
      </div>
    </FormDialog>
  );
}

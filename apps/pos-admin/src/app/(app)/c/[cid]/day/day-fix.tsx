"use client";

import { useEffect, useState } from "react";
import { collection, query, where } from "firebase/firestore";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { bizDateLabel, formatINR, istTime, paths, type BizDate, type Day, type DayMove, type MisplacedGroup, type Paise, type ZReport } from "@px-pos/core";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/shared/field";
import { FormDialog } from "@/components/shared/form-dialog";
import { FormError, MoneyInput } from "@/components/shared/form-controls";
import { Money } from "@/components/shared/money";
import { usePrincipal } from "@/components/providers/principal-provider";
import { findMisplaced, finishMove, moveBills, recountDrawer, reopenDay } from "@/lib/day-fix";
import { firestoreMessage } from "@/lib/firebase/apply-plan";
import { useCollection } from "@/lib/firebase/hooks";
import { cn } from "@/lib/utils";

const rs = (p: Paise) => formatINR(p, { decimals: "auto" });
const payLine = (byPay: Record<string, Paise>) =>
  Object.entries(byPay)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k === "upi" ? "UPI" : k[0]!.toUpperCase() + k.slice(1)} ${rs(v)}`)
    .join(" · ");

function Reason({ id, value, onChange, placeholder }: { id: string; value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <Field label="Why (kept with the change)" htmlFor={id}>
      <Textarea id={id} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={2} maxLength={200} />
    </Field>
  );
}

/**
 * Move bills to the day they were sold. Finds the till's bills on this business day whose bill
 * time falls on another day (closed early, or left open overnight), shows each group, and moves
 * the one picked: totals, payments, items and GST follow; drawer cash stays with its count.
 */
export function MoveBillsDialog({
  cid,
  from,
  cutoffMin,
  totalOf,
  isFrozen,
  onOpenChange,
}: {
  cid: string;
  from: BizDate | null;
  cutoffMin: number;
  /** Current total of a business day (its Z when closed, else live). */
  totalOf: (d: BizDate) => Paise;
  isFrozen: (d: BizDate) => boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { planCtx } = usePrincipal();
  const [groups, setGroups] = useState<MisplacedGroup[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pick, setPick] = useState<string>("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fresh search each time it opens for a day — adjusted during render, loaded in the effect.
  const [seen, setSeen] = useState<BizDate | null>(null);
  if (from !== seen) {
    setSeen(from);
    setGroups(null);
    setLoadError(null);
    setPick("");
    setReason("");
    setError(null);
  }
  useEffect(() => {
    if (!from) return;
    let live = true;
    findMisplaced(cid, from, cutoffMin)
      .then((g) => {
        if (!live) return;
        setGroups(g);
        // An earlier day (closed early) is the usual case; a later one may just be after midnight.
        const earlier = g.find((x) => x.to < from);
        setPick(earlier?.to ?? (g.length === 1 ? g[0]!.to : ""));
      })
      .catch((e) => live && setLoadError(firestoreMessage(e)));
    return () => {
      live = false;
    };
  }, [cid, from, cutoffMin]);

  const chosen = groups?.find((g) => g.to === pick) ?? null;
  const frozen = chosen ? isFrozen(chosen.to) : false;

  async function apply() {
    if (!from || !chosen) return;
    if (!reason.trim()) return setError("Say why the bills are moved.");
    setBusy(true);
    setError(null);
    try {
      await moveBills(planCtx(cid), from, chosen, reason);
      toast.success(`${chosen.bills} bill${chosen.bills === 1 ? "" : "s"} moved to ${bizDateLabel(chosen.to)}`);
      onOpenChange(false);
    } catch (e) {
      setError(firestoreMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <FormDialog
      open={Boolean(from)}
      onOpenChange={(o) => !busy && onOpenChange(o)}
      title={from ? `Move bills off ${bizDateLabel(from, true)}` : "Move bills"}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void apply()} disabled={busy || !chosen || frozen}>
            {busy ? <Loader2 className="animate-spin" data-icon="inline-start" aria-hidden /> : null}
            {chosen ? `Move ${chosen.bills} bill${chosen.bills === 1 ? "" : "s"} to ${bizDateLabel(chosen.to)}` : "Move bills"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 text-sm">
        {loadError ? (
          <FormError error={loadError} />
        ) : !groups ? (
          <p className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Checking every bill&apos;s time…
          </p>
        ) : groups.length === 0 ? (
          <p className="text-muted-foreground">Every bill on this day was sold on this day, going by the bill times. Nothing to move.</p>
        ) : (
          <>
            <p className="text-muted-foreground">These bills carry this day but were sold on another one, going by their times. Pick the group to move.</p>
            <RadioGroup value={pick} onValueChange={setPick} className="gap-2">
              {groups.map((g) => {
                const id = `move-${g.to}`;
                const before = from ? totalOf(from) : 0;
                return (
                  <Label key={g.to} htmlFor={id} className={cn("flex cursor-pointer items-start gap-3 rounded-lg border p-3 font-normal", pick === g.to && "border-primary")}>
                    <RadioGroupItem id={id} value={g.to} className="mt-0.5" />
                    <span className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="font-medium">
                        Sold on {bizDateLabel(g.to, true)}: {g.bills} bill{g.bills === 1 ? "" : "s"}, {rs(g.totalPaise)}
                      </span>
                      <span className="text-muted-foreground">
                        {istTime(g.firstMs)} – {istTime(g.lastMs)}
                        {payLine(g.byPay) ? ` · ${payLine(g.byPay)}` : ""}
                      </span>
                      {from ? (
                        <span className="text-muted-foreground tabular-nums">
                          After: {bizDateLabel(from)} {rs(before - g.totalPaise)} · {bizDateLabel(g.to)} {rs(totalOf(g.to) + g.totalPaise)}
                        </span>
                      ) : null}
                      {from && g.to > from ? <span className="text-warning">Sold after this day. If the shop works past midnight these may belong here; check the times.</span> : null}
                      {isFrozen(g.to) ? <span className="text-brand">{bizDateLabel(g.to)} is in a closed month. Only the super admin can reopen it (End of day › Months).</span> : null}
                    </span>
                  </Label>
                );
              })}
            </RadioGroup>
            <Reason id="move-reason" value={reason} onChange={setReason} placeholder="e.g. The day was closed in the afternoon by mistake" />
            <p className="text-muted-foreground">Sales, payments, items and GST move with the bills. Cash in the drawers stays with the count it was counted in. Both days keep their Z numbers, and each Z as first printed stays available.</p>
          </>
        )}
        <FormError error={error} />
      </div>
    </FormDialog>
  );
}

/** Correct the cash counted in a closed day's drawers (staff typed it wrong, or didn't count). */
export function RecountDialog({ cid, day, businessDate, terminalNames, onOpenChange }: { cid: string; day: (Day & { z: ZReport }) | null; businessDate: BizDate | null; terminalNames: Record<string, string>; onOpenChange: (open: boolean) => void }) {
  const { planCtx } = usePrincipal();
  const [counts, setCounts] = useState<Record<string, Paise | null>>({});
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const drawers = day?.z.drawers ?? [];

  const [seen, setSeen] = useState<BizDate | null>(null);
  if (businessDate !== seen) {
    setSeen(businessDate);
    setCounts(Object.fromEntries(drawers.map((d) => [d.terminalId, d.countedPaise ?? null])));
    setReason("");
    setError(null);
  }
  const changed = drawers.filter((d) => counts[d.terminalId] != null && counts[d.terminalId] !== (d.countedPaise ?? null));

  async function save() {
    if (!businessDate || !changed.length) return;
    if (!reason.trim()) return setError("Say why the count changes.");
    setBusy(true);
    setError(null);
    try {
      for (const d of changed) await recountDrawer(planCtx(cid), businessDate, d.terminalId, counts[d.terminalId]!, reason);
      toast.success(changed.length === 1 ? "Cash count corrected" : `${changed.length} cash counts corrected`);
      onOpenChange(false);
    } catch (e) {
      setError(firestoreMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <FormDialog
      open={Boolean(businessDate && day)}
      onOpenChange={(o) => !busy && onOpenChange(o)}
      title={businessDate ? `Correct the cash count, ${bizDateLabel(businessDate, true)}` : "Correct the cash count"}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={busy || !changed.length}>
            {busy ? <Loader2 className="animate-spin" data-icon="inline-start" aria-hidden /> : null}
            Save count
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 text-sm">
        {drawers.length === 0 ? (
          <p className="text-muted-foreground">No drawer was recorded on this day.</p>
        ) : (
          <ul className="flex flex-col divide-y rounded-lg border">
            {drawers.map((d) => {
              const id = `recount-${d.terminalId}`;
              const v = counts[d.terminalId];
              const diff = v == null ? null : v - d.expectedPaise;
              return (
                <li key={d.terminalId} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                  <label htmlFor={id} className="min-w-40 flex-1">
                    <span className="block font-medium">{terminalNames[d.terminalId] ?? "Drawer"}</span>
                    <span className="text-muted-foreground">
                      Should hold <Money value={d.expectedPaise} decimals="auto" />
                      {diff != null && diff !== 0 ? <span className={diff < 0 ? "text-brand" : "text-warning"}>{` · ${diff < 0 ? "short" : "over"} ${rs(Math.abs(diff))}`}</span> : diff === 0 ? <span className="text-success"> · matches</span> : null}
                    </span>
                  </label>
                  <MoneyInput id={id} value={v ?? null} onChange={(p) => setCounts((c) => ({ ...c, [d.terminalId]: p }))} placeholder="Not counted" className="w-36 text-right tabular-nums" aria-label={`Cash counted at ${terminalNames[d.terminalId] ?? "this drawer"}, in rupees`} />
                </li>
              );
            })}
          </ul>
        )}
        <Reason id="recount-reason" value={reason} onChange={setReason} placeholder="e.g. UPI slips were counted as cash" />
        <p className="text-muted-foreground">The Z keeps its number and shows the change; the Z as first printed stays available.</p>
        <FormError error={error} />
      </div>
    </FormDialog>
  );
}

/** Reopen a closed day: it closes again later under the same Z number. */
export function ReopenDialog({ cid, day, businessDate, today, onOpenChange }: { cid: string; day: Day | null; businessDate: BizDate | null; today: BizDate; onOpenChange: (open: boolean) => void }) {
  const { planCtx } = usePrincipal();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seen, setSeen] = useState<BizDate | null>(null);
  if (businessDate !== seen) {
    setSeen(businessDate);
    setReason("");
    setError(null);
  }

  async function apply() {
    if (!businessDate) return;
    if (!reason.trim()) return setError("Say why the day is reopened.");
    setBusy(true);
    setError(null);
    try {
      await reopenDay(planCtx(cid), businessDate, reason);
      toast.success(`${bizDateLabel(businessDate)} reopened`);
      onOpenChange(false);
    } catch (e) {
      setError(firestoreMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <FormDialog
      open={Boolean(businessDate && day)}
      onOpenChange={(o) => !busy && onOpenChange(o)}
      title={businessDate ? `Reopen ${bizDateLabel(businessDate, true)}?` : "Reopen day"}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={() => void apply()} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" data-icon="inline-start" aria-hidden /> : null}
            Reopen day
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 text-sm">
        <p>
          The day opens again{day?.zNo ? ` and closes later as Z ${day.zNo}` : ""}. Its drawers reopen too, so the next close counts the cash again.
        </p>
        {businessDate && businessDate < today ? (
          <p className="text-warning">The tills have moved on to a later day, so they won&apos;t sell into this one. Reopen it only to close it again. If its bills belong to another day, use Move bills instead.</p>
        ) : (
          <p className="text-muted-foreground">A till still on this day carries on selling into it.</p>
        )}
        <Reason id="reopen-reason" value={reason} onChange={setReason} placeholder="e.g. Closed in the afternoon by mistake" />
        <FormError error={error} />
      </div>
    </FormDialog>
  );
}

/** Moves off this day whose bills are still being re-dated (a move stopped half way): finish them. */
export function PendingMoves({ cid, businessDate }: { cid: string; businessDate: BizDate }) {
  const { planCtx } = usePrincipal();
  const moves = useCollection<DayMove>(`dayMoves:${cid}:${businessDate}`, (db) => query(collection(db, paths.col(cid, "dayMoves")), where("from", "==", businessDate)));
  const [busy, setBusy] = useState<string | null>(null);
  const pending = moves.data.filter((m) => m.retag === "pending");
  if (!pending.length) return null;
  return (
    <div className="flex flex-col gap-2">
      {pending.map((m) => (
        <div key={m.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-warning/40 px-3 py-2 text-sm">
          <span className="min-w-0 flex-1 text-warning">
            {m.bills} bill{m.bills === 1 ? "" : "s"} moved to {bizDateLabel(m.to)} still show here in lists.
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={busy === m.id}
            onClick={() => {
              setBusy(m.id);
              finishMove(planCtx(cid), m.id)
                .then(() => toast.success("Bills re-dated"))
                .catch((e) => toast.error(firestoreMessage(e)))
                .finally(() => setBusy(null));
            }}
          >
            {busy === m.id ? <Loader2 className="animate-spin" data-icon="inline-start" aria-hidden /> : null}
            Finish moving
          </Button>
        </div>
      ))}
    </div>
  );
}

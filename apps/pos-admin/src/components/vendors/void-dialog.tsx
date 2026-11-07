"use client";

import { useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { bizDateLabel, monthLabel, monthOf, paths, purchaseVoidPlan, VENDOR_VOID_REASONS, vendorPaymentVoidPlan, type Day, type Paise, type Purchase, type VendorPayment, type WritePlan } from "@px-pos/core";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Field } from "@/components/shared/field";
import { FormDialog } from "@/components/shared/form-dialog";
import { FormError, SelectField } from "@/components/shared/form-controls";
import { useClient } from "@/components/providers/client-provider";
import { usePrincipal } from "@/components/providers/principal-provider";
import { useMonths } from "@/hooks/use-months";
import { useDoc, type WithId } from "@/lib/firebase/hooks";
import { useRunPlan } from "@/lib/run-plan";
import { rs, wayLabel } from "./vendor-status";

export type VoidTarget = { kind: "purchase"; purchase: WithId<Purchase> } | { kind: "payment"; payment: WithId<VendorPayment> };

type Reason = (typeof VENDOR_VOID_REASONS)[number];
const REASON_OPTIONS = VENDOR_VOID_REASONS.map((r) => ({ value: r, label: r }));

/**
 * Void a bill or a payment (a mistake is voided, then entered again). Shows what it changes: the
 * vendor's balance, a till's expected cash, and a day already closed.
 */
export function VoidDialog({ target, onOpenChange, balancePaise, terminalName }: { target: VoidTarget | null; onOpenChange: (o: boolean) => void; balancePaise: Paise; terminalName: (id: string) => string }) {
  const { cid } = useClient();
  const { planCtx } = usePrincipal();
  const { run, pending } = useRunPlan();
  const [reason, setReason] = useState<Reason>("Entered twice");
  const [note, setNote] = useState("");
  const [alsoPayment, setAlsoPayment] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const key = target ? (target.kind === "purchase" ? `b:${target.purchase.id}` : `p:${target.payment.id}`) : null;
  const [seen, setSeen] = useState(key);
  if (seen !== key) {
    setSeen(key);
    if (key) {
      setReason("Entered twice");
      setNote("");
      setAlsoPayment(true);
      setError(null);
    }
  }

  const bill = target?.kind === "purchase" ? target.purchase : null;
  // A bill paid on delivery: its payment can be voided with it.
  const paidWith = useDoc<VendorPayment>(bill?.paymentId ? paths.vendorPayment(cid, bill.paymentId) : null);
  const linked = paidWith.data?.status === "active" ? paidWith.data : null;
  const payment = target?.kind === "payment" ? target.payment : alsoPayment ? linked : null;
  const vendorName = bill?.vendorName ?? (target?.kind === "payment" ? target.payment.vendorName : "");
  const date = bill?.businessDate ?? payment?.businessDate ?? null;
  const day = useDoc<Day>(target && date ? paths.day(cid, date) : null);
  // A closed month is frozen: its days' figures can't change from admin.
  const months = useMonths(cid);
  const frozen = months.isFrozen(date);
  const after = balancePaise - (bill?.totalPaise ?? 0) + (payment?.amountPaise ?? 0);
  const opening = bill?.kind === "opening" || (target?.kind === "payment" && target.payment.kind === "opening");
  const owed = (p: Paise) => (p < 0 ? `${rs(-p)} advance` : rs(p));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!target || paidWith.status === "loading") return;
    const text = reason === "Other" ? note.trim() : note.trim() ? `${reason}: ${note.trim()}` : reason;
    if (!text) return setError("Say why");
    setError(null);
    const ctx = planCtx(cid);
    const plans: WritePlan[] = [];
    try {
      if (bill) plans.push(purchaseVoidPlan(ctx, bill, text));
      if (payment) plans.push(vendorPaymentVoidPlan(ctx, payment, text));
    } catch (err) {
      return setError(err instanceof Error ? err.message : "Couldn't void it.");
    }
    if (await run(plans, bill ? "Bill voided" : "Payment voided")) onOpenChange(false);
  }

  return (
    <FormDialog
      open={Boolean(target)}
      onOpenChange={(o) => !pending && onOpenChange(o)}
      title={bill ? (bill.kind === "opening" ? `Void opening balance · ${vendorName}` : `Void bill${bill.billNo ? ` ${bill.billNo}` : ""} · ${vendorName}`) : `Void payment · ${vendorName}`}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="void-form" variant="destructive" disabled={pending || frozen}>
            {pending ? <Loader2 className="animate-spin" data-icon="inline-start" aria-hidden /> : null}
            {bill ? (payment ? "Void bill and payment" : "Void bill") : "Void payment"}
          </Button>
        </>
      }
    >
      {target ? (
        <form id="void-form" onSubmit={submit} className="flex flex-col gap-5" noValidate>
          <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm">
            <li>
              What you owe {vendorName}: <span className="tabular-nums">{owed(balancePaise)}</span> → <span className="font-medium tabular-nums">{owed(after)}</span>
            </li>
            {bill && bill.kind === "bill" ? <li>Bought on {bizDateLabel(bill.businessDate)} goes down by {rs(bill.totalPaise)}.</li> : null}
            {payment && payment.kind === "payment" ? (
              <li>
                Paid to vendors on {bizDateLabel(payment.businessDate)} goes down by {rs(payment.amountPaise)}
                {payment.mode === "drawer" && payment.drawerTerminalId ? `, and ${terminalName(payment.drawerTerminalId)}'s expected cash goes back up by the same.` : "."}
              </li>
            ) : null}
            {frozen ? <li className="text-brand">{monthLabel(monthOf(date!))} is closed, so nothing dated in it can change. The super admin can reopen it (End of day › Months).</li> : null}
            {day.data?.status === "closed" && !opening ? <li className="text-warning">{bizDateLabel(date!)} is already closed. Its Z report stays as printed; the day&apos;s figures show the change.</li> : null}
          </ul>
          {linked ? (
            <div className="flex items-start gap-3 rounded-xl border p-3">
              <Checkbox id="void-pay" checked={alsoPayment} onCheckedChange={(v) => setAlsoPayment(v === true)} className="mt-0.5" />
              <Label htmlFor="void-pay" className="flex-1 cursor-pointer flex-col items-start gap-0.5 font-normal">
                <span>
                  Also void the {rs(linked.amountPaise)} paid with it ({wayLabel(linked.mode, linked.drawerTerminalId ? terminalName(linked.drawerTerminalId) : undefined)})
                </span>
                {!alsoPayment ? <span className="text-xs text-muted-foreground">It stays with {vendorName} as credit for the other bills.</span> : null}
              </Label>
            </div>
          ) : null}
          <Field label="Reason" htmlFor="void-reason">
            <SelectField id="void-reason" value={reason} onValueChange={setReason} options={REASON_OPTIONS} />
          </Field>
          <Field label={reason === "Other" ? "What happened" : "Note"} htmlFor="void-note">
            <Input id="void-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={120} autoComplete="off" />
          </Field>
          <FormError error={error} />
        </form>
      ) : null}
    </FormDialog>
  );
}

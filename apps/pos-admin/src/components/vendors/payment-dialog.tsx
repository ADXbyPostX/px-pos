"use client";

import { useMemo, useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { bizDateLabel, paymentPreview, payChips, vendorBalance, vendorPaymentPlan, vendorPosition, type BizDate, type Paise, type Vendor, type VendorPayMode } from "@px-pos/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Field, FieldRow } from "@/components/shared/field";
import { FormDialog } from "@/components/shared/form-dialog";
import { FormError, MoneyInput, SelectField } from "@/components/shared/form-controls";
import { useClient } from "@/components/providers/client-provider";
import { usePrincipal } from "@/components/providers/principal-provider";
import { useVendorLedger } from "@/hooks/use-vendors";
import type { WithId } from "@/lib/firebase/hooks";
import { newId } from "@/lib/ids";
import { useRunPlan } from "@/lib/run-plan";
import { cn } from "@/lib/utils";
import { VendorCombobox } from "./pickers";
import { WAY_OPTIONS } from "./purchase-dialog";
import { rs } from "./vendor-status";

const billName = (c: { kind: string; billNo?: string; billDate: BizDate }) => `${c.kind === "opening" ? "Opening balance" : c.billNo ? `Bill ${c.billNo}` : "Bill"} · ${bizDateLabel(c.billDate)}`;

/** Pay a vendor. Payments always settle the oldest bills first; the preview shows which. */
export function PaymentDialog({ open, onOpenChange, vendorId, vendors, today, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; vendorId: string | null; vendors: WithId<Vendor>[]; today: BizDate; onSaved?: (id: string) => void }) {
  const { cid } = useClient();
  const { planCtx } = usePrincipal();
  const { run, pending } = useRunPlan();
  const [id, setId] = useState("");
  const [vid, setVid] = useState<string | null>(null);
  const [amount, setAmount] = useState<Paise | null>(null);
  const [way, setWay] = useState<VendorPayMode>("upi");
  const [ref, setRef] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const [seen, setSeen] = useState({ open, vendorId });
  if (seen.open !== open || seen.vendorId !== vendorId) {
    setSeen({ open, vendorId });
    if (open) {
      setId(newId());
      setVid(vendorId);
      setAmount(null);
      setWay("upi");
      setRef("");
      setNote("");
      setError(null);
    }
  }

  const vendor = vendors.find((v) => v.id === vid) ?? null;
  const { bills } = useVendorLedger(cid, open ? vid : null);
  const balance = vendorBalance(vendor);
  const pos = useMemo(() => vendorPosition(bills.data, balance), [bills.data, balance]);
  const chips = bills.status === "ready" ? payChips(pos) : [];
  const preview = amount && bills.status === "ready" ? paymentPreview(bills.data, balance, amount) : null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!vendor) return setError("Choose the vendor");
    if (!amount) return setError("Enter the amount");
    setError(null);
    let plan;
    try {
      plan = vendorPaymentPlan(planCtx(cid), {
        id,
        vendor: { id: vendor.id, name: vendor.name },
        businessDate: today,
        amountPaise: amount,
        mode: way,
        ...(ref.trim() ? { ref: ref.trim() } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
        today,
      });
    } catch (err) {
      return setError(err instanceof Error ? err.message : "Couldn't save the payment.");
    }
    if (!(await run(plan, `Paid ${vendor.name} ${rs(amount)}`))) return;
    onSaved?.(id);
    onOpenChange(false);
  }

  const chipLabel = (c: (typeof chips)[number]) => (c.label === "all" ? `All ${rs(c.amountPaise)}` : c.label === "oldest" ? `Oldest bill · ${rs(c.amountPaise)}` : `Up to ${bizDateLabel(c.billDate!)} · ${rs(c.amountPaise)}`);

  return (
    <FormDialog
      open={open}
      onOpenChange={(o) => !pending && onOpenChange(o)}
      title={vendor ? `Pay ${vendor.name}` : "Pay vendor"}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="payment-form" disabled={pending}>
            {pending ? <Loader2 className="animate-spin" data-icon="inline-start" aria-hidden /> : null}
            {preview?.advancePaise ? `Pay with ${rs(preview.advancePaise)} advance` : amount ? `Pay ${rs(amount)}` : "Pay"}
          </Button>
        </>
      }
    >
      <form id="payment-form" onSubmit={submit} className="flex flex-col gap-5" noValidate>
        <Field label="Vendor" htmlFor="pay-vendor">
          <VendorCombobox id="pay-vendor" vendors={vendors} value={vid} onChange={setVid} />
        </Field>
        {vendor ? (
          <div className="grid grid-cols-2 gap-px overflow-clip rounded-xl border bg-border text-sm">
            <div className="flex flex-col gap-0.5 bg-card px-4 py-2.5">
              <span className="text-xs text-muted-foreground">{balance < 0 ? "They hold an advance" : "You owe"}</span>
              <span className={cn("text-lg font-semibold tabular-nums", balance > 0 && "text-brand")}>{rs(Math.abs(balance))}</span>
            </div>
            <div className="flex flex-col gap-0.5 bg-card px-4 py-2.5">
              <span className="text-xs text-muted-foreground">Oldest due</span>
              <div className="truncate text-lg font-semibold tabular-nums">{bills.status !== "ready" ? <Skeleton className="mt-1.5 h-4 w-24" /> : pos.oldestDue ? bizDateLabel(pos.oldestDue.bill.billDate) : pos.uncoveredPaise > 0 ? "Older bills" : "—"}</div>
            </div>
          </div>
        ) : null}
        <Field label="Amount" htmlFor="pay-amount">
          <MoneyInput id="pay-amount" value={amount} onChange={setAmount} autoFocus={Boolean(vendorId)} />
        </Field>
        {chips.length ? (
          <div className="-mt-3 flex flex-wrap gap-1.5" role="group" aria-label="Quick amounts">
            {chips.map((c) => (
              <Button key={`${c.label}${c.billDate ?? ""}`} type="button" variant={amount === c.amountPaise ? "secondary" : "outline"} size="sm" onClick={() => setAmount(c.amountPaise)} className="tabular-nums">
                {chipLabel(c)}
              </Button>
            ))}
          </div>
        ) : null}
        {preview && (preview.clears.length || preview.olderPaise) ? (
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">This clears</span>
            <ul className="divide-y overflow-clip rounded-xl border text-sm" aria-live="polite">
              {preview.olderPaise ? (
                <li className="flex items-center justify-between gap-3 px-3 py-2">
                  <span>Older bills</span>
                  <span className="tabular-nums">{rs(preview.olderPaise)}</span>
                </li>
              ) : null}
              {preview.clears.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span className="min-w-0 truncate">{billName(c)}</span>
                  <span className="shrink-0 tabular-nums">
                    {c.cleared ? (
                      <span className="text-success">Paid off · {rs(c.dueBeforePaise)}</span>
                    ) : (
                      <>
                        {rs(c.dueBeforePaise - c.dueAfterPaise)} <span className="text-muted-foreground">· {rs(c.dueAfterPaise)} left</span>
                      </>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {preview?.advancePaise ? (
          <p role="status" className="rounded-lg border border-warning/40 px-3 py-2 text-sm text-warning">
            {rs(preview.advancePaise)} more than you owe. {vendor?.name} keeps it as an advance for the next bills.
          </p>
        ) : null}
        <FieldRow>
          <Field label="Paid by" htmlFor="pay-way">
            <SelectField id="pay-way" value={way} onValueChange={setWay} options={WAY_OPTIONS} />
          </Field>
          <Field label={way === "cheque" ? "Cheque no." : "Reference"} htmlFor="pay-ref">
            <Input id="pay-ref" value={ref} onChange={(e) => setRef(e.target.value)} maxLength={40} autoComplete="off" placeholder={way === "upi" || way === "bank" ? "UTR" : undefined} />
          </Field>
        </FieldRow>
        <Field label="Note" htmlFor="pay-note">
          <Input id="pay-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />
        </Field>
        <FormError error={error} />
      </form>
    </FormDialog>
  );
}

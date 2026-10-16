"use client";

import { useMemo, useState, type FormEvent } from "react";
import { Copy, Loader2, Plus, X } from "lucide-react";
import {
  amountForRate,
  bizDateLabel,
  fifoCompare,
  gstInclusiveSplit,
  MATERIAL_UNIT_LABEL,
  purchasePlan,
  rateLabel,
  TAX_RATES,
  unitRatePaise,
  VENDOR_PAY_LABEL,
  withGst,
  type BizDate,
  type Material,
  type Paise,
  type PricePoint,
  type Purchase,
  type Vendor,
  type VendorPayMode,
} from "@px-pos/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Field, FieldRow } from "@/components/shared/field";
import { FormDialog } from "@/components/shared/form-dialog";
import { FormError, MoneyInput, QtyInput, SelectField, SwitchRow } from "@/components/shared/form-controls";
import { BizDateField } from "@/components/shared/range-picker";
import { useClient } from "@/components/providers/client-provider";
import { usePrincipal } from "@/components/providers/principal-provider";
import type { WithId } from "@/lib/firebase/hooks";
import { newId } from "@/lib/ids";
import { useRunPlan } from "@/lib/run-plan";
import { cn } from "@/lib/utils";
import { MaterialCombobox, VendorCombobox, type DraftMaterial, type MaterialOption } from "./pickers";
import { rs } from "./vendor-status";

type PaidNow = "none" | "full" | "part";

/** Ways to record a payment from the admin panel (till cash is only ever paid at a till). */
export const ADMIN_WAYS: VendorPayMode[] = ["upi", "bank", "cash", "cheque", "other"];
export const WAY_OPTIONS = ADMIN_WAYS.map((m) => ({ value: m, label: VENDOR_PAY_LABEL[m] }));
const GST_OPTIONS = TAX_RATES.map((r) => ({ value: String(r), label: rateLabel(r) }));

interface LineDraft {
  lineId: string;
  materialId: string | null;
  qtyMilli: number | null;
  ratePaise: Paise | null;
  amountPaise: Paise | null;
  taxBps: number;
  /** The one of rate / amount typed last; the other follows the quantity. */
  driver: "rate" | "amount";
}

const blankLine = (): LineDraft => ({ lineId: newId(), materialId: null, qtyMilli: null, ratePaise: null, amountPaise: null, taxBps: 0, driver: "rate" });
const isBlank = (l: LineDraft) => !l.materialId && l.qtyMilli == null && l.amountPaise == null;

/** A line of the bill as the person reads it on paper: material, quantity × rate = amount, GST. */
function LineRow({
  index,
  line,
  options,
  preferred,
  last,
  onChange,
  onMaterial,
  onAddMaterial,
  onRemove,
}: {
  index: number;
  line: LineDraft;
  options: MaterialOption[];
  preferred: string[];
  last: PricePoint | undefined;
  onChange: (next: LineDraft) => void;
  onMaterial: (id: string) => void;
  onAddMaterial: (d: DraftMaterial) => void;
  onRemove: () => void;
}) {
  const m = options.find((o) => o.id === line.materialId);
  const unit = m ? MATERIAL_UNIT_LABEL[m.unit] : "";
  const name = m?.name ?? `line ${index + 1}`;
  const setQty = (q: number | null) => {
    const next = { ...line, qtyMilli: q };
    if (q) {
      if (line.driver === "rate" && line.ratePaise != null) next.amountPaise = amountForRate(line.ratePaise, q);
      if (line.driver === "amount" && line.amountPaise != null) next.ratePaise = unitRatePaise(line.amountPaise, q);
    }
    onChange(next);
  };
  const setRate = (r: Paise | null) => onChange({ ...line, ratePaise: r, driver: "rate", ...(r != null && line.qtyMilli ? { amountPaise: amountForRate(r, line.qtyMilli) } : {}) });
  const setAmount = (a: Paise | null) => onChange({ ...line, amountPaise: a, driver: "amount", ...(a != null && line.qtyMilli ? { ratePaise: unitRatePaise(a, line.qtyMilli) } : {}) });
  return (
    <li className="grid grid-cols-6 items-start gap-2 border-b py-3 last:border-0 sm:grid-cols-[minmax(0,1fr)_6rem_6.5rem_7rem_5.25rem_2.25rem] sm:border-0 sm:py-1">
      <div className="col-span-5 flex min-w-0 flex-col gap-1 sm:col-span-1">
        <MaterialCombobox aria-label={`Material, line ${index + 1}`} options={options} preferred={preferred} value={line.materialId} onChange={onMaterial} onAdd={onAddMaterial} />
        {last ? (
          <span className="truncate px-1 text-xs text-muted-foreground tabular-nums">
            Last {rs(last.ratePaise)}/{MATERIAL_UNIT_LABEL[last.unit]} · {bizDateLabel(last.billDate)}
          </span>
        ) : null}
      </div>
      <Button type="button" variant="ghost" size="icon" onClick={onRemove} aria-label={`Remove ${name}`} className="col-span-1 justify-self-end sm:order-last">
        <X aria-hidden />
      </Button>
      <div className="relative col-span-2 sm:col-span-1">
        <QtyInput aria-label={`Quantity of ${name}`} value={line.qtyMilli} onChange={setQty} className={unit ? "pr-14" : undefined} placeholder="Qty" />
        {unit ? <span className="pointer-events-none absolute top-1/2 right-2.5 max-w-12 -translate-y-1/2 truncate text-xs text-muted-foreground">{unit}</span> : null}
      </div>
      <MoneyInput aria-label={`Rate per ${unit || "unit"} of ${name}`} value={line.ratePaise} onChange={setRate} placeholder={unit ? `per ${unit}` : "Rate"} className="col-span-2 sm:col-span-1" />
      <MoneyInput aria-label={`Amount for ${name}`} value={line.amountPaise} onChange={setAmount} placeholder="Amount" className="col-span-2 sm:col-span-1" />
      <SelectField aria-label={`GST on ${name}`} value={String(line.taxBps)} onValueChange={(v) => onChange({ ...line, taxBps: Number(v) })} options={GST_OPTIONS} className="col-span-3 sm:col-span-1" />
    </li>
  );
}

/**
 * Record a vendor's bill: what was delivered, at what price, and whether anything was paid on the
 * spot. It counts as bought today; the bill date decides which dues are oldest.
 */
export function PurchaseDialog({
  open,
  onOpenChange,
  vendorId,
  vendors,
  materials,
  recent,
  rates,
  today,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  vendorId: string | null;
  vendors: WithId<Vendor>[];
  materials: WithId<Material>[];
  /** Recent bills (for "Same as last bill"). */
  recent: WithId<Purchase>[];
  /** Latest rate paid per material. */
  rates: Map<string, PricePoint>;
  today: BizDate;
  onSaved?: (id: string) => void;
}) {
  const { cid } = useClient();
  const { planCtx } = usePrincipal();
  const { run, pending } = useRunPlan();
  const [ids, setIds] = useState({ purchase: "", payment: "" });
  const [vid, setVid] = useState<string | null>(null);
  const [billDate, setBillDate] = useState<BizDate>(today);
  const [billNo, setBillNo] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([]);
  const [drafts, setDrafts] = useState<DraftMaterial[]>([]);
  const [gstOnTop, setGstOnTop] = useState(false);
  const [billTotal, setBillTotal] = useState<Paise | null>(null);
  const [paid, setPaid] = useState<PaidNow>("none");
  const [partPaise, setPartPaise] = useState<Paise | null>(null);
  const [way, setWay] = useState<VendorPayMode>("upi");
  const [ref, setRef] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Fresh form (and fresh ids, so a double submit can't save the bill twice) on every open.
  const [seen, setSeen] = useState({ open, vendorId });
  if (seen.open !== open || seen.vendorId !== vendorId) {
    setSeen({ open, vendorId });
    if (open) {
      setIds({ purchase: newId(), payment: newId() });
      setVid(vendorId);
      setBillDate(today);
      setBillNo("");
      setLines([blankLine()]);
      setDrafts([]);
      setGstOnTop(false);
      setBillTotal(null);
      setPaid("none");
      setPartPaise(null);
      setWay("upi");
      setRef("");
      setNote("");
      setError(null);
    }
  }

  const vendor = vendors.find((v) => v.id === vid) ?? null;
  const options: MaterialOption[] = useMemo(
    () => [...materials.filter((m) => m.active || lines.some((l) => l.materialId === m.id)), ...drafts.map((d) => ({ ...d, draft: true }))],
    [materials, drafts, lines],
  );
  const optionById = useMemo(() => new Map(options.map((o) => [o.id, o])), [options]);
  const preferred = vendor?.materialIds ?? [];
  const lastBill = useMemo(() => {
    if (!vid) return null;
    const mine = recent.filter((p) => p.vendorId === vid && p.kind === "bill" && p.status === "active" && p.lines.some((l) => l.materialId && optionById.has(l.materialId)));
    return mine.sort((a, b) => fifoCompare(b, a))[0] ?? null;
  }, [recent, vid, optionById]);

  const stored = (l: LineDraft): Paise | null => (l.amountPaise == null ? null : gstOnTop ? withGst(l.amountPaise, l.taxBps) : l.amountPaise);
  const filled = lines.filter((l) => !isBlank(l));
  const sum = filled.reduce((s, l) => s + (stored(l) ?? 0), 0);
  const gst = filled.reduce((s, l) => s + gstInclusiveSplit(stored(l) ?? 0, l.taxBps).gstPaise, 0);
  const adjust = billTotal != null && sum > 0 ? billTotal - sum : 0;
  const total = sum + adjust;
  const chips = preferred.filter((mid) => optionById.has(mid) && !lines.some((l) => l.materialId === mid));

  const lineFor = (mid: string, base: LineDraft = blankLine()): LineDraft => {
    const opt = optionById.get(mid);
    const last = rates.get(mid);
    const next: LineDraft = { ...base, materialId: mid, taxBps: opt?.taxBps ?? base.taxBps };
    // Prefill the last price paid (prices on record include GST).
    if (next.ratePaise == null && next.amountPaise == null && last && !gstOnTop) {
      next.ratePaise = last.ratePaise;
      next.driver = "rate";
      if (next.qtyMilli) next.amountPaise = amountForRate(last.ratePaise, next.qtyMilli);
    }
    return next;
  };
  const addMaterialLine = (mid: string) =>
    setLines((ls) => {
      const blank = ls.findIndex(isBlank);
      return blank >= 0 ? ls.map((l, i) => (i === blank ? lineFor(mid, l) : l)) : [...ls, lineFor(mid)];
    });
  const sameAsLast = () => {
    if (!lastBill) return;
    setGstOnTop(false);
    setLines(
      lastBill.lines
        .filter((l) => l.materialId && optionById.has(l.materialId))
        .map((l) => ({ lineId: newId(), materialId: l.materialId!, qtyMilli: l.qtyMilli, ratePaise: unitRatePaise(l.amountPaise, l.qtyMilli), amountPaise: l.amountPaise, taxBps: l.taxBps, driver: "rate" as const })),
    );
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!vendor) return setError("Choose the vendor");
    if (!filled.length) return setError("Add what was delivered");
    for (const [i, l] of filled.entries()) {
      const opt = l.materialId ? optionById.get(l.materialId) : undefined;
      if (!opt) return setError(`Line ${i + 1}: choose the material`);
      if (!l.qtyMilli) return setError(`${opt.name}: enter the quantity`);
      if (!stored(l)) return setError(`${opt.name}: enter the amount`);
    }
    if (billTotal != null && Math.abs(adjust) > 10000) return setError(`The lines add up to ${rs(sum)}. Check them against the bill total of ${rs(billTotal)}.`);
    const paidPaise = paid === "full" ? total : paid === "part" ? partPaise : null;
    if (paid === "part" && (!paidPaise || paidPaise >= total)) return setError(paidPaise && paidPaise >= total ? "That's the full amount. Choose Paid in full." : "Enter how much was paid");
    setError(null);
    const used = new Set(filled.map((l) => l.materialId));
    let plan;
    try {
      plan = purchasePlan(planCtx(cid), {
        id: ids.purchase,
        vendor: { id: vendor.id, name: vendor.name },
        billDate,
        businessDate: today,
        ...(billNo.trim() ? { billNo: billNo.trim() } : {}),
        lines: filled.map((l) => {
          const opt = optionById.get(l.materialId!)!;
          return { lineId: l.lineId, materialId: opt.id, name: opt.name, qtyMilli: l.qtyMilli!, unit: opt.unit, amountPaise: stored(l)!, taxBps: l.taxBps };
        }),
        ...(adjust ? { adjustPaise: adjust } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(paidPaise ? { paidNow: { id: ids.payment, amountPaise: paidPaise, mode: way, ...(ref.trim() ? { ref: ref.trim() } : {}) } } : {}),
        newMaterials: drafts.filter((d) => used.has(d.id)).map((d) => ({ id: d.id, material: { name: d.name, unit: d.unit, taxBps: d.taxBps, active: true } })),
        // Each line adds to stock, in pieces for packs ("1 tray = 30 pcs").
        stockUnits: Object.fromEntries(materials.map((m) => [m.id, { unit: m.unit, ...(m.pack ? { pack: m.pack } : {}) }])),
        today,
      });
    } catch (err) {
      return setError(err instanceof Error ? err.message : "Couldn't save the bill.");
    }
    if (!(await run(plan, `Bill saved · ${rs(total)}`))) return;
    onSaved?.(ids.purchase);
    onOpenChange(false);
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={(o) => !pending && onOpenChange(o)}
      title={vendor ? `Purchase from ${vendor.name}` : "Record purchase"}
      className="sm:max-w-3xl"
      footer={
        <>
          <span className="mr-auto text-sm tabular-nums">
            <span className="text-muted-foreground">Total </span>
            <span className="font-semibold">{rs(total)}</span>
          </span>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="purchase-form" disabled={pending}>
            {pending ? <Loader2 className="animate-spin" data-icon="inline-start" aria-hidden /> : null}
            Save bill
          </Button>
        </>
      }
    >
      <form id="purchase-form" onSubmit={submit} className="flex flex-col gap-5" noValidate>
        <FieldRow className="sm:grid-cols-[minmax(0,1fr)_11rem_9rem]">
          <Field label="Vendor" htmlFor="p-vendor">
            <VendorCombobox id="p-vendor" vendors={vendors} value={vid} onChange={setVid} />
          </Field>
          <Field label="Bill date" htmlFor="p-date">
            <BizDateField id="p-date" value={billDate} onChange={setBillDate} max={today} />
          </Field>
          <Field label="Bill no." htmlFor="p-no">
            <Input id="p-no" value={billNo} onChange={(e) => setBillNo(e.target.value)} maxLength={30} autoComplete="off" />
          </Field>
        </FieldRow>

        <div className="flex flex-col gap-2">
          {lastBill || chips.length ? (
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Quick add">
              {lastBill ? (
                <Button type="button" variant="outline" size="sm" onClick={sameAsLast}>
                  <Copy data-icon="inline-start" aria-hidden />
                  Same as last bill · {bizDateLabel(lastBill.billDate)}
                </Button>
              ) : null}
              {chips.map((mid) => (
                <Button key={mid} type="button" variant="outline" size="sm" onClick={() => addMaterialLine(mid)}>
                  <Plus data-icon="inline-start" aria-hidden />
                  {optionById.get(mid)?.name}
                </Button>
              ))}
            </div>
          ) : null}
          <div className="hidden grid-cols-[minmax(0,1fr)_6rem_6.5rem_7rem_5.25rem_2.25rem] gap-2 px-1 text-xs font-medium text-muted-foreground sm:grid" aria-hidden>
            <span>Material</span>
            <span>Qty</span>
            <span>Rate</span>
            <span>Amount</span>
            <span>GST</span>
          </div>
          <ul className="flex flex-col" aria-label="Items on the bill">
            {lines.map((l, i) => (
              <LineRow
                key={l.lineId}
                index={i}
                line={l}
                options={options}
                preferred={preferred}
                last={l.materialId ? rates.get(l.materialId) : undefined}
                onChange={(next) => setLines((ls) => ls.map((x) => (x.lineId === l.lineId ? next : x)))}
                onMaterial={(mid) => setLines((ls) => ls.map((x) => (x.lineId === l.lineId ? lineFor(mid, { ...x, ratePaise: x.materialId === mid ? x.ratePaise : null, amountPaise: x.materialId === mid ? x.amountPaise : null }) : x)))}
                onAddMaterial={(d) => setDrafts((ds) => [...ds, d])}
                onRemove={() => setLines((ls) => (ls.length > 1 ? ls.filter((x) => x.lineId !== l.lineId) : [blankLine()]))}
              />
            ))}
          </ul>
          <Button type="button" variant="ghost" size="sm" className="-ml-2.5 self-start" onClick={() => setLines((ls) => [...ls, blankLine()])} disabled={lines.length >= 50}>
            <Plus data-icon="inline-start" aria-hidden />
            Add line
          </Button>
        </div>

        <div className="grid grid-cols-1 gap-4 rounded-xl border p-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <SwitchRow label="GST is added on top" checked={gstOnTop} onCheckedChange={setGstOnTop} />
            <Field label="Total on the bill" htmlFor="p-total">
              <MoneyInput id="p-total" value={billTotal} onChange={setBillTotal} placeholder={sum ? (sum / 100).toFixed(2) : "0.00"} />
            </Field>
          </div>
          <dl className="flex flex-col justify-end gap-1.5 text-sm tabular-nums">
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Items ({filled.length})</dt>
              <dd>{rs(sum)}</dd>
            </div>
            {adjust ? (
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Round off</dt>
                <dd className={cn(Math.abs(adjust) > 10000 && "text-brand")}>{adjust > 0 ? "+" : "−"}{rs(Math.abs(adjust))}</dd>
              </div>
            ) : null}
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">GST included</dt>
              <dd>{rs(gst)}</dd>
            </div>
            <div className="flex justify-between gap-4 border-t pt-1.5 font-semibold">
              <dt>Total</dt>
              <dd>{rs(total)}</dd>
            </div>
          </dl>
        </div>

        <Field label="Paid now">
          <ToggleGroup type="single" variant="outline" value={paid} onValueChange={(v) => v && setPaid(v as PaidNow)} aria-label="Paid now" className="flex-wrap">
            <ToggleGroupItem value="none" className="px-3">Not paid</ToggleGroupItem>
            <ToggleGroupItem value="full" className="px-3">Paid in full</ToggleGroupItem>
            <ToggleGroupItem value="part" className="px-3">Part paid</ToggleGroupItem>
          </ToggleGroup>
        </Field>
        {paid !== "none" ? (
          <FieldRow className={paid === "part" ? "sm:grid-cols-3" : undefined}>
            {paid === "part" ? (
              <Field label="Amount paid" htmlFor="p-paid">
                <MoneyInput id="p-paid" value={partPaise} onChange={setPartPaise} />
              </Field>
            ) : null}
            <Field label="Paid by" htmlFor="p-way">
              <SelectField id="p-way" value={way} onValueChange={setWay} options={WAY_OPTIONS} />
            </Field>
            <Field label={way === "cheque" ? "Cheque no." : "Reference"} htmlFor="p-ref">
              <Input id="p-ref" value={ref} onChange={(e) => setRef(e.target.value)} maxLength={40} autoComplete="off" placeholder={way === "upi" || way === "bank" ? "UTR" : undefined} />
            </Field>
          </FieldRow>
        ) : null}
        <Field label="Note" htmlFor="p-note">
          <Input id="p-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />
        </Field>
        <FormError error={error} />
      </form>
    </FormDialog>
  );
}

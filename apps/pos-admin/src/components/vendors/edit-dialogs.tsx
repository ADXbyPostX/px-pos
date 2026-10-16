"use client";

import { useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { canHavePack, inputUnitsFor, MATERIAL_UNIT_LABEL, MATERIAL_UNITS, purchaseEditPlan, rateLabel, TAX_RATES, upsertMaterialPlan, validateMaterial, type Material, type MaterialUnit, type Purchase } from "@px-pos/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldRow } from "@/components/shared/field";
import { FormDialog } from "@/components/shared/form-dialog";
import { FormError, IntInput, SelectField, SwitchRow } from "@/components/shared/form-controls";
import { StockQtyInput } from "@/components/inventory/stock-qty-input";
import { useClient } from "@/components/providers/client-provider";
import { usePrincipal } from "@/components/providers/principal-provider";
import type { WithId } from "@/lib/firebase/hooks";
import { newId } from "@/lib/ids";
import { useRunPlan } from "@/lib/run-plan";

const GST_OPTIONS = TAX_RATES.map((r) => ({ value: String(r), label: r === 0 ? "0% (exempt)" : rateLabel(r) }));

/** A bill's number and note can be corrected; anything else is voided and entered again. */
export function EditBillDialog({ bill, onOpenChange }: { bill: WithId<Purchase> | null; onOpenChange: (o: boolean) => void }) {
  const { cid } = useClient();
  const { planCtx } = usePrincipal();
  const { run, pending } = useRunPlan();
  const [billNo, setBillNo] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [seen, setSeen] = useState(bill?.id);
  if (seen !== bill?.id) {
    setSeen(bill?.id);
    setBillNo(bill?.billNo ?? "");
    setNote(bill?.note ?? "");
    setError(null);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!bill) return;
    let plan;
    try {
      plan = purchaseEditPlan(planCtx(cid), bill, { billNo, note });
    } catch (err) {
      return setError(err instanceof Error ? err.message : "Couldn't save.");
    }
    if (!plan.ops.length) return onOpenChange(false);
    if (await run(plan, "Bill updated")) onOpenChange(false);
  }

  return (
    <FormDialog
      open={Boolean(bill)}
      onOpenChange={(o) => !pending && onOpenChange(o)}
      title="Edit bill"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="edit-bill-form" disabled={pending}>
            {pending ? <Loader2 className="animate-spin" data-icon="inline-start" aria-hidden /> : null}
            Save
          </Button>
        </>
      }
    >
      <form id="edit-bill-form" onSubmit={submit} className="flex flex-col gap-5" noValidate>
        <Field label="Bill no." htmlFor="eb-no">
          <Input id="eb-no" value={billNo} onChange={(e) => setBillNo(e.target.value)} maxLength={30} autoFocus autoComplete="off" />
        </Field>
        <Field label="Note" htmlFor="eb-note">
          <Input id="eb-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />
        </Field>
        <FormError error={error} />
      </form>
    </FormDialog>
  );
}

/**
 * Add a material, or rename it, change its usual GST, pieces per pack, low-stock level or retire it.
 * Its unit is fixed once created (old bills use it); pieces per pack only come or go while it has
 * no stock.
 */
export function MaterialDialog({ open, material, onOpenChange, onHand = 0, onSaved }: { open?: boolean; material: WithId<Material> | null; onOpenChange: (o: boolean) => void; onHand?: number; onSaved?: (id: string) => void }) {
  const { cid } = useClient();
  const { planCtx } = usePrincipal();
  const { run, pending } = useRunPlan();
  const isOpen = open ?? Boolean(material);
  const [name, setName] = useState("");
  const [unit, setUnit] = useState<MaterialUnit>("kg");
  const [tax, setTax] = useState("0");
  const [pack, setPack] = useState<number | null>(null);
  const [lowAt, setLowAt] = useState<number | null>(null);
  const [lowUnit, setLowUnit] = useState<MaterialUnit | null>(null);
  const [active, setActive] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [seen, setSeen] = useState({ isOpen, id: material?.id });
  if (seen.isOpen !== isOpen || seen.id !== material?.id) {
    setSeen({ isOpen, id: material?.id });
    if (isOpen) {
      setName(material?.name ?? "");
      setUnit(material?.unit ?? "kg");
      setTax(String(material?.taxBps ?? 0));
      setPack(material?.pack ?? null);
      setLowAt(material?.lowAt ?? null);
      setLowUnit(null);
      setActive(material?.active ?? true);
      setError(null);
    }
  }
  const packs = canHavePack(unit);
  const stockAs = { unit, ...(packs && pack ? { pack } : {}) };

  async function submit(e: FormEvent) {
    e.preventDefault();
    const next = { name: name.trim(), unit, taxBps: Number(tax), active, ...(packs && pack ? { pack } : {}), ...(lowAt ? { lowAt } : {}) };
    const bad = validateMaterial(next);
    if (bad) return setError(bad);
    const id = material?.id ?? newId();
    let plan;
    try {
      plan = upsertMaterialPlan(planCtx(cid), { id, material: next, ...(material ? { before: material, onHand } : {}) });
    } catch (err) {
      return setError(err instanceof Error ? err.message : "Couldn't save.");
    }
    if (!plan.ops.length) return onOpenChange(false);
    if (await run(plan, material ? "Material saved" : `${next.name} added`)) {
      onSaved?.(id);
      onOpenChange(false);
    }
  }

  return (
    <FormDialog
      open={isOpen}
      onOpenChange={(o) => !pending && onOpenChange(o)}
      title={material ? `Edit ${material.name}` : "Add material"}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="material-form" disabled={pending}>
            {pending ? <Loader2 className="animate-spin" data-icon="inline-start" aria-hidden /> : null}
            {material ? "Save" : "Add material"}
          </Button>
        </>
      }
    >
      <form id="material-form" onSubmit={submit} className="flex flex-col gap-5" noValidate>
        <Field label="Name" htmlFor="m-name">
          <Input id="m-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoFocus placeholder={material ? undefined : "Milk"} />
        </Field>
        <FieldRow>
          <Field label="Bought in" htmlFor="m-unit">
            {material ? (
              <Input id="m-unit" value={MATERIAL_UNIT_LABEL[material.unit]} disabled readOnly />
            ) : (
              <SelectField id="m-unit" value={unit} onValueChange={(u) => setUnit(u as MaterialUnit)} options={MATERIAL_UNITS.map((u) => ({ value: u, label: MATERIAL_UNIT_LABEL[u] }))} />
            )}
          </Field>
          <Field label="GST on its bills" htmlFor="m-gst">
            <SelectField id="m-gst" value={tax} onValueChange={setTax} options={GST_OPTIONS} />
          </Field>
        </FieldRow>
        <FieldRow>
          {packs ? (
            <Field label={`Pieces in one ${MATERIAL_UNIT_LABEL[unit]}`} htmlFor="m-pack">
              <IntInput id="m-pack" value={pack} onChange={setPack} min={0} max={1000} placeholder="Not counted in pieces" />
            </Field>
          ) : null}
          <Field label="Low stock at" htmlFor="m-low">
            <StockQtyInput material={stockAs} value={lowAt} onChange={setLowAt} unit={lowUnit ?? inputUnitsFor(stockAs).at(-1)?.unit ?? null} onUnitChange={setLowUnit} aria-label="Low stock at" placeholder="Off" />
          </Field>
        </FieldRow>
        {material ? <SwitchRow label="Active" checked={active} onCheckedChange={setActive} /> : null}
        <FormError error={error} />
      </form>
    </FormDialog>
  );
}

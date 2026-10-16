"use client";

import { useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { MATERIAL_UNIT_LABEL, purchaseEditPlan, rateLabel, TAX_RATES, upsertMaterialPlan, validateMaterial, type Material, type Purchase } from "@px-pos/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldRow } from "@/components/shared/field";
import { FormDialog } from "@/components/shared/form-dialog";
import { FormError, SelectField, SwitchRow } from "@/components/shared/form-controls";
import { useClient } from "@/components/providers/client-provider";
import { usePrincipal } from "@/components/providers/principal-provider";
import type { WithId } from "@/lib/firebase/hooks";
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

/** Rename a material, change its usual GST or retire it. Its unit is fixed (old bills use it). */
export function MaterialDialog({ material, onOpenChange }: { material: WithId<Material> | null; onOpenChange: (o: boolean) => void }) {
  const { cid } = useClient();
  const { planCtx } = usePrincipal();
  const { run, pending } = useRunPlan();
  const [name, setName] = useState("");
  const [tax, setTax] = useState("0");
  const [active, setActive] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [seen, setSeen] = useState(material?.id);
  if (seen !== material?.id) {
    setSeen(material?.id);
    setName(material?.name ?? "");
    setTax(String(material?.taxBps ?? 0));
    setActive(material?.active ?? true);
    setError(null);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!material) return;
    const next = { name: name.trim(), unit: material.unit, taxBps: Number(tax), active };
    const bad = validateMaterial(next);
    if (bad) return setError(bad);
    let plan;
    try {
      plan = upsertMaterialPlan(planCtx(cid), { id: material.id, material: next, before: material });
    } catch (err) {
      return setError(err instanceof Error ? err.message : "Couldn't save.");
    }
    if (!plan.ops.length) return onOpenChange(false);
    if (await run(plan, "Material saved")) onOpenChange(false);
  }

  return (
    <FormDialog
      open={Boolean(material)}
      onOpenChange={(o) => !pending && onOpenChange(o)}
      title={material ? `Edit ${material.name}` : "Edit material"}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="material-form" disabled={pending}>
            {pending ? <Loader2 className="animate-spin" data-icon="inline-start" aria-hidden /> : null}
            Save
          </Button>
        </>
      }
    >
      <form id="material-form" onSubmit={submit} className="flex flex-col gap-5" noValidate>
        <Field label="Name" htmlFor="m-name">
          <Input id="m-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoFocus />
        </Field>
        <FieldRow>
          <Field label="Unit" htmlFor="m-unit">
            <Input id="m-unit" value={material ? MATERIAL_UNIT_LABEL[material.unit] : ""} disabled readOnly />
          </Field>
          <Field label="GST on its bills" htmlFor="m-gst">
            <SelectField id="m-gst" value={tax} onValueChange={setTax} options={GST_OPTIONS} />
          </Field>
        </FieldRow>
        <SwitchRow label="Active" checked={active} onCheckedChange={setActive} />
        <FormError error={error} />
      </form>
    </FormDialog>
  );
}

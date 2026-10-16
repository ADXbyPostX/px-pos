"use client";

import { useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { combinePlans, openingBalancePlan, upsertMaterialPlan, upsertVendorPlan, validateMaterial, validateVendor, type BizDate, type Material, type Paise, type Vendor, type WritePlan } from "@px-pos/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Field, FieldRow } from "@/components/shared/field";
import { FormDialog } from "@/components/shared/form-dialog";
import { FormError, IntInput, MoneyInput, SwitchRow } from "@/components/shared/form-controls";
import { BizDateField } from "@/components/shared/range-picker";
import { useClient } from "@/components/providers/client-provider";
import { usePrincipal } from "@/components/providers/principal-provider";
import type { WithId } from "@/lib/firebase/hooks";
import { newId } from "@/lib/ids";
import { useRunPlan } from "@/lib/run-plan";
import { MaterialPicker, type DraftMaterial } from "./pickers";

const TERMS = [0, 7, 15, 30] as const;
type Opening = "none" | "owe" | "advance";

/** Add a vendor, or edit one. A new vendor can start with what was already owed (or an advance). */
export function VendorDialog({ open, onOpenChange, vendor, materials, today, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; vendor: WithId<Vendor> | null; materials: WithId<Material>[]; today: BizDate; onSaved?: (id: string) => void }) {
  const { cid } = useClient();
  const { planCtx } = usePrincipal();
  const { run, pending } = useRunPlan();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [gstin, setGstin] = useState("");
  const [creditDays, setCreditDays] = useState<number | null>(7);
  const [custom, setCustom] = useState(false);
  const [materialIds, setMaterialIds] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<DraftMaterial[]>([]);
  const [note, setNote] = useState("");
  const [active, setActive] = useState(true);
  const [opening, setOpening] = useState<Opening>("none");
  const [openingPaise, setOpeningPaise] = useState<Paise | null>(null);
  const [asOf, setAsOf] = useState<BizDate>(today);
  const [error, setError] = useState<string | null>(null);

  // Reset when the dialog opens (or switches vendor) — adjusted during render.
  const [seen, setSeen] = useState({ open, id: vendor?.id });
  if (seen.open !== open || seen.id !== vendor?.id) {
    setSeen({ open, id: vendor?.id });
    if (open) {
      setName(vendor?.name ?? "");
      setPhone(vendor?.phone ?? "");
      setGstin(vendor?.gstin ?? "");
      const days = vendor?.creditDays ?? 7;
      setCreditDays(days);
      setCustom(!(TERMS as readonly number[]).includes(days));
      setMaterialIds(vendor?.materialIds ?? []);
      setDrafts([]);
      setNote(vendor?.note ?? "");
      setActive(vendor?.active ?? true);
      setOpening("none");
      setOpeningPaise(null);
      setAsOf(today);
      setError(null);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const profile = { name, phone: phone || undefined, gstin: gstin || undefined, materialIds, creditDays: creditDays ?? -1, note: note || undefined, active };
    const bad = validateVendor({ ...profile, name: name.trim(), phone: phone.trim() || undefined, gstin: gstin.trim().toUpperCase() || undefined });
    if (bad) return setError(bad);
    const used = drafts.filter((d) => materialIds.includes(d.id));
    for (const d of used) {
      const m = validateMaterial(d);
      if (m) return setError(`${d.name}: ${m}`);
    }
    if (!vendor && opening !== "none" && (openingPaise == null || openingPaise <= 0)) return setError("Enter the opening balance, or choose Nothing owed");
    setError(null);
    const ctx = planCtx(cid);
    const id = vendor?.id ?? newId();
    let saved: WritePlan;
    try {
      const vendorPlan = upsertVendorPlan(ctx, { id, vendor: profile, ...(vendor ? { before: vendor } : {}) });
      saved = combinePlans(vendorPlan.label, [...used.map((d) => upsertMaterialPlan(ctx, { id: d.id, material: { name: d.name, unit: d.unit, taxBps: d.taxBps, active: true } })), vendorPlan]);
    } catch (err) {
      return setError(err instanceof Error ? err.message : "Couldn't save the vendor.");
    }
    // The opening balance moves the vendor's totals: its own batch, after the vendor exists.
    const plans: WritePlan[] = [saved];
    if (!vendor && opening !== "none" && openingPaise) plans.push(openingBalancePlan(ctx, { id: newId(), vendor: { id, name: name.trim() }, asOf, amountPaise: opening === "owe" ? openingPaise : -openingPaise }));
    if (!(await run(plans.filter((p) => p.ops.length), vendor ? "Vendor saved" : `${name.trim()} added`))) return;
    onSaved?.(id);
    onOpenChange(false);
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={(o) => !pending && onOpenChange(o)}
      title={vendor ? `Edit ${vendor.name}` : "Add vendor"}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="vendor-form" disabled={pending}>
            {pending ? <Loader2 className="animate-spin" data-icon="inline-start" aria-hidden /> : null}
            {vendor ? "Save" : "Add vendor"}
          </Button>
        </>
      }
    >
      <form id="vendor-form" onSubmit={submit} className="flex flex-col gap-5" noValidate>
        <FieldRow>
          <Field label="Name" htmlFor="v-name">
            <Input id="v-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoFocus placeholder="Lakshmi Dairy" />
          </Field>
          <Field label="Phone" htmlFor="v-phone">
            <Input id="v-phone" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" maxLength={15} />
          </Field>
        </FieldRow>
        <Field label="What they supply" htmlFor="v-supplies">
          <MaterialPicker
            id="v-supplies"
            materials={materials}
            drafts={drafts}
            value={materialIds}
            onChange={(ids, d) => {
              setMaterialIds(ids);
              setDrafts(d);
            }}
          />
        </Field>
        <Field label="When you pay them">
          <div className="flex flex-wrap items-center gap-2">
            <ToggleGroup
              type="single"
              variant="outline"
              value={custom ? "custom" : String(creditDays)}
              onValueChange={(v) => {
                if (!v) return;
                if (v === "custom") {
                  setCustom(true);
                  return;
                }
                setCustom(false);
                setCreditDays(Number(v));
              }}
              aria-label="When you pay them"
              className="flex-wrap"
            >
              <ToggleGroupItem value="0" className="px-3">On delivery</ToggleGroupItem>
              {TERMS.slice(1).map((d) => (
                <ToggleGroupItem key={d} value={String(d)} className="px-3 tabular-nums">
                  {d} days
                </ToggleGroupItem>
              ))}
              <ToggleGroupItem value="custom" className="px-3">Other</ToggleGroupItem>
            </ToggleGroup>
            {custom ? <IntInput aria-label="Days of credit" value={creditDays} onChange={setCreditDays} min={0} max={90} className="w-20" placeholder="Days" /> : null}
          </div>
        </Field>
        <FieldRow>
          <Field label="GSTIN" htmlFor="v-gstin">
            <Input id="v-gstin" value={gstin} onChange={(e) => setGstin(e.target.value.toUpperCase())} maxLength={15} className="font-mono uppercase" />
          </Field>
          <Field label="Note" htmlFor="v-note">
            <Input id="v-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />
          </Field>
        </FieldRow>
        {vendor ? (
          <SwitchRow label="Active" checked={active} onCheckedChange={setActive} />
        ) : (
          <div className="flex flex-col gap-3 rounded-xl border p-4">
            <Field label="Already owed when you start">
              <ToggleGroup type="single" variant="outline" value={opening} onValueChange={(v) => v && setOpening(v as Opening)} aria-label="Opening balance" className="flex-wrap">
                <ToggleGroupItem value="none" className="px-3">Nothing</ToggleGroupItem>
                <ToggleGroupItem value="owe" className="px-3">We owe them</ToggleGroupItem>
                <ToggleGroupItem value="advance" className="px-3">They hold an advance</ToggleGroupItem>
              </ToggleGroup>
            </Field>
            {opening !== "none" ? (
              <FieldRow>
                <Field label="Amount" htmlFor="v-opening">
                  <MoneyInput id="v-opening" value={openingPaise} onChange={setOpeningPaise} />
                </Field>
                <Field label="As of" htmlFor="v-asof">
                  <BizDateField id="v-asof" value={asOf} onChange={setAsOf} max={today} />
                </Field>
              </FieldRow>
            ) : null}
          </div>
        )}
        {vendor && !active && vendor.purchasedPaise !== vendor.paidPaise ? <FormError error="This vendor still has a balance. It stays on the overview until it's settled." /> : null}
        <FormError error={error} />
      </form>
    </FormDialog>
  );
}

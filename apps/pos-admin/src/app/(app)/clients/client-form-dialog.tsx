"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { createClientPlan, del, fyFor, GST_STATES, makeClientId, stateName, updateClientPlan, validateClient, type Client, type TaxMode } from "@px-pos/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldRow } from "@/components/shared/field";
import { FormDialog } from "@/components/shared/form-dialog";
import { FormError, SelectField } from "@/components/shared/form-controls";
import { usePrincipal } from "@/components/providers/principal-provider";
import { cryptoRand } from "@/lib/ids";
import type { WithId } from "@/lib/firebase/hooks";
import { useRunPlan } from "@/lib/run-plan";

const TAX_MODES: Array<{ value: TaxMode; label: string }> = [
  { value: "regular", label: "Regular GST (tax invoice)" },
  { value: "composition", label: "Composition (bill of supply)" },
  { value: "unregistered", label: "Not GST registered" },
];

const blank = { name: "", legalName: "", city: "", stateCode: "", address: "", phone: "", gstin: "", fssai: "", taxMode: "regular" as TaxMode, invoicePrefix: "" };
type Form = typeof blank;

const toForm = (c: WithId<Client> | null | undefined): Form =>
  c
    ? { name: c.name, legalName: c.legalName, city: c.city, stateCode: c.stateCode, address: c.address, phone: c.phone ?? "", gstin: c.gstin ?? "", fssai: c.fssai, taxMode: c.taxMode, invoicePrefix: c.invoicePrefix }
    : blank;

/** Add a client, or edit one (pass `client`): outlet, legal and tax details. */
export function ClientFormDialog({ open, onOpenChange, client }: { open: boolean; onOpenChange: (o: boolean) => void; client?: WithId<Client> | null }) {
  const editing = Boolean(client);
  const [f, setF] = useState<Form>(() => toForm(client));
  // Refill when the dialog opens or switches client — adjusted during render.
  const [seen, setSeen] = useState({ open, id: client?.id ?? null });
  if (seen.open !== open || seen.id !== (client?.id ?? null)) {
    setSeen({ open, id: client?.id ?? null });
    if (open) setF(toForm(client));
  }
  const [error, setError] = useState<string | null>(null);
  // Financial year for the first-bill example (fixed for the life of the page).
  const [fy] = useState(() => fyFor(Date.now()));
  const { planCtx } = usePrincipal();
  const { run, pending } = useRunPlan();
  const router = useRouter();
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((s) => ({ ...s, [k]: v }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const input = {
      name: f.name.trim(),
      legalName: f.legalName.trim() || f.name.trim(),
      city: f.city.trim(),
      stateCode: f.stateCode,
      stateName: stateName(f.stateCode) ?? "",
      address: f.address.trim(),
      fssai: f.fssai.replace(/\s/g, ""),
      taxMode: f.taxMode,
      invoicePrefix: f.invoicePrefix.trim().toUpperCase(),
      ...(f.phone.trim() ? { phone: f.phone.trim() } : {}),
      ...(f.gstin.trim() ? { gstin: f.gstin.trim().toUpperCase() } : {}),
    };
    if (!input.city) return setError("City is required");
    const err = validateClient(input);
    if (err) return setError(err);
    setError(null);
    if (client) {
      // Cleared optional fields are removed from the doc (only if they were set).
      const patch: Partial<Client> = { ...input };
      if (!input.phone && client.phone) (patch as Record<string, unknown>).phone = del();
      if (!input.gstin && client.gstin) (patch as Record<string, unknown>).gstin = del();
      const ok = await run(updateClientPlan(planCtx(client.id), client, patch, "client.update"), `${input.name} updated`);
      if (ok) onOpenChange(false);
      return;
    }
    const cid = makeClientId(input.name, cryptoRand);
    const ok = await run(createClientPlan(planCtx(cid), input), `${input.name} created`);
    if (ok) {
      setF(blank);
      onOpenChange(false);
      router.push(`/c/${cid}/settings`);
    }
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={(o) => {
        if (!pending) {
          setError(null);
          onOpenChange(o);
        }
      }}
      title={editing ? `Edit ${client?.name ?? "client"}` : "Add client"}
      className="sm:max-w-2xl"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form="client-form" disabled={pending}>
            {pending ? <Loader2 className="animate-spin" data-icon="inline-start" aria-hidden /> : null}
            {editing ? "Save changes" : "Create client"}
          </Button>
        </>
      }
    >
      <form id="client-form" onSubmit={submit} className="flex flex-col gap-5" noValidate>
        <FieldRow>
          <Field label="Outlet name" htmlFor="c-name">
            <Input id="c-name" value={f.name} onChange={(e) => set("name", e.target.value)} autoFocus={!editing} maxLength={60} />
          </Field>
          <Field label="Legal name (on bills)" htmlFor="c-legal">
            <Input id="c-legal" value={f.legalName} onChange={(e) => set("legalName", e.target.value)} placeholder={f.name || "Company Pvt Ltd"} maxLength={100} />
          </Field>
        </FieldRow>
        <FieldRow>
          <Field label="City" htmlFor="c-city">
            <Input id="c-city" value={f.city} onChange={(e) => set("city", e.target.value)} maxLength={40} />
          </Field>
          <Field label="State" htmlFor="c-state">
            <SelectField id="c-state" value={f.stateCode} onValueChange={(v) => set("stateCode", v)} options={GST_STATES.map((s) => ({ value: s.code, label: `${s.name} (${s.code})` }))} placeholder="Choose state" />
          </Field>
        </FieldRow>
        <Field label="Address" htmlFor="c-address">
          <Textarea id="c-address" value={f.address} onChange={(e) => set("address", e.target.value)} rows={2} maxLength={200} />
        </Field>
        <FieldRow>
          <Field label="Tax" htmlFor="c-tax">
            <SelectField id="c-tax" value={f.taxMode} onValueChange={(v) => set("taxMode", v)} options={TAX_MODES} />
          </Field>
          <Field label="GSTIN" htmlFor="c-gstin">
            <Input id="c-gstin" value={f.gstin} onChange={(e) => set("gstin", e.target.value.toUpperCase())} maxLength={15} className="font-mono uppercase" disabled={f.taxMode === "unregistered"} />
          </Field>
        </FieldRow>
        <FieldRow>
          <Field label="FSSAI licence no." htmlFor="c-fssai">
            <Input id="c-fssai" value={f.fssai} onChange={(e) => set("fssai", e.target.value)} inputMode="numeric" maxLength={14} className="font-mono" />
          </Field>
          <Field label="Phone" htmlFor="c-phone">
            <Input id="c-phone" value={f.phone} onChange={(e) => set("phone", e.target.value)} inputMode="tel" maxLength={15} />
          </Field>
        </FieldRow>
        <FieldRow>
          <Field label="Invoice prefix (0–2 letters)" htmlFor="c-prefix">
            <Input id="c-prefix" value={f.invoicePrefix} onChange={(e) => set("invoicePrefix", e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 2))} className="font-mono uppercase" placeholder="e.g. DC" />
          </Field>
          <div className="flex flex-col justify-end gap-1 pb-2 text-xs text-muted-foreground" aria-live="polite">
            <span>
              {editing ? "Terminals paired from now bill as: " : "First bill: "}
              <span className="font-mono text-foreground">{`${f.invoicePrefix}1/${fy}/000001`}</span>
            </span>
          </div>
        </FieldRow>
        <FormError error={error} />
      </form>
    </FormDialog>
  );
}

"use client";

import { useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { upsertCategoryPlan, type Category, type Station } from "@px-pos/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldRow } from "@/components/shared/field";
import { FormDialog } from "@/components/shared/form-dialog";
import { FormError, SelectField, SwitchRow } from "@/components/shared/form-controls";
import { useClient } from "@/components/providers/client-provider";
import { usePrincipal } from "@/components/providers/principal-provider";
import type { WithId } from "@/lib/firebase/hooks";
import { newId } from "@/lib/ids";
import { useRunPlan } from "@/lib/run-plan";

export const STATIONS: Array<{ value: Station; label: string }> = [
  { value: "kitchen", label: "Kitchen" },
  { value: "bar", label: "Bar" },
  { value: "beverage", label: "Beverage counter" },
];

export function CategoryDialog({ open, onOpenChange, category, nextSort }: { open: boolean; onOpenChange: (o: boolean) => void; category: WithId<Category> | null; nextSort: number }) {
  const { cid } = useClient();
  const { planCtx } = usePrincipal();
  const { run, pending } = useRunPlan();
  const [name, setName] = useState(category?.name ?? "");
  const [station, setStation] = useState<Station>(category?.station ?? "kitchen");
  const [active, setActive] = useState(category?.active ?? true);
  const [error, setError] = useState<string | null>(null);

  // Reset the form when the dialog opens (or the category changes while open) — adjusted during render.
  const [seen, setSeen] = useState({ open, category });
  if (seen.open !== open || seen.category?.id !== category?.id) {
    setSeen({ open, category });
    if (open) {
      setName(category?.name ?? "");
      setStation(category?.station ?? "kitchen");
      setActive(category?.active ?? true);
      setError(null);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError("Name is required");
    const ok = await run(upsertCategoryPlan(planCtx(cid), category?.id ?? newId(), { name: name.trim(), station, active, sort: category?.sort ?? nextSort }, !category), category ? "Category saved" : "Category added");
    if (ok) onOpenChange(false);
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={(o) => !pending && onOpenChange(o)}
      title={category ? "Edit category" : "Add category"}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form="cat-form" disabled={pending}>
            {pending ? <Loader2 className="animate-spin" data-icon="inline-start" aria-hidden /> : null}
            Save
          </Button>
        </>
      }
    >
      <form id="cat-form" onSubmit={submit} className="flex flex-col gap-5" noValidate>
        <FieldRow>
          <Field label="Name" htmlFor="cat-name">
            <Input id="cat-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoFocus />
          </Field>
          <Field label="KOT goes to" htmlFor="cat-station">
            <SelectField id="cat-station" value={station} onValueChange={setStation} options={STATIONS} />
          </Field>
        </FieldRow>
        <SwitchRow label="Shown on the menu" checked={active} onCheckedChange={setActive} />
        <FormError error={error} />
      </form>
    </FormDialog>
  );
}

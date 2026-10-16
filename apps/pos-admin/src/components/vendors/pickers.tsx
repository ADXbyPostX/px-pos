"use client";

import { useState } from "react";
import { Check, ChevronLeft, ChevronsUpDown, Plus, X } from "lucide-react";
import { guessUnit, MATERIAL_UNIT_LABEL, MATERIAL_UNITS, rateLabel, TAX_RATES, vendorBalance, type Material, type MaterialUnit, type Vendor } from "@px-pos/core";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Field, FieldRow } from "@/components/shared/field";
import { SelectField } from "@/components/shared/form-controls";
import type { WithId } from "@/lib/firebase/hooks";
import { newId } from "@/lib/ids";
import { cn } from "@/lib/utils";
import { rs } from "./vendor-status";

/** A material typed in a form and not saved yet (saved in the same batch as the form). */
export interface DraftMaterial {
  id: string;
  name: string;
  unit: MaterialUnit;
  taxBps: number;
}

export type MaterialOption = { id: string; name: string; unit: MaterialUnit; taxBps: number; draft?: boolean };

const GST_OPTIONS = TAX_RATES.map((r) => ({ value: String(r), label: r === 0 ? "0% (exempt)" : rateLabel(r) }));
const UNIT_OPTIONS = MATERIAL_UNITS.map((u) => ({ value: u, label: MATERIAL_UNIT_LABEL[u] }));

/** Pick a vendor: active ones, each with what's owed. */
export function VendorCombobox({ id, vendors, value, onChange, disabled }: { id?: string; vendors: WithId<Vendor>[]; value: string | null; onChange: (id: string) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const current = vendors.find((v) => v.id === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button id={id} type="button" variant="outline" role="combobox" aria-expanded={open} className="w-full justify-between font-normal" disabled={disabled}>
          <span className={cn("truncate", !current && "text-muted-foreground")}>{current?.name ?? "Choose a vendor"}</span>
          <ChevronsUpDown className="size-4 text-muted-foreground" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-(--radix-popover-trigger-width) min-w-64 p-0">
        <Command>
          <CommandInput placeholder="Find a vendor…" />
          <CommandList>
            <CommandEmpty>No vendors found.</CommandEmpty>
            <CommandGroup>
              {vendors
                .filter((v) => v.active || v.id === value)
                .map((v) => {
                  const bal = vendorBalance(v);
                  return (
                    <CommandItem
                      key={v.id}
                      value={`${v.name} ${v.phone ?? ""} ${v.id}`}
                      onSelect={() => {
                        onChange(v.id);
                        setOpen(false);
                      }}
                      className="gap-2"
                    >
                      <span className="min-w-0 flex-1 truncate">{v.name}</span>
                      <span className="text-xs text-muted-foreground tabular-nums">{bal > 0 ? `to pay ${rs(bal)}` : bal < 0 ? `advance ${rs(-bal)}` : "settled"}</span>
                      {v.id === value ? <Check className="size-4 text-brand" aria-hidden /> : null}
                    </CommandItem>
                  );
                })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** The small form behind 'Add "…"': unit (guessed from the name) and the usual GST. */
function NewMaterialForm({ name, onBack, onAdd }: { name: string; onBack: () => void; onAdd: (d: DraftMaterial) => void }) {
  const [unit, setUnit] = useState<MaterialUnit>(() => guessUnit(name));
  const [tax, setTax] = useState("0");
  return (
    <div className="flex flex-col gap-3 p-3">
      <p className="text-sm font-medium">Add “{name.trim()}”</p>
      <FieldRow className="sm:grid-cols-2">
        <Field label="Unit">
          <SelectField aria-label="Unit" value={unit} onValueChange={(v) => setUnit(v as MaterialUnit)} options={UNIT_OPTIONS} />
        </Field>
        <Field label="GST on its bills">
          <SelectField aria-label="GST on its bills" value={tax} onValueChange={setTax} options={GST_OPTIONS} />
        </Field>
      </FieldRow>
      <div className="flex justify-between gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onBack}>
          <ChevronLeft data-icon="inline-start" aria-hidden />
          Back
        </Button>
        <Button type="button" size="sm" onClick={() => onAdd({ id: newId(), name: name.trim(), unit, taxBps: Number(tax) })}>
          Add material
        </Button>
      </div>
    </div>
  );
}

/** Everything typed so far that doesn't match a material exactly can be added. */
const canAdd = (q: string, options: MaterialOption[]) => q.trim().length > 0 && q.trim().length <= 40 && !options.some((o) => o.name.toLowerCase() === q.trim().toLowerCase());

/** What a vendor supplies: pick several, or add new ones on the spot. */
export function MaterialPicker({ id, materials, drafts, value, onChange }: { id?: string; materials: WithId<Material>[]; drafts: DraftMaterial[]; value: string[]; onChange: (ids: string[], drafts: DraftMaterial[]) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState<string | null>(null);
  const options: MaterialOption[] = [...materials.filter((m) => m.active || value.includes(m.id)), ...drafts.map((d) => ({ ...d, draft: true }))];
  const byId = new Map(options.map((o) => [o.id, o]));
  const toggle = (mid: string) => onChange(value.includes(mid) ? value.filter((x) => x !== mid) : [...value, mid], drafts);
  return (
    <div className="flex flex-col gap-2">
      <Popover
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) {
            setAdding(null);
            setQ("");
          }
        }}
      >
        <PopoverTrigger asChild>
          <Button id={id} type="button" variant="outline" role="combobox" aria-expanded={open} className="w-full justify-between font-normal">
            <span className="truncate text-muted-foreground">{value.length ? `${value.length} selected` : "Milk, sugar, gas…"}</span>
            <ChevronsUpDown className="size-4 text-muted-foreground" aria-hidden />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-(--radix-popover-trigger-width) min-w-72 p-0">
          {adding != null ? (
            <NewMaterialForm
              name={adding}
              onBack={() => setAdding(null)}
              onAdd={(d) => {
                onChange([...value, d.id], [...drafts, d]);
                setAdding(null);
                setQ("");
              }}
            />
          ) : (
            <Command>
              <CommandInput placeholder="Find or add a material…" value={q} onValueChange={setQ} />
              <CommandList>
                <CommandEmpty>{q.trim() ? "No match." : "No materials yet."}</CommandEmpty>
                <CommandGroup>
                  {options.map((m) => (
                    <CommandItem key={m.id} value={`${m.name} ${m.id}`} onSelect={() => toggle(m.id)} className="gap-2">
                      <span className="min-w-0 flex-1 truncate">{m.name}</span>
                      <span className="text-xs text-muted-foreground">{MATERIAL_UNIT_LABEL[m.unit]}</span>
                      {value.includes(m.id) ? <Check className="size-4 text-brand" aria-hidden /> : <span className="size-4" />}
                    </CommandItem>
                  ))}
                </CommandGroup>
                {canAdd(q, options) ? (
                  <>
                    <CommandSeparator />
                    <CommandGroup>
                      <CommandItem value={`__add ${q}`} onSelect={() => setAdding(q)}>
                        <Plus aria-hidden />
                        Add “{q.trim()}”
                      </CommandItem>
                    </CommandGroup>
                  </>
                ) : null}
              </CommandList>
            </Command>
          )}
        </PopoverContent>
      </Popover>
      {value.length ? (
        <ul className="flex flex-wrap gap-1.5" aria-label="Supplies">
          {value.map((mid) => {
            const m = byId.get(mid);
            if (!m) return null;
            return (
              <li key={mid} className="inline-flex h-7 items-center gap-1 rounded-md border pr-1 pl-2 text-xs">
                {m.name}
                <button type="button" onClick={() => toggle(mid)} aria-label={`Remove ${m.name}`} className="inline-flex size-5 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground">
                  <X className="size-3.5" aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

/** One material for a bill line: the vendor's usual ones first, then everything, or add a new one. */
export function MaterialCombobox({ id, options, preferred, value, onChange, onAdd, "aria-label": ariaLabel }: { id?: string; options: MaterialOption[]; preferred: string[]; value: string | null; onChange: (id: string) => void; onAdd: (d: DraftMaterial) => void; "aria-label"?: string }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState<string | null>(null);
  const current = options.find((o) => o.id === value);
  const mine = options.filter((o) => preferred.includes(o.id));
  const rest = options.filter((o) => !preferred.includes(o.id));
  const item = (m: MaterialOption) => (
    <CommandItem
      key={m.id}
      value={`${m.name} ${m.id}`}
      onSelect={() => {
        onChange(m.id);
        setOpen(false);
      }}
      className="gap-2"
    >
      <span className="min-w-0 flex-1 truncate">{m.name}</span>
      <span className="text-xs text-muted-foreground">{MATERIAL_UNIT_LABEL[m.unit]}</span>
      {m.id === value ? <Check className="size-4 text-brand" aria-hidden /> : null}
    </CommandItem>
  );
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setAdding(null);
          setQ("");
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button id={id} type="button" variant="outline" role="combobox" aria-expanded={open} aria-label={ariaLabel} className="w-full justify-between font-normal">
          <span className={cn("truncate", !current && "text-muted-foreground")}>{current?.name ?? "Material"}</span>
          <ChevronsUpDown className="size-4 text-muted-foreground" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        {adding != null ? (
          <NewMaterialForm
            name={adding}
            onBack={() => setAdding(null)}
            onAdd={(d) => {
              onAdd(d);
              onChange(d.id);
              setOpen(false);
            }}
          />
        ) : (
          <Command>
            <CommandInput placeholder="Find or add a material…" value={q} onValueChange={setQ} />
            <CommandList>
              <CommandEmpty>{q.trim() ? "No match." : "No materials yet."}</CommandEmpty>
              {mine.length ? <CommandGroup heading="Usually from this vendor">{mine.map(item)}</CommandGroup> : null}
              {rest.length ? <CommandGroup heading={mine.length ? "All materials" : undefined}>{rest.map(item)}</CommandGroup> : null}
              {canAdd(q, options) ? (
                <>
                  <CommandSeparator />
                  <CommandGroup>
                    <CommandItem value={`__add ${q}`} onSelect={() => setAdding(q)}>
                      <Plus aria-hidden />
                      Add “{q.trim()}”
                    </CommandItem>
                  </CommandGroup>
                </>
              ) : null}
            </CommandList>
          </Command>
        )}
      </PopoverContent>
    </Popover>
  );
}

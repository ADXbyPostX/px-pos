"use client";

import { useState, type FormEvent } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import {
  businessDateFor,
  combinePlans,
  itemPhotoPlan,
  MODE_LABEL,
  inputUnitsFor,
  ORDER_MODES,
  rateLabel,
  RECIPE_BASE,
  TAX_RATES,
  upsertItemPlan,
  upsertMaterialPlan,
  validateItem,
  type Category,
  type FoodType,
  type Item,
  type ItemInput,
  type ItemRecipe,
  type Material,
  type OrderMode,
  type Paise,
  type PricePoint,
  type Unit,
  type Variant,
  type WritePlan,
} from "@px-pos/core";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Field, FieldRow } from "@/components/shared/field";
import { FormError, IntInput, MoneyInput, SelectField, SwitchRow } from "@/components/shared/form-controls";
import { FoodMark } from "@/components/shared/money";
import { RecordSheet } from "@/components/shared/record-sheet";
import { useClient } from "@/components/providers/client-provider";
import { usePrincipal } from "@/components/providers/principal-provider";
import type { WithId } from "@/lib/firebase/hooks";
import { newId } from "@/lib/ids";
import type { PreparedPhoto } from "@/lib/photo";
import { useRunPlan } from "@/lib/run-plan";
import type { DraftMaterial } from "@/components/vendors/pickers";
import { copyLines, finishedLines, FormulaEditor, type FormulaDraft } from "./formula-editor";
import { PhotoField } from "./item-photo";

type StockMode = "none" | "count" | "formula";

const UNITS: Array<{ value: Unit; label: string }> = [
  { value: "plate", label: "Plate" },
  { value: "pcs", label: "Piece" },
  { value: "portion", label: "Portion" },
  { value: "g", label: "Gram" },
  { value: "ml", label: "Millilitre" },
];

type VariantDraft = { id: string; name: string; price: Paise | null };
/** Photo edits wait for Save, then go out in the same batch as the item. */
type PhotoDraft = { kind: "keep" } | { kind: "set"; photo: PreparedPhoto } | { kind: "remove" };

interface Draft {
  name: string;
  shortName: string;
  code: string;
  categoryId: string;
  foodType: FoodType;
  price: Paise | null;
  variants: VariantDraft[];
  /** Explicit GST slab for this item (bps as a string, for the Select). */
  taxBps: string;
  modes: OrderMode[];
  stockMode: StockMode;
  formula: FormulaDraft;
  /** Materials added from the formula editor, saved with the item. */
  newMaterials: DraftMaterial[];
  unit: Unit;
  lowAt: number | null;
  openingQty: number | null;
  available: boolean;
  active: boolean;
  photo: PhotoDraft;
}

/** The outlet default when it is a valid slab, else 5% (standalone restaurant service). */
const initialRate = (defaultTaxBps: number) => String((TAX_RATES as readonly number[]).includes(defaultTaxBps) ? defaultTaxBps : 500);

/** A saved formula as editor lines, in the unit that suits each material (ml for milk kept in L). */
function formulaDraft(recipe: ItemRecipe | undefined, materials: ReadonlyMap<string, Pick<Material, "unit" | "pack">>): FormulaDraft {
  const out: FormulaDraft = {};
  for (const [key, lines] of Object.entries(recipe ?? {})) {
    out[key] = lines.map((l) => {
      const m = materials.get(l.materialId);
      return { lineId: newId(8), materialId: l.materialId, qtyMicro: l.qtyMicro, unit: m ? (inputUnitsFor(m)[0]?.unit ?? null) : null };
    });
  }
  return out;
}

function toDraft(item: WithId<Item> | null, categoryId: string, enabledModes: OrderMode[], defaultTaxBps: number, materials: ReadonlyMap<string, Pick<Material, "unit" | "pack">>): Draft {
  if (!item) {
    return { name: "", shortName: "", code: "", categoryId, foodType: "veg", price: null, variants: [], taxBps: initialRate(defaultTaxBps), modes: enabledModes, stockMode: "none", formula: {}, newMaterials: [], unit: "plate", lowAt: 5, openingQty: null, available: true, active: true, photo: { kind: "keep" } };
  }
  const hasFormula = Object.values(item.recipe ?? {}).some((l) => l.length > 0);
  return {
    name: item.name,
    shortName: item.shortName ?? "",
    code: item.code ?? "",
    categoryId: item.categoryId,
    foodType: item.foodType,
    price: item.pricePaise,
    variants: item.variants.map((v) => ({ id: v.id, name: v.name, price: v.pricePaise })),
    // Legacy items without a rate are shown (and saved) at the outlet default.
    taxBps: item.taxBps == null ? initialRate(defaultTaxBps) : String(item.taxBps),
    modes: item.modes,
    stockMode: hasFormula ? "formula" : item.trackStock ? "count" : "none",
    formula: formulaDraft(item.recipe, materials),
    newMaterials: [],
    unit: item.unit,
    lowAt: item.lowAt,
    openingQty: null,
    available: item.available,
    active: item.active,
    photo: { kind: "keep" },
  };
}

/** Add / edit a menu item: rates, variants, GST, modes, stock. */
export function ItemSheet({
  open,
  onOpenChange,
  item,
  photo,
  categories,
  defaultCategoryId,
  nextSort,
  materials,
  rates,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  item: WithId<Item> | null;
  /** The item's current photo (data URI), if any. */
  photo: string | null;
  categories: Array<WithId<Category>>;
  defaultCategoryId: string;
  nextSort: number;
  /** Raw materials for formulas, and the last price paid for each (cost per serving). */
  materials: Array<WithId<Material>>;
  rates: ReadonlyMap<string, PricePoint>;
}) {
  const materialById = new Map(materials.map((m) => [m.id, m]));
  const { cid, client } = useClient();
  const { planCtx } = usePrincipal();
  const { run, pending } = useRunPlan();
  const enabledModes = ORDER_MODES.filter((m) => client.orderModes[m]);
  const [d, setD] = useState<Draft>(() => toDraft(item, defaultCategoryId, enabledModes, client.defaultTaxBps, materialById));
  const [error, setError] = useState<string | null>(null);

  // Reset the draft when the sheet opens or switches record — adjusted during render. Compared by
  // value: live snapshots re-create `item`/`client` objects on every change anywhere in the
  // collection, and that must not wipe an edit in progress.
  const resetOn = { open, itemId: item?.id ?? null, defaultCategoryId, modes: enabledModes.join(",") };
  const [seen, setSeen] = useState(resetOn);
  if (seen.open !== open || seen.itemId !== resetOn.itemId || seen.defaultCategoryId !== defaultCategoryId || seen.modes !== resetOn.modes) {
    setSeen(resetOn);
    if (open) {
      setD(toDraft(item, defaultCategoryId, enabledModes, client.defaultTaxBps, materialById));
      setError(null);
    }
  }

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((s) => ({ ...s, [k]: v }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const variants: Variant[] = d.variants.map((v) => ({ id: v.id, name: v.name.trim(), pricePaise: v.price ?? 0 }));
    const basePrice = variants.length ? Math.min(...variants.map((v) => v.pricePaise)) : d.price;
    // The formula, one per size: a size never filled in is a copy of the first.
    const recipe: ItemRecipe = {};
    if (d.stockMode === "formula") {
      const keys = variants.length ? variants.map((v) => v.id) : [RECIPE_BASE];
      const firstKey = keys[0]!;
      const firstLines = d.formula[firstKey] ?? Object.values(d.formula)[0];
      for (const k of keys) recipe[k] = finishedLines(d.formula[k] ?? copyLines(firstLines));
    }
    const next: ItemInput = {
      name: d.name.trim(),
      ...(d.shortName.trim() ? { shortName: d.shortName.trim() } : {}),
      ...(d.code.trim() ? { code: d.code.trim().toUpperCase() } : {}),
      categoryId: d.categoryId,
      sort: item?.sort ?? nextSort,
      foodType: d.foodType,
      pricePaise: basePrice ?? 0,
      variants,
      taxBps: Number(d.taxBps),
      modes: d.modes,
      trackStock: d.stockMode === "count",
      unit: d.unit,
      lowAt: d.lowAt ?? 0,
      available: d.available,
      active: d.active,
      recipe,
    };
    if (d.stockMode === "formula" && !Object.values(recipe).some((l) => l.length)) return setError("Add at least one material to the formula");
    const err = validateItem(next);
    if (err) return setError(err);
    setError(null);
    const id = item?.id ?? newId();
    const ctx = planCtx(cid);
    const itemPlan = upsertItemPlan(ctx, {
      id,
      item: next,
      ...(item ? { before: item } : {}),
      ...(!item && d.stockMode === "count" && d.openingQty ? { openingQty: d.openingQty, businessDate: businessDateFor(Date.now(), client.day.cutoffMin) } : {}),
    });
    // Materials first added in this formula go out in the same batch as the item.
    const usedIds = new Set(Object.values(recipe).flatMap((ls) => ls.map((l) => l.materialId)));
    let materialPlans: WritePlan[];
    try {
      materialPlans = d.newMaterials.filter((m) => usedIds.has(m.id)).map((m) => upsertMaterialPlan(ctx, { id: m.id, material: { name: m.name, unit: m.unit, taxBps: m.taxBps, active: true } }));
    } catch (e) {
      return setError(e instanceof Error ? e.message : "Couldn't add the material.");
    }
    const photoPlan =
      d.photo.kind === "set"
        ? itemPhotoPlan(ctx, { itemId: id, itemName: next.name, photo: d.photo.photo, hadPhoto: Boolean(photo) })
        : d.photo.kind === "remove" && photo
          ? itemPhotoPlan(ctx, { itemId: id, itemName: next.name, photo: null, hadPhoto: true })
          : null;
    const extra = [...materialPlans, ...(photoPlan ? [photoPlan] : [])];
    const ok = await run(extra.length ? combinePlans(`Save ${next.name}`, [...materialPlans, itemPlan, ...(photoPlan ? [photoPlan] : [])]) : itemPlan, item ? `${next.name} saved` : `${next.name} added to the menu`);
    if (ok) onOpenChange(false);
  }

  return (
    <RecordSheet
      open={open}
      onOpenChange={(o) => !pending && onOpenChange(o)}
      title={item ? item.name : "New item"}
      meta={item ? `Rev ${item.rev}` : undefined}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form="item-form" disabled={pending}>
            {pending ? <Loader2 className="animate-spin" data-icon="inline-start" aria-hidden /> : null}
            {item ? "Save" : "Add item"}
          </Button>
        </>
      }
    >
      <form id="item-form" onSubmit={submit} className="flex flex-col gap-5" noValidate>
        <Field label="Photo">
          <PhotoField
            uri={d.photo.kind === "set" ? d.photo.photo.uri : d.photo.kind === "remove" ? null : photo}
            name={d.name}
            onChange={(p) => set("photo", { kind: "set", photo: p })}
            onRemove={() => set("photo", { kind: "remove" })}
          />
        </Field>
        <Field label="Name" htmlFor="i-name">
          <Input id="i-name" value={d.name} onChange={(e) => set("name", e.target.value)} maxLength={60} autoFocus={!item} />
        </Field>
        <FieldRow>
          <Field label="Short name (KOT)" htmlFor="i-short">
            <Input id="i-short" value={d.shortName} onChange={(e) => set("shortName", e.target.value)} maxLength={24} placeholder="Optional" />
          </Field>
          <Field label="Code" htmlFor="i-code">
            <Input id="i-code" value={d.code} onChange={(e) => set("code", e.target.value.toUpperCase())} maxLength={10} className="font-mono uppercase" placeholder="Optional" />
          </Field>
        </FieldRow>
        <Field label="Category" htmlFor="i-cat">
          <SelectField id="i-cat" value={d.categoryId} onValueChange={(v) => set("categoryId", v)} options={categories.map((c) => ({ value: c.id, label: c.active ? c.name : `${c.name} (hidden)` }))} placeholder="Choose category" />
        </Field>
        <Field label="Type">
          <ToggleGroup type="single" variant="outline" value={d.foodType} onValueChange={(v) => v && set("foodType", v as FoodType)} className="w-full" aria-label="Food type">
            {(["veg", "nonveg", "egg"] as const).map((t) => (
              <ToggleGroupItem key={t} value={t} className="flex-1 gap-1.5">
                <FoodMark type={t} />
                {t === "veg" ? "Veg" : t === "egg" ? "Egg" : "Non-veg"}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </Field>

        <div className="flex flex-col gap-3 rounded-xl border p-4">
          {d.variants.length === 0 ? (
            <Field label="Price" htmlFor="i-price">
              <MoneyInput id="i-price" value={d.price} onChange={(p) => set("price", p)} />
            </Field>
          ) : (
            <div className="flex flex-col gap-2">
              <Label>Variants and prices</Label>
              {d.variants.map((v, idx) => (
                <div key={v.id} className="flex items-center gap-2">
                  <Input
                    value={v.name}
                    onChange={(e) => set("variants", d.variants.map((x, j) => (j === idx ? { ...x, name: e.target.value } : x)))}
                    placeholder={idx === 0 ? "Half" : "Full"}
                    aria-label={`Variant ${idx + 1} name`}
                    maxLength={30}
                    className="flex-1"
                  />
                  <MoneyInput value={v.price} onChange={(p) => set("variants", d.variants.map((x, j) => (j === idx ? { ...x, price: p } : x)))} className="w-32" />
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove ${v.name || "variant"}`} onClick={() => set("variants", d.variants.filter((_, j) => j !== idx))}>
                    <Trash2 aria-hidden />
                  </Button>
                </div>
              ))}
            </div>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() => {
              const seed = d.variants.length === 0 && d.price != null ? [{ id: newId(8), name: "Regular", price: d.price }] : [];
              set("variants", [...d.variants, ...seed, { id: newId(8), name: "", price: null }]);
            }}
          >
            <Plus data-icon="inline-start" aria-hidden />
            {d.variants.length ? "Add variant" : "Sizes / variants (regular, large…)"}
          </Button>
        </div>

        <FieldRow>
          <Field label="GST rate" htmlFor="i-tax">
            <SelectField
              id="i-tax"
              value={d.taxBps}
              onValueChange={(v) => set("taxBps", v)}
              options={TAX_RATES.map((r) => ({ value: String(r), label: r === 0 ? "0% (nil / exempt)" : rateLabel(r) }))}
            />
          </Field>
          <Field label="Sold in">
            <div className="flex flex-wrap gap-x-4 gap-y-2 pt-1.5">
              {ORDER_MODES.map((m) => {
                const id = `i-mode-${m}`;
                return (
                  <div key={m} className="flex items-center gap-2">
                    <Checkbox id={id} checked={d.modes.includes(m)} onCheckedChange={(v) => set("modes", v ? [...new Set([...d.modes, m])] : d.modes.filter((x) => x !== m))} />
                    <Label htmlFor={id} className={client.orderModes[m] ? "font-normal" : "font-normal text-muted-foreground"}>
                      {MODE_LABEL[m]}
                    </Label>
                  </div>
                );
              })}
            </div>
          </Field>
        </FieldRow>

        <div className="flex flex-col gap-3 rounded-xl border p-4">
          <Field label="Stock">
            <ToggleGroup type="single" variant="outline" value={d.stockMode} onValueChange={(v) => v && set("stockMode", v as StockMode)} aria-label="Stock" className="flex-wrap">
              <ToggleGroupItem value="none" className="px-3">Not tracked</ToggleGroupItem>
              <ToggleGroupItem value="count" className="px-3">Count pieces</ToggleGroupItem>
              <ToggleGroupItem value="formula" className="px-3">Formula</ToggleGroupItem>
            </ToggleGroup>
          </Field>
          {d.stockMode === "formula" ? (
            <FormulaEditor
              sizes={d.variants.length ? d.variants.map((v) => ({ key: v.id, name: v.name.trim(), pricePaise: v.price })) : [{ key: RECIPE_BASE, name: "", pricePaise: d.price }]}
              value={d.formula}
              onChange={(f) => set("formula", f)}
              materials={materials}
              drafts={d.newMaterials}
              onAddDraft={(m) => set("newMaterials", [...d.newMaterials, m])}
              rates={rates}
            />
          ) : null}
          {d.stockMode === "count" ? (
            <FieldRow>
              <Field label="Unit" htmlFor="i-unit">
                <SelectField id="i-unit" value={d.unit} onValueChange={(v) => set("unit", v)} options={UNITS} />
              </Field>
              <Field label="Low-stock alert at" htmlFor="i-low">
                <IntInput id="i-low" value={d.lowAt} onChange={(n) => set("lowAt", n)} />
              </Field>
              {!item ? (
                <Field label="Opening stock" htmlFor="i-open">
                  <IntInput id="i-open" value={d.openingQty} onChange={(n) => set("openingQty", n)} placeholder="0" />
                </Field>
              ) : null}
            </FieldRow>
          ) : null}
        </div>

        <div className="flex flex-col gap-1 rounded-xl border px-4 py-2">
          <SwitchRow label="Available to order now" checked={d.available} onCheckedChange={(v) => set("available", v)} />
          <SwitchRow label="On the menu" checked={d.active} onCheckedChange={(v) => set("active", v)} />
        </div>
        <FormError error={error} />
      </form>
    </RecordSheet>
  );
}

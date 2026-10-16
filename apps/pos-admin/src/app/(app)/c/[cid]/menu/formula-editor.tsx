"use client";

import { useState } from "react";
import { Copy, Plus, X } from "lucide-react";
import { inputUnitsFor, recipeCost, type Material, type MaterialUnit, type Paise, type PricePoint, type RecipeLine } from "@px-pos/core";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { StockQtyInput } from "@/components/inventory/stock-qty-input";
import { MaterialCombobox, type DraftMaterial, type MaterialOption } from "@/components/vendors/pickers";
import { rs } from "@/components/vendors/vendor-status";
import type { WithId } from "@/lib/firebase/hooks";
import { newId } from "@/lib/ids";

export interface FormulaLine {
  lineId: string;
  materialId: string | null;
  qtyMicro: number | null;
  unit: MaterialUnit | null;
}

export type FormulaDraft = Record<string, FormulaLine[]>;

export interface FormulaSize {
  /** Variant id, or RECIPE_BASE for an item without sizes. */
  key: string;
  name: string;
  pricePaise: Paise | null;
}

const blank = (): FormulaLine => ({ lineId: newId(8), materialId: null, qtyMicro: null, unit: null });
export const copyLines = (lines: FormulaLine[] | undefined): FormulaLine[] => (lines ?? []).map((l) => ({ ...l, lineId: newId(8) }));

/** The finished lines of a draft (material and amount filled in). */
export const finishedLines = (lines: FormulaLine[] | undefined): RecipeLine[] =>
  (lines ?? []).filter((l) => l.materialId && l.qtyMicro && l.qtyMicro > 0).map((l) => ({ materialId: l.materialId!, qtyMicro: l.qtyMicro! }));

/**
 * What goes into one of an item: raw materials and how much, per size. A size not filled in yet
 * starts as a copy of the first. Shows the cost of a serving at the last prices paid.
 */
export function FormulaEditor({
  sizes,
  value,
  onChange,
  materials,
  drafts,
  onAddDraft,
  rates,
}: {
  sizes: FormulaSize[];
  value: FormulaDraft;
  onChange: (next: FormulaDraft) => void;
  materials: WithId<Material>[];
  drafts: DraftMaterial[];
  onAddDraft: (d: DraftMaterial) => void;
  rates: ReadonlyMap<string, PricePoint>;
}) {
  const first = sizes[0]!;
  const [picked, setPicked] = useState(first.key);
  const size = sizes.find((s) => s.key === picked) ?? first;
  // Sizes added (or removed) after the formula was written: the first size shows the earlier one.
  const lines = value[size.key] ?? (size.key === first.key ? Object.values(value)[0] : undefined) ?? [];

  const used = new Set(Object.values(value).flatMap((ls) => ls.map((l) => l.materialId)));
  const options: MaterialOption[] = [...materials.filter((m) => m.active || used.has(m.id)), ...drafts.map((d) => ({ ...d, draft: true }))];
  const byId = new Map<string, Pick<Material, "unit" | "pack"> & { name: string; active?: boolean }>([...materials.map((m) => [m.id, m] as const), ...drafts.map((d) => [d.id, d] as const)]);

  const setLines = (next: FormulaLine[]) => onChange({ ...value, [size.key]: next });
  const update = (lineId: string, patch: Partial<FormulaLine>) => setLines(lines.map((l) => (l.lineId === lineId ? { ...l, ...patch } : l)));
  const choose = (key: string) => {
    // A size opened for the first time starts as a copy of the first one.
    if (!value[key] && key !== first.key) onChange({ ...value, [key]: copyLines(value[first.key] ?? Object.values(value)[0]) });
    setPicked(key);
  };

  const finished = finishedLines(lines);
  const cost = recipeCost(finished, byId, rates);
  const pct = size.pricePaise && cost.costPaise && !cost.missing.length ? Math.round((cost.costPaise / size.pricePaise) * 100) : null;
  const inactive = finished.filter((l) => byId.get(l.materialId)?.active === false);

  return (
    <div className="flex flex-col gap-3">
      {sizes.length > 1 ? (
        <div className="flex flex-wrap items-center gap-2">
          <ToggleGroup type="single" variant="outline" size="sm" value={size.key} onValueChange={(v) => v && choose(v)} aria-label="Size" className="flex-wrap">
            {sizes.map((s) => (
              <ToggleGroupItem key={s.key} value={s.key} className="px-3">
                {s.name || "Size"}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          {size.key !== first.key ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => setLines(copyLines(value[first.key] ?? Object.values(value)[0]))}>
              <Copy data-icon="inline-start" aria-hidden />
              Copy from {first.name || "first size"}
            </Button>
          ) : null}
        </div>
      ) : null}
      <ul className="flex flex-col gap-2" aria-label={`Formula${size.name ? ` for ${size.name}` : ""}`}>
        {lines.map((l, idx) => {
          const m = l.materialId ? byId.get(l.materialId) : undefined;
          const name = m?.name ?? `line ${idx + 1}`;
          return (
            <li key={l.lineId} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 border-b pb-3 last:border-0 last:pb-0">
              <MaterialCombobox
                aria-label={`Material, line ${idx + 1}`}
                options={options}
                preferred={[]}
                value={l.materialId}
                onChange={(mid) => {
                  const mm = byId.get(mid);
                  update(l.lineId, { materialId: mid, unit: mm ? (inputUnitsFor(mm)[0]?.unit ?? null) : null, qtyMicro: mid === l.materialId ? l.qtyMicro : null });
                }}
                onAdd={(d) => onAddDraft(d)}
              />
              <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${name}`} onClick={() => setLines(lines.filter((x) => x.lineId !== l.lineId))}>
                <X aria-hidden />
              </Button>
              <StockQtyInput
                material={m ?? null}
                value={l.qtyMicro}
                onChange={(q) => update(l.lineId, { qtyMicro: q })}
                unit={l.unit}
                onUnitChange={(u) => update(l.lineId, { unit: u })}
                aria-label={`Amount of ${name}`}
                className="col-span-2"
              />
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button type="button" variant="ghost" size="sm" className="-ml-2.5" onClick={() => setLines([...lines, blank()])} disabled={lines.length >= 30}>
          <Plus data-icon="inline-start" aria-hidden />
          Add material
        </Button>
        {finished.length ? (
          <span className="text-sm tabular-nums" aria-live="polite">
            <span className="text-muted-foreground">Cost per {size.name ? size.name.toLowerCase() : "serving"} </span>
            {cost.missing.length === finished.length ? (
              <span className="text-muted-foreground">not known yet</span>
            ) : (
              <>
                <span className="font-medium">{rs(cost.costPaise)}</span>
                {pct != null ? <span className="text-muted-foreground"> · {pct}% of the price</span> : null}
                {cost.missing.length ? <span className="text-muted-foreground"> · {cost.missing.length} never bought</span> : null}
              </>
            )}
          </span>
        ) : null}
      </div>
      {inactive.length ? <p className="text-sm text-warning">{inactive.map((l) => byId.get(l.materialId)?.name).join(", ")} {inactive.length === 1 ? "is" : "are"} switched off, but still used up by this formula.</p> : null}
    </div>
  );
}

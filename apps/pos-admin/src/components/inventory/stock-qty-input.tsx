"use client";

import { useState } from "react";
import { inputUnitsFor, MATERIAL_UNIT_LABEL, parseStockInput, stockInputText, type Material, type MaterialUnit } from "@px-pos/core";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/shared/form-controls";
import { cn } from "@/lib/utils";

/**
 * A raw-material quantity typed in a unit that suits it (80 ml, 1.5 kg, 2 trays), held as micro
 * of the material's stock unit. Null while the text isn't a number.
 */
export function StockQtyInput({
  material,
  value,
  onChange,
  unit,
  onUnitChange,
  "aria-label": ariaLabel,
  className,
  placeholder = "0",
  autoFocus,
}: {
  material: Pick<Material, "unit" | "pack"> | null;
  value: number | null;
  onChange: (micro: number | null) => void;
  /** The unit typed in; defaults to the first that suits the material. */
  unit: MaterialUnit | null;
  onUnitChange: (u: MaterialUnit) => void;
  "aria-label"?: string;
  className?: string;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const units = material ? inputUnitsFor(material) : [];
  const current = units.find((u) => u.unit === unit) ?? units[0] ?? null;
  const toText = (v: number | null) => (v == null || !current ? "" : stockInputText(v, current));
  const [text, setText] = useState(() => toText(value));
  // Follow outside changes (a reset, another unit, a copied formula) — adjusted during render.
  const [seen, setSeen] = useState({ value, unit: current?.unit });
  if (seen.value !== value || seen.unit !== current?.unit) {
    setSeen({ value, unit: current?.unit });
    if (!current || value !== parseStockInput(text, current)) setText(toText(value));
  }
  return (
    <div className={cn("flex min-w-0 gap-1.5", className)}>
      <Input
        inputMode="decimal"
        autoComplete="off"
        value={text}
        placeholder={placeholder}
        aria-label={ariaLabel}
        autoFocus={autoFocus}
        disabled={!current}
        onChange={(e) => {
          const t = e.target.value.replace(/[^\d.]/g, "");
          setText(t);
          onChange(!current || t.trim() === "" ? null : parseStockInput(t, current));
        }}
        className="min-w-0 flex-1 tabular-nums"
      />
      {units.length > 1 ? (
        <SelectField
          aria-label={ariaLabel ? `${ariaLabel}, unit` : "Unit"}
          value={current?.unit ?? ""}
          onValueChange={(u) => {
            // People type the number, then pick its unit: "500" then ml means 500 ml.
            onUnitChange(u as MaterialUnit);
            const next = units.find((x) => x.unit === u);
            if (next && text.trim()) onChange(parseStockInput(text, next));
          }}
          options={units.map((u) => ({ value: u.unit, label: MATERIAL_UNIT_LABEL[u.unit] ?? u.unit }))}
          className="w-24 shrink-0"
        />
      ) : current ? (
        <span className="inline-flex h-9 w-16 shrink-0 items-center justify-center rounded-md border px-2 text-xs text-muted-foreground">{MATERIAL_UNIT_LABEL[current.unit] ?? current.unit}</span>
      ) : null}
    </div>
  );
}

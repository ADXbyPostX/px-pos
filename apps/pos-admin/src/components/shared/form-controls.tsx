"use client";

import { useId, useState, type ReactNode } from "react";
import { formatINR, parseINR, type Paise } from "@px-pos/core";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

export type Option<V extends string = string> = { value: V; label: string; disabled?: boolean };

/** shadcn Select as a full-width form control (never a raw <select>). */
export function SelectField<V extends string>({
  id,
  value,
  onValueChange,
  options,
  placeholder = "Choose…",
  className,
  disabled,
  "aria-label": ariaLabel,
}: {
  id?: string;
  value: V | "" | undefined;
  onValueChange: (v: V) => void;
  options: Option<V>[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  "aria-label"?: string;
}) {
  return (
    <Select value={value || undefined} onValueChange={(v) => onValueChange(v as V)} disabled={disabled}>
      <SelectTrigger id={id} className={cn("w-full", className)} aria-label={ariaLabel}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * Rupee amount input backed by integer paise. Accepts "120", "120.5", "1,200".
 * Reports null while the text is not a valid amount.
 */
export function MoneyInput({
  id,
  value,
  onChange,
  className,
  placeholder = "0.00",
  "aria-invalid": invalid,
  autoFocus,
  onEnter,
}: {
  id?: string;
  value: Paise | null;
  onChange: (p: Paise | null) => void;
  className?: string;
  placeholder?: string;
  "aria-invalid"?: boolean;
  autoFocus?: boolean;
  onEnter?: () => void;
}) {
  const toText = (p: Paise | null) => (p == null ? "" : formatINR(p, { symbol: false, decimals: "auto" }).replace(/,/g, ""));
  const [text, setText] = useState(() => toText(value));
  // Follow external resets (e.g. dialog re-opened for another record) — adjusted during render.
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    if (value !== parseINR(text)) setText(toText(value));
  }
  return (
    <div className={cn("relative", className)}>
      <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-sm text-muted-foreground">₹</span>
      <Input
        id={id}
        inputMode="decimal"
        autoComplete="off"
        value={text}
        placeholder={placeholder}
        aria-invalid={invalid}
        autoFocus={autoFocus}
        onChange={(e) => {
          setText(e.target.value);
          onChange(e.target.value.trim() === "" ? null : parseINR(e.target.value));
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && onEnter) {
            e.preventDefault();
            onEnter();
          }
        }}
        className="pl-6 tabular-nums"
      />
    </div>
  );
}

/** Whole-number input (quantities, seats, minutes). */
export function IntInput({ id, value, onChange, min = 0, max, className, placeholder, "aria-label": ariaLabel }: { id?: string; value: number | null; onChange: (n: number | null) => void; min?: number; max?: number; className?: string; placeholder?: string; "aria-label"?: string }) {
  return (
    <Input
      id={id}
      inputMode="numeric"
      autoComplete="off"
      value={value == null ? "" : String(value)}
      placeholder={placeholder}
      aria-label={ariaLabel}
      onChange={(e) => {
        const raw = e.target.value.replace(/[^\d-]/g, "");
        if (raw === "" || raw === "-") return onChange(null);
        let n = Number.parseInt(raw, 10);
        if (Number.isNaN(n)) return onChange(null);
        if (max != null) n = Math.min(n, max);
        n = Math.max(n, min);
        onChange(n);
      }}
      className={cn("tabular-nums", className)}
    />
  );
}

/** Label + switch on one row. */
export function SwitchRow({ label, checked, onCheckedChange, disabled, children }: { label: string; checked: boolean; onCheckedChange: (v: boolean) => void; disabled?: boolean; children?: ReactNode }) {
  const id = useId();
  return (
    <div className="flex min-h-11 items-center justify-between gap-4">
      <Label htmlFor={id} className="flex-1 cursor-pointer font-normal">
        {label}
        {children}
      </Label>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
    </div>
  );
}

export function FormError({ error }: { error: string | null | undefined }) {
  if (!error) return null;
  return (
    <p role="alert" className="text-sm text-destructive">
      {error}
    </p>
  );
}

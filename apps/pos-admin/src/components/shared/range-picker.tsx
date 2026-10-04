"use client";

import { useCallback, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarRange, ChevronLeft, ChevronRight } from "lucide-react";
import { addDays, bizDateLabel, businessDateFor, daysBetween, isBizDate, type BizDate } from "@px-pos/core";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

export type Preset = "today" | "7" | "30" | "90" | "custom";

/** Today's business date for a client (IST, shifted by its day cutoff). */
export function todayBiz(cutoffMin: number, nowMs = Date.now()): BizDate {
  return businessDateFor(nowMs, cutoffMin);
}

const toDate = (d: BizDate) => new Date(`${d}T00:00:00`);
const fromDate = (d: Date): BizDate => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * Business-date range kept in the URL (?range=7|30|90 or ?from&to) so reloads and shared
 * links keep the view. Presets are inclusive and end today.
 */
export function useBizRange(cutoffMin: number, fallback: Exclude<Preset, "custom"> = "today") {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const today = todayBiz(cutoffMin);
  const rawFrom = params.get("from");
  const rawTo = params.get("to");
  const rawRange = params.get("range") as Preset | null;

  const value = useMemo(() => {
    if (rawFrom && rawTo && isBizDate(rawFrom) && isBizDate(rawTo) && rawFrom <= rawTo) return { from: rawFrom, to: rawTo, preset: "custom" as Preset };
    const preset = rawRange && ["today", "7", "30", "90"].includes(rawRange) ? rawRange : fallback;
    const days = preset === "today" ? 1 : Number(preset);
    return { from: addDays(today, -(days - 1)), to: today, preset };
  }, [rawFrom, rawTo, rawRange, fallback, today]);

  const push = useCallback(
    (next: Record<string, string | null>) => {
      const sp = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(next)) {
        if (v == null) sp.delete(k);
        else sp.set(k, v);
      }
      const qs = sp.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  const setPreset = useCallback((p: Exclude<Preset, "custom">) => push({ range: p === fallback ? null : p, from: null, to: null }), [push, fallback]);
  const setRange = useCallback((from: BizDate, to: BizDate) => push({ from, to, range: null }), [push]);

  /** The previous window of the same length (for comparisons). */
  const previous = useMemo(() => {
    const len = daysBetween(value.from, value.to) + 1;
    return { from: addDays(value.from, -len), to: addDays(value.from, -1) };
  }, [value]);

  return { ...value, today, days: daysBetween(value.from, value.to) + 1, previous, setPreset, setRange };
}

export function RangePicker({ range, maxDays }: { range: ReturnType<typeof useBizRange>; maxDays?: number }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<{ from?: Date; to?: Date } | undefined>(undefined);
  const label = range.from === range.to ? bizDateLabel(range.from) : `${bizDateLabel(range.from)} – ${bizDateLabel(range.to)}`;
  return (
    <div className="flex flex-wrap items-center gap-2 md:flex-nowrap">
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        value={range.preset === "custom" ? "" : range.preset}
        onValueChange={(v) => v && range.setPreset(v as Exclude<Preset, "custom">)}
        aria-label="Date range"
      >
        <ToggleGroupItem value="today" className="px-3">
          Today
        </ToggleGroupItem>
        {(["7", "30", "90"] as const)
          .filter((p) => !maxDays || Number(p) <= maxDays)
          .map((p) => (
            <ToggleGroupItem key={p} value={p} className="px-3 tabular-nums">
              {p}D
            </ToggleGroupItem>
          ))}
      </ToggleGroup>
      <Popover
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (o) setDraft({ from: toDate(range.from), to: toDate(range.to) });
        }}
      >
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="min-w-0 max-w-64 tabular-nums" aria-label={`Pick dates, now ${label}`}>
            <CalendarRange data-icon="inline-start" aria-hidden />
            <span className="truncate">{label}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-auto p-0">
          <Calendar
            mode="range"
            numberOfMonths={2}
            defaultMonth={draft?.from}
            selected={draft?.from ? { from: draft.from, to: draft.to } : undefined}
            onSelect={(r) => setDraft(r ? { from: r.from, to: r.to } : undefined)}
            disabled={{ after: toDate(range.today) }}
          />
          <div className="flex items-center justify-end gap-2 border-t p-3">
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={!draft?.from}
              onClick={() => {
                if (!draft?.from) return;
                let from = fromDate(draft.from);
                const to = fromDate(draft.to ?? draft.from);
                if (maxDays && daysBetween(from, to) + 1 > maxDays) from = addDays(to, -(maxDays - 1));
                range.setRange(from, to);
                setOpen(false);
              }}
            >
              Apply
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

/** Single business date in the URL (?d=), defaulting to today. */
export function useBizDate(cutoffMin: number) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const today = todayBiz(cutoffMin);
  const raw = params.get("d");
  const date = raw && isBizDate(raw) && raw <= today ? raw : today;
  const set = useCallback(
    (d: BizDate) => {
      const sp = new URLSearchParams(params.toString());
      if (d === today) sp.delete("d");
      else sp.set("d", d);
      const qs = sp.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router, today],
  );
  return { date, today, set, isToday: date === today };
}

export function DateSwitch({ value }: { value: ReturnType<typeof useBizDate> }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex items-center gap-1">
      <Button variant="outline" size="icon-sm" onClick={() => value.set(addDays(value.date, -1))} aria-label="Previous day">
        <ChevronLeft aria-hidden />
      </Button>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="min-w-36 tabular-nums">
            {value.isToday ? `Today · ${bizDateLabel(value.date)}` : bizDateLabel(value.date, true)}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-auto p-0">
          <Calendar
            mode="single"
            selected={toDate(value.date)}
            defaultMonth={toDate(value.date)}
            onSelect={(d) => {
              if (d) value.set(fromDate(d));
              setOpen(false);
            }}
            disabled={{ after: toDate(value.today) }}
          />
        </PopoverContent>
      </Popover>
      <Button variant="outline" size="icon-sm" onClick={() => value.set(addDays(value.date, 1))} disabled={value.isToday} aria-label="Next day">
        <ChevronRight aria-hidden />
      </Button>
    </div>
  );
}

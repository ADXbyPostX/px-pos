"use client";

import { useState, type FormEvent } from "react";
import { Loader2, Plus, X } from "lucide-react";
import {
  formatStock,
  inputUnitsFor,
  materialMovePlan,
  stockMovePlan,
  upsertMaterialPlan,
  combinePlans,
  type Item,
  type Material,
  type MaterialUnit,
  type WritePlan,
} from "@px-pos/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Field } from "@/components/shared/field";
import { FormDialog } from "@/components/shared/form-dialog";
import { FormError, IntInput, SelectField } from "@/components/shared/form-controls";
import { SearchInput } from "@/components/shared/search-input";
import { useClient } from "@/components/providers/client-provider";
import { usePrincipal } from "@/components/providers/principal-provider";
import { MaterialCombobox, type DraftMaterial, type MaterialOption } from "@/components/vendors/pickers";
import type { WithId } from "@/lib/firebase/hooks";
import { newId } from "@/lib/ids";
import { useRunPlan } from "@/lib/run-plan";
import { cn } from "@/lib/utils";
import { StockQtyInput } from "./stock-qty-input";
import type { ItemMoveKind, MoveKind } from "./context";

const TITLE: Record<MoveKind, string> = { in: "Stock in", waste: "Wastage", adjust: "Adjust stock" };
const WASTE_REASONS = ["Spoiled", "Spilled", "Expired", "Staff meal", "Other"];

interface MoveLine {
  lineId: string;
  materialId: string | null;
  qty: number | null;
  unit: MaterialUnit | null;
  /** adjust only: take off instead of add. */
  minus: boolean;
}

const blank = (materialId: string | null = null): MoveLine => ({ lineId: newId(8), materialId, qty: null, unit: null, minus: false });

/** Raw materials stocked in without a bill, wasted, or adjusted by hand. Many at once, one posting. */
export function MoveDialog({ kind, materialId, open, onOpenChange, materials, onHand, today }: { kind: MoveKind; materialId: string | null; open: boolean; onOpenChange: (o: boolean) => void; materials: Array<WithId<Material>>; onHand: Record<string, number>; today: string }) {
  const { cid } = useClient();
  const { planCtx } = usePrincipal();
  const { run, pending } = useRunPlan();
  const [id, setId] = useState("");
  const [lines, setLines] = useState<MoveLine[]>([]);
  const [drafts, setDrafts] = useState<DraftMaterial[]>([]);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [seen, setSeen] = useState({ open, kind, materialId });
  if (seen.open !== open || seen.kind !== kind || seen.materialId !== materialId) {
    setSeen({ open, kind, materialId });
    if (open) {
      setId(newId());
      setLines([blank(materialId)]);
      setDrafts([]);
      setReason(kind === "waste" ? "Spoiled" : "");
      setNote("");
      setError(null);
    }
  }

  const byId = new Map<string, Pick<Material, "unit" | "pack"> & { name: string }>([...materials.map((m) => [m.id, m] as const), ...drafts.map((d) => [d.id, d] as const)]);
  const options: MaterialOption[] = [...materials.filter((m) => m.active), ...drafts.map((d) => ({ ...d, draft: true }))];
  const update = (lineId: string, patch: Partial<MoveLine>) => setLines((ls) => ls.map((l) => (l.lineId === lineId ? { ...l, ...patch } : l)));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const filled = lines.filter((l) => l.materialId || l.qty != null);
    if (!filled.length) return setError("Pick a material");
    for (const l of filled) {
      if (!l.materialId) return setError("Pick a material on every line");
      if (!l.qty) return setError(`${byId.get(l.materialId)?.name ?? "Material"}: enter how much`);
    }
    const text = kind === "waste" ? (reason === "Other" ? note.trim() : note.trim() ? `${reason}: ${note.trim()}` : reason) : note.trim();
    const ctx = planCtx(cid);
    let plans: WritePlan[];
    try {
      const used = new Set(filled.map((l) => l.materialId));
      plans = [
        ...drafts.filter((d) => used.has(d.id)).map((d) => upsertMaterialPlan(ctx, { id: d.id, material: { name: d.name, unit: d.unit, taxBps: d.taxBps, active: true } })),
        materialMovePlan(ctx, {
          id,
          businessDate: today,
          kind,
          lines: filled.map((l) => ({ materialId: l.materialId!, name: byId.get(l.materialId!)?.name ?? "", qty: kind === "adjust" && l.minus ? -l.qty! : l.qty! })),
          ...(text ? { reason: text } : {}),
        }),
      ];
    } catch (err) {
      return setError(err instanceof Error ? err.message : "Couldn't save.");
    }
    setError(null);
    // New materials and the move are separate docs: one batch.
    if (await run(plans.length > 1 ? combinePlans(TITLE[kind], plans) : plans[0]!, `${TITLE[kind]} saved`)) onOpenChange(false);
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={(o) => !pending && onOpenChange(o)}
      title={TITLE[kind]}
      className="sm:max-w-2xl"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="move-form" disabled={pending} variant={kind === "waste" ? "destructive" : "default"}>
            {pending ? <Loader2 className="animate-spin" data-icon="inline-start" aria-hidden /> : null}
            {kind === "in" ? "Add to stock" : kind === "waste" ? "Record wastage" : "Save"}
          </Button>
        </>
      }
    >
      <form id="move-form" onSubmit={submit} className="flex flex-col gap-5" noValidate>
        <ul className="flex flex-col gap-3" aria-label="Materials">
          {lines.map((l, idx) => {
            const m = l.materialId ? byId.get(l.materialId) : undefined;
            const name = m?.name ?? `line ${idx + 1}`;
            const book = l.materialId ? (onHand[l.materialId] ?? 0) : null;
            const delta = l.qty ? (kind === "in" || (kind === "adjust" && !l.minus) ? l.qty : -l.qty) : 0;
            return (
              <li key={l.lineId} className="flex flex-col gap-1.5">
                <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 sm:grid-cols-[minmax(0,1fr)_13rem_auto]">
                  <MaterialCombobox aria-label={`Material, line ${idx + 1}`} options={options} preferred={[]} value={l.materialId} onChange={(mid) => update(l.lineId, { materialId: mid, unit: null, qty: null })} onAdd={(d) => setDrafts((ds) => [...ds, d])} />
                  <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${name}`} onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((x) => x.lineId !== l.lineId) : [blank()]))} className="sm:order-last">
                    <X aria-hidden />
                  </Button>
                  <StockQtyInput material={m ?? null} value={l.qty} onChange={(q) => update(l.lineId, { qty: q })} unit={l.unit ?? (m ? (inputUnitsFor(m).at(-1)?.unit ?? null) : null)} onUnitChange={(u) => update(l.lineId, { unit: u })} aria-label={`How much ${name}`} className="col-span-2 sm:col-span-1" />
                </div>
                {kind === "adjust" ? (
                  <ToggleGroup type="single" variant="outline" size="sm" value={l.minus ? "minus" : "plus"} onValueChange={(v) => v && update(l.lineId, { minus: v === "minus" })} aria-label={`Add or take off ${name}`}>
                    <ToggleGroupItem value="plus" className="px-3">Add</ToggleGroupItem>
                    <ToggleGroupItem value="minus" className="px-3">Take off</ToggleGroupItem>
                  </ToggleGroup>
                ) : null}
                {m && book != null ? (
                  <span className="text-xs text-muted-foreground tabular-nums">
                    In stock {formatStock(book, m)}
                    {delta ? ` → ${formatStock(book + delta, m)}` : ""}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
        <Button type="button" variant="ghost" size="sm" className="-ml-2.5 self-start" onClick={() => setLines((ls) => [...ls, blank()])}>
          <Plus data-icon="inline-start" aria-hidden />
          Add material
        </Button>
        {kind === "waste" ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Why" htmlFor="mv-reason">
              <SelectField id="mv-reason" value={reason} onValueChange={setReason} options={WASTE_REASONS.map((r) => ({ value: r, label: r }))} />
            </Field>
            <Field label={reason === "Other" ? "What happened" : "Note"} htmlFor="mv-note">
              <Input id="mv-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={100} autoComplete="off" />
            </Field>
          </div>
        ) : (
          <Field label={kind === "adjust" ? "Why" : "Note"} htmlFor="mv-note">
            <Input id="mv-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={100} autoComplete="off" placeholder={kind === "in" ? "From the market" : undefined} />
          </Field>
        )}
        <FormError error={error} />
      </form>
    </FormDialog>
  );
}

/**
 * A stock count: type what's on the shelf for any materials; each becomes an adjustment of
 * counted − book. Lines left empty aren't counted.
 */
export function CountDialog({ open, onOpenChange, materials, only, onHand, today }: { open: boolean; onOpenChange: (o: boolean) => void; materials: Array<WithId<Material>>; only: string[] | null; onHand: Record<string, number>; today: string }) {
  const { cid } = useClient();
  const { planCtx } = usePrincipal();
  const { run, pending } = useRunPlan();
  const [id, setId] = useState("");
  const [counts, setCounts] = useState<Record<string, number | null>>({});
  const [units, setUnits] = useState<Record<string, MaterialUnit>>({});
  const [q, setQ] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const key = only?.join(",") ?? "*";
  const [seen, setSeen] = useState({ open, key });
  if (seen.open !== open || seen.key !== key) {
    setSeen({ open, key });
    if (open) {
      setId(newId());
      setCounts({});
      setUnits({});
      setQ("");
      setNote("");
      setError(null);
    }
  }
  const list = materials.filter((m) => (only ? only.includes(m.id) : m.active || (onHand[m.id] ?? 0) !== 0));
  const needle = q.trim().toLowerCase();
  const shown = list.filter((m) => !needle || m.name.toLowerCase().includes(needle));
  const filled = list.filter((m) => counts[m.id] != null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!filled.length) return setError("Type what you counted for at least one material");
    let plan;
    try {
      plan = materialMovePlan(planCtx(cid), {
        id,
        businessDate: today,
        kind: "count",
        lines: filled.map((m) => ({ materialId: m.id, name: m.name, qty: counts[m.id]!, book: onHand[m.id] ?? 0 })),
        ...(note.trim() ? { reason: note.trim() } : {}),
      });
    } catch (err) {
      return setError(err instanceof Error ? err.message : "Couldn't save.");
    }
    setError(null);
    if (await run(plan, `Count saved · ${filled.length} material${filled.length === 1 ? "" : "s"}`)) onOpenChange(false);
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={(o) => !pending && onOpenChange(o)}
      title="Count stock"
      className="sm:max-w-2xl"
      footer={
        <>
          <span className="mr-auto text-sm text-muted-foreground tabular-nums">{filled.length} counted</span>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="count-form" disabled={pending}>
            {pending ? <Loader2 className="animate-spin" data-icon="inline-start" aria-hidden /> : null}
            Save count
          </Button>
        </>
      }
    >
      <form id="count-form" onSubmit={submit} className="flex flex-col gap-4" noValidate>
        {list.length > 8 ? <SearchInput value={q} onChange={setQ} placeholder="Find a material" className="md:w-full" /> : null}
        <ul className="flex flex-col divide-y rounded-xl border" aria-label="Materials to count">
          {shown.map((m) => {
            const book = onHand[m.id] ?? 0;
            const counted = counts[m.id] ?? null;
            const diff = counted == null ? null : counted - book;
            return (
              <li key={m.id} className="grid grid-cols-[minmax(0,1fr)_minmax(0,13rem)] items-center gap-x-3 gap-y-1 px-3 py-2.5">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{m.name}</div>
                  <div className="text-xs text-muted-foreground tabular-nums">
                    Book {formatStock(book, m)}
                    {diff ? <span className={cn(diff < 0 ? "text-brand" : "text-success")}> · {diff > 0 ? "+" : "−"}{formatStock(Math.abs(diff), m)}</span> : diff === 0 ? <span className="text-success"> · matches</span> : null}
                  </div>
                </div>
                <StockQtyInput material={m} value={counted} onChange={(v) => setCounts((c) => ({ ...c, [m.id]: v }))} unit={units[m.id] ?? inputUnitsFor(m).at(-1)?.unit ?? null} onUnitChange={(u) => setUnits((x) => ({ ...x, [m.id]: u }))} aria-label={`Counted ${m.name}`} placeholder="Not counted" />
              </li>
            );
          })}
          {!shown.length ? <li className="px-3 py-6 text-center text-sm text-muted-foreground">No materials match.</li> : null}
        </ul>
        <Field label="Note" htmlFor="count-note">
          <Input id="count-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={100} autoComplete="off" placeholder="Closing count" />
        </Field>
        <FormError error={error} />
      </form>
    </FormDialog>
  );
}

const ITEM_TITLE: Record<ItemMoveKind, string> = { in: "Stock in", waste: "Wastage", count: "Count" };

/** An item counted in pieces (samosas, bottles): stock in, wastage or a count. */
export function ItemStockDialog({ kind, item, open, onOpenChange, onHand, today }: { kind: ItemMoveKind; item: WithId<Item> | null; open: boolean; onOpenChange: (o: boolean) => void; onHand: number; today: string }) {
  const { cid } = useClient();
  const { planCtx } = usePrincipal();
  const { run, pending } = useRunPlan();
  const [id, setId] = useState("");
  const [qty, setQty] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [seen, setSeen] = useState({ open, kind, itemId: item?.id });
  if (seen.open !== open || seen.kind !== kind || seen.itemId !== item?.id) {
    setSeen({ open, kind, itemId: item?.id });
    if (open) {
      setId(newId());
      setQty(null);
      setReason("");
      setError(null);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!item) return;
    if (qty == null || (kind !== "count" && qty <= 0)) return setError("Enter how many");
    if (kind === "waste" && !reason.trim()) return setError("Say why");
    let plan;
    try {
      plan = stockMovePlan(planCtx(cid), { id, businessDate: today, kind, itemId: item.id, itemName: item.name, qty, ...(kind === "count" ? { onHand } : {}), ...(reason.trim() ? { reason: reason.trim() } : {}) });
    } catch (err) {
      return setError(err instanceof Error ? err.message : "Couldn't save.");
    }
    if (await run(plan, `${item.name}: ${ITEM_TITLE[kind].toLowerCase()} saved`)) onOpenChange(false);
  }

  const after = qty == null ? null : kind === "in" ? onHand + qty : kind === "waste" ? onHand - qty : qty;
  return (
    <FormDialog
      open={open}
      onOpenChange={(o) => !pending && onOpenChange(o)}
      title={item ? `${ITEM_TITLE[kind]} · ${item.name}` : ITEM_TITLE[kind]}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="item-stock-form" disabled={pending} variant={kind === "waste" ? "destructive" : "default"}>
            {pending ? <Loader2 className="animate-spin" data-icon="inline-start" aria-hidden /> : null}
            Save
          </Button>
        </>
      }
    >
      <form id="item-stock-form" onSubmit={submit} className="flex flex-col gap-5" noValidate>
        <Field label={kind === "count" ? "Counted" : "How many"} htmlFor="is-qty">
          <IntInput id="is-qty" value={qty} onChange={setQty} min={0} max={100000} placeholder="0" />
        </Field>
        <p className="text-sm text-muted-foreground tabular-nums" aria-live="polite">
          In stock {onHand}
          {after != null ? ` → ${after}` : ""}
        </p>
        <Field label={kind === "waste" ? "Why" : "Note"} htmlFor="is-reason">
          <Input id="is-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={100} autoComplete="off" />
        </Field>
        <FormError error={error} />
      </form>
    </FormDialog>
  );
}

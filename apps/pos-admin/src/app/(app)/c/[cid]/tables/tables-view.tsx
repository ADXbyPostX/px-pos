"use client";

import { useMemo, useState, type FormEvent } from "react";
import { Armchair, Layers, Loader2, Plus } from "lucide-react";
import { bulkTablesPlan, upsertFloorPlan, upsertTablePlan, type Floor, type Table } from "@px-pos/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Empty } from "@/components/shared/empty";
import { Field, FieldRow } from "@/components/shared/field";
import { FormDialog } from "@/components/shared/form-dialog";
import { FormError, IntInput, SelectField, SwitchRow } from "@/components/shared/form-controls";
import { PageSkeleton } from "@/components/shared/loadable";
import { PageHeader } from "@/components/shared/page-header";
import { Panel } from "@/components/shared/panel";
import { Stat, Stats } from "@/components/shared/stat";
import { useClient } from "@/components/providers/client-provider";
import { usePrincipal } from "@/components/providers/principal-provider";
import { useFloors, useTables } from "@/hooks/use-menu";
import { useOpenOrders } from "@/hooks/use-open-orders";
import type { WithId } from "@/lib/firebase/hooks";
import { newId } from "@/lib/ids";
import { useRunPlan } from "@/lib/run-plan";
import { cn } from "@/lib/utils";

function FloorDialog({ open, onOpenChange, floor, nextSort }: { open: boolean; onOpenChange: (o: boolean) => void; floor: WithId<Floor> | null; nextSort: number }) {
  const { cid } = useClient();
  const { planCtx } = usePrincipal();
  const { run, pending } = useRunPlan();
  const [name, setName] = useState(floor?.name ?? "");
  const [active, setActive] = useState(floor?.active ?? true);
  const [error, setError] = useState<string | null>(null);
  // Reset the form when the dialog opens (or the floor changes while open) — adjusted during render.
  const [seen, setSeen] = useState({ open, floor });
  if (seen.open !== open || seen.floor?.id !== floor?.id) {
    setSeen({ open, floor });
    if (open) {
      setName(floor?.name ?? "");
      setActive(floor?.active ?? true);
      setError(null);
    }
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError("Name is required");
    if (await run(upsertFloorPlan(planCtx(cid), floor?.id ?? newId(), { name: name.trim(), sort: floor?.sort ?? nextSort, active }, !floor), floor ? "Floor saved" : "Floor added")) onOpenChange(false);
  }
  return (
    <FormDialog
      open={open}
      onOpenChange={(o) => !pending && onOpenChange(o)}
      title={floor ? "Edit floor" : "Add floor"}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" form="floor-form" disabled={pending}>Save</Button>
        </>
      }
    >
      <form id="floor-form" onSubmit={submit} className="flex flex-col gap-5" noValidate>
        <Field label="Floor or area" htmlFor="f-name">
          <Input id="f-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ground floor, Terrace…" maxLength={30} autoFocus />
        </Field>
        {floor ? <SwitchRow label="In use" checked={active} onCheckedChange={setActive} /> : null}
        <FormError error={error} />
      </form>
    </FormDialog>
  );
}

function BulkDialog({ open, onOpenChange, floors, floorId, startSort }: { open: boolean; onOpenChange: (o: boolean) => void; floors: Array<WithId<Floor>>; floorId: string; startSort: number }) {
  const { cid } = useClient();
  const { planCtx } = usePrincipal();
  const { run, pending } = useRunPlan();
  const [floor, setFloor] = useState(floorId);
  const [prefix, setPrefix] = useState("T");
  const [from, setFrom] = useState<number | null>(1);
  const [to, setTo] = useState<number | null>(6);
  const [seats, setSeats] = useState<number | null>(4);
  const [error, setError] = useState<string | null>(null);
  // Follow the active floor each time the dialog opens (or it changes while open) — adjusted during render.
  const [seen, setSeen] = useState({ open, floorId });
  if (seen.open !== open || seen.floorId !== floorId) {
    setSeen({ open, floorId });
    if (open) setFloor(floorId);
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!floor) return setError("Pick a floor");
    if (from == null || to == null || to < from) return setError("Enter a valid range, e.g. 1 to 6");
    if (to - from + 1 > 60) return setError("Add at most 60 tables at a time");
    if (!seats || seats < 1) return setError("Seats must be at least 1");
    setError(null);
    const ids = Array.from({ length: to - from + 1 }, () => newId());
    if (await run(bulkTablesPlan(planCtx(cid), { floorId: floor, prefix: prefix.trim(), from, to, seats, startSort, ids }), `${to - from + 1} tables added`)) onOpenChange(false);
  }
  return (
    <FormDialog
      open={open}
      onOpenChange={(o) => !pending && onOpenChange(o)}
      title="Add tables"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" form="bulk-form" disabled={pending}>
            {pending ? <Loader2 className="animate-spin" data-icon="inline-start" aria-hidden /> : null}
            Add {from != null && to != null && to >= from ? to - from + 1 : ""} tables
          </Button>
        </>
      }
    >
      <form id="bulk-form" onSubmit={submit} className="flex flex-col gap-5" noValidate>
        <Field label="Floor" htmlFor="b-floor">
          <SelectField id="b-floor" value={floor} onValueChange={setFloor} options={floors.map((f) => ({ value: f.id, label: f.name }))} />
        </Field>
        <FieldRow>
          <Field label="Label prefix" htmlFor="b-prefix">
            <Input id="b-prefix" value={prefix} onChange={(e) => setPrefix(e.target.value.slice(0, 4))} placeholder="T" />
          </Field>
          <Field label="Seats each" htmlFor="b-seats">
            <IntInput id="b-seats" value={seats} onChange={setSeats} min={1} max={40} />
          </Field>
        </FieldRow>
        <FieldRow>
          <Field label="From" htmlFor="b-from">
            <IntInput id="b-from" value={from} onChange={setFrom} min={0} max={999} />
          </Field>
          <Field label="To" htmlFor="b-to">
            <IntInput id="b-to" value={to} onChange={setTo} min={0} max={999} />
          </Field>
        </FieldRow>
        <p className="text-sm text-muted-foreground">
          Creates <span className="font-mono text-foreground">{prefix}{from ?? ""}</span> … <span className="font-mono text-foreground">{prefix}{to ?? ""}</span>
        </p>
        <FormError error={error} />
      </form>
    </FormDialog>
  );
}

function TableDialog({ open, onOpenChange, table, floors, running }: { open: boolean; onOpenChange: (o: boolean) => void; table: WithId<Table> | null; floors: Array<WithId<Floor>>; running: boolean }) {
  const { cid } = useClient();
  const { planCtx } = usePrincipal();
  const { run, pending } = useRunPlan();
  const [label, setLabel] = useState(table?.label ?? "");
  const [seats, setSeats] = useState<number | null>(table?.seats ?? 4);
  const [floorId, setFloorId] = useState(table?.floorId ?? "");
  const [active, setActive] = useState(table?.active ?? true);
  const [error, setError] = useState<string | null>(null);
  // Load the table into the form when the dialog opens (or the table changes while open) — adjusted during render.
  const [seen, setSeen] = useState({ open, table });
  if (seen.open !== open || seen.table?.id !== table?.id) {
    setSeen({ open, table });
    if (open && table) {
      setLabel(table.label);
      setSeats(table.seats);
      setFloorId(table.floorId);
      setActive(table.active);
      setError(null);
    }
  }
  if (!table) return null;
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!table) return;
    if (!label.trim()) return setError("Label is required");
    if (!active && running) return setError("This table has a running order. Settle or move it first.");
    if (await run(upsertTablePlan(planCtx(cid), table.id, { label: label.trim(), seats: seats ?? 1, floorId, active, sort: table.sort }, false), "Table saved")) onOpenChange(false);
  }
  return (
    <FormDialog
      open={open}
      onOpenChange={(o) => !pending && onOpenChange(o)}
      title={`Table ${table.label}`}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" form="table-form" disabled={pending}>Save</Button>
        </>
      }
    >
      <form id="table-form" onSubmit={submit} className="flex flex-col gap-5" noValidate>
        <FieldRow>
          <Field label="Label" htmlFor="t-label">
            <Input id="t-label" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={8} />
          </Field>
          <Field label="Seats" htmlFor="t-seats">
            <IntInput id="t-seats" value={seats} onChange={setSeats} min={1} max={40} />
          </Field>
        </FieldRow>
        <Field label="Floor" htmlFor="t-floor">
          <SelectField id="t-floor" value={floorId} onValueChange={setFloorId} options={floors.map((f) => ({ value: f.id, label: f.name }))} />
        </Field>
        <SwitchRow label="In use" checked={active} onCheckedChange={setActive} />
        <FormError error={error} />
      </form>
    </FormDialog>
  );
}

export function TablesView() {
  const { cid, client } = useClient();
  const floors = useFloors(cid);
  const tables = useTables(cid);
  const open = useOpenOrders(cid);
  const [floorId, setFloorId] = useState<string | null>(null);
  const [floorDialog, setFloorDialog] = useState<{ open: boolean; floor: WithId<Floor> | null }>({ open: false, floor: null });
  const [bulk, setBulk] = useState(false);
  const [editing, setEditing] = useState<WithId<Table> | null>(null);
  const activeFloor = floorId ?? floors.data[0]?.id ?? null;
  const runningTables = useMemo(() => new Set(open.data.filter((o) => o.tableId).map((o) => o.tableId as string)), [open.data]);
  const visible = tables.data.filter((t) => t.floorId === activeFloor);
  const activeTables = tables.data.filter((t) => t.active);

  if (floors.status === "loading" || tables.status === "loading") return <PageSkeleton />;

  return (
    <>
      <PageHeader
        title="Tables"
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => setFloorDialog({ open: true, floor: null })}>
              <Layers data-icon="inline-start" aria-hidden />
              Add floor
            </Button>
            <Button size="sm" onClick={() => setBulk(true)} disabled={floors.data.length === 0}>
              <Plus data-icon="inline-start" aria-hidden />
              Add tables
            </Button>
          </>
        }
      />
      <Stats>
        <Stat label="Tables" value={activeTables.length} />
        <Stat label="Seats" value={activeTables.reduce((n, t) => n + t.seats, 0)} />
        <Stat label="Running now" value={runningTables.size} accent={runningTables.size > 0} />
        <Stat label="Floors" value={floors.data.filter((f) => f.active).length} />
      </Stats>
      {!client.orderModes.dineIn ? <p className="rounded-xl border border-warning/40 px-4 py-3 text-sm text-warning">Table service is turned off, so the app doesn&apos;t show tables. Turn it on under Order modes.</p> : null}
      {floors.data.length === 0 ? (
        <Empty icon={Layers} label="Add a floor or area first (Ground floor, Terrace…), then add its tables." action={<Button size="sm" onClick={() => setFloorDialog({ open: true, floor: null })}>Add floor</Button>} />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[15rem_minmax(0,1fr)]">
          <Panel title="Floors" className="self-start lg:sticky lg:-top-6">
            <ul className="flex flex-row gap-1 overflow-x-auto p-2 lg:flex-col">
              {floors.data.map((f) => (
                <li key={f.id}>
                  <button
                    type="button"
                    onClick={() => setFloorId(f.id)}
                    onDoubleClick={() => setFloorDialog({ open: true, floor: f })}
                    className={cn("flex min-h-9 w-full items-center justify-between gap-3 rounded-md px-2.5 text-sm whitespace-nowrap hover:bg-muted", activeFloor === f.id && "bg-muted font-medium", !f.active && "text-muted-foreground")}
                  >
                    {f.name}
                    <span className="text-xs text-muted-foreground tabular-nums">{tables.data.filter((t) => t.floorId === f.id).length}</span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="border-t px-2 py-2">
              <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => setFloorDialog({ open: true, floor: floors.data.find((f) => f.id === activeFloor) ?? null })}>
                Rename floor
              </Button>
            </div>
          </Panel>
          {visible.length === 0 ? (
            <Empty icon={Armchair} label="No tables on this floor yet." action={<Button size="sm" onClick={() => setBulk(true)}>Add tables</Button>} />
          ) : (
            <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 xl:grid-cols-7 2xl:grid-cols-10">
              {visible.map((t) => {
                const running = runningTables.has(t.id);
                return (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => setEditing(t)}
                      className={cn(
                        "flex aspect-square w-full flex-col items-center justify-center gap-1 rounded-xl border bg-card transition-colors hover:border-foreground/30 focus-visible:outline-2 focus-visible:outline-ring",
                        running && "border-brand/60 bg-brand/5",
                        !t.active && "border-dashed opacity-50",
                      )}
                      aria-label={`Table ${t.label}, ${t.seats} seats${running ? ", running" : ""}${t.active ? "" : ", not in use"}`}
                    >
                      <span className="text-lg font-semibold">{t.label}</span>
                      <span className="text-xs text-muted-foreground">{t.seats} seats</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
      <FloorDialog open={floorDialog.open} onOpenChange={(o) => setFloorDialog((s) => ({ ...s, open: o }))} floor={floorDialog.floor} nextSort={(floors.data.at(-1)?.sort ?? 0) + 1} />
      <BulkDialog open={bulk} onOpenChange={setBulk} floors={floors.data} floorId={activeFloor ?? ""} startSort={(tables.data.at(-1)?.sort ?? 0) + 1} />
      <TableDialog open={Boolean(editing)} onOpenChange={(o) => !o && setEditing(null)} table={editing} floors={floors.data} running={editing ? runningTables.has(editing.id) : false} />
    </>
  );
}

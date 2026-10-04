"use client";

import { useState, type FormEvent } from "react";
import { Loader2, Plus, Users } from "lucide-react";
import { capFor, ROLE_LABEL, STAFF_ROLES, upsertStaffPlan, type Staff, type StaffRole } from "@px-pos/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { DataTable, type Column } from "@/components/shared/data-table";
import { Field, FieldRow } from "@/components/shared/field";
import { FormDialog } from "@/components/shared/form-dialog";
import { FormError, IntInput, SelectField, SwitchRow } from "@/components/shared/form-controls";
import { Loadable } from "@/components/shared/loadable";
import { PageHeader } from "@/components/shared/page-header";
import { Stat, Stats } from "@/components/shared/stat";
import { ActiveBadge, Pill } from "@/components/shared/status-badge";
import { UserChip } from "@/components/shared/user-avatar";
import { useClient } from "@/components/providers/client-provider";
import { usePrincipal } from "@/components/providers/principal-provider";
import { useStaff } from "@/hooks/use-menu";
import type { WithId } from "@/lib/firebase/hooks";
import { newId } from "@/lib/ids";
import { useRunPlan } from "@/lib/run-plan";

type Row = WithId<Staff>;
const ROLE_TONE: Record<StaffRole, "red" | "white" | "zinc" | "dim"> = { owner: "red", manager: "white", cashier: "zinc", captain: "zinc", kitchen: "dim" };

function StaffDialog({ open, onOpenChange, staff }: { open: boolean; onOpenChange: (o: boolean) => void; staff: Row | null }) {
  const { cid, client } = useClient();
  const { planCtx } = usePrincipal();
  const { run, pending } = useRunPlan();
  const [name, setName] = useState(staff?.name ?? "");
  const [role, setRole] = useState<StaffRole>(staff?.role ?? "cashier");
  const [phone, setPhone] = useState(staff?.phone ?? "");
  const [capPct, setCapPct] = useState<number | null>(staff?.discountCapBps != null ? staff.discountCapBps / 100 : null);
  const [active, setActive] = useState(staff?.active ?? true);
  const [error, setError] = useState<string | null>(null);

  // Reset the form when the dialog opens (or the record changes while open) — adjusted during render.
  const [seen, setSeen] = useState({ open, staff });
  if (seen.open !== open || seen.staff?.id !== staff?.id) {
    setSeen({ open, staff });
    if (open) {
      setName(staff?.name ?? "");
      setRole(staff?.role ?? "cashier");
      setPhone(staff?.phone ?? "");
      setCapPct(staff?.discountCapBps != null ? staff.discountCapBps / 100 : null);
      setActive(staff?.active ?? true);
      setError(null);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError("Name is required");
    if (phone && !/^[0-9+\-\s]{8,15}$/.test(phone.trim())) return setError("Phone number looks wrong");
    const data = {
      name: name.trim(),
      role,
      active,
      ...(phone.trim() ? { phone: phone.trim() } : {}),
      ...(capPct != null ? { discountCapBps: Math.min(100, capPct) * 100 } : {}),
    };
    if (await run(upsertStaffPlan(planCtx(cid), staff?.id ?? newId(), data, staff ?? undefined), staff ? "Saved" : `${data.name} added`)) onOpenChange(false);
  }

  const roleCap = capFor(role, client) / 100;
  return (
    <FormDialog
      open={open}
      onOpenChange={(o) => !pending && onOpenChange(o)}
      title={staff ? `Edit ${staff.name}` : "Add staff member"}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" form="staff-form" disabled={pending}>
            {pending ? <Loader2 className="animate-spin" data-icon="inline-start" aria-hidden /> : null}
            Save
          </Button>
        </>
      }
    >
      <form id="staff-form" onSubmit={submit} className="flex flex-col gap-5" noValidate>
        <FieldRow>
          <Field label="Name" htmlFor="s-name">
            <Input id="s-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoFocus />
          </Field>
          <Field label="Role" htmlFor="s-role">
            <SelectField id="s-role" value={role} onValueChange={setRole} options={STAFF_ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r] }))} />
          </Field>
        </FieldRow>
        <FieldRow>
          <Field label="Phone" htmlFor="s-phone">
            <Input id="s-phone" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" maxLength={15} />
          </Field>
          <Field label={`Discount limit % (role default ${roleCap}%)`} htmlFor="s-cap">
            <IntInput id="s-cap" value={capPct} onChange={setCapPct} min={0} max={100} placeholder={String(roleCap)} />
          </Field>
        </FieldRow>
        {staff ? <SwitchRow label="Can use the terminals" checked={active} onCheckedChange={setActive} /> : null}
        <FormError error={error} />
      </form>
    </FormDialog>
  );
}

/** People who work the terminals. Picked on the app's lock screen (PIN login in phase 2). */
export function StaffView() {
  const { cid, client } = useClient();
  const { planCtx } = usePrincipal();
  const { run } = useRunPlan();
  const staff = useStaff(cid);
  const [editing, setEditing] = useState<Row | null>(null);
  const [open, setOpen] = useState(false);
  const active = staff.data.filter((s) => s.active);

  const columns: Column<Row>[] = [
    { key: "name", header: "Name", sort: (s) => s.name, cell: (s) => <UserChip name={s.name} /> },
    { key: "role", header: "Role", sort: (s) => STAFF_ROLES.indexOf(s.role), cell: (s) => <Pill tone={ROLE_TONE[s.role]} label={ROLE_LABEL[s.role]} /> },
    { key: "phone", header: "Phone", cell: (s) => <span className="text-muted-foreground tabular-nums">{s.phone ?? "—"}</span>, hideBelow: "md" },
    { key: "cap", header: "Discount limit", align: "right", sort: (s) => capFor(s.role, client, s.discountCapBps), cell: (s) => `${capFor(s.role, client, s.discountCapBps) / 100}%`, hideBelow: "lg" },
    { key: "status", header: "Status", sort: (s) => (s.active ? 1 : 0), cell: (s) => <ActiveBadge active={s.active} /> },
    {
      key: "toggle",
      header: <span className="sr-only">Active</span>,
      align: "right",
      cell: (s) => (
        <Switch
          checked={s.active}
          aria-label={`${s.active ? "Deactivate" : "Activate"} ${s.name}`}
          onClick={(e) => e.stopPropagation()}
          onCheckedChange={(v) => void run(upsertStaffPlan(planCtx(cid), s.id, { name: s.name, role: s.role, active: v }, s), v ? `${s.name} activated` : `${s.name} deactivated`)}
        />
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Staff"
        actions={
          <Button size="sm" onClick={() => { setEditing(null); setOpen(true); }}>
            <Plus data-icon="inline-start" aria-hidden />
            Add staff
          </Button>
        }
      />
      <Stats>
        <Stat label="Active staff" value={active.length} />
        <Stat label="Managers & owners" value={active.filter((s) => s.role === "owner" || s.role === "manager").length} />
        <Stat label="Cashiers & captains" value={active.filter((s) => s.role === "cashier" || s.role === "captain").length} />
        <Stat label="Kitchen" value={active.filter((s) => s.role === "kitchen").length} />
      </Stats>
      <Loadable state={staff} onRetry={staff.retry} empty={{ icon: Users, label: "No staff yet. Add the people who will take orders and bill on the tablets.", action: <Button size="sm" onClick={() => setOpen(true)}>Add staff</Button> }}>
        {(rows) => <DataTable rows={rows} columns={columns} rowKey={(s) => s.id} onRowClick={(s) => { setEditing(s); setOpen(true); }} caption="Staff" rowClassName={(s) => (s.active ? undefined : "opacity-60")} />}
      </Loadable>
      <StaffDialog open={open} onOpenChange={setOpen} staff={editing} />
    </>
  );
}

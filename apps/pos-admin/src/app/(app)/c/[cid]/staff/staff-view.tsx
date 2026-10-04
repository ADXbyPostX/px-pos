"use client";

import { useState, type FormEvent } from "react";
import { Loader2, Plus, Users } from "lucide-react";
import { toast } from "sonner";
import { capFor, ROLE_LABEL, STAFF_ROLES, upsertStaffPlan, validatePin, type Staff, type StaffRole } from "@px-pos/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { DataTable, type Column } from "@/components/shared/data-table";
import { Field, FieldRow } from "@/components/shared/field";
import { FormDialog } from "@/components/shared/form-dialog";
import { FormError, IntInput, SelectField, SwitchRow } from "@/components/shared/form-controls";
import { Loadable } from "@/components/shared/loadable";
import { PinInput, PinReveal } from "@/components/shared/pin-input";
import { PageHeader } from "@/components/shared/page-header";
import { Stat, Stats } from "@/components/shared/stat";
import { ActiveBadge, Pill } from "@/components/shared/status-badge";
import { UserChip } from "@/components/shared/user-avatar";
import { useClient } from "@/components/providers/client-provider";
import { usePrincipal } from "@/components/providers/principal-provider";
import { useStaff } from "@/hooks/use-menu";
import type { WithId } from "@/lib/firebase/hooks";
import { newId } from "@/lib/ids";
import { hashPin, suggestPin } from "@/lib/pin";
import { useRunPlan } from "@/lib/run-plan";

type Row = WithId<Staff>;
const ROLE_TONE: Record<StaffRole, "red" | "white" | "zinc" | "dim"> = { owner: "red", manager: "white", cashier: "zinc", captain: "zinc", kitchen: "dim" };
/** Admins sign in on the tills through an entry the Admins page keeps in step; it isn't edited here. */
const isAdminEntry = (s: Staff) => Boolean(s.adminUid);

function StaffDialog({ open, onOpenChange, staff }: { open: boolean; onOpenChange: (o: boolean) => void; staff: Row | null }) {
  const { cid, client } = useClient();
  const { planCtx } = usePrincipal();
  const { run, pending } = useRunPlan();
  const [name, setName] = useState(staff?.name ?? "");
  const [role, setRole] = useState<StaffRole>(staff?.role ?? "cashier");
  const [phone, setPhone] = useState(staff?.phone ?? "");
  const [capPct, setCapPct] = useState<number | null>(staff?.discountCapBps != null ? staff.discountCapBps / 100 : null);
  const [active, setActive] = useState(staff?.active ?? true);
  const [pin, setPin] = useState(staff ? "" : suggestPin());
  const [hashing, setHashing] = useState(false);
  const [handover, setHandover] = useState<{ name: string; pin: string } | null>(null);
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
      setPin(staff ? "" : suggestPin());
      setHandover(null);
      setError(null);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError("Name is required");
    if (phone && !/^[0-9+\-\s]{8,15}$/.test(phone.trim())) return setError("Phone number looks wrong");
    // A new person needs a PIN to sign in; an existing one keeps theirs unless a new one is typed.
    if (!staff || pin) {
      const bad = validatePin(pin);
      if (bad) return setError(bad);
    }
    setError(null);
    setHashing(true);
    let pinHash: string | undefined;
    try {
      pinHash = pin ? await hashPin(pin) : undefined;
    } catch {
      setHashing(false);
      return setError("This browser couldn't secure the PIN. Try another browser.");
    }
    setHashing(false);
    const data = {
      name: name.trim(),
      role,
      active,
      ...(phone.trim() ? { phone: phone.trim() } : {}),
      ...(capPct != null ? { discountCapBps: Math.min(100, capPct) * 100 } : {}),
      ...(pinHash ? { pinHash } : {}),
    };
    if (!(await run(upsertStaffPlan(planCtx(cid), staff?.id ?? newId(), data, staff ?? undefined)))) return;
    if (pin) setHandover({ name: data.name, pin });
    else {
      toast.success("Saved");
      onOpenChange(false);
    }
  }

  const roleCap = capFor(role, client) / 100;
  const busy = pending || hashing;
  return (
    <FormDialog
      open={open}
      onOpenChange={(o) => !busy && onOpenChange(o)}
      title={handover ? `${handover.name}'s till PIN` : staff ? `Edit ${staff.name}` : "Add staff member"}
      footer={
        handover ? (
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        ) : (
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" form="staff-form" disabled={busy}>
              {busy ? <Loader2 className="animate-spin" data-icon="inline-start" aria-hidden /> : null}
              Save
            </Button>
          </>
        )
      }
    >
      {handover ? (
        <PinReveal name={handover.name} pin={handover.pin} />
      ) : (
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
          <Field label={staff?.pinHash ? "New till PIN (empty keeps the current one)" : "Till PIN (4–6 digits)"} htmlFor="s-pin">
            <PinInput id="s-pin" value={pin} onChange={setPin} />
          </Field>
          {staff ? <SwitchRow label="Can use the terminals" checked={active} onCheckedChange={setActive} /> : null}
          <FormError error={error} />
        </form>
      )}
    </FormDialog>
  );
}

/** People who work the terminals: they pick their name on the till and type their PIN. */
export function StaffView() {
  const { cid, client } = useClient();
  const { planCtx } = usePrincipal();
  const { run } = useRunPlan();
  const staff = useStaff(cid);
  const [editing, setEditing] = useState<Row | null>(null);
  const [open, setOpen] = useState(false);
  // Counts are the outlet's own people; admins' till entries are listed but not counted.
  const active = staff.data.filter((s) => s.active && !isAdminEntry(s));

  const columns: Column<Row>[] = [
    { key: "name", header: "Name", sort: (s) => s.name, cell: (s) => <UserChip name={s.name} /> },
    { key: "role", header: "Role", sort: (s) => (isAdminEntry(s) ? -1 : STAFF_ROLES.indexOf(s.role)), cell: (s) => (isAdminEntry(s) ? <Pill tone="red" label="Admin" /> : <Pill tone={ROLE_TONE[s.role]} label={ROLE_LABEL[s.role]} />) },
    { key: "pin", header: "Till PIN", sort: (s) => (s.pinHash ? 1 : 0), cell: (s) => (s.pinHash ? <span className="text-muted-foreground">Set</span> : <span className="text-warning">Not set</span>) },
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
          disabled={isAdminEntry(s)}
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
        {(rows) => (
          <DataTable
            rows={rows}
            columns={columns}
            rowKey={(s) => s.id}
            onRowClick={(s) => {
              if (isAdminEntry(s)) return void toast.info(`${s.name} is an admin. Their till PIN is set on the Admins page.`);
              setEditing(s);
              setOpen(true);
            }}
            caption="Staff"
            rowClassName={(s) => (s.active ? undefined : "opacity-60")}
          />
        )}
      </Loadable>
      <StaffDialog open={open} onOpenChange={setOpen} staff={editing} />
    </>
  );
}

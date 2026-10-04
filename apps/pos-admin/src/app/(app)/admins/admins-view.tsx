"use client";

import { useMemo, useState, type FormEvent } from "react";
import { collection, query } from "firebase/firestore";
import { Copy, KeyRound, Loader2, Plus, RefreshCw, ShieldCheck, ShieldOff } from "lucide-react";
import { toast } from "sonner";
import { adminTillPlan, assignAdminsPlan, combinePlans, paths, platformUserPlan, validatePin, type AdminPerson, type PlanCtx, type PlatformRole, type PlatformUser } from "@px-pos/core";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Switch } from "@/components/ui/switch";
import { DataTable, type Column } from "@/components/shared/data-table";
import { Empty } from "@/components/shared/empty";
import { Field } from "@/components/shared/field";
import { FormDialog } from "@/components/shared/form-dialog";
import { FormError, SelectField } from "@/components/shared/form-controls";
import { Loadable } from "@/components/shared/loadable";
import { PinInput, PinReveal } from "@/components/shared/pin-input";
import { PageHeader } from "@/components/shared/page-header";
import { KV, Panel } from "@/components/shared/panel";
import { Stat, Stats } from "@/components/shared/stat";
import { ActiveBadge } from "@/components/shared/status-badge";
import { UserChip } from "@/components/shared/user-avatar";
import { authMessage } from "@/components/providers/firebase-provider";
import { usePrincipal } from "@/components/providers/principal-provider";
import { useClients } from "@/hooks/use-clients";
import { createLogin } from "@/lib/firebase/client";
import { useCollection, type WithId } from "@/lib/firebase/hooks";
import { cryptoRand } from "@/lib/ids";
import { hashPin, suggestPin } from "@/lib/pin";
import { useRunPlan } from "@/lib/run-plan";
import { cn } from "@/lib/utils";

type Admin = WithId<PlatformUser>;
const person = (a: Admin): AdminPerson => ({ uid: a.id, name: a.name, active: a.active, ...(a.pinHash ? { pinHash: a.pinHash } : {}) });

const ROLES: Array<{ value: PlatformRole; label: string }> = [
  { value: "admin", label: "Admin (only the clients you assign)" },
  { value: "superadmin", label: "Super admin (everything, like you)" },
];

/** Temporary password: 12 characters, no look-alikes (0/O, 1/l/I), easy to read out. */
function tempPassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  return Array.from({ length: 12 }, () => chars[Math.floor(cryptoRand() * chars.length)]).join("");
}

/**
 * New admin = a real email + password sign-in (created without signing you out) and the
 * platformUsers doc under the same uid. Hand over the details; they change the password.
 */
function AddAdminDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState(tempPassword);
  const [role, setRole] = useState<PlatformRole>("admin");
  const [pin, setPin] = useState(suggestPin);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<{ name: string; email: string; password: string; role: PlatformRole; pin?: string } | null>(null);
  const { run, pending } = useRunPlan();
  const busy = creating || pending;

  function close() {
    if (busy) return;
    setName("");
    setEmail("");
    setPassword(tempPassword());
    setRole("admin");
    setPin(suggestPin());
    setError(null);
    setCreated(null);
    onOpenChange(false);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError("Name is required");
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError("Enter the email they will sign in with");
    if (password.length < 8) return setError("Use at least 8 characters for the password");
    // Admins also sign in on their clients' tills; super admins don't need a till PIN.
    const tillPin = role === "admin" ? pin : "";
    if (tillPin) {
      const bad = validatePin(tillPin);
      if (bad) return setError(`Till PIN: ${bad}`);
    }
    setError(null);
    setCreating(true);
    let uid: string;
    let pinHash: string | undefined;
    try {
      pinHash = tillPin ? await hashPin(tillPin) : undefined;
      uid = await createLogin(email, password);
    } catch (err) {
      const code = (err as { code?: string })?.code ?? "";
      setCreating(false);
      return setError(code === "auth/email-already-in-use" ? "That email already has a PX POS sign-in." : authMessage(err));
    }
    setCreating(false);
    const ok = await run(platformUserPlan({ uid, role, name: name.trim(), email: email.trim(), active: true, nowMs: Date.now(), create: true, ...(pinHash ? { pinHash } : {}) }), `${name.trim()} added`);
    if (ok) setCreated({ name: name.trim(), email: email.trim(), password, role, ...(tillPin ? { pin: tillPin } : {}) });
  }

  const signInUrl = typeof window === "undefined" ? "/setup" : `${window.location.origin}/setup`;
  const message = created
    ? `PX POS Admin\nSign in: ${signInUrl}\nEmail: ${created.email}\nTemporary password: ${created.password}\n\nAfter signing in, change it: click your name (bottom left) → Change password.${created.pin ? `\n\nTill PIN (pick your name on the till, then type it): ${created.pin}` : ""}`
    : "";

  return (
    <FormDialog
      open={open}
      onOpenChange={(o) => (o ? onOpenChange(true) : close())}
      title={created ? `${created.name} can sign in` : "Add admin"}
      footer={
        created ? (
          <>
            <Button variant="outline" onClick={() => void navigator.clipboard?.writeText(message).then(() => toast.success("Sign-in details copied"))}>
              <Copy data-icon="inline-start" aria-hidden />
              Copy details
            </Button>
            <Button onClick={close}>Done</Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={close} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" form="admin-form" disabled={busy}>
              {busy ? <Loader2 className="animate-spin" data-icon="inline-start" aria-hidden /> : null}
              Create admin
            </Button>
          </>
        )
      }
    >
      {created ? (
        <div className="flex flex-col gap-4">
          <KV
            items={[
              { label: "Sign in at", value: <span className="font-mono text-xs">{signInUrl}</span> },
              { label: "Email", value: created.email },
              { label: "Temporary password", value: <span className="font-mono">{created.password}</span> },
              ...(created.pin ? [{ label: "Till PIN", value: <span className="font-mono tracking-[0.3em]">{created.pin}</span> }] : []),
            ]}
          />
          <p className="text-sm text-muted-foreground">
            Share these privately. They change the password after signing in (their name → Change password).{created.role === "admin" ? " Assign their clients in the matrix below." : " Super admins see every client."}
          </p>
        </div>
      ) : (
        <form id="admin-form" onSubmit={submit} className="flex flex-col gap-5" noValidate>
          <Field label="Name" htmlFor="a-name">
            <Input id="a-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={60} />
          </Field>
          <Field label="Email (they sign in with this)" htmlFor="a-email">
            <Input id="a-email" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={100} />
          </Field>
          <Field label="Role" htmlFor="a-role">
            <SelectField id="a-role" value={role} onValueChange={setRole} options={ROLES} />
          </Field>
          {role === "admin" ? (
            <Field label="Till PIN (signs them in on their clients' tills)" htmlFor="a-pin">
              <PinInput id="a-pin" value={pin} onChange={setPin} />
            </Field>
          ) : null}
          <Field label="Temporary password" htmlFor="a-password">
            <InputGroup>
              <InputGroupInput id="a-password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" className="font-mono" />
              <InputGroupAddon align="inline-end">
                <InputGroupButton size="icon-xs" onClick={() => setPassword(tempPassword())} aria-label="Generate another password">
                  <RefreshCw aria-hidden />
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
          </Field>
          <FormError error={error} />
        </form>
      )}
    </FormDialog>
  );
}

/** Set or change an admin's till PIN; it reaches every client they're assigned to. */
function AdminPinDialog({ admin, assigned, onOpenChange }: { admin: Admin | null; assigned: PlanCtx[]; onOpenChange: (o: boolean) => void }) {
  const [pin, setPin] = useState(suggestPin);
  const [hashing, setHashing] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { run, pending } = useRunPlan();
  const busy = hashing || pending;

  // Fresh form each time it opens for someone — adjusted during render.
  const [seen, setSeen] = useState<string | null>(null);
  if ((admin?.id ?? null) !== seen) {
    setSeen(admin?.id ?? null);
    setPin(suggestPin());
    setDone(null);
    setError(null);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!admin) return;
    const bad = validatePin(pin);
    if (bad) return setError(bad);
    setError(null);
    setHashing(true);
    let pinHash: string;
    try {
      pinHash = await hashPin(pin);
    } catch {
      setHashing(false);
      return setError("This browser couldn't secure the PIN. Try another browser.");
    }
    setHashing(false);
    if (await run(adminTillPlan(Date.now(), { ...person(admin), pinHash }, assigned, "pin"))) setDone(pin);
  }

  return (
    <FormDialog
      open={admin != null}
      onOpenChange={(o) => !busy && onOpenChange(o)}
      title={admin ? `${admin.name}'s till PIN` : "Till PIN"}
      footer={
        done ? (
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        ) : (
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" form="admin-pin-form" disabled={busy}>
              {busy ? <Loader2 className="animate-spin" data-icon="inline-start" aria-hidden /> : null}
              {admin?.pinHash ? "Change PIN" : "Set PIN"}
            </Button>
          </>
        )
      }
    >
      {done && admin ? (
        <PinReveal name={admin.name} pin={done} />
      ) : (
        <form id="admin-pin-form" onSubmit={submit} className="flex flex-col gap-5" noValidate>
          <Field label={`Till PIN for ${assigned.length} client${assigned.length === 1 ? "" : "s"}`} htmlFor="ap-pin">
            <PinInput id="ap-pin" value={pin} onChange={setPin} />
          </Field>
          <FormError error={error} />
        </form>
      )}
    </FormDialog>
  );
}

export function AdminsView() {
  const { isSuper, planCtx, principal } = usePrincipal();
  const clients = useClients();
  const live = useCollection<PlatformUser>(isSuper ? "platformUsers:all" : null, (db) => query(collection(db, paths.platformUsers())));
  // Super admins first, then admins; the assignment matrix is for admins only (super admins see everything).
  const people = useMemo(() => [...live.data].sort((a, b) => (a.role === b.role ? a.name.localeCompare(b.name) : a.role === "superadmin" ? -1 : 1)), [live.data]);
  const admins = useMemo(() => people.filter((a) => a.role === "admin"), [people]);
  const [adding, setAdding] = useState(false);
  const [pinFor, setPinFor] = useState<Admin | null>(null);
  const [draft, setDraft] = useState<Record<string, string[]>>({});
  const { run, pending } = useRunPlan();

  const assignedCount = (uid: string) => clients.data.filter((c) => c.adminUids.includes(uid)).length;
  const assignedCtxs = (uid: string) => clients.data.filter((c) => c.adminUids.includes(uid)).map((c) => planCtx(c.id));
  const current = (cid: string) => draft[cid] ?? clients.data.find((c) => c.id === cid)?.adminUids ?? [];
  const changedClients = clients.data.filter((c) => draft[c.id] && JSON.stringify([...draft[c.id]!].sort()) !== JSON.stringify([...c.adminUids].sort()));

  if (!isSuper) return <Empty icon={ShieldOff} label="Only the super admin manages admins." className="flex-1" />;

  const columns: Column<Admin>[] = [
    { key: "name", header: "Name", sort: (a) => a.name, cell: (a) => <UserChip name={a.name} /> },
    { key: "role", header: "Role", sort: (a) => a.role, cell: (a) => (a.role === "superadmin" ? "Super admin" : "Admin") },
    { key: "email", header: "Email", sort: (a) => a.email ?? "", cell: (a) => <span className="text-muted-foreground">{a.email ?? "—"}</span>, hideBelow: "md" },
    { key: "clients", header: "Clients", align: "right", sort: (a) => (a.role === "superadmin" ? Infinity : assignedCount(a.id)), cell: (a) => (a.role === "superadmin" ? "All" : assignedCount(a.id)) },
    {
      key: "pin",
      header: "Till PIN",
      sort: (a) => (a.role === "superadmin" ? -1 : a.pinHash ? 1 : 0),
      cell: (a) =>
        a.role === "superadmin" ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            // Pull the ghost padding back so the icon lines up with the column header.
            className={cn("-ml-2.5 whitespace-nowrap", !a.pinHash && "text-warning")}
            onClick={(e) => {
              e.stopPropagation();
              setPinFor(a);
            }}
            aria-label={`${a.pinHash ? "Change" : "Set"} ${a.name}'s till PIN`}
          >
            <KeyRound data-icon="inline-start" aria-hidden />
            {a.pinHash ? "Change" : "Set PIN"}
          </Button>
        ),
    },
    { key: "status", header: "Status", sort: (a) => (a.active ? 1 : 0), cell: (a) => <ActiveBadge active={a.active} /> },
    {
      key: "toggle",
      header: <span className="sr-only">Active</span>,
      align: "right",
      cell: (a) => (
        <Switch
          checked={a.active}
          // You can't switch yourself off (that would lock you out of this page).
          disabled={a.id === principal?.id}
          aria-label={`${a.active ? "Deactivate" : "Activate"} ${a.name}`}
          onClick={(e) => e.stopPropagation()}
          onCheckedChange={(v) => {
            const now = Date.now();
            // Their till sign-in follows: off everywhere while deactivated, back on when reactivated.
            const plan = combinePlans(`${a.name} ${v ? "on" : "off"}`, [
              platformUserPlan({ uid: a.id, role: a.role, name: a.name, ...(a.email ? { email: a.email } : {}), active: v, nowMs: now, create: false }),
              adminTillPlan(now, { ...person(a), active: v }, a.role === "admin" ? assignedCtxs(a.id) : [], "status"),
            ]);
            void run(plan, v ? `${a.name} activated` : `${a.name} deactivated`);
          }}
        />
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Admins"
        actions={
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus data-icon="inline-start" aria-hidden />
            Add admin
          </Button>
        }
      />
      <Stats>
        <Stat label="Super admins" value={people.filter((a) => a.role === "superadmin" && a.active).length} />
        <Stat label="Admins" value={admins.filter((a) => a.active).length} />
        <Stat label="Clients assigned" value={clients.data.filter((c) => c.adminUids.length > 0).length} />
        <Stat label="Clients without admin" value={clients.data.filter((c) => c.adminUids.length === 0).length} />
      </Stats>
      <Loadable state={{ ...live, data: people }} onRetry={live.retry} empty={{ icon: ShieldCheck, label: "No admins yet. Admins manage only the clients you assign them.", action: <Button size="sm" onClick={() => setAdding(true)}>Add admin</Button> }}>
        {(rows) => (
          <div className="grid grid-cols-1 gap-4 2xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <DataTable rows={rows} columns={columns} rowKey={(a) => a.id} caption="Admins" />
            <Panel
              title="Assignments"
              action={
                changedClients.length ? (
                  <div className="flex items-center gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setDraft({})} disabled={pending}>
                      Discard
                    </Button>
                    <Button
                      size="sm"
                      disabled={pending}
                      onClick={async () => {
                        const plans = changedClients.map((c) => assignAdminsPlan(planCtx(c.id), c.name, c.adminUids, draft[c.id] ?? [], admins.map(person)));
                        if (await run(plans, `Saved ${plans.length} client${plans.length === 1 ? "" : "s"}`)) setDraft({});
                      }}
                    >
                      Save {changedClients.length}
                    </Button>
                  </div>
                ) : null
              }
            >
              {clients.data.length === 0 || admins.length === 0 ? (
                <p className="px-4 py-6 text-sm text-muted-foreground">{clients.data.length === 0 ? "No clients yet." : "No admins yet. Super admins see every client."}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <caption className="sr-only">Which admin manages which client</caption>
                    <thead>
                      <tr className="border-b">
                        <th scope="col" className="sticky left-0 z-10 bg-card px-4 py-2 text-left text-xs font-medium text-muted-foreground">
                          Client
                        </th>
                        {admins.map((a) => (
                          <th key={a.id} scope="col" className="px-3 py-2 text-center text-xs font-medium whitespace-nowrap text-muted-foreground">
                            {a.name}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {clients.data.map((c) => (
                        <tr key={c.id} className="border-b last:border-0">
                          <th scope="row" className="sticky left-0 z-10 bg-card px-4 py-2 text-left font-normal whitespace-nowrap">
                            {c.name}
                            <span className="ml-2 text-xs text-muted-foreground">{c.city}</span>
                          </th>
                          {admins.map((a) => {
                            const on = current(c.id).includes(a.id);
                            return (
                              <td key={a.id} className="px-3 py-2 text-center">
                                <Checkbox
                                  checked={on}
                                  aria-label={`${a.name} manages ${c.name}`}
                                  onCheckedChange={(v) =>
                                    setDraft((d) => {
                                      const base = d[c.id] ?? c.adminUids;
                                      return { ...d, [c.id]: v ? [...new Set([...base, a.id])] : base.filter((x) => x !== a.id) };
                                    })
                                  }
                                />
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          </div>
        )}
      </Loadable>
      <AddAdminDialog open={adding} onOpenChange={setAdding} />
      <AdminPinDialog admin={pinFor} assigned={pinFor ? assignedCtxs(pinFor.id) : []} onOpenChange={(o) => !o && setPinFor(null)} />
    </>
  );
}

"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { collection, query, where } from "firebase/firestore";
import { ArrowRight, Building2, Pencil, Plus } from "lucide-react";
import { assignAdminsPlan, MODE_LABEL, ORDER_MODES, paths, updateClientPlan, type Client, type PlatformUser } from "@px-pos/core";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { DataTable, type Column } from "@/components/shared/data-table";
import { Loadable } from "@/components/shared/loadable";
import { PageHeader } from "@/components/shared/page-header";
import { KV, Panel } from "@/components/shared/panel";
import { RecordSheet } from "@/components/shared/record-sheet";
import { SearchInput } from "@/components/shared/search-input";
import { Stat, Stats } from "@/components/shared/stat";
import { ActiveBadge } from "@/components/shared/status-badge";
import { UserChip } from "@/components/shared/user-avatar";
import { usePrincipal } from "@/components/providers/principal-provider";
import { useClients } from "@/hooks/use-clients";
import { useCollection, type WithId } from "@/lib/firebase/hooks";
import { fmtDate } from "@/lib/format";
import { useRunPlan } from "@/lib/run-plan";
import { ClientFormDialog } from "./client-form-dialog";

type Row = WithId<Client>;
const TAX_LABEL = { regular: "Regular GST", composition: "Composition", unregistered: "Not registered" } as const;
const modesOf = (c: Client) => ORDER_MODES.filter((m) => c.orderModes?.[m]).map((m) => MODE_LABEL[m]);

export function ClientsView() {
  const clients = useClients();
  const { isSuper, planCtx } = usePrincipal();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"all" | "active" | "suspended">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draftAdmins, setDraftAdmins] = useState<string[] | null>(null);
  const [confirmSuspend, setConfirmSuspend] = useState(false);
  const [editing, setEditing] = useState(false);
  const { run, pending } = useRunPlan();
  const creating = params.get("new") === "1";

  const admins = useCollection<PlatformUser>(isSuper ? "platformUsers:admins" : null, (db) => query(collection(db, paths.platformUsers()), where("role", "==", "admin")));
  const adminName = useMemo(() => new Map(admins.data.map((a) => [a.id, a.name])), [admins.data]);
  // Deleted admins can't be assigned again (their names still resolve above for history).
  const assignable = useMemo(() => admins.data.filter((a) => !a.deletedAtMs), [admins.data]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return clients.data.filter(
      (c) =>
        (status === "all" || c.status === status) &&
        (!needle || [c.name, c.legalName, c.city, c.gstin ?? "", c.id].some((v) => v.toLowerCase().includes(needle))),
    );
  }, [clients.data, q, status]);
  const selected = clients.data.find((c) => c.id === selectedId) ?? null;

  const setCreating = (on: boolean) => {
    const sp = new URLSearchParams(params.toString());
    if (on) sp.set("new", "1");
    else sp.delete("new");
    router.replace(sp.size ? `${pathname}?${sp}` : pathname, { scroll: false });
  };

  const columns: Column<Row>[] = [
    {
      key: "name",
      header: "Client",
      sort: (c) => c.name,
      cell: (c) => (
        <span className="flex flex-col">
          <span className="font-medium">{c.name}</span>
          <span className="text-xs text-muted-foreground">{c.legalName}</span>
        </span>
      ),
    },
    { key: "city", header: "City", sort: (c) => c.city, cell: (c) => `${c.city}, ${c.stateName}`, hideBelow: "md" },
    { key: "gstin", header: "GSTIN", cell: (c) => (c.gstin ? <span className="font-mono text-xs">{c.gstin}</span> : c.taxMode === "regular" ? <span className="text-xs text-warning">Not added</span> : "—"), hideBelow: "xl" },
    { key: "tax", header: "Tax", sort: (c) => c.taxMode, cell: (c) => <span className="text-muted-foreground">{TAX_LABEL[c.taxMode]}</span>, hideBelow: "lg" },
    {
      key: "admins",
      header: "Admins",
      sort: (c) => c.adminUids.length,
      cell: (c) => (c.adminUids.length ? <span className="text-muted-foreground">{c.adminUids.map((u) => adminName.get(u) ?? "Unknown").join(", ")}</span> : <span className="text-muted-foreground">Super admin only</span>),
      hideBelow: "lg",
    },
    { key: "modes", header: "Order modes", cell: (c) => <span className="text-muted-foreground">{modesOf(c).join(" · ") || "None"}</span>, hideBelow: "xl" },
    { key: "status", header: "Status", sort: (c) => c.status, cell: (c) => <ActiveBadge active={c.status === "active"} off="Suspended" /> },
  ];

  const draft = draftAdmins ?? selected?.adminUids ?? [];
  const adminsChanged = selected ? JSON.stringify([...draft].sort()) !== JSON.stringify([...selected.adminUids].sort()) : false;

  return (
    <>
      <PageHeader
        title="Clients"
        actions={
          <>
            <SearchInput value={q} onChange={setQ} placeholder="Search clients" />
            <ToggleGroup type="single" variant="outline" size="sm" value={status} onValueChange={(v) => v && setStatus(v as typeof status)} aria-label="Status">
              <ToggleGroupItem value="all" className="px-3">All</ToggleGroupItem>
              <ToggleGroupItem value="active" className="px-3">Active</ToggleGroupItem>
              <ToggleGroupItem value="suspended" className="px-3">Suspended</ToggleGroupItem>
            </ToggleGroup>
            {isSuper ? (
              <Button size="sm" onClick={() => setCreating(true)}>
                <Plus data-icon="inline-start" aria-hidden />
                Add client
              </Button>
            ) : null}
          </>
        }
      />
      <Stats>
        <Stat label="Clients" value={clients.data.length} />
        <Stat label="Active" value={clients.data.filter((c) => c.status === "active").length} />
        <Stat label="With GSTIN" value={clients.data.filter((c) => c.gstin).length} />
        <Stat label="Unassigned" value={clients.data.filter((c) => c.adminUids.length === 0).length} />
      </Stats>
      <Loadable state={clients} onRetry={clients.retry} empty={{ icon: Building2, label: isSuper ? "No clients yet. Add the first outlet." : "No clients are assigned to you yet." }}>
        {() =>
          rows.length ? (
            <DataTable
              rows={rows}
              columns={columns}
              rowKey={(c) => c.id}
              selectedKey={selectedId}
              onRowClick={(c) => {
                setSelectedId(c.id);
                setDraftAdmins(null);
              }}
              initialSort={{ key: "name", dir: "asc" }}
              caption="Clients"
              mobileRow={(c) => (
                <div className="flex items-center justify-between gap-3">
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate font-medium">{c.name}</span>
                    <span className="truncate text-xs text-muted-foreground">{c.city}</span>
                  </span>
                  <ActiveBadge active={c.status === "active"} off="Suspended" />
                </div>
              )}
            />
          ) : (
            <p className="rounded-xl border border-dashed px-6 py-12 text-center text-sm text-muted-foreground">No clients match these filters.</p>
          )
        }
      </Loadable>

      <RecordSheet
        open={Boolean(selected)}
        onOpenChange={(o) => !o && setSelectedId(null)}
        title={selected?.name ?? ""}
        meta={selected ? <ActiveBadge active={selected.status === "active"} off="Suspended" /> : null}
        footer={
          selected ? (
            <>
              {isSuper ? (
                <Button variant={selected.status === "active" ? "destructive" : "outline"} onClick={() => setConfirmSuspend(true)} className="mr-auto">
                  {selected.status === "active" ? "Suspend" : "Reactivate"}
                </Button>
              ) : null}
              <Button variant="outline" onClick={() => setEditing(true)}>
                <Pencil data-icon="inline-start" aria-hidden />
                Edit
              </Button>
              <Button asChild>
                <Link href={`/c/${selected.id}`}>
                  Open client
                  <ArrowRight data-icon="inline-end" aria-hidden />
                </Link>
              </Button>
            </>
          ) : null
        }
      >
        {selected ? (
          <div className="flex flex-col gap-6">
            <KV
              items={[
                { label: "Legal name", value: selected.legalName },
                { label: "Address", value: selected.address },
                { label: "State", value: `${selected.stateName} (${selected.stateCode})` },
                { label: "Phone", value: selected.phone },
                { label: "GSTIN", value: selected.gstin ? <span className="font-mono">{selected.gstin}</span> : selected.taxMode === "regular" ? <span className="text-warning">Not added</span> : "—" },
                { label: "FSSAI", value: selected.fssai ? <span className="font-mono">{selected.fssai}</span> : <span className="text-warning">Not added</span> },
                { label: "Tax", value: TAX_LABEL[selected.taxMode] },
                { label: "Invoice prefix", value: selected.invoicePrefix || "None" },
                { label: "Order modes", value: modesOf(selected).join(", ") || "None" },
                { label: "Client ID", value: <span className="font-mono text-xs">{selected.id}</span> },
                { label: "Created", value: fmtDate(selected.createdAtMs) },
              ]}
            />
            {isSuper ? (
              <Panel
                title="Assigned admins"
                action={
                  adminsChanged ? (
                    <Button
                      size="sm"
                      disabled={pending}
                      onClick={async () => {
                        const people = assignable.map((a) => ({ uid: a.id, name: a.name, active: a.active, ...(a.pinHash ? { pinHash: a.pinHash } : {}) }));
                        const ok = await run(assignAdminsPlan(planCtx(selected.id), selected.name, selected.adminUids, draft, people), "Admins updated");
                        if (ok) setDraftAdmins(null);
                      }}
                    >
                      Save
                    </Button>
                  ) : null
                }
              >
                {assignable.length === 0 ? (
                  <p className="px-4 py-4 text-sm text-muted-foreground">
                    No admins yet.{" "}
                    <Link href="/admins" className="text-foreground underline-offset-4 hover:underline">
                      Add one
                    </Link>
                  </p>
                ) : (
                  <ul className="divide-y">
                    {[...assignable].sort((a, b) => a.name.localeCompare(b.name)).map((a) => {
                      const id = `assign-${a.id}`;
                      return (
                        <li key={a.id} className="flex min-h-11 items-center gap-3 px-4">
                          <Checkbox
                            id={id}
                            checked={draft.includes(a.id)}
                            onCheckedChange={(v) => setDraftAdmins(v ? [...draft, a.id] : draft.filter((x) => x !== a.id))}
                          />
                          <Label htmlFor={id} className="flex-1 cursor-pointer font-normal">
                            <UserChip name={a.name} />
                          </Label>
                          {!a.active ? <span className="text-xs text-muted-foreground">Inactive</span> : null}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Panel>
            ) : null}
          </div>
        ) : null}
      </RecordSheet>

      {selected ? (
        <ConfirmDialog
          open={confirmSuspend}
          onOpenChange={setConfirmSuspend}
          title={selected.status === "active" ? `Suspend ${selected.name}?` : `Reactivate ${selected.name}?`}
          description={selected.status === "active" ? "Terminals stay paired, but the client is marked suspended across the panel." : "The client becomes active again."}
          confirmLabel={selected.status === "active" ? "Suspend" : "Reactivate"}
          destructive={selected.status === "active"}
          onConfirm={async () => {
            const ok = await run(updateClientPlan(planCtx(selected.id), selected, { status: selected.status === "active" ? "suspended" : "active" }, "client.status"), "Client updated");
            if (!ok) throw new Error("Couldn't update the client.");
          }}
        />
      ) : null}

      {isSuper ? <ClientFormDialog open={creating} onOpenChange={setCreating} /> : null}
      <ClientFormDialog open={editing && Boolean(selected)} onOpenChange={setEditing} client={selected} />
    </>
  );
}

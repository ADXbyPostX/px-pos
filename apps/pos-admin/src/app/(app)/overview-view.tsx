"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building2, Plus } from "lucide-react";
import { MODE_LABEL, ORDER_MODES, type Client } from "@px-pos/core";
import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/shared/data-table";
import { Loadable } from "@/components/shared/loadable";
import { PageHeader } from "@/components/shared/page-header";
import { Stat, Stats } from "@/components/shared/stat";
import { ActiveBadge } from "@/components/shared/status-badge";
import { usePrincipal } from "@/components/providers/principal-provider";
import { useClients } from "@/hooks/use-clients";
import type { WithId } from "@/lib/firebase/hooks";

const modesOf = (c: Client) => ORDER_MODES.filter((m) => c.orderModes?.[m]).map((m) => MODE_LABEL[m]).join(" · ") || "None";

export function OverviewView() {
  const clients = useClients();
  const { isSuper } = usePrincipal();
  const router = useRouter();
  const active = clients.data.filter((c) => c.status === "active").length;

  const columns: Column<WithId<Client>>[] = [
    { key: "name", header: "Client", sort: (c) => c.name, cell: (c) => <span className="font-medium">{c.name}</span> },
    { key: "city", header: "City", sort: (c) => c.city, cell: (c) => c.city, hideBelow: "md" },
    { key: "gstin", header: "GSTIN", cell: (c) => <span className="font-mono text-xs">{c.gstin ?? "—"}</span>, hideBelow: "lg" },
    { key: "modes", header: "Order modes", cell: (c) => <span className="text-muted-foreground">{modesOf(c)}</span>, hideBelow: "lg" },
    { key: "status", header: "Status", sort: (c) => c.status, cell: (c) => <ActiveBadge active={c.status === "active"} off="Suspended" /> },
  ];

  return (
    <>
      <PageHeader
        title="Overview"
        actions={
          isSuper ? (
            <Button size="sm" asChild>
              <Link href="/clients?new=1">
                <Plus data-icon="inline-start" aria-hidden />
                Add client
              </Link>
            </Button>
          ) : null
        }
      />
      <Stats>
        <Stat label="Clients" value={clients.data.length} />
        <Stat label="Active" value={active} />
        <Stat label="Suspended" value={clients.data.length - active} />
        <Stat label="Order modes on" value={clients.data.reduce((n, c) => n + ORDER_MODES.filter((m) => c.orderModes?.[m]).length, 0)} />
      </Stats>
      <Loadable
        state={clients}
        onRetry={clients.retry}
        empty={{ icon: Building2, label: isSuper ? "No clients yet. Add the first outlet to get started." : "No clients are assigned to you yet." }}
      >
        {(rows) => <DataTable rows={rows} columns={columns} rowKey={(c) => c.id} onRowClick={(c) => router.push(`/c/${c.id}`)} initialSort={{ key: "name", dir: "asc" }} caption="Clients" />}
      </Loadable>
    </>
  );
}

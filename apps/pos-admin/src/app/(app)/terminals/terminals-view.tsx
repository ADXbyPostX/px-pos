"use client";

import { useMemo } from "react";
import { collectionGroup, query } from "firebase/firestore";
import { MonitorSmartphone, ShieldOff } from "lucide-react";
import { presence, type Terminal } from "@px-pos/core";
import { Empty } from "@/components/shared/empty";
import { Loadable } from "@/components/shared/loadable";
import { PageHeader } from "@/components/shared/page-header";
import { Stat, Stats } from "@/components/shared/stat";
import { PendingRequests } from "@/components/terminals/pending-requests";
import { TerminalsTable, type TerminalRow } from "@/components/terminals/terminals-table";
import { usePrincipal } from "@/components/providers/principal-provider";
import { useClients } from "@/hooks/use-clients";
import { useCollection, useNow } from "@/lib/firebase/hooks";

/** Super admin: every client's terminals in one place (collection-group read). */
export function AllTerminalsView() {
  const { isSuper } = usePrincipal();
  const clients = useClients();
  const now = useNow(30_000);
  const live = useCollection<Terminal>(isSuper ? "terminals:all" : null, (db) => query(collectionGroup(db, "terminals")));
  const names = useMemo(() => new Map(clients.data.map((c) => [c.id, c.name])), [clients.data]);
  const rows: TerminalRow[] = useMemo(
    () =>
      live.data.map((t) => {
        const cid = t._path?.split("/")[1] ?? "";
        return { ...t, cid, clientName: names.get(cid) ?? cid };
      }),
    [live.data, names],
  );
  if (!isSuper) return <Empty icon={ShieldOff} label="Only the super admin sees every client's terminals." className="flex-1" />;
  const active = rows.filter((t) => t.status === "active");
  const p = active.map((t) => presence(t.lastSeenAtMs, now));
  return (
    <>
      <PageHeader title="All terminals" />
      <Stats>
        <Stat label="Terminals" value={active.length} />
        <Stat label="Online" value={p.filter((x) => x === "online").length} />
        <Stat label="Offline > 30 min" value={p.filter((x) => x === "offline").length} accent={p.some((x) => x === "offline")} />
        <Stat label="With failed syncs" value={active.filter((t) => (t.journalRejected ?? 0) > 0).length} />
      </Stats>
      <PendingRequests />
      <Loadable state={{ ...live, data: rows }} onRetry={live.retry} empty={{ icon: MonitorSmartphone, label: "No terminals paired yet." }}>
        {(data) => <TerminalsTable rows={data} showClient />}
      </Loadable>
    </>
  );
}

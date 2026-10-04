"use client";

import { useMemo, useState } from "react";
import { collection, query } from "firebase/firestore";
import { Plus, Tablet } from "lucide-react";
import { paths, presence, type Terminal } from "@px-pos/core";
import { Button } from "@/components/ui/button";
import { Loadable } from "@/components/shared/loadable";
import { PageHeader } from "@/components/shared/page-header";
import { Stat, Stats } from "@/components/shared/stat";
import { PairDialog } from "@/components/terminals/pair-dialog";
import { PendingRequests } from "@/components/terminals/pending-requests";
import { TerminalsTable, type TerminalRow } from "@/components/terminals/terminals-table";
import { useClient } from "@/components/providers/client-provider";
import { useCollection, useNow } from "@/lib/firebase/hooks";

export function ClientTerminalsView() {
  const { cid, client } = useClient();
  const now = useNow(30_000);
  const live = useCollection<Terminal>(`terminals:${cid}`, (db) => query(collection(db, paths.col(cid, "terminals"))));
  const [pairOpen, setPairOpen] = useState(false);
  const [code, setCode] = useState<string | undefined>(undefined);
  const rows: TerminalRow[] = useMemo(() => live.data.map((t) => ({ ...t, cid })), [live.data, cid]);
  const active = rows.filter((t) => t.status === "active");
  const p = active.map((t) => presence(t.lastSeenAtMs, now));

  return (
    <>
      <PageHeader
        title="Terminals"
        actions={
          <Button
            size="sm"
            onClick={() => {
              setCode(undefined);
              setPairOpen(true);
            }}
          >
            <Plus data-icon="inline-start" aria-hidden />
            Pair terminal
          </Button>
        }
      />
      <Stats>
        <Stat label="Online" value={p.filter((x) => x === "online").length} />
        <Stat label="Stale" value={p.filter((x) => x === "stale").length} />
        <Stat label="Offline" value={p.filter((x) => x === "offline" || x === "never").length} />
        <Stat label="Unsynced changes" value={active.reduce((n, t) => n + (t.pendingWrites ?? 0), 0)} accent={active.some((t) => (t.journalRejected ?? 0) > 0)} />
      </Stats>
      <PendingRequests
        onPair={(c) => {
          setCode(c);
          setPairOpen(true);
        }}
      />
      <Loadable
        state={{ ...live, data: rows }}
        onRetry={live.retry}
        empty={{ icon: Tablet, label: "No terminals yet. Install PX POS on a tablet, open it, and pair the code it shows.", action: <Button size="sm" onClick={() => setPairOpen(true)}>Pair terminal</Button> }}
      >
        {(data) => <TerminalsTable rows={data} />}
      </Loadable>
      <PairDialog open={pairOpen} onOpenChange={setPairOpen} client={client} terminals={live.data} initialCode={code} />
    </>
  );
}

"use client";

import { collection, query, where } from "firebase/firestore";
import { Tablet } from "lucide-react";
import { paths, rejectPairingPlan, type PairingRequest } from "@px-pos/core";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/shared/panel";
import { usePrincipal } from "@/components/providers/principal-provider";
import { useCollection, useNow } from "@/lib/firebase/hooks";
import { ago } from "@/lib/format";
import { useRunPlan } from "@/lib/run-plan";

/** Tablets currently showing a pairing code. Only the super admin may see (and pair) them. */
export function usePendingRequests(enabled = true) {
  return useCollection<PairingRequest>(enabled ? "pairingRequests:pending" : null, (db) => query(collection(db, paths.pairingRequests()), where("status", "==", "pending")));
}

export function PendingRequests({ onPair }: { onPair?: (code: string) => void }) {
  const { isSuper } = usePrincipal();
  const pending = usePendingRequests(isSuper);
  const now = useNow(15_000);
  const { run } = useRunPlan();
  const rows = [...pending.data].sort((a, b) => b.createdAtMs - a.createdAtMs);
  if (pending.status !== "ready" || rows.length === 0) return null;
  return (
    <Panel title={`Waiting to pair (${rows.length})`}>
      <ul className="divide-y">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <Tablet className="size-4 text-brand" aria-hidden />
            <span className="font-mono text-sm tracking-wider">{r.code}</span>
            <span className="text-sm text-muted-foreground">
              {r.deviceName} · {r.model} · {r.platform} · v{r.appVersion}
            </span>
            <span className="text-xs text-muted-foreground tabular-nums">{ago(r.createdAtMs, now)}</span>
            <span className="ml-auto flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => void run(rejectPairingPlan(Date.now(), r.id), "Request rejected")}>
                Reject
              </Button>
              {onPair ? (
                <Button size="sm" onClick={() => onPair(r.code)}>
                  Pair here
                </Button>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

"use client";

import { useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { presence, revokeTerminalPlan, SKEW_WARN_MS, terminalUpdatePlan, type Terminal } from "@px-pos/core";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { DataTable, type Column } from "@/components/shared/data-table";
import { Field } from "@/components/shared/field";
import { FormDialog } from "@/components/shared/form-dialog";
import { FormError } from "@/components/shared/form-controls";
import { ActiveBadge, Flag, PresenceBadge } from "@/components/shared/status-badge";
import { usePrincipal } from "@/components/providers/principal-provider";
import { useNow, type WithId } from "@/lib/firebase/hooks";
import { ago } from "@/lib/format";
import { useRunPlan } from "@/lib/run-plan";

export type TerminalRow = WithId<Terminal> & { cid: string; clientName?: string };

/** Terminal list with presence, sync health and actions (rename, mode, revoke). */
export function TerminalsTable({ rows, showClient = false }: { rows: TerminalRow[]; showClient?: boolean }) {
  const now = useNow(30_000);
  const { planCtx } = usePrincipal();
  const { run, pending } = useRunPlan();
  const [renaming, setRenaming] = useState<TerminalRow | null>(null);
  const [newName, setNewName] = useState("");
  const [revoking, setRevoking] = useState<TerminalRow | null>(null);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const columns: Column<TerminalRow>[] = [
    ...(showClient ? [{ key: "client", header: "Client", sort: (t: TerminalRow) => t.clientName ?? t.cid, cell: (t: TerminalRow) => t.clientName ?? t.cid } satisfies Column<TerminalRow>] : []),
    {
      key: "name",
      header: "Terminal",
      sort: (t) => t.name,
      cell: (t) => (
        <span className="flex items-center gap-2">
          <span className="flex size-6 items-center justify-center rounded-md border font-mono text-xs">{t.code}</span>
          <span className="flex flex-col">
            <span className="font-medium">{t.name}</span>
            <span className="text-xs text-muted-foreground">{t.mode === "kds" ? "Kitchen display" : "Billing"}</span>
          </span>
        </span>
      ),
    },
    { key: "presence", header: "Presence", sort: (t) => t.lastSeenAtMs ?? 0, cell: (t) => (t.status === "revoked" ? <ActiveBadge active={false} off="Revoked" /> : <PresenceBadge presence={presence(t.lastSeenAtMs, now)} />) },
    { key: "seen", header: "Last seen", sort: (t) => t.lastSeenAtMs ?? 0, cell: (t) => <span className="text-muted-foreground tabular-nums">{ago(t.lastSeenAtMs, now)}</span>, hideBelow: "md" },
    {
      key: "series",
      header: "Last invoice",
      sort: (t) => t.lastInvoiceSeq,
      cell: (t) => (
        <span className="font-mono text-xs">
          {t.series}/{t.lastInvoiceFy}/{String(t.lastInvoiceSeq).padStart(6, "0")}
        </span>
      ),
      hideBelow: "lg",
    },
    {
      key: "health",
      header: "Sync",
      sort: (t) => (t.pendingWrites ?? 0) + (t.journalRejected ?? 0) * 1000,
      cell: (t) => (
        <span className="flex flex-wrap gap-1">
          {t.pendingWrites ? <Flag>{`${t.pendingWrites} queued`}</Flag> : null}
          {t.journalRejected ? <Flag tone="red">{`${t.journalRejected} failed`}</Flag> : null}
          {t.clockSkewMs != null && Math.abs(t.clockSkewMs) > SKEW_WARN_MS ? <Flag>Clock off</Flag> : null}
          {!t.pendingWrites && !t.journalRejected ? <span className="text-xs text-muted-foreground">OK</span> : null}
        </span>
      ),
    },
    { key: "device", header: "Device", cell: (t) => <span className="text-xs text-muted-foreground">{[t.model, t.appVersion && `v${t.appVersion}`].filter(Boolean).join(" · ") || "—"}</span>, hideBelow: "xl" },
    {
      key: "actions",
      header: <span className="sr-only">Actions</span>,
      align: "right",
      cell: (t) =>
        t.status === "revoked" ? null : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${t.name}`} onClick={(e) => e.stopPropagation()}>
                <MoreHorizontal aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onSelect={() => {
                  setNewName(t.name);
                  setErr(null);
                  setRenaming(t);
                }}
              >
                Rename
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void run(terminalUpdatePlan(planCtx(t.cid), t.id, { mode: t.mode === "kds" ? "pos" : "kds" }, t), "Terminal updated")}>
                {t.mode === "kds" ? "Use for billing" : "Use as kitchen display"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => {
                  setReason("");
                  setRevoking(t);
                }}
              >
                Revoke
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ),
    },
  ];

  return (
    <>
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(t) => `${t.cid}/${t.id}`}
        initialSort={{ key: "name", dir: "asc" }}
        caption="Terminals"
        rowClassName={(t) => (t.status === "revoked" ? "opacity-60" : undefined)}
        mobileRow={(t) => (
          <div className="flex items-center justify-between gap-3">
            <span className="flex min-w-0 flex-col">
              <span className="truncate font-medium">
                {t.code} · {t.name}
              </span>
              <span className="truncate text-xs text-muted-foreground">{showClient ? t.clientName : t.mode === "kds" ? "Kitchen display" : "Billing"}</span>
            </span>
            {t.status === "revoked" ? <ActiveBadge active={false} off="Revoked" /> : <PresenceBadge presence={presence(t.lastSeenAtMs, now)} />}
          </div>
        )}
      />
      <FormDialog
        open={Boolean(renaming)}
        onOpenChange={(o) => !o && setRenaming(null)}
        title="Rename terminal"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRenaming(null)}>
              Cancel
            </Button>
            <Button
              disabled={pending}
              onClick={async () => {
                if (!renaming) return;
                if (!newName.trim()) return setErr("Name is required");
                if (await run(terminalUpdatePlan(planCtx(renaming.cid), renaming.id, { name: newName.trim() }, renaming), "Renamed")) setRenaming(null);
              }}
            >
              Save
            </Button>
          </>
        }
      >
        <Field label="Name" htmlFor="t-rename">
          <Input id="t-rename" value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={30} autoFocus />
        </Field>
        <FormError error={err} />
      </FormDialog>
      {revoking ? (
        <ConfirmDialog
          open={Boolean(revoking)}
          onOpenChange={(o) => !o && setRevoking(null)}
          title={`Revoke ${revoking.name}?`}
          description={
            revoking.pendingWrites
              ? `This tablet still has ${revoking.pendingWrites} unsynced change(s). Revoking now means those will be rejected. A replacement gets a new code and invoice series.`
              : "The tablet stops working for this client immediately. A replacement gets a new code and invoice series."
          }
          confirmLabel="Revoke"
          onConfirm={async () => {
            if (!reason.trim()) throw new Error("Give a reason");
            const ok = await run(revokeTerminalPlan(planCtx(revoking.cid), { id: revoking.id, authUid: revoking.authUid, name: revoking.name, pendingWrites: revoking.pendingWrites ?? 0 }, reason.trim()), "Terminal revoked");
            if (!ok) throw new Error("Couldn't revoke the terminal.");
          }}
        >
          <Field label="Reason" htmlFor="t-reason">
            <Textarea id="t-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={200} />
          </Field>
        </ConfirmDialog>
      ) : null}
    </>
  );
}

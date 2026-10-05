"use client";

import { useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { collection, getDocsFromServer, limit, query, where } from "firebase/firestore";
import { fyFor, paths, presence, restartNumberingPlan, revokeTerminalPlan, SKEW_WARN_MS, terminalUpdatePlan, type CatalogLayout, type Terminal } from "@px-pos/core";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { DataTable, type Column } from "@/components/shared/data-table";
import { Field } from "@/components/shared/field";
import { FormDialog } from "@/components/shared/form-dialog";
import { FormError } from "@/components/shared/form-controls";
import { ActiveBadge, Flag, PresenceBadge } from "@/components/shared/status-badge";
import { usePrincipal } from "@/components/providers/principal-provider";
import { getDb } from "@/lib/firebase/client";
import { useNow, type WithId } from "@/lib/firebase/hooks";
import { ago } from "@/lib/format";
import { useRunPlan } from "@/lib/run-plan";
import { cn } from "@/lib/utils";

export type TerminalRow = WithId<Terminal> & { cid: string; clientName?: string };

const LAYOUTS: Array<{ value: CatalogLayout; label: string }> = [
  { value: "top", label: "Categories on top" },
  { value: "side", label: "Categories on the side" },
];

/** A tiny picture of each menu layout (flat blocks, no images). */
function LayoutPreview({ layout }: { layout: CatalogLayout }) {
  const tiles = (n: number, cols: string) => (
    <div className={cn("grid flex-1 gap-1", cols)}>
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="h-7 rounded-sm bg-muted-foreground/25" />
      ))}
    </div>
  );
  return (
    <div aria-hidden className="flex h-28 flex-col gap-1.5 rounded-md border bg-background p-2">
      {layout === "top" ? (
        <>
          <div className="flex gap-1">
            {[10, 14, 12, 9].map((w, i) => (
              <div key={i} className={cn("h-2.5 rounded-full", i === 0 ? "bg-primary/70" : "bg-muted-foreground/30")} style={{ width: `${w * 4}%` }} />
            ))}
          </div>
          {tiles(9, "grid-cols-3")}
        </>
      ) : (
        <div className="flex flex-1 gap-1.5">
          <div className="flex w-1/3 flex-col gap-1">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className={cn("h-2.5 rounded-sm", i === 0 ? "bg-primary/70" : "bg-muted-foreground/30")} />
            ))}
          </div>
          {tiles(6, "grid-cols-2")}
        </div>
      )}
    </div>
  );
}

/** Per-terminal settings (reach the till live). For now: how its menu is laid out. */
function TerminalSettingsDialog({ terminal, onClose }: { terminal: TerminalRow | null; onClose: () => void }) {
  const { planCtx } = usePrincipal();
  const { run, pending } = useRunPlan();
  const [catalog, setCatalog] = useState<CatalogLayout>(terminal?.catalog ?? "top");
  // Fresh form each time it opens for a terminal — adjusted during render.
  const [seen, setSeen] = useState<string | null>(null);
  const key = terminal ? `${terminal.cid}/${terminal.id}` : null;
  if (key !== seen) {
    setSeen(key);
    setCatalog(terminal?.catalog ?? "top");
  }
  return (
    <FormDialog
      open={terminal != null}
      onOpenChange={(o) => !o && !pending && onClose()}
      title={terminal ? `${terminal.name} settings` : "Terminal settings"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={pending || !terminal || catalog === (terminal.catalog ?? "top")}
            onClick={async () => {
              if (!terminal) return;
              if (await run(terminalUpdatePlan(planCtx(terminal.cid), terminal.id, { catalog }, terminal), "Settings saved")) onClose();
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-3 text-sm font-medium">Menu layout</legend>
        <RadioGroup value={catalog} onValueChange={(v) => setCatalog(v as CatalogLayout)} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {LAYOUTS.map((l) => (
            <label key={l.value} htmlFor={`catalog-${l.value}`} className={cn("flex cursor-pointer flex-col gap-2 rounded-lg border p-3 hover:bg-muted/40", catalog === l.value && "border-primary bg-primary/5")}>
              <LayoutPreview layout={l.value} />
              <span className="flex items-center gap-2 text-sm">
                <RadioGroupItem id={`catalog-${l.value}`} value={l.value} />
                {l.label}
              </span>
            </label>
          ))}
        </RadioGroup>
      </fieldset>
    </FormDialog>
  );
}

/** Terminal list with presence, sync health and actions (settings, rename, mode, revoke). */
export function TerminalsTable({ rows, showClient = false }: { rows: TerminalRow[]; showClient?: boolean }) {
  const now = useNow(30_000);
  const { planCtx, isSuper } = usePrincipal();
  const [restarting, setRestarting] = useState<TerminalRow | null>(null);
  const { run, pending } = useRunPlan();
  const [renaming, setRenaming] = useState<TerminalRow | null>(null);
  const [newName, setNewName] = useState("");
  const [revoking, setRevoking] = useState<TerminalRow | null>(null);
  const [settingsFor, setSettingsFor] = useState<TerminalRow | null>(null);
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
              <DropdownMenuItem onSelect={() => setSettingsFor(t)}>Settings</DropdownMenuItem>
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
              {isSuper ? <DropdownMenuItem onSelect={() => setRestarting(t)}>Restart numbering</DropdownMenuItem> : null}
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
      <TerminalSettingsDialog terminal={settingsFor} onClose={() => setSettingsFor(null)} />
      {restarting ? (
        <ConfirmDialog
          open={Boolean(restarting)}
          onOpenChange={(o) => !o && setRestarting(null)}
          title={`Restart numbering on ${restarting.name}?`}
          description={`For going live after test sales are cleared: bills start again at ${restarting.series}/${fyFor(now)}/000001, and KOTs, orders and tokens at 1. The till drops its leftover test tickets.`}
          confirmLabel="Restart numbering"
          onConfirm={async () => {
            // GST: a series never repeats a number. Only allowed once its bills are gone.
            const fy = fyFor(now);
            const left = await getDocsFromServer(query(collection(getDb(), paths.col(restarting.cid, "invoices")), where("series", "==", restarting.series), where("fy", "==", fy), limit(1)));
            if (!left.empty) throw new Error(`Bills in series ${restarting.series} for ${fy} still exist. Clear the test sales first.`);
            const ok = await run(restartNumberingPlan(planCtx(restarting.cid), restarting), "Numbering restarted");
            if (!ok) throw new Error("Couldn't restart the numbering.");
          }}
        />
      ) : null}
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

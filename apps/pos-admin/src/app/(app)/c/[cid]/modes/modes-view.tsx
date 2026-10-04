"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { collection, query } from "firebase/firestore";
import { Armchair, Bike, Loader2, Zap } from "lucide-react";
import { toast } from "sonner";
import { paths, updateClientPlan, type Client, type OrderMode, type Paise, type Table } from "@px-pos/core";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Field } from "@/components/shared/field";
import { MoneyInput, SwitchRow } from "@/components/shared/form-controls";
import { PageHeader } from "@/components/shared/page-header";
import { Panel } from "@/components/shared/panel";
import { useClient } from "@/components/providers/client-provider";
import { usePrincipal } from "@/components/providers/principal-provider";
import { useOpenOrders } from "@/hooks/use-open-orders";
import { useCollection } from "@/lib/firebase/hooks";
import { useRunPlan } from "@/lib/run-plan";

function ModePanel({ title, icon, on, onToggle, disabledReason, children }: { title: string; icon: ReactNode; on: boolean; onToggle: (v: boolean) => void; disabledReason?: string | null; children: ReactNode }) {
  return (
    <Panel
      title={title}
      action={
        <span className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{on ? "Shown in the app" : "Hidden"}</span>
          <Switch checked={on} onCheckedChange={onToggle} aria-label={`${on ? "Turn off" : "Turn on"} ${title}`} />
        </span>
      }
      bodyClassName="flex flex-col gap-1 px-4 py-3"
    >
      <div className="flex items-center gap-3 pb-2">
        <span className={on ? "text-brand [&_svg]:size-5" : "text-muted-foreground [&_svg]:size-5"}>{icon}</span>
        {disabledReason ? <span className="text-xs text-warning">{disabledReason}</span> : null}
      </div>
      <fieldset disabled={!on} className="flex flex-col gap-1 disabled:opacity-50">
        {children}
      </fieldset>
    </Panel>
  );
}

function ChargeField({ label, value, onSave }: { label: string; value: Paise; onSave: (p: Paise) => Promise<boolean> }) {
  const [draft, setDraft] = useState<Paise | null>(value);
  const [saving, setSaving] = useState(false);
  const dirty = draft !== value && draft != null;
  const id = `charge-${label.replace(/\s+/g, "-").toLowerCase()}`;
  return (
    <Field label={label} htmlFor={id} className="py-2">
      <div className="flex items-center gap-2">
        <MoneyInput
          id={id}
          value={draft}
          onChange={setDraft}
          className="flex-1"
          onEnter={async () => {
            if (!dirty || draft == null) return;
            setSaving(true);
            await onSave(draft);
            setSaving(false);
          }}
        />
        {dirty ? (
          <Button
            size="sm"
            disabled={saving}
            onClick={async () => {
              if (draft == null) return;
              setSaving(true);
              await onSave(draft);
              setSaving(false);
            }}
          >
            {saving ? <Loader2 className="animate-spin" aria-hidden /> : "Save"}
          </Button>
        ) : null}
      </div>
    </Field>
  );
}

/** Which order types the app shows, and how each behaves. Saves instantly (audited). */
export function ModesView() {
  const { cid, client } = useClient();
  const { planCtx } = usePrincipal();
  const { run } = useRunPlan();
  const open = useOpenOrders(cid);
  const tables = useCollection<Table>(`tables:${cid}`, (db) => query(collection(db, paths.col(cid, "tables"))));
  const openBy = (m: OrderMode) => open.data.filter((o) => o.mode === m).length;
  const save = (patch: Partial<Client>, msg = "Saved") => run(updateClientPlan(planCtx(cid), client, patch, "client.modes"), msg);

  function toggleMode(m: OrderMode, v: boolean) {
    if (!v) {
      const n = openBy(m);
      if (n > 0) {
        toast.error(`${n} ${m === "dineIn" ? "table" : m} order${n === 1 ? " is" : "s are"} still running. Settle ${n === 1 ? "it" : "them"} first.`);
        return;
      }
      const others = (Object.entries(client.orderModes) as Array<[OrderMode, boolean]>).filter(([k, on]) => k !== m && on);
      if (others.length === 0) {
        toast.error("Keep at least one order mode on.");
        return;
      }
    }
    void save({ orderModes: { ...client.orderModes, [m]: v } }, v ? "Mode turned on" : "Mode turned off");
  }

  const packagingOn = (m: OrderMode) => client.charges.packagingOn.includes(m);
  const setPackagingOn = (m: OrderMode, v: boolean) =>
    save({ charges: { ...client.charges, packagingOn: v ? [...new Set([...client.charges.packagingOn, m])] : client.charges.packagingOn.filter((x) => x !== m) } });

  const activeTables = tables.data.filter((t) => t.active).length;

  return (
    <>
      <PageHeader title="Order modes" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <ModePanel title="Table service" icon={<Armchair aria-hidden />} on={client.orderModes.dineIn} onToggle={(v) => toggleMode("dineIn", v)} disabledReason={openBy("dineIn") ? `${openBy("dineIn")} running` : null}>
          <SwitchRow label="Ask for covers (guests) when a table opens" checked={client.modeOpts.dineIn.askCovers} onCheckedChange={(v) => void save({ modeOpts: { ...client.modeOpts, dineIn: { ...client.modeOpts.dineIn, askCovers: v } } })} />
          <SwitchRow label="Return to tables after sending a KOT" checked={client.modeOpts.dineIn.backToTables} onCheckedChange={(v) => void save({ modeOpts: { ...client.modeOpts, dineIn: { ...client.modeOpts.dineIn, backToTables: v } } })} />
          <SwitchRow label="Packaging charge on dine-in" checked={packagingOn("dineIn")} onCheckedChange={(v) => void setPackagingOn("dineIn", v)} />
          <p className="pt-2 text-sm text-muted-foreground">
            {activeTables} table{activeTables === 1 ? "" : "s"} set up ·{" "}
            <Link href={`/c/${cid}/tables`} className="text-foreground underline-offset-4 hover:underline">
              Manage tables
            </Link>
          </p>
        </ModePanel>

        <ModePanel title="Quick order" icon={<Zap aria-hidden />} on={client.orderModes.quick} onToggle={(v) => toggleMode("quick", v)} disabledReason={openBy("quick") ? `${openBy("quick")} running` : null}>
          <SwitchRow label="Take payment before the KOT goes to the kitchen" checked={client.modeOpts.quick.payFirst} onCheckedChange={(v) => void save({ modeOpts: { ...client.modeOpts, quick: { payFirst: v } } })} />
          <SwitchRow label="Packaging charge on quick orders" checked={packagingOn("quick")} onCheckedChange={(v) => void setPackagingOn("quick", v)} />
          <ChargeField label="Packaging charge per order" value={client.charges.packagingPaise} onSave={(p) => save({ charges: { ...client.charges, packagingPaise: p } }, "Packaging charge saved")} />
        </ModePanel>

        <ModePanel title="Delivery" icon={<Bike aria-hidden />} on={client.orderModes.delivery} onToggle={(v) => toggleMode("delivery", v)} disabledReason={openBy("delivery") ? `${openBy("delivery")} running` : null}>
          <SwitchRow label="New delivery orders are prepaid by default" checked={client.modeOpts.delivery.defaultPrepaid} onCheckedChange={(v) => void save({ modeOpts: { ...client.modeOpts, delivery: { defaultPrepaid: v } } })} />
          <SwitchRow label="Packaging charge on delivery" checked={packagingOn("delivery")} onCheckedChange={(v) => void setPackagingOn("delivery", v)} />
          <ChargeField label="Delivery charge per order" value={client.charges.deliveryPaise} onSave={(p) => save({ charges: { ...client.charges, deliveryPaise: p } }, "Delivery charge saved")} />
        </ModePanel>
      </div>
    </>
  );
}
